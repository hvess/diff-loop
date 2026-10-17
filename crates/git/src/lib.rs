//! [`Repository`] over the `git` command line.
//!
//! Every call runs `git` in the checkout with optional locks off, so polling
//! never contends with an agent committing in the same repository.

mod command;
mod locate;
mod parse;
mod raw;
mod states;
mod untracked;
mod watch;

use std::{
    collections::{BTreeMap, BTreeSet, HashSet},
    fs, io,
    path::{Component, Path, PathBuf},
};

use diff_loop_core::{
    Base, BaseRef, Changes, Checkout, Content, FileDiff, FileStates, Head, NewSide, OnChange,
    RefKind, RepoError, Repository, Side, Snapshot, WatchGuard,
};

use command::{Outcome, Runner};

/// A git working tree.
#[derive(Debug, Clone)]
pub struct Git {
    run: Runner,
}

impl Git {
    /// The working tree containing `path`.
    ///
    /// # Errors
    /// [`RepoError::NotARepository`] when `path` is in no working tree;
    /// [`RepoError::Failed`] when `git` cannot run.
    pub fn open(path: &Path) -> Result<Self, RepoError> {
        let probe = Runner::new(locate::locate(), path.to_path_buf());
        let not_a_repository = || RepoError::NotARepository {
            path: path.display().to_string(),
        };
        if !path.is_dir() {
            return Err(not_a_repository());
        }
        let inside = probe.outcome(&["rev-parse", "--is-inside-work-tree"])?;
        if !matches!(inside, Outcome::Success(out) if out.trim() == "true") {
            return Err(not_a_repository());
        }
        let root = probe.stdout(&["rev-parse", "--show-toplevel"])?;
        Ok(Self {
            run: probe.in_dir(PathBuf::from(root.trim_end_matches('\n'))),
        })
    }

    fn root(&self) -> &Path {
        self.run.dir()
    }

    /// Full id of `HEAD`, or `None` before the first commit.
    fn head_commit(&self) -> Result<Option<String>, RepoError> {
        self.verify("HEAD")
    }

    /// Full id of the commit `name` resolves to, or `None` when it names none.
    fn verify(&self, name: &str) -> Result<Option<String>, RepoError> {
        let spec = format!("{name}^{{commit}}");
        Ok(
            match self.run.outcome(&[
                "rev-parse",
                "--verify",
                "--quiet",
                "--end-of-options",
                &spec,
            ])? {
                Outcome::Success(out) => Some(out.trim().to_owned()),
                Outcome::Failure => None,
            },
        )
    }

    /// The two trees `base` compares.
    fn snapshot(&self, base: &Base) -> Result<Snapshot, RepoError> {
        let head = self.head_commit()?;
        Ok(match base {
            Base::Ref { name } => {
                let base_commit = self
                    .verify(name)?
                    .ok_or_else(|| RepoError::UnknownBase { name: name.clone() })?;
                let head = head.ok_or(RepoError::NoCommits)?;
                let fork = match self.run.outcome(&["merge-base", &base_commit, &head])? {
                    Outcome::Success(out) => out.trim().to_owned(),
                    // Unrelated histories: compare with the base itself.
                    Outcome::Failure => base_commit,
                };
                Snapshot {
                    old: Some(fork),
                    new: NewSide::WorkingTree,
                }
            }
            Base::Uncommitted => Snapshot {
                old: head,
                new: NewSide::WorkingTree,
            },
            Base::LastCommit => {
                let head = head.ok_or(RepoError::NoCommits)?;
                Snapshot {
                    old: self.verify("HEAD^")?,
                    new: NewSide::Commit { id: head },
                }
            }
        })
    }

    /// The raw `git diff` output for `snapshot`, tracked files only, limited
    /// to `paths` when given.
    fn diff_output(
        &self,
        snapshot: &Snapshot,
        paths: Option<&BTreeSet<String>>,
        extra: &[&str],
    ) -> Result<String, RepoError> {
        let old = match &snapshot.old {
            Some(old) => old.clone(),
            None => self.empty_tree()?,
        };
        let mut args = command::DIFF_FLAGS.to_vec();
        args.extend(extra);
        args.push(&old);
        if let NewSide::Commit { id } = &snapshot.new {
            args.push(id);
        }
        args.push("--");
        args.extend(paths.into_iter().flatten().map(String::as_str));
        self.run.stdout(&args)
    }

    fn empty_tree(&self) -> Result<String, RepoError> {
        Ok(self
            .run
            .stdout(&["hash-object", "-t", "tree", "--stdin"])?
            .trim()
            .to_owned())
    }

    /// Untracked, unignored files, relative to the root, limited to `paths`
    /// when given.
    fn untracked(&self, paths: Option<&BTreeSet<String>>) -> Result<Vec<String>, RepoError> {
        let mut args = vec!["ls-files", "--others", "--exclude-standard", "-z", "--"];
        args.extend(paths.into_iter().flatten().map(String::as_str));
        let out = self.run.stdout(&args)?;
        // A nested repository is listed as its directory, with a trailing slash.
        Ok(out
            .split('\0')
            .filter(|p| !p.is_empty() && !p.ends_with('/'))
            .map(str::to_owned)
            .collect())
    }

    /// Untracked files under `paths` that are not among `tracked`, the paths
    /// the diff names: a path git also reports as tracked (staged for
    /// deletion, still on disk) is left out, so each path is listed once.
    fn untracked_beside(
        &self,
        tracked: &HashSet<&str>,
        paths: Option<&BTreeSet<String>>,
    ) -> Result<Vec<String>, RepoError> {
        Ok(self
            .untracked(paths)?
            .into_iter()
            .filter(|path| !tracked.contains(path.as_str()))
            .collect())
    }

    /// Fills in the sizes of binary files, one `git cat-file` for all of them.
    fn size_binaries(&self, snapshot: &Snapshot, files: &mut [FileDiff]) -> Result<(), RepoError> {
        let binaries: Vec<usize> = files
            .iter()
            .enumerate()
            .filter(|(_, f)| matches!(f.content, Content::Binary { .. }))
            .map(|(i, _)| i)
            .collect();
        if binaries.is_empty() {
            return Ok(());
        }
        // One query per side that is a commit, in this order per file; a missing
        // object answers "<name> missing", which parses as no size.
        let new_commit = match &snapshot.new {
            NewSide::Commit { id } => Some(id),
            NewSide::WorkingTree => None,
        };
        let queries: String = binaries
            .iter()
            .map(|&i| &files[i])
            .flat_map(|file| {
                let old = snapshot
                    .old
                    .as_ref()
                    .map(|old| format!("{old}:{}\n", file.old_path()));
                let new = new_commit.map(|id| format!("{id}:{}\n", file.path));
                old.into_iter().chain(new)
            })
            .collect();
        let answers = self
            .run
            .stdout_with_input(&["cat-file", "--batch-check=%(objectsize)"], &queries)?;
        let mut sizes = answers.lines().map(|l| l.parse::<u64>().ok());
        for &i in &binaries {
            let file = &mut files[i];
            let old_size = snapshot.old.as_ref().and_then(|_| sizes.next().flatten());
            let new_size = match &snapshot.new {
                NewSide::Commit { .. } => sizes.next().flatten(),
                NewSide::WorkingTree => fs::symlink_metadata(self.root().join(&file.path))
                    .ok()
                    .map(|m| m.len()),
            };
            file.content = Content::Binary { old_size, new_size };
        }
        Ok(())
    }

    /// What changed between `base` and the checkout, limited to `paths` when given.
    fn changes_under(
        &self,
        base: &Base,
        paths: Option<&BTreeSet<String>>,
    ) -> Result<Changes, RepoError> {
        let snapshot = self.snapshot(base)?;
        let mut files = parse::parse(&self.diff_output(&snapshot, paths, &[])?);
        if snapshot.new == NewSide::WorkingTree {
            let tracked: HashSet<&str> = files.iter().map(|f| f.path.as_str()).collect();
            let added: Vec<FileDiff> = self
                .untracked_beside(&tracked, paths)?
                .into_iter()
                .map(|path| untracked::added(self.root(), path))
                .collect::<Result<_, _>>()?;
            files.extend(added);
            files.sort_unstable_by(|a, b| a.path.cmp(&b.path));
        }
        self.size_binaries(&snapshot, &mut files)?;
        Ok(Changes { snapshot, files })
    }

    /// `path` inside the working tree, refusing any that leaves it.
    fn inside(&self, path: &str) -> Result<PathBuf, RepoError> {
        let full = self.root().join(relative(path)?);
        // A symlinked directory can still point out of the tree.
        let root = self
            .root()
            .canonicalize()
            .map_err(|e| failed(self.root(), &e))?;
        match full.canonicalize() {
            Ok(real) if real.starts_with(&root) => Ok(full),
            Ok(_) => Err(RepoError::OutsideRepository {
                path: path.to_owned(),
            }),
            Err(e) => Err(failed(&full, &e)),
        }
    }
}

impl Repository for Git {
    fn checkout(&self) -> Result<Checkout, RepoError> {
        let common =
            self.run
                .stdout(&["rev-parse", "--path-format=absolute", "--git-common-dir"])?;
        let common = Path::new(common.trim_end_matches('\n'));
        let named = if common.file_name().is_some_and(|n| n == ".git") {
            common.parent()
        } else {
            Some(common)
        };
        let name = named
            .and_then(Path::file_name)
            .map(|n| n.to_string_lossy().trim_end_matches(".git").to_owned())
            .unwrap_or_default();
        let head = match self
            .run
            .outcome(&["symbolic-ref", "--quiet", "--short", "HEAD"])?
        {
            Outcome::Success(out) => Head::Branch {
                name: out.trim().to_owned(),
            },
            Outcome::Failure => Head::Detached {
                commit: self
                    .run
                    .stdout(&["rev-parse", "--short", "HEAD"])?
                    .trim()
                    .to_owned(),
            },
        };
        Ok(Checkout {
            name,
            root: self.root().display().to_string(),
            head,
            commit: self.head_commit()?,
        })
    }

    fn refs(&self) -> Result<Vec<BaseRef>, RepoError> {
        let current = match self.run.outcome(&["symbolic-ref", "--quiet", "HEAD"])? {
            Outcome::Success(out) => Some(out.trim().to_owned()),
            Outcome::Failure => None,
        };
        fn list(format: &str) -> [&str; 5] {
            [
                "for-each-ref",
                format,
                "refs/heads",
                "refs/remotes",
                "refs/tags",
            ]
        }
        // `ahead-behind` needs git 2.41 and a commit at HEAD; without either,
        // the refs come without counts.
        let out = match self
            .run
            .outcome(&list("--format=%(refname)%00%(ahead-behind:HEAD)"))?
        {
            Outcome::Success(out) => out,
            Outcome::Failure => self.run.stdout(&list("--format=%(refname)"))?,
        };
        Ok(out
            .lines()
            .filter_map(|line| {
                let (full, counts) = line.split_once('\0').unwrap_or((line, ""));
                if Some(full) == current.as_deref() || full.ends_with("/HEAD") {
                    return None;
                }
                let (kind, name) = [
                    ("refs/heads/", RefKind::Branch),
                    ("refs/remotes/", RefKind::Remote),
                    ("refs/tags/", RefKind::Tag),
                ]
                .into_iter()
                .find_map(|(prefix, kind)| full.strip_prefix(prefix).map(|n| (kind, n)))?;
                // The first count is the ref's commits HEAD lacks.
                let behind = counts.split(' ').next().and_then(|n| n.parse().ok());
                Some(BaseRef {
                    name: name.to_owned(),
                    kind,
                    behind,
                })
            })
            .collect())
    }

    fn remote_default(&self) -> Result<Option<String>, RepoError> {
        Ok(
            match self
                .run
                .outcome(&["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"])?
            {
                Outcome::Success(out) => {
                    out.trim().strip_prefix("refs/remotes/").map(str::to_owned)
                }
                Outcome::Failure => None,
            },
        )
    }

    fn changes(&self, base: &Base) -> Result<Changes, RepoError> {
        self.changes_under(base, None)
    }

    fn changes_in(&self, base: &Base, paths: &BTreeSet<String>) -> Result<Changes, RepoError> {
        if paths.is_empty() {
            // An empty pathspec means every path to git.
            return Ok(Changes {
                snapshot: self.snapshot(base)?,
                files: Vec::new(),
            });
        }
        self.changes_under(base, Some(paths))
    }

    fn file_states(&self, base: &Base) -> Result<FileStates, RepoError> {
        let snapshot = self.snapshot(base)?;
        // Between two commits, their ids fix the diff.
        let files = if snapshot.new == NewSide::WorkingTree {
            // Which files differ, and how, without reading the patch (diff-loop-git.md Decision 4).
            let raw = self.diff_output(&snapshot, None, &["--raw", "-z", "--no-abbrev"])?;
            let untracked = self.untracked(None)?;
            let entries = raw::raw_records(&raw)
                .map(|(header, path)| (header, path.to_owned()))
                .chain(untracked.into_iter().map(|path| ("untracked", path)));
            states::states(self.root(), entries)
        } else {
            BTreeMap::new()
        };
        Ok(FileStates { snapshot, files })
    }

    fn blob(&self, snapshot: &Snapshot, side: Side, path: &str) -> Result<Vec<u8>, RepoError> {
        let commit = match (side, &snapshot.new) {
            (Side::Old, _) => snapshot.old.as_deref(),
            (Side::New, NewSide::Commit { id }) => Some(id.as_str()),
            (Side::New, NewSide::WorkingTree) => {
                let full = self.inside(path)?;
                return fs::read(&full).map_err(|e| failed(&full, &e));
            }
        };
        let Some(commit) = commit else {
            return Ok(Vec::new());
        };
        relative(path)?;
        self.run
            .bytes(&["cat-file", "blob", &format!("{commit}:{path}")])
    }

    fn watch(&self, on_change: OnChange) -> Result<WatchGuard, RepoError> {
        // A worktree's git directories live outside it: HEAD, the index and
        // refs change there.
        let git_dirs = ["--git-common-dir", "--absolute-git-dir"]
            .into_iter()
            .map(|flag| {
                let out = self
                    .run
                    .stdout(&["rev-parse", "--path-format=absolute", flag])?;
                Ok(PathBuf::from(out.trim_end_matches('\n')))
            })
            .collect::<Result<Vec<_>, RepoError>>()?;
        let index =
            self.run
                .stdout(&["rev-parse", "--path-format=absolute", "--git-path", "index"])?;
        let index = PathBuf::from(index.trim_end_matches('\n'));
        watch::watch(self.root(), &git_dirs, &index, on_change)
    }

    fn uncommitted_files(&self) -> Result<u32, RepoError> {
        // The files `changes(Uncommitted)` lists, read by name only.
        let snapshot = self.snapshot(&Base::Uncommitted)?;
        let names = self.diff_output(&snapshot, None, &["--name-only", "-z"])?;
        let tracked: HashSet<&str> = names.split('\0').filter(|n| !n.is_empty()).collect();
        let untracked = self.untracked_beside(&tracked, None)?.len();
        Ok(u32::try_from(tracked.len() + untracked).unwrap_or(u32::MAX))
    }

    fn commits_between(&self, from: &str, to: &str) -> Result<Option<u32>, RepoError> {
        if let Outcome::Failure =
            self.run
                .outcome(&["merge-base", "--is-ancestor", "--end-of-options", from, to])?
        {
            return Ok(None);
        }
        let count = self.run.stdout(&[
            "rev-list",
            "--count",
            "--end-of-options",
            &format!("{from}..{to}"),
        ])?;
        Ok(count.trim().parse().ok())
    }
}

/// The one way this crate reports a failed file operation: with its path.
pub(crate) fn failed(path: &Path, error: &io::Error) -> RepoError {
    RepoError::Failed {
        message: format!("{}: {error}", path.display()),
    }
}

/// `path` as a path inside a tree: only normal components, so no `..`, root
/// or prefix can lead out of it.
fn relative(path: &str) -> Result<&Path, RepoError> {
    let relative = Path::new(path);
    if relative
        .components()
        .all(|c| matches!(c, Component::Normal(_)))
    {
        Ok(relative)
    } else {
        Err(RepoError::OutsideRepository {
            path: path.to_owned(),
        })
    }
}

#[cfg(test)]
mod tests;
