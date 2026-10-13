//! The command lines the local guard refuses (`docs/spec/diff-loop-review.md`
//! Decision 9).

/// Git subcommands that write a commit without the pre-commit hook.
const UNHOOKED: [&str; 5] = ["commit-tree", "cherry-pick", "revert", "rebase", "am"];

/// Commit's short options that take a value: a cluster ends at one.
const TAKES_VALUE: &str = "mFCcStuU";

/// Why `command`, a shell command line, would skip the commit gate; `None`
/// when it would not. Reads words, not a shell: it can be fooled.
pub(crate) fn refusal(command: &str) -> Option<String> {
    segments(command).iter().find_map(|words| refusal_in(words))
}

/// `command` as the words of each simple command in it: split on blanks
/// and on `;`, `|`, `&` and newlines, except inside quotes, which are
/// dropped. No expansion, no escapes: enough to read a git command line.
fn segments(command: &str) -> Vec<Vec<String>> {
    let mut segments = vec![Vec::new()];
    let mut word: Option<String> = None;
    let mut quote: Option<char> = None;
    for c in command.chars() {
        match (quote, c) {
            (Some(q), c) if c == q => quote = None,
            (Some(_), c) => word.get_or_insert_with(String::new).push(c),
            (None, '\'' | '"') => {
                quote = Some(c);
                word.get_or_insert_with(String::new);
            }
            (None, c) if c.is_whitespace() || matches!(c, ';' | '|' | '&') => {
                let current = segments.last_mut().expect("never empty");
                current.extend(word.take());
                if c != ' ' && c != '\t' && !current.is_empty() {
                    segments.push(Vec::new());
                }
            }
            (None, c) => word.get_or_insert_with(String::new).push(c),
        }
    }
    segments.last_mut().expect("never empty").extend(word);
    segments
}

fn refusal_in(words: &[String]) -> Option<String> {
    // Leading `NAME=value` words set the environment for the command.
    let mut rest = words.iter().skip_while(|w| is_assignment(w));
    if words
        .iter()
        .take_while(|w| is_assignment(w))
        .any(|w| w.starts_with("GIT_CONFIG"))
    {
        return Some("setting git config through the environment can move the hooks".into());
    }
    let program = rest.next()?;
    if !(program == "git" || program.ends_with("/git")) {
        return None;
    }
    let args: Vec<&String> = rest.collect();
    if args.iter().any(|a| *a == "--no-verify") {
        return Some("--no-verify skips the commit gate".into());
    }
    // Global options come before the subcommand; `-c` takes a value.
    let mut index = 0;
    while let Some(arg) = args.get(index).filter(|a| a.starts_with('-')) {
        let setting = match arg.as_str() {
            "-c" | "--config-env" => args.get(index + 1).map(|v| v.as_str()),
            other => other
                .strip_prefix("-c")
                .or_else(|| other.strip_prefix("--config-env=")),
        };
        if let Some(key) = setting.filter(|s| moves_hooks(s)) {
            return Some(format!("`{key}` would move the commit gate's hooks"));
        }
        index += if matches!(
            arg.as_str(),
            "-c" | "-C" | "--config-env" | "--git-dir" | "--work-tree" | "--namespace"
        ) {
            2
        } else {
            1
        };
    }
    let subcommand = args.get(index)?.as_str();
    let after = &args[index + 1..];
    if UNHOOKED.contains(&subcommand) {
        return Some(format!(
            "git {subcommand} commits without the commit gate's hook"
        ));
    }
    if subcommand == "config" && after.iter().any(|a| moves_hooks(a)) {
        return Some("changing core.hooksPath or a git alias can skip the commit gate".into());
    }
    if subcommand == "commit" && after.iter().any(|a| skips_verify(a)) {
        return Some("git commit -n skips the commit gate".into());
    }
    None
}

fn is_assignment(word: &str) -> bool {
    word.split_once('=').is_some_and(|(name, _)| {
        !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
    })
}

/// A config key that would change which hooks run, or alias a command.
fn moves_hooks(setting: &str) -> bool {
    let key = setting.to_ascii_lowercase();
    key.starts_with("core.hookspath") || key.starts_with("alias.")
}

/// A short-option cluster of `git commit` that holds `-n` before any option
/// that takes a value (`-am` does not; `-nm` and `-an` do).
fn skips_verify(arg: &str) -> bool {
    let Some(cluster) = arg.strip_prefix('-').filter(|c| !c.starts_with('-')) else {
        return false;
    };
    cluster
        .chars()
        .take_while(|c| !TAKES_VALUE.contains(*c))
        .any(|c| c == 'n')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ordinary_git_and_other_commands_pass() {
        for command in [
            "git status",
            "git commit -am 'fix the gap count'",
            "git commit -F msg.txt",
            "git -C app diff --cached",
            "cargo test && git add -A",
            "echo rebase",
            "git config user.name x",
            "git commit -m 'mention -n in text'",
            "git commit -uno -m x",
            "git commit -U5n -m x",
            "git commit -vtnotes.txt",
            "git commit -m \"a; git rebase main\"",
        ] {
            assert_eq!(refusal(command), None, "{command}");
        }
    }

    #[test]
    fn every_way_round_the_hook_is_refused() {
        for command in [
            "git commit --no-verify -m x",
            "git commit -n -m x",
            "git commit -anm x",
            "git merge --no-verify topic",
            "git -c core.hooksPath=/dev/null commit -m x",
            "git -ccore.hooksPath=/tmp commit",
            "git config core.hooksPath /tmp",
            "git config --local alias.ci 'commit --no-verify'",
            "git -c alias.c=commit c",
            "GIT_CONFIG_COUNT=1 git commit",
            "git commit-tree HEAD^{tree}",
            "git cherry-pick abc",
            "cd x; git rebase main",
            "/usr/bin/git am < patch",
            "git --git-dir .git rebase main",
            "git --work-tree . commit-tree x",
            "git revert HEAD",
        ] {
            assert!(refusal(command).is_some(), "{command}");
        }
    }

    #[test]
    fn segments_split_on_separators_outside_quotes() {
        assert_eq!(
            segments("a 'b c'; d \"e|f\" && g\nh"),
            [vec!["a", "b c"], vec!["d", "e|f"], vec!["g"], vec!["h"]]
        );
    }
}
