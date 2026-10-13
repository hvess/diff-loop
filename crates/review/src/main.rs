//! `diff-loop-review`: the review loop's commit gate
//! (`docs/spec/diff-loop-review.md`). Dev-only: no other crate depends on it.

mod git;
mod guard;
mod install;
mod judges;
mod run;
mod stages;

use std::{
    env, fs,
    io::{self, Read as _},
    path::{Path, PathBuf},
    process::ExitCode,
};

use serde_json::Value;
use thiserror::Error;

use git::Repo;

/// Why a gate command failed, in words for the agent running it.
#[derive(Debug, Error)]
enum Failure {
    #[error("{what} failed: {message}")]
    Run { what: String, message: String },
    #[error("{}: {message}", path.display())]
    Io { path: PathBuf, message: String },
    #[error("stage `{name}` failed:\n{output}")]
    Stage { name: String, output: String },
    #[error(
        "the working tree holds changes that are not staged: stage exactly the commit, and put the rest aside"
    )]
    Unstaged,
    #[error("not a verdict in the review skill's shape: {message}")]
    Verdict { message: String },
    #[error("no judge is called `{name}`: the judges are code-1, code-2, rust and ui")]
    UnknownJudge { name: String },
    #[error("this run needs no `{judge}` judge; it needs: {needed}")]
    NotAJudge { judge: String, needed: String },
    #[error("no verdict from `{judge}` yet")]
    MissingVerdict { judge: String },
    #[error("`{judge}` found:\n{}", findings.join("\n"))]
    Findings {
        judge: String,
        findings: Vec<String>,
    },
    #[error("the staged tree is {staged}, not the reviewed {reviewed}: review it again")]
    TreeMoved { reviewed: String, staged: String },
    #[error(
        "tree {tree} has not passed the review loop (.agents/skills/review/SKILL.md): run it, then `pass`"
    )]
    NoPass { tree: String },
    #[error(
        "usage: diff-loop-review begin | verdict <run> <judge> | pass <run> | check | guard | install-guard"
    )]
    Usage,
}

fn main() -> ExitCode {
    let args: Vec<String> = env::args().skip(1).collect();
    let words: Vec<&str> = args.iter().map(String::as_str).collect();
    let result = match words.as_slice() {
        ["guard"] => return guard(),
        ["begin"] => begin(),
        ["verdict", run, judge] => judge
            .parse()
            .and_then(|judge| Ok((judge, stdin()?)))
            .and_then(|(judge, text)| run::verdict(Path::new(run), judge, &text)),
        ["pass", run] => Repo::here()
            .and_then(|repo| run::pass(&repo, Path::new(run)))
            .map(|record| {
                println!("passed: {}", record.display());
            }),
        ["check"] => Repo::here().and_then(|repo| run::check(&repo)),
        ["install-guard"] => install_guard(),
        _ => Err(Failure::Usage),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(failure) => {
            eprintln!("diff-loop-review: {failure}");
            ExitCode::FAILURE
        }
    }
}

fn begin() -> Result<(), Failure> {
    let repo = Repo::here()?;
    let (dir, run) = run::begin(&repo, stages::run_all)?;
    println!("run: {}", dir.display());
    if run.judges.is_empty() {
        println!("no judge needed: `diff-loop-review pass {}`", dir.display());
    }
    for judge in &run.judges {
        println!(
            "judge {judge}: its verdict goes in with `cargo run -q -p diff-loop-review -- verdict {} {judge}` on stdin",
            dir.display()
        );
    }
    Ok(())
}

fn stdin() -> Result<String, Failure> {
    let mut text = String::new();
    io::stdin()
        .read_to_string(&mut text)
        .map_err(|e| Failure::Run {
            what: "reading the verdict".into(),
            message: e.to_string(),
        })?;
    Ok(text)
}

/// The Claude Code `PreToolUse` hook: exit 2 refuses the command, with the
/// reason on stderr for the agent.
fn guard() -> ExitCode {
    // Input that is not a Bash call lets the command through: refusing it
    // would block every command should Claude Code's format change.
    let Ok(text) = stdin() else {
        return ExitCode::SUCCESS;
    };
    let call: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    let command = call["tool_input"]["command"].as_str().unwrap_or("");
    match guard::refusal(command) {
        Some(reason) => {
            eprintln!(
                "diff-loop-review guard: {reason}. Run the review loop and commit normally (docs/spec/diff-loop-review.md)."
            );
            ExitCode::from(2)
        }
        None => ExitCode::SUCCESS,
    }
}

fn install_guard() -> Result<(), Failure> {
    let settings = install::install(&Repo::here()?)?;
    println!(
        "hooks: .githooks; guard installed in {}",
        settings.display()
    );
    Ok(())
}

/// Writes `text` to `path`, making its directory first: the one way this
/// crate writes a file.
fn write_file(path: &Path, text: &str) -> Result<(), Failure> {
    let failed = |e: io::Error| Failure::Io {
        path: path.to_path_buf(),
        message: e.to_string(),
    };
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(failed)?;
    }
    fs::write(path, text).map_err(failed)
}
