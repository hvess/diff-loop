//! A review run, its verdicts, and the pass record a clean run earns.

use std::{
    fs, io,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

use crate::{
    Failure,
    git::Repo,
    judges::{self, Judge, Verdict},
    write_file,
};

/// What `begin` records in a run's `run.json`, written only once the
/// stages passed.
#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Run {
    /// The staged tree the run reviewed.
    pub(crate) tree: String,
    /// The judges it needs.
    pub(crate) judges: Vec<Judge>,
}

/// Checks the change is staged whole, runs the stages, and writes a run
/// directory under `target/review/` for the judges; returns its path and
/// the run it recorded.
///
/// # Errors
/// [`Failure::Unstaged`] when the working tree holds anything not staged,
/// before or after the stages; a stage's failure; [`Failure::Run`] when git
/// fails; [`Failure::Io`] when the run cannot be written.
pub(crate) fn begin(
    repo: &Repo,
    stages: impl FnOnce(&Path) -> Result<(), Failure>,
) -> Result<(PathBuf, Run), Failure> {
    if repo.has_unstaged()? {
        return Err(Failure::Unstaged);
    }
    let tree = repo.staged_tree()?;
    stages(repo.root())?;
    // Read again after the stages: they must not have changed what is staged.
    if repo.staged_tree()? != tree || repo.has_unstaged()? {
        return Err(Failure::Unstaged);
    }
    let run = Run {
        tree,
        judges: judges::required(&repo.staged_paths()?),
    };
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos());
    let dir = repo
        .root()
        .join("target")
        .join("review")
        .join(stamp.to_string());
    write_file(&dir.join("change.diff"), &repo.staged_diff()?)?;
    let json = serde_json::to_string_pretty(&run).map_err(|e| Failure::Io {
        path: dir.join("run.json"),
        message: e.to_string(),
    })?;
    write_file(&dir.join("run.json"), &json)?;
    Ok((dir, run))
}

/// Keeps `text` as `judge`'s verdict in the run at `dir`, verbatim.
///
/// # Errors
/// [`Failure::NotAJudge`] when the run needs no such judge;
/// [`Failure::Verdict`] when `text` is not a verdict; [`Failure::Io`] when
/// the run cannot be read or the verdict written.
pub(crate) fn verdict(dir: &Path, judge: Judge, text: &str) -> Result<(), Failure> {
    let run = read_run(dir)?;
    if !run.judges.contains(&judge) {
        return Err(Failure::NotAJudge {
            judge: judge.to_string(),
            needed: names(&run.judges),
        });
    }
    Verdict::parse(text)?;
    write_file(&dir.join(format!("{judge}.json")), text)
}

/// Writes the pass record for the run at `dir` when its tree is still the
/// staged tree and every judge the staged paths need gave a clean verdict.
/// The judges are worked out again here, not read from `run.json`.
///
/// # Errors
/// [`Failure::TreeMoved`], [`Failure::MissingVerdict`] or
/// [`Failure::Findings`] when it has not passed; [`Failure::Verdict`] when a
/// verdict file is not a verdict; [`Failure::Io`] when the run cannot be read
/// or the record written; [`Failure::Run`] when git fails.
pub(crate) fn pass(repo: &Repo, dir: &Path) -> Result<PathBuf, Failure> {
    let run = read_run(dir)?;
    let staged = repo.staged_tree()?;
    if staged != run.tree {
        return Err(Failure::TreeMoved {
            reviewed: run.tree,
            staged,
        });
    }
    for judge in judges::required(&repo.staged_paths()?) {
        let path = dir.join(format!("{judge}.json"));
        let text = fs::read_to_string(&path).map_err(|e| match e.kind() {
            io::ErrorKind::NotFound => Failure::MissingVerdict {
                judge: judge.to_string(),
            },
            _ => Failure::Io {
                path: path.clone(),
                message: e.to_string(),
            },
        })?;
        let findings = Verdict::parse(&text)?.findings();
        if !findings.is_empty() {
            return Err(Failure::Findings {
                judge: judge.to_string(),
                findings,
            });
        }
    }
    let record = repo.pass_record(&run.tree)?;
    write_file(&record, &dir.display().to_string())?;
    Ok(record)
}

/// Whether the staged tree has a pass record: what the hook asks.
///
/// # Errors
/// [`Failure::NoPass`] when it has none; [`Failure::Run`] when git fails.
pub(crate) fn check(repo: &Repo) -> Result<(), Failure> {
    let tree = repo.staged_tree()?;
    if repo.pass_record(&tree)?.is_file() {
        Ok(())
    } else {
        Err(Failure::NoPass { tree })
    }
}

fn names(judges: &[Judge]) -> String {
    judges
        .iter()
        .map(|j| j.name())
        .collect::<Vec<_>>()
        .join(", ")
}

fn read_run(dir: &Path) -> Result<Run, Failure> {
    let path = dir.join("run.json");
    let text = fs::read_to_string(&path).map_err(|e| Failure::Io {
        path: path.clone(),
        message: e.to_string(),
    })?;
    serde_json::from_str(&text).map_err(|e| Failure::Io {
        path,
        message: e.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::tests::{repository, stage};

    const CLEAN: &str =
        r#"{"iteration":1,"findings":[],"contradictions":[],"questions":[],"matches":[]}"#;
    const FOUND: &str = r#"{"iteration":1,"findings":[{"severity":"minor","source":"s","expected":"e","found":"f","at":"x.rs:1"}],"contradictions":[],"questions":[],"matches":[]}"#;

    fn passing(_: &Path) -> Result<(), Failure> {
        Ok(())
    }

    #[test]
    fn a_run_with_clean_verdicts_passes_its_tree() {
        let (_dir, repo) = repository();
        stage(&repo, "crates/x/src/lib.rs", "//! x\n");
        assert!(matches!(check(&repo), Err(Failure::NoPass { .. })));
        let (run_dir, run) = begin(&repo, passing).unwrap();
        assert_eq!(run.judges, [Judge::Code1, Judge::Code2, Judge::Rust]);
        for judge in run.judges {
            verdict(&run_dir, judge, CLEAN).unwrap();
        }
        pass(&repo, &run_dir).unwrap();
        check(&repo).unwrap();
    }

    #[test]
    fn a_missing_or_failing_verdict_earns_no_pass() {
        let (_dir, repo) = repository();
        stage(&repo, "crates/x/src/lib.rs", "//! x\n");
        let (run_dir, _) = begin(&repo, passing).unwrap();
        verdict(&run_dir, Judge::Code1, CLEAN).unwrap();
        verdict(&run_dir, Judge::Code2, FOUND).unwrap();
        assert!(matches!(
            pass(&repo, &run_dir),
            Err(Failure::Findings { .. })
        ));
        verdict(&run_dir, Judge::Code2, CLEAN).unwrap();
        assert!(matches!(
            pass(&repo, &run_dir),
            Err(Failure::MissingVerdict { .. })
        ));
        assert!(check(&repo).is_err());
    }

    #[test]
    fn a_tree_staged_after_the_run_is_not_passed() {
        let (_dir, repo) = repository();
        stage(&repo, "docs/a.md", "a\n");
        let (run_dir, run) = begin(&repo, passing).unwrap();
        assert!(run.judges.is_empty());
        stage(&repo, "docs/a.md", "changed after review\n");
        assert!(matches!(
            pass(&repo, &run_dir),
            Err(Failure::TreeMoved { .. })
        ));
        assert!(check(&repo).is_err());
    }

    #[test]
    fn a_run_refuses_unstaged_work_and_a_failing_stage() {
        let (_dir, repo) = repository();
        stage(&repo, "docs/a.md", "a\n");
        fs::write(repo.root().join("loose.txt"), "x").unwrap();
        assert!(matches!(begin(&repo, passing), Err(Failure::Unstaged)));
        fs::remove_file(repo.root().join("loose.txt")).unwrap();
        let failing = |_: &Path| {
            Err(Failure::Stage {
                name: "test".into(),
                output: "1 failed".into(),
            })
        };
        assert!(matches!(begin(&repo, failing), Err(Failure::Stage { .. })));
    }

    #[test]
    fn only_a_judge_the_run_needs_can_give_a_verdict() {
        let (_dir, repo) = repository();
        stage(&repo, "docs/a.md", "a\n");
        let (run_dir, _) = begin(&repo, passing).unwrap();
        assert!(matches!(
            verdict(&run_dir, Judge::Rust, CLEAN),
            Err(Failure::NotAJudge { .. })
        ));
    }

    /// A `run.json` written by hand, naming no judge, earns no pass.
    #[test]
    fn pass_needs_the_judges_the_staged_paths_need_whatever_the_run_says() {
        let (_dir, repo) = repository();
        stage(&repo, "crates/x/src/lib.rs", "//! x\n");
        let (run_dir, run) = begin(&repo, passing).unwrap();
        let forged = Run {
            judges: Vec::new(),
            ..run
        };
        write_file(
            &run_dir.join("run.json"),
            &serde_json::to_string(&forged).unwrap(),
        )
        .unwrap();
        assert!(matches!(
            pass(&repo, &run_dir),
            Err(Failure::MissingVerdict { .. })
        ));
    }
}
