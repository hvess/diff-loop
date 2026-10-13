//! Finding the `git` executable as a terminal would.

use std::{
    env::{self, consts::EXE_SUFFIX},
    ffi::OsStr,
    path::PathBuf,
};

/// The `git` to run: the first on `PATH`, else the one the user's login shell
/// finds, else plain `git`, which fails to spawn with a message saying so.
pub(crate) fn locate() -> PathBuf {
    locate_with(
        env::var_os("PATH").as_deref(),
        env::var_os("SHELL").as_deref(),
    )
}

fn locate_with(path: Option<&OsStr>, shell: Option<&OsStr>) -> PathBuf {
    path.and_then(on_path)
        .or_else(|| shell.and_then(from_login_shell))
        .unwrap_or_else(|| PathBuf::from("git"))
}

fn on_path(path: &OsStr) -> Option<PathBuf> {
    let name = format!("git{EXE_SUFFIX}");
    env::split_paths(path)
        .map(|dir| dir.join(&name))
        .find(|candidate| candidate.is_file())
}

/// An app opened from the macOS Finder gets a minimal `PATH`; a login shell
/// reads the profile that adds Homebrew's.
#[cfg(unix)]
fn from_login_shell(shell: &OsStr) -> Option<PathBuf> {
    use std::process::{Command, Stdio};

    let output = Command::new(shell)
        .args(["-lc", "command -v git"])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    let found = PathBuf::from(String::from_utf8(output.stdout).ok()?.trim());
    // `command -v` names an alias or function as itself: only a file counts.
    (output.status.success() && found.is_absolute() && found.is_file()).then_some(found)
}

#[cfg(not(unix))]
fn from_login_shell(_: &OsStr) -> Option<PathBuf> {
    None
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;

    #[test]
    fn git_on_path_is_found_there() {
        let dir = TempDir::new().unwrap();
        let git = dir.path().join(format!("git{EXE_SUFFIX}"));
        fs::write(&git, "").unwrap();
        let path = env::join_paths([dir.path().join("missing"), dir.path().to_path_buf()]).unwrap();
        assert_eq!(locate_with(Some(&path), None), git);
    }

    #[test]
    fn without_git_anywhere_plain_git_is_run() {
        let empty = TempDir::new().unwrap();
        let path = empty.path().as_os_str();
        assert_eq!(locate_with(Some(path), None), PathBuf::from("git"));
        assert_eq!(locate_with(None, None), PathBuf::from("git"));
    }

    #[cfg(unix)]
    #[test]
    fn a_login_shell_finds_git_when_path_does_not() {
        let empty = TempDir::new().unwrap();
        let found = locate_with(Some(empty.path().as_os_str()), Some(OsStr::new("sh")));
        assert!(found.is_absolute() && found.ends_with("git"), "{found:?}");
    }

    #[cfg(unix)]
    #[test]
    fn a_shell_that_fails_falls_back_to_plain_git() {
        let empty = TempDir::new().unwrap();
        let path = empty.path().as_os_str();
        assert_eq!(
            locate_with(Some(path), Some(OsStr::new("false"))),
            PathBuf::from("git")
        );
        assert_eq!(
            locate_with(Some(path), Some(OsStr::new("/no/such/shell"))),
            PathBuf::from("git")
        );
    }
}
