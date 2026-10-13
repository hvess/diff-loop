//! The git questions the gate asks, through the `git` command line.

use std::{
    fs, io,
    path::{Path, PathBuf},
    process::Command,
};

use crate::{Failure, write_file};

/// A checkout's repository, by its working-tree root.
#[derive(Debug)]
pub(crate) struct Repo {
    root: PathBuf,
}

impl Repo {
    /// The repository containing the current directory.
    pub(crate) fn here() -> Result<Self, Failure> {
        let root = git(Path::new("."), &["rev-parse", "--show-toplevel"])?;
        Ok(Self::at(PathBuf::from(root.trim_end_matches('\n'))))
    }

    pub(crate) fn at(root: PathBuf) -> Self {
        Self { root }
    }

    pub(crate) fn root(&self) -> &Path {
        &self.root
    }

    /// The tree the index holds: what a commit now would record. Honours
    /// `GIT_INDEX_FILE`, so a hook sees the index git is committing.
    pub(crate) fn staged_tree(&self) -> Result<String, Failure> {
        Ok(git(&self.root, &["write-tree"])?.trim().to_owned())
    }

    /// The staged diff, as the judges read it.
    pub(crate) fn staged_diff(&self) -> Result<String, Failure> {
        git(
            &self.root,
            &["diff", "--cached", "--no-color", "--no-ext-diff"],
        )
    }

    /// Paths the staged change touches, relative to the root.
    pub(crate) fn staged_paths(&self) -> Result<Vec<String>, Failure> {
        let out = git(
            &self.root,
            &["diff", "--cached", "--name-only", "-z", "--no-renames"],
        )?;
        Ok(out
            .split('\0')
            .filter(|p| !p.is_empty())
            .map(str::to_owned)
            .collect())
    }

    /// Whether the working tree holds anything not staged: an unstaged edit
    /// or an untracked, unignored file.
    pub(crate) fn has_unstaged(&self) -> Result<bool, Failure> {
        let unstaged = git(&self.root, &["diff", "--name-only"])?;
        let untracked = git(&self.root, &["ls-files", "--others", "--exclude-standard"])?;
        Ok(!unstaged.trim().is_empty() || !untracked.trim().is_empty())
    }

    /// Points this checkout's own git config at the gate's hooks.
    pub(crate) fn use_hooks(&self) -> Result<(), Failure> {
        git(
            &self.root,
            &["config", "--local", "core.hooksPath", ".githooks"],
        )
        .map(drop)
    }

    /// Keeps `path` (relative to the root) out of git in this checkout
    /// alone, through `info/exclude`, unless something ignores it already.
    pub(crate) fn exclude(&self, path: &str) -> Result<(), Failure> {
        let check = ["check-ignore", "-q", path];
        let status = command(&self.root, &check)
            .status()
            .map_err(|e| failed_to_start(&e))?;
        // `check-ignore` answers by its exit: 0 ignored, 1 not.
        match status.code() {
            Some(0) => return Ok(()),
            Some(1) => {}
            _ => {
                return Err(Failure::Run {
                    what: format!("git {}", check.join(" ")),
                    message: status.to_string(),
                });
            }
        }
        let exclude = git(
            &self.root,
            &[
                "rev-parse",
                "--path-format=absolute",
                "--git-path",
                "info/exclude",
            ],
        )?;
        let exclude = PathBuf::from(exclude.trim_end_matches('\n'));
        // Read whole or not at all: it is written back with what it held.
        let mut text = match fs::read_to_string(&exclude) {
            Ok(text) => text,
            Err(e) if e.kind() == io::ErrorKind::NotFound => String::new(),
            Err(e) => {
                return Err(Failure::Io {
                    path: exclude,
                    message: e.to_string(),
                });
            }
        };
        if !text.is_empty() && !text.ends_with('\n') {
            text.push('\n');
        }
        text.push_str(path);
        text.push('\n');
        write_file(&exclude, &text)
    }

    /// Where the pass record for `tree` lives, inside the git directory.
    pub(crate) fn pass_record(&self, tree: &str) -> Result<PathBuf, Failure> {
        let path = git(
            &self.root,
            &[
                "rev-parse",
                "--path-format=absolute",
                "--git-path",
                &format!("diff-loop-review/passed/{tree}"),
            ],
        )?;
        Ok(PathBuf::from(path.trim_end_matches('\n')))
    }
}

/// `git args` in `dir`, as every call here runs it (ADR 0001 §4).
fn command(dir: &Path, args: &[&str]) -> Command {
    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(dir)
        .args(args)
        .env("GIT_OPTIONAL_LOCKS", "0");
    command
}

fn failed_to_start(error: &io::Error) -> Failure {
    Failure::Run {
        what: "git".into(),
        message: error.to_string(),
    }
}

/// Stdout of `git args` in `dir`, which must succeed.
fn git(dir: &Path, args: &[&str]) -> Result<String, Failure> {
    let output = command(dir, args)
        .output()
        .map_err(|e| failed_to_start(&e))?;
    if !output.status.success() {
        return Err(Failure::Run {
            what: format!("git {}", args.join(" ")),
            message: String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

#[cfg(test)]
pub(crate) mod tests {
    use tempfile::TempDir;

    use super::*;

    /// A repository with one commit, holding `a.txt`.
    pub(crate) fn repository() -> (TempDir, Repo) {
        let dir = TempDir::new().unwrap();
        let run = |args: &[&str]| {
            let status = Command::new("git")
                .arg("-C")
                .arg(dir.path())
                .args([
                    "-c",
                    "user.name=t",
                    "-c",
                    "user.email=t@t",
                    "-c",
                    "commit.gpgsign=false",
                ])
                .args(args)
                .env("GIT_CONFIG_GLOBAL", "/dev/null")
                .env("GIT_CONFIG_NOSYSTEM", "1")
                .status()
                .unwrap();
            assert!(status.success(), "git {args:?}");
        };
        run(&["init", "-q", "-b", "main"]);
        fs::write(dir.path().join("a.txt"), "a\n").unwrap();
        run(&["add", "."]);
        run(&["commit", "-qm", "init"]);
        let repo = Repo::at(dir.path().to_path_buf());
        (dir, repo)
    }

    pub(crate) fn stage(repo: &Repo, path: &str, text: &str) {
        let full = repo.root().join(path);
        fs::create_dir_all(full.parent().unwrap()).unwrap();
        fs::write(&full, text).unwrap();
        git(repo.root(), &["add", path]).unwrap();
    }

    #[test]
    fn the_staged_tree_follows_the_index_not_the_working_tree() {
        let (_dir, repo) = repository();
        let before = repo.staged_tree().unwrap();
        fs::write(repo.root().join("a.txt"), "unstaged\n").unwrap();
        assert_eq!(repo.staged_tree().unwrap(), before);
        assert!(repo.has_unstaged().unwrap());
        stage(&repo, "a.txt", "staged\n");
        assert_ne!(repo.staged_tree().unwrap(), before);
        assert!(!repo.has_unstaged().unwrap());
    }

    #[test]
    fn staged_paths_name_what_the_commit_would_change() {
        let (_dir, repo) = repository();
        stage(&repo, "crates/x/src/lib.rs", "//!\n");
        stage(&repo, "docs/b.md", "b\n");
        assert_eq!(
            repo.staged_paths().unwrap(),
            ["crates/x/src/lib.rs", "docs/b.md"]
        );
    }

    #[test]
    fn excluding_a_path_already_ignored_adds_nothing() {
        let (_dir, repo) = repository();
        fs::write(repo.root().join(".gitignore"), "build/\n").unwrap();
        repo.exclude("build/").unwrap();
        let exclude = repo.root().join(".git/info/exclude");
        let text = fs::read_to_string(&exclude).unwrap_or_default();
        assert!(!text.lines().any(|l| l == "build/"));
        repo.exclude("local/").unwrap();
        assert!(
            fs::read_to_string(&exclude)
                .unwrap()
                .lines()
                .any(|l| l == "local/")
        );
    }

    #[test]
    fn an_untracked_file_counts_as_unstaged() {
        let (_dir, repo) = repository();
        fs::write(repo.root().join("new.txt"), "n\n").unwrap();
        assert!(repo.has_unstaged().unwrap());
    }
}
