//! Finding the `git` executable as a terminal would, once per [`GitProgram`].

#[cfg(unix)]
use std::process::{Child, ExitStatus};
use std::{
    env::{self, consts::EXE_SUFFIX},
    ffi::OsStr,
    path::{Path, PathBuf},
    sync::OnceLock,
    time::Duration,
};

use crate::command::{Outcome, Runner};

/// Longest the login shell may take to exit: a profile waiting on input or
/// the network must not hang opening a repository.
const SHELL_TIMEOUT: Duration = Duration::from_secs(5);

/// The `git` executable every [`Git`](crate::Git) and
/// [`GitProject`](crate::GitProject) opened with it runs, looked for on first
/// use and then kept; the composition root holds one (diff-loop-git.md Decision 8).
#[derive(Debug, Default)]
pub struct GitProgram {
    found: OnceLock<PathBuf>,
}

impl GitProgram {
    /// The executable, looked for now if it has not been yet: this may ask
    /// the login shell, for up to [`SHELL_TIMEOUT`].
    pub(crate) fn path(&self) -> PathBuf {
        self.found.get_or_init(locate).clone()
    }
}

/// The `git` to run: the first on `PATH`, else the one the user's login shell
/// finds, else plain `git`, which fails to spawn with a message saying so;
/// past a launcher to the binary it starts (`past_launcher`).
fn locate() -> PathBuf {
    let found = locate_with(
        env::var_os("PATH").as_deref(),
        env::var_os("SHELL").as_deref(),
    );
    past_launcher(found)
}

fn locate_with(path: Option<&OsStr>, shell: Option<&OsStr>) -> PathBuf {
    path.and_then(on_path)
        .or_else(|| shell.and_then(|shell| from_login_shell(shell, SHELL_TIMEOUT)))
        .unwrap_or_else(|| PathBuf::from("git"))
}

/// macOS's `git`: a launcher that looks up Xcode's on every run, about 17 ms
/// a call (diff-loop-git.md Decision 8).
const LAUNCHER: &str = "/usr/bin/git";

/// `found`, or on macOS, when it is the [`LAUNCHER`], the `git` in its exec
/// path, the binary it starts, when there is one. Only the launcher: another
/// git's exec path can be a versioned folder an upgrade removes (Homebrew's
/// Cellar), and the one found is kept for the whole run.
fn past_launcher(found: PathBuf) -> PathBuf {
    if !cfg!(target_os = "macos") || found != Path::new(LAUNCHER) {
        return found;
    }
    // Any folder will do: `--exec-path` reads no repository.
    let asked = Runner::new(found.clone(), env::temp_dir()).outcome(&["--exec-path"]);
    let Ok(Outcome::Success(exec_path)) = asked else {
        return found;
    };
    let binary =
        Path::new(exec_path.trim_end_matches(['\r', '\n'])).join(format!("git{EXE_SUFFIX}"));
    if binary.is_file() { binary } else { found }
}

fn on_path(path: &OsStr) -> Option<PathBuf> {
    let name = format!("git{EXE_SUFFIX}");
    env::split_paths(path)
        .map(|dir| dir.join(&name))
        .find(|candidate| candidate.is_file())
}

/// An app opened from the macOS Finder gets a minimal `PATH`; a login shell
/// reads the profile that adds Homebrew's. `None` unless the shell succeeds
/// within `timeout` and its last line of output names an absolute path to a
/// file.
#[cfg(unix)]
fn from_login_shell(shell: &OsStr, timeout: Duration) -> Option<PathBuf> {
    use std::{
        fs::{self, File},
        process::{Command, Stdio},
    };

    // A file, not a pipe: a process the profile starts in the background can
    // hold a pipe open after the shell exits, and reading it would wait on
    // that process. `create_new` follows no symlink and refuses an existing
    // file: the temporary directory can be shared with other users.
    let out = output_path();
    let file = File::create_new(&out).ok()?;
    let status = Command::new(shell)
        .args(["-lc", "command -v git"])
        .stdin(Stdio::null())
        .stdout(file)
        .stderr(Stdio::null())
        .spawn()
        .ok()
        .and_then(|mut child| wait_within(&mut child, timeout));
    let text = fs::read_to_string(&out);
    let _ = fs::remove_file(&out);
    status.filter(ExitStatus::success)?;
    // The profile may print first; `command -v` prints last.
    let found = PathBuf::from(text.ok()?.lines().last()?.trim());
    // `command -v` names an alias or function as itself: only a file counts.
    (found.is_absolute() && found.is_file()).then_some(found)
}

/// Where [`from_login_shell`] has the shell write; one per process and
/// thread, so concurrent opens differ.
#[cfg(unix)]
fn output_path() -> PathBuf {
    use std::{process, thread};

    env::temp_dir().join(format!(
        "diff-loop-git-{}-{:?}",
        process::id(),
        thread::current().id()
    ))
}

/// `child`'s exit status if it exits within `timeout`; otherwise, or when it
/// cannot be polled, it is killed and reaped, and `None`.
#[cfg(unix)]
fn wait_within(child: &mut Child, timeout: Duration) -> Option<ExitStatus> {
    use std::{thread, time::Instant};

    let deadline = Instant::now() + timeout;
    // Polled: std has no wait with a timeout.
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Some(status),
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(10)),
            _ => {
                // A kill that fails means it exited meanwhile; `wait` reaps it either way.
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
}

#[cfg(not(unix))]
fn from_login_shell(_: &OsStr, _: Duration) -> Option<PathBuf> {
    None
}

#[cfg(test)]
mod tests {
    use std::fs;
    #[cfg(unix)]
    use std::{
        io::ErrorKind,
        os::unix::fs::{PermissionsExt, symlink},
        process::Command,
        thread,
        time::Instant,
    };

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

    #[cfg(target_os = "macos")]
    #[test]
    fn the_macos_launcher_gives_way_to_the_git_in_its_exec_path() {
        let launcher = PathBuf::from(LAUNCHER);
        let binary = past_launcher(launcher.clone());
        let exec_path = Command::new(&launcher).arg("--exec-path").output().unwrap();
        let dir = String::from_utf8(exec_path.stdout).unwrap();
        assert!(binary.is_file(), "{binary:?}");
        assert!(
            binary.starts_with(dir.trim_end()),
            "{binary:?} not in {dir}"
        );
    }

    #[test]
    fn any_git_but_the_macos_launcher_is_kept_as_found() {
        let dir = TempDir::new().unwrap();
        let missing = dir.path().join("git");
        assert_eq!(past_launcher(missing.clone()), missing);
        let found = locate_with(env::var_os("PATH").as_deref(), None);
        if found != Path::new(LAUNCHER) || !cfg!(target_os = "macos") {
            assert_eq!(past_launcher(found.clone()), found);
        }
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

    /// An executable `sh` script at `dir/name` standing in for a login shell;
    /// run without `-lc`, it does nothing.
    #[cfg(unix)]
    fn shell_script(dir: &TempDir, name: &str, body: &str) -> PathBuf {
        let shell = dir.path().join(name);
        fs::write(
            &shell,
            format!("#!/bin/sh\n[ \"$1\" = -lc ] || exit 0\n{body}\n"),
        )
        .unwrap();
        fs::set_permissions(&shell, fs::Permissions::from_mode(0o755)).unwrap();
        // A test forking while the file was open for writing leaves the child
        // holding it until that child execs; until then exec fails (ETXTBSY).
        while matches!(
            Command::new(&shell).status(),
            Err(e) if e.kind() == ErrorKind::ExecutableFileBusy
        ) {
            thread::sleep(Duration::from_millis(10));
        }
        shell
    }

    #[cfg(unix)]
    #[test]
    fn a_login_shell_that_hangs_is_given_up_on() {
        let dir = TempDir::new().unwrap();
        let shell = shell_script(&dir, "slow-shell", "exec sleep 30");
        let started = Instant::now();
        assert_eq!(
            from_login_shell(shell.as_os_str(), Duration::from_millis(200)),
            None
        );
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[cfg(unix)]
    #[test]
    fn a_background_process_the_profile_starts_does_not_hold_up_the_answer() {
        let dir = TempDir::new().unwrap();
        let shell = shell_script(&dir, "forking-shell", "sleep 30 &\necho /bin/sh");
        let started = Instant::now();
        assert_eq!(
            from_login_shell(shell.as_os_str(), Duration::from_secs(10)),
            Some(PathBuf::from("/bin/sh"))
        );
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[cfg(unix)]
    #[test]
    fn what_the_profile_prints_before_the_answer_is_skipped() {
        let dir = TempDir::new().unwrap();
        let shell = shell_script(&dir, "chatty-shell", "echo Welcome\necho /bin/sh");
        assert_eq!(
            from_login_shell(shell.as_os_str(), Duration::from_secs(10)),
            Some(PathBuf::from("/bin/sh"))
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_shell_that_prints_a_path_but_fails_is_not_believed() {
        let dir = TempDir::new().unwrap();
        let shell = shell_script(&dir, "failing-shell", "echo /bin/sh\nexit 1");
        assert_eq!(
            from_login_shell(shell.as_os_str(), Duration::from_secs(10)),
            None
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_file_planted_where_the_shell_would_write_is_left_alone() {
        let dir = TempDir::new().unwrap();
        let victim = dir.path().join("victim");
        fs::write(&victim, "keep").unwrap();
        let planted = output_path();
        symlink(&victim, &planted).unwrap();
        let shell = shell_script(&dir, "honest-shell", "echo /bin/sh");
        let found = from_login_shell(shell.as_os_str(), Duration::from_secs(10));
        let still_planted = fs::symlink_metadata(&planted).is_ok();
        let _ = fs::remove_file(&planted);
        assert_eq!(found, None);
        assert!(still_planted);
        assert_eq!(fs::read_to_string(&victim).unwrap(), "keep");
    }
}
