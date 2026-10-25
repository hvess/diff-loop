//! [`Repository`] and [`Project`](diff_loop_core::Project) over the `git`
//! command line.
//!
//! Every call runs `git` with optional locks off, in the checkout, or for a
//! project or a branch no worktree has, in the common git directory, so
//! polling never contends with an agent committing in the same repository.

mod command;
mod locate;
mod parse;
mod project;
mod raw;
mod shows;
mod states;
mod untracked;
mod watch;

use std::{
    collections::{BTreeMap, BTreeSet, HashSet},
    fs, io,
    path::{Component, Path, PathBuf},
    sync::Arc,
};

use diff_loop_core::{
    Base, BaseRef, Changes, Checkout, Content, FileDiff, FileStates, LineCounts, NewSide, OnChange,
    RefKind, RepoError, Repository, Side, Snapshot, WatchGuard, project_name,
};

use command::{Outcome, Runner};
pub use locate::GitProgram;
pub use project::GitProject;
use shows::{Shows, WorkingTree};

/// A git working tree, or a branch no working tree has checked out.
#[derive(Debug, Clone)]
pub struct Git {
    run: Runner,
    /// The absolute common git directory, as [`Checkout::project`] names it.
    project: PathBuf,
    shows: Arc<dyn Shows>,
}

impl Git {
    /// The working tree containing `path`, run with `git`.
    ///
    /// # Errors
    /// [`RepoError::NotARepository`] when `path` is in no working tree;
    /// [`RepoError::Failed`] when `git` cannot run.
    pub fn open(git: &GitProgram, path: &Path) -> Result<Self, RepoError> {
        let probe = Runner::new(git.path(), path.to_path_buf());
        let not_a_repository = || RepoError::NotARepository {
            path: path.display().to_string(),
        };
        if !path.is_dir() {
            return Err(not_a_repository());
        }
        // One call: outside a working tree it prints `false`, or fails at
        // `--show-toplevel`.
        let Outcome::Success(out) = probe.outcome(&[
            "rev-parse",
            "--is-inside-work-tree",
            "--show-toplevel",
            "--path-format=absolute",
            "--git-common-dir",
        ])?
        else {
            return Err(not_a_repository());
        };
        let mut lines = out.lines();
        let (Some("true"), Some(root), Some(project)) = (lines.next(), lines.next(), lines.next())
        else {
            return Err(not_a_repository());
        };
        Ok(Self {
            run: probe.in_dir(PathBuf::from(root)),
            project: PathBuf::from(project),
            shows: Arc::new(WorkingTree),
        })
    }

    /// Branch `name` of the repository whose common git directory is
    /// `project`: the working tree that has it checked out, or with none, the
    /// branch read from its commits (ADR 0026 §3).
    ///
    /// # Errors
    /// [`RepoError::NoBranch`] when no branch has that name;
    /// [`RepoError::NotARepository`] when `project` is no git directory;
    /// [`RepoError::Failed`] when `git` cannot run.
    pub fn for_branch(git: &GitProgram, project: &Path, name: &str) -> Result<Self, RepoError> {
        let project = GitProject::open(git, project)?;
        let (branch, refname) = project
            .listed()?
            .into_iter()
            .find(|(branch, _)| branch.name == name)
            .ok_or_else(|| RepoError::NoBranch {
                name: name.to_owned(),
            })?;
        match branch.worktree() {
            Some(root) => Self::open(git, Path::new(root)),
            None => Ok(Self {
                project: project::common_dir(project.runner())?,
                run: project.into_runner(),
                shows: Arc::new(shows::Branch {
                    name: branch.name,
                    refname,
                }),
            }),
        }
    }

    fn root(&self) -> &Path {
        self.run.dir()
    }

    /// Full id of the commit shown: at `HEAD`, or the branch's; `None`
    /// before the first commit.
    fn tip(&self) -> Result<Option<String>, RepoError> {
        self.verify(self.shows.tip_ref())
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
        let tip = self.tip()?;
        Ok(match base {
            Base::Ref { name } => {
                let base_commit = self
                    .verify(name)?
                    .ok_or_else(|| RepoError::UnknownBase { name: name.clone() })?;
                let tip = tip.ok_or(RepoError::NoCommits)?;
                let fork = match self.run.outcome(&["merge-base", &base_commit, &tip])? {
                    Outcome::Success(out) => out.trim().to_owned(),
                    // Unrelated histories: compare with the base itself.
                    Outcome::Failure => base_commit,
                };
                Snapshot {
                    old: Some(fork),
                    new: self.shows.new_side(tip),
                }
            }
            Base::Uncommitted => {
                self.shows.working_tree()?;
                Snapshot {
                    old: tip,
                    new: NewSide::WorkingTree,
                }
            }
            Base::LastCommit => {
                let tip = tip.ok_or(RepoError::NoCommits)?;
                Snapshot {
                    old: self.verify(&format!("{tip}^"))?,
                    new: NewSide::Commit { id: tip },
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
        let project = self.project.display().to_string();
        let (head, worktree) = self.shows.head(&self.run)?;
        Ok(Checkout {
            name: project_name(&project),
            project,
            worktree,
            head,
            commit: self.tip()?,
        })
    }

    fn refs(&self) -> Result<Vec<BaseRef>, RepoError> {
        let current = self.shows.shown_ref(&self.run)?;
        // `creatordate` is a commit's committer date, or an annotated tag's
        // tagger date.
        let out = self.run.stdout(&[
            "for-each-ref",
            "--sort=-creatordate",
            "--format=%(refname)%00%(creatordate:unix)",
            "refs/heads",
            "refs/remotes",
            "refs/tags",
        ])?;
        Ok(out
            .lines()
            .filter_map(|line| {
                let (full, date) = line.split_once('\0').unwrap_or((line, ""));
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
                Some(BaseRef {
                    name: name.to_owned(),
                    kind,
                    updated: millis(date),
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
        self.shows.watch(&self.run, &self.project, on_change)
    }

    fn uncommitted_lines(&self) -> Result<LineCounts, RepoError> {
        self.shows.working_tree()?;
        // The lines `changes(Uncommitted)` shows: tracked files counted by
        // git, untracked ones read as `untracked::added` reads them.
        let snapshot = self.snapshot(&Base::Uncommitted)?;
        let numstat = self.diff_output(&snapshot, None, &["--numstat", "-z"])?;
        let tracked = parse::numstat(&numstat);
        let names: HashSet<&str> = tracked.iter().map(|(_, path)| *path).collect();
        let counted = tracked.iter().filter_map(|(counts, _)| *counts).fold(
            LineCounts::default(),
            |sum, counts| LineCounts {
                added: sum.added.saturating_add(counts.added),
                removed: sum.removed.saturating_add(counts.removed),
            },
        );
        self.untracked_beside(&names, None)?
            .iter()
            .try_fold(counted, |sum, path| {
                Ok(LineCounts {
                    added: sum
                        .added
                        .saturating_add(untracked::added_lines(self.root(), path)?),
                    ..sum
                })
            })
    }

    fn commits_between(&self, from: &str, to: &str) -> Result<Option<u32>, RepoError> {
        commits_between(&self.run, from, to)
    }
}

/// A ref's date as `%(creatordate:unix)` gives it, in milliseconds; `None`
/// for one git left empty.
fn millis(seconds: &str) -> Option<i64> {
    seconds.parse::<i64>().ok()?.checked_mul(1000)
}

/// [`Repository::commits_between`].
fn commits_between(run: &Runner, from: &str, to: &str) -> Result<Option<u32>, RepoError> {
    if let Outcome::Failure =
        run.outcome(&["merge-base", "--is-ancestor", "--end-of-options", from, to])?
    {
        return Ok(None);
    }
    let count = run.stdout(&[
        "rev-list",
        "--count",
        "--end-of-options",
        &format!("{from}..{to}"),
    ])?;
    Ok(count.trim().parse().ok())
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
