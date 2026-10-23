//! Running `git` in one directory.

use std::{
    io::Write as _,
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
    thread,
};

use diff_loop_core::RepoError;

/// `git diff` flags `parse::parse` relies on, whatever the user's config says.
pub(crate) const DIFF_FLAGS: [&str; 8] = [
    "diff",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--find-renames",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    "--no-relative",
];

/// Why `git` could not be run when it was not found, naming where `locate` looked.
#[cfg(unix)]
pub(crate) const MISSING: &str =
    "git is not installed, or neither PATH nor the login shell finds it";
/// Why `git` could not be run when it was not found, naming where `locate` looked.
#[cfg(not(unix))]
pub(crate) const MISSING: &str = "git is not installed, or not on PATH";

/// Config forced on every call, overriding the user's.
const CONFIG: [&str; 6] = [
    "-c",
    "core.quotePath=false",
    "-c",
    "diff.noprefix=false",
    "-c",
    "diff.mnemonicPrefix=false",
];

/// How a `git` call ended, for calls where a non-zero exit is an answer.
pub(crate) enum Outcome {
    /// Exit 0, with stdout.
    Success(String),
    /// Any other exit.
    Failure,
}

/// Runs `git` in one directory.
#[derive(Debug, Clone)]
pub(crate) struct Runner {
    /// The executable, from `locate::locate`.
    program: PathBuf,
    dir: PathBuf,
}

impl Runner {
    pub(crate) fn new(program: PathBuf, dir: PathBuf) -> Self {
        Self { program, dir }
    }

    /// The same executable in `dir`.
    pub(crate) fn in_dir(&self, dir: PathBuf) -> Self {
        Self::new(self.program.clone(), dir)
    }

    pub(crate) fn dir(&self) -> &Path {
        &self.dir
    }

    /// Stdout of a call that must succeed.
    pub(crate) fn stdout(&self, args: &[&str]) -> Result<String, RepoError> {
        self.stdout_with_input(args, "")
    }

    /// Stdout of a call that must succeed, given `input` on stdin.
    pub(crate) fn stdout_with_input(
        &self,
        args: &[&str],
        input: &str,
    ) -> Result<String, RepoError> {
        let output = self.output(args, input.as_bytes())?;
        succeeded(args, &output)?;
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    }

    /// Raw stdout of a call that must succeed.
    pub(crate) fn bytes(&self, args: &[&str]) -> Result<Vec<u8>, RepoError> {
        let output = self.output(args, &[])?;
        succeeded(args, &output)?;
        Ok(output.stdout)
    }

    /// How a call ended. Fails only when `git` cannot run at all.
    pub(crate) fn outcome(&self, args: &[&str]) -> Result<Outcome, RepoError> {
        let output = self.output(args, &[])?;
        Ok(if output.status.success() {
            Outcome::Success(String::from_utf8_lossy(&output.stdout).into_owned())
        } else {
            Outcome::Failure
        })
    }

    fn output(&self, args: &[&str], input: &[u8]) -> Result<Output, RepoError> {
        let mut child = Command::new(&self.program)
            .arg("-C")
            .arg(&self.dir)
            .args(CONFIG)
            .args(args)
            .env("GIT_OPTIONAL_LOCKS", "0")
            // A pathspec is a path, never a pattern: a file may be named `*.ts`.
            .env("GIT_LITERAL_PATHSPECS", "1")
            .env("LC_ALL", "C")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| RepoError::Failed {
                message: if e.kind() == std::io::ErrorKind::NotFound {
                    MISSING.to_owned()
                } else {
                    format!("could not run git: {e}")
                },
            })?;
        let stdin = child.stdin.take();
        thread::scope(|scope| {
            if let Some(mut stdin) = stdin {
                // Written on its own thread: git can fill the stdout pipe before
                // it has read all its input, and a sequential write would then
                // wait forever. A write error means git exited early; its
                // status reports why.
                scope.spawn(move || {
                    let _ = stdin.write_all(input);
                });
            }
            child.wait_with_output()
        })
        .map_err(|e| RepoError::Failed {
            message: e.to_string(),
        })
    }
}

fn succeeded(args: &[&str], output: &Output) -> Result<(), RepoError> {
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(RepoError::Failed {
        message: format!(
            "git {} failed: {}",
            args.first().unwrap_or(&""),
            stderr.trim()
        ),
    })
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;

    #[test]
    fn input_and_output_larger_than_a_pipe_do_not_deadlock() {
        // Regression: stdin was written in full before stdout was read, so a
        // query and answer both larger than the pipe buffer blocked both sides.
        let dir = TempDir::new().unwrap();
        let git = Runner::new("git".into(), dir.path().to_path_buf());
        assert!(git.outcome(&["init", "-q"]).is_ok());
        let blob = git
            .stdout_with_input(&["hash-object", "-w", "--stdin"], "x")
            .unwrap();
        let padding = "x".repeat(1000);
        let query: String = (0..500)
            .map(|_| format!("{} {padding}\n", blob.trim()))
            .collect();
        let answer = git
            .stdout_with_input(&["cat-file", "--batch-check=%(rest)"], &query)
            .unwrap();
        assert_eq!(answer.lines().count(), 500);
    }
}
