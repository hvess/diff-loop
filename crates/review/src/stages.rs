//! The review loop's deterministic stages 1–3 (`docs/spec/diff-loop-review.md` Decision 4).

use std::{fs, path::Path, process::Command};

use crate::Failure;

/// Each command a stage runs: a name, the directory under the root, and the program with its arguments.
const COMMANDS: [(&str, &str, &[&str]); 7] = [
    ("format", ".", &["cargo", "fmt", "--all", "--check"]),
    (
        "clippy",
        ".",
        &[
            "cargo",
            "clippy",
            "--workspace",
            "--all-targets",
            "--locked",
            "--",
            "-D",
            "warnings",
        ],
    ),
    ("test", ".", &["cargo", "test", "--workspace", "--locked"]),
    ("front-end lint", "app", &["npm", "run", "lint"]),
    ("front-end type check", "app", &["npm", "run", "typecheck"]),
    ("front-end test", "app", &["npm", "test"]),
    ("front-end build", "app", &["npm", "run", "build"]),
];

/// Runs every stage in `root`, in order, stopping at the first that fails.
///
/// # Errors
/// [`Failure::Stage`] with the failing stage's output; [`Failure::Run`]
/// when a program cannot start; [`Failure::Io`] when `rust-toolchain.toml`
/// cannot be read.
pub(crate) fn run_all(root: &Path) -> Result<(), Failure> {
    toolchain(root)?;
    COMMANDS.iter().try_for_each(|(name, dir, command)| {
        eprintln!("review: {name}");
        let (program, args) = command
            .split_first()
            .expect("every command names a program");
        let output = Command::new(program)
            .args(args)
            .current_dir(root.join(dir))
            .output()
            .map_err(|e| Failure::Run {
                what: (*program).to_owned(),
                message: e.to_string(),
            })?;
        if output.status.success() {
            Ok(())
        } else {
            Err(Failure::Stage {
                name: (*name).to_owned(),
                output: format!(
                    "{}{}",
                    String::from_utf8_lossy(&output.stdout),
                    String::from_utf8_lossy(&output.stderr)
                ),
            })
        }
    })
}

/// Stage 1: `rustc --version` names the channel `rust-toolchain.toml` pins.
fn toolchain(root: &Path) -> Result<(), Failure> {
    let file = root.join("rust-toolchain.toml");
    let pinned = fs::read_to_string(&file).map_err(|e| Failure::Io {
        path: file.clone(),
        message: e.to_string(),
    })?;
    let channel = channel(&pinned).ok_or_else(|| Failure::Stage {
        name: "toolchain".into(),
        output: "rust-toolchain.toml names no channel".into(),
    })?;
    let output = Command::new("rustc")
        .arg("--version")
        .current_dir(root)
        .output()
        .map_err(|e| Failure::Run {
            what: "rustc".into(),
            message: e.to_string(),
        })?;
    let version = String::from_utf8_lossy(&output.stdout);
    if version.split_whitespace().nth(1) == Some(channel) {
        Ok(())
    } else {
        Err(Failure::Stage {
            name: "toolchain".into(),
            output: format!(
                "rust-toolchain.toml pins {channel}; rustc is {}",
                version.trim()
            ),
        })
    }
}

/// The `channel` value in a `rust-toolchain.toml`.
fn channel(toml: &str) -> Option<&str> {
    toml.lines()
        .filter_map(|line| line.split_once('='))
        .find(|(key, _)| key.trim() == "channel")
        .map(|(_, value)| value.trim().trim_matches('"'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_channel_is_read_from_the_toolchain_file() {
        let toml = "# comment\n[toolchain]\nchannel    = \"1.99.0\"\nprofile = \"minimal\"\n";
        assert_eq!(channel(toml), Some("1.99.0"));
        assert_eq!(channel("[toolchain]\n"), None);
    }
}
