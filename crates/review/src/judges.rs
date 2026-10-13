//! The judges: which a change needs, and the verdict each must give.

use std::{fmt, str::FromStr};

use serde::{Deserialize, Serialize};

use crate::Failure;

/// A judge of the review skill, by the name its verdict file carries.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum Judge {
    #[serde(rename = "code-1")]
    Code1,
    #[serde(rename = "code-2")]
    Code2,
    #[serde(rename = "rust")]
    Rust,
    #[serde(rename = "ui")]
    Ui,
}

impl Judge {
    const ALL: [Self; 4] = [Self::Code1, Self::Code2, Self::Rust, Self::Ui];

    pub(crate) fn name(self) -> &'static str {
        match self {
            Self::Code1 => "code-1",
            Self::Code2 => "code-2",
            Self::Rust => "rust",
            Self::Ui => "ui",
        }
    }
}

impl fmt::Display for Judge {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.name())
    }
}

impl FromStr for Judge {
    type Err = Failure;

    fn from_str(name: &str) -> Result<Self, Failure> {
        Self::ALL
            .into_iter()
            .find(|judge| judge.name() == name)
            .ok_or_else(|| Failure::UnknownJudge {
                name: name.to_owned(),
            })
    }
}

/// The judges the review skill names for these staged paths, in a fixed
/// order (`docs/spec/diff-loop-review.md` Decision 5).
pub(crate) fn required(paths: &[String]) -> Vec<Judge> {
    let code = paths.iter().any(|p| {
        ["crates/", "app/src-tauri/", "app/src/", ".githooks/"]
            .iter()
            .any(|dir| p.starts_with(dir))
            || ["Cargo.toml", "Cargo.lock", "app/package.json"].contains(&p.as_str())
    });
    let rust = paths.iter().any(|p| p.ends_with(".rs"));
    let ui = paths
        .iter()
        .any(|p| p.starts_with("app/src/") && (p.ends_with(".tsx") || p.ends_with(".css")));
    [
        (code, Judge::Code1),
        (code, Judge::Code2),
        (rust, Judge::Rust),
        (ui, Judge::Ui),
    ]
    .into_iter()
    .filter_map(|(needed, judge)| needed.then_some(judge))
    .collect()
}

/// The review skill's verdict shape; only `findings` decides.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Verdict {
    #[expect(dead_code, reason = "part of the shape a verdict must have")]
    iteration: u32,
    findings: Vec<Finding>,
    #[expect(dead_code, reason = "part of the shape a verdict must have")]
    contradictions: Vec<String>,
    #[expect(dead_code, reason = "part of the shape a verdict must have")]
    questions: Vec<String>,
    #[expect(dead_code, reason = "part of the shape a verdict must have")]
    matches: Vec<String>,
}

/// One finding: what broke where.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Finding {
    severity: Severity,
    source: String,
    #[expect(dead_code, reason = "part of the shape a finding must have")]
    expected: String,
    found: String,
    at: String,
}

/// How bad a finding is; the review skill names only these.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Severity {
    Major,
    Minor,
}

impl fmt::Display for Severity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Major => "major",
            Self::Minor => "minor",
        })
    }
}

impl Verdict {
    /// A verdict read from a judge's output: the JSON alone, or one fenced
    /// `json` block.
    ///
    /// # Errors
    /// [`Failure::Verdict`] when it is not the review skill's shape.
    pub(crate) fn parse(text: &str) -> Result<Self, Failure> {
        let body = text
            .trim()
            .strip_prefix("```json")
            .and_then(|rest| rest.trim_end().strip_suffix("```"))
            .unwrap_or(text);
        serde_json::from_str(body).map_err(|e| Failure::Verdict {
            message: e.to_string(),
        })
    }

    /// The findings, one line each, for a refusal.
    pub(crate) fn findings(&self) -> Vec<String> {
        self.findings
            .iter()
            .map(|f| format!("{} at {}: {} ({})", f.severity, f.at, f.found, f.source))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths(list: &[&str]) -> Vec<String> {
        list.iter().map(|p| (*p).to_owned()).collect()
    }

    #[test]
    fn docs_alone_need_no_judge() {
        assert!(required(&paths(&["docs/spec/a.md", "AGENTS.md"])).is_empty());
    }

    #[test]
    fn rust_needs_the_code_judges_and_the_rust_judge() {
        assert_eq!(
            required(&paths(&["crates/core/src/lib.rs"])),
            [Judge::Code1, Judge::Code2, Judge::Rust]
        );
        assert_eq!(
            required(&paths(&["Cargo.lock"])),
            [Judge::Code1, Judge::Code2]
        );
    }

    #[test]
    fn a_view_needs_the_ui_judge() {
        assert_eq!(
            required(&paths(&["app/src/components/Sidebar.tsx"])),
            [Judge::Code1, Judge::Code2, Judge::Ui]
        );
        assert_eq!(
            required(&paths(&["app/src/rows.ts"])),
            [Judge::Code1, Judge::Code2]
        );
        assert_eq!(
            required(&paths(&[".githooks/pre-commit"])),
            [Judge::Code1, Judge::Code2]
        );
    }

    const CLEAN: &str =
        r#"{"iteration":1,"findings":[],"contradictions":[],"questions":["q"],"matches":["m"]}"#;

    #[test]
    fn a_verdict_reads_bare_or_fenced() {
        assert!(Verdict::parse(CLEAN).unwrap().findings().is_empty());
        let fenced = format!("```json\n{CLEAN}\n```\n");
        assert!(Verdict::parse(&fenced).unwrap().findings().is_empty());
    }

    #[test]
    fn a_verdict_with_findings_names_them() {
        let text = r#"{"iteration":2,"findings":[{"severity":"major","source":"§2","expected":"e","found":"f","at":"a.rs:1"}],"contradictions":[],"questions":[],"matches":[]}"#;
        assert_eq!(
            Verdict::parse(text).unwrap().findings(),
            ["major at a.rs:1: f (§2)"]
        );
    }

    #[test]
    fn judges_are_named_as_their_verdict_files_are() {
        for judge in Judge::ALL {
            assert_eq!(judge.name().parse::<Judge>().unwrap(), judge);
        }
        assert!("code".parse::<Judge>().is_err());
    }

    #[test]
    fn anything_else_is_refused() {
        assert!(Verdict::parse("looks good to me").is_err());
        assert!(Verdict::parse(r#"{"findings":[]}"#).is_err());
        let extra = CLEAN.replace("\"iteration\":1", "\"iteration\":1,\"pass\":true");
        assert!(Verdict::parse(&extra).is_err());
        let nit = r#"{"iteration":1,"findings":[{"severity":"nit","source":"s","expected":"e","found":"f","at":"a"}],"contradictions":[],"questions":[],"matches":[]}"#;
        assert!(Verdict::parse(nit).is_err());
    }
}
