//! The Claude Code settings that install the local guard
//! (`docs/spec/diff-loop-review.md` Decision 9).

use std::{
    fs, io,
    path::{Path, PathBuf},
};

use serde_json::{Value, json};

use crate::{Failure, git::Repo, write_file};

/// The Claude Code hook that runs `guard`: the built binary when there is
/// one, else through cargo, so a clean checkout is guarded too.
const GUARD_COMMAND: &str = "b=\"$CLAUDE_PROJECT_DIR/target/debug/diff-loop-review\"; \
if [ -x \"$b\" ]; then exec \"$b\" guard; fi; \
exec cargo run -q --manifest-path \"$CLAUDE_PROJECT_DIR/Cargo.toml\" -p diff-loop-review -- guard";

/// Installs the gate in `repo`'s checkout: points its git config at the
/// hooks, writes the guard into `.claude/settings.json`, and keeps `.claude/`
/// out of git there when nothing ignores it, since `begin` refuses untracked
/// files. Returns the settings file's path.
///
/// # Errors
/// [`Failure::Io`] when the settings cannot be read, parsed or written, or
/// the checkout's `info/exclude` cannot be read or written; [`Failure::Run`] when
/// git fails.
pub(crate) fn install(repo: &Repo) -> Result<PathBuf, Failure> {
    let path = repo.root().join(".claude").join("settings.json");
    let failed = |message: String| Failure::Io {
        path: path.clone(),
        message,
    };
    let before = match fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).map_err(|e| failed(e.to_string()))?,
        Err(e) if e.kind() == io::ErrorKind::NotFound => Value::Null,
        Err(e) => return Err(failed(e.to_string())),
    };
    // A linked worktree's records lie outside it, out of reach of the
    // relative rules (diff-loop-review.md Decision 9).
    let records = repo.pass_records()?;
    let outside = (!records.starts_with(repo.root()))
        .then(|| absolute(&records))
        .flatten();
    let after = installed(before, outside.as_deref());
    let json = serde_json::to_string_pretty(&after).expect("a JSON value always serialises");
    write_file(&path, &(json + "\n"))?;
    // In the checkout's own config, so the hooks run for every agent.
    repo.use_hooks()?;
    repo.exclude(".claude/")?;
    Ok(path)
}

/// `settings`, a `.claude/settings.json`, with the guard merged in: what it
/// had is kept, and running the install twice changes nothing more.
/// `records`, a pass-record directory outside the checkout already in
/// Claude Code's `//` form (`absolute`), is denied as well.
pub(crate) fn installed(mut settings: Value, records: Option<&str>) -> Value {
    if !settings.is_object() {
        settings = json!({});
    }
    object(&mut settings, "env")["AGENT"] = json!("1");
    // Pass records sit in the git directory, which for a linked worktree is
    // under `.git/worktrees/<name>/`; the run directories hold the verdicts.
    let deny = [
        "Edit(.githooks/**)",
        "Write(.githooks/**)",
        "Edit(**/diff-loop-review/passed/**)",
        "Write(**/diff-loop-review/passed/**)",
        "Edit(target/review/**)",
        "Write(target/review/**)",
    ];
    let outside = records
        .into_iter()
        .flat_map(|dir| [format!("Edit({dir}/**)"), format!("Write({dir}/**)")]);
    let permissions = object(&mut settings, "permissions");
    let list = array(permissions, "deny");
    // A loop, not `extend`: each rule is checked against the list it joins.
    for rule in deny.into_iter().map(String::from).chain(outside) {
        if !list.iter().any(|r| r == rule.as_str()) {
            list.push(json!(rule));
        }
    }
    let hook = json!({
        "matcher": "Bash",
        "hooks": [{
            "type": "command",
            "command": GUARD_COMMAND,
        }],
    });
    let pre = array(object(&mut settings, "hooks"), "PreToolUse");
    if !pre.contains(&hook) {
        pre.push(hook);
    }
    settings
}

/// `dir` as a Claude Code permission path from the filesystem root, which
/// it writes with a leading `//`; `None` when it is not a Unix path.
fn absolute(dir: &Path) -> Option<String> {
    dir.to_str()
        .filter(|path| path.starts_with('/'))
        .map(|path| format!("/{path}"))
}

fn object<'v>(value: &'v mut Value, key: &str) -> &'v mut Value {
    let map = value.as_object_mut().expect("callers pass an object");
    let entry = map.entry(key).or_insert_with(|| json!({}));
    if !entry.is_object() {
        *entry = json!({});
    }
    entry
}

fn array<'v>(value: &'v mut Value, key: &str) -> &'v mut Vec<Value> {
    let map = value.as_object_mut().expect("callers pass an object");
    let entry = map.entry(key).or_insert_with(|| json!([]));
    if !entry.is_array() {
        *entry = json!([]);
    }
    entry.as_array_mut().expect("just made an array")
}

#[cfg(test)]
mod tests {
    use std::process::Command;

    use super::*;
    use crate::git::tests::repository;

    #[test]
    fn installing_points_git_at_the_hooks_and_keeps_claude_out_of_git() {
        let (_dir, repo) = repository();
        let settings = install(&repo).unwrap();
        assert!(settings.is_file());
        let hooks = Command::new("git")
            .arg("-C")
            .arg(repo.root())
            .args(["config", "--local", "core.hooksPath"])
            .output()
            .unwrap();
        assert_eq!(String::from_utf8_lossy(&hooks.stdout).trim(), ".githooks");
        assert!(!repo.has_unstaged().unwrap(), ".claude/ shows as untracked");
        install(&repo).unwrap();
        let exclude = fs::read_to_string(repo.root().join(".git/info/exclude")).unwrap();
        assert_eq!(exclude.matches(".claude/").count(), 1);
    }

    #[test]
    fn installing_keeps_what_was_there_and_is_idempotent() {
        let before = json!({
            "env": { "EDITOR": "vi" },
            "permissions": { "deny": ["Read(.env)"] },
            "model": "x",
        });
        let once = installed(before, None);
        let twice = installed(once.clone(), None);
        assert_eq!(once, twice);
        assert_eq!(once["env"]["EDITOR"], "vi");
        assert_eq!(once["env"]["AGENT"], "1");
        assert_eq!(once["model"], "x");
        assert_eq!(once["permissions"]["deny"].as_array().unwrap().len(), 7);
        assert_eq!(once["hooks"]["PreToolUse"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn records_outside_the_checkout_are_denied_by_their_absolute_path() {
        let records = "//main/.git/worktrees/wt/diff-loop-review/passed";
        let once = installed(json!({}), Some(records));
        let deny = &once["permissions"]["deny"];
        assert!(
            deny.as_array()
                .unwrap()
                .contains(&json!(format!("Edit({records}/**)")))
        );
        assert!(
            deny.as_array()
                .unwrap()
                .contains(&json!(format!("Write({records}/**)")))
        );
        assert_eq!(installed(once.clone(), Some(records)), once);
    }

    #[cfg(unix)]
    #[test]
    fn a_linked_worktree_denies_its_records_in_the_main_git_directory() {
        let (main, repo) = repository();
        let at = main.path().join("wt");
        let status = Command::new("git")
            .arg("-C")
            .arg(repo.root())
            .args(["worktree", "add", "-q", "-b", "agent/x"])
            .arg(&at)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .status()
            .unwrap();
        assert!(status.success());
        let worktree = Repo::at(at.canonicalize().unwrap());
        let settings = install(&worktree).unwrap();
        let text = fs::read_to_string(settings).unwrap();
        let records = worktree.pass_records().unwrap();
        assert!(!records.starts_with(worktree.root()));
        assert!(
            text.contains(&format!("Edit(/{}/**)", records.display())),
            "{text}"
        );
        let main_settings = install(&repo).unwrap();
        let text = fs::read_to_string(main_settings).unwrap();
        assert!(
            !text.contains("Edit(//"),
            "the main checkout needs no absolute rule"
        );
    }
}
