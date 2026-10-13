//! A review written out as plain-text instructions for a coding agent.

use std::fmt::Write as _;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{
    anchor::{Comment, Target},
    base::Base,
    diff::Side,
    repository::Head,
};

/// How headings are written.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Format {
    /// Headings as bare lines.
    Plain,
    /// Headings as `###` lines.
    Markdown,
}

/// Everything [`instructions`] writes from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct InstructionsRequest {
    /// What is checked out.
    pub head: Head,
    /// What it is compared with.
    pub base: Base,
    /// Grouped by file in order of first appearance; by line within a file.
    pub comments: Vec<Comment>,
    /// A note on the review as a whole; written when not blank.
    pub note: Option<String>,
    /// How headings are written.
    pub format: Format,
    /// Whether each line comment quotes the code it is on.
    pub include_code: bool,
}

/// Longest quoted code before it is cut with `…`, in characters.
const QUOTE_MAX: usize = 60;

/// The review as instructions an agent can act on.
#[must_use]
pub fn instructions(request: &InstructionsRequest) -> String {
    let mut out = String::new();
    let heading = |title: &str| match request.format {
        Format::Plain => title.to_owned(),
        Format::Markdown => format!("### {title}"),
    };
    // `write!` to a String cannot fail.
    let _ = writeln!(
        out,
        "Please address these review comments on {}{}.",
        head_label(&request.head),
        base_label(&request.base)
    );
    if let Some(note) = request
        .note
        .as_deref()
        .map(str::trim)
        .filter(|n| !n.is_empty())
    {
        let _ = write!(out, "\n{}\n{note}\n", heading("General"));
    }
    for (path, comments) in by_file(&request.comments) {
        let _ = write!(out, "\n{}\n", heading(path));
        for comment in comments {
            write_comment(&mut out, comment, request.include_code);
        }
    }
    out.push_str("\nWhen done, reply with one line per comment saying what you changed.\n");
    out
}

fn head_label(head: &Head) -> String {
    match head {
        Head::Branch { name } => name.clone(),
        Head::Detached { commit } => format!("the detached HEAD at {commit}"),
    }
}

fn base_label(base: &Base) -> String {
    match base {
        Base::Ref { name } => format!(" (compared with {name})"),
        Base::Uncommitted => " (uncommitted changes only)".to_owned(),
        Base::LastCommit => " (last commit only)".to_owned(),
    }
}

/// Comments grouped by path in order of first appearance, sorted by line within.
fn by_file(comments: &[Comment]) -> Vec<(&str, Vec<&Comment>)> {
    // A loop, not a chain: grouping in first-appearance order searches the
    // groups built so far. Linear per comment; comments are written by hand.
    let mut files: Vec<(&str, Vec<&Comment>)> = Vec::new();
    for comment in comments {
        match files.iter_mut().find(|(path, _)| *path == comment.path) {
            Some((_, list)) => list.push(comment),
            None => files.push((&comment.path, vec![comment])),
        }
    }
    for (_, list) in &mut files {
        list.sort_by_key(|c| match &c.target {
            Target::File => (0, 0),
            Target::Lines {
                side: Side::Old,
                start,
                ..
            } => (1, *start),
            Target::Lines {
                side: Side::New,
                start,
                ..
            } => (2, *start),
        });
    }
    files
}

fn write_comment(out: &mut String, comment: &Comment, include_code: bool) {
    let text = comment.text.trim();
    let _ = match &comment.target {
        Target::File => writeln!(out, "- The whole file: {text}"),
        target @ Target::Lines { side, start, code } => {
            let removed = if *side == Side::Old { "removed " } else { "" };
            let end = target.end().unwrap_or(*start);
            let lines = if *start == end {
                format!("L{start}")
            } else {
                format!("L{start}–{end}")
            };
            let quote = include_code
                .then(|| quote(code))
                .flatten()
                .unwrap_or_default();
            writeln!(out, "- {removed}{lines}{quote}: {text}")
        }
    };
    if let Some(suggestion) = &comment.suggestion {
        let _ = writeln!(
            out,
            "  Suggested change:\n  ```{}",
            fence_language(&comment.path)
        );
        for line in dedent(suggestion) {
            let _ = writeln!(out, "  {line}");
        }
        out.push_str("  ```\n");
    }
}

/// The first non-blank line of `code` in backticks, cut to [`QUOTE_MAX`],
/// with `…` when more follows.
fn quote(code: &[String]) -> Option<String> {
    let first = code.iter().map(|l| l.trim()).find(|l| !l.is_empty())?;
    let cut: String = first.chars().take(QUOTE_MAX).collect();
    let more = cut.len() < first.len() || code.len() > 1;
    Some(format!(" `{cut}{}`", if more { "…" } else { "" }))
}

/// `text`'s lines with their common leading whitespace removed.
fn dedent(text: &str) -> impl Iterator<Item = &str> {
    let indent = text
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| l.len() - l.trim_start().len())
        .min()
        .unwrap_or(0);
    text.lines()
        .map(move |l| l.get(indent..).unwrap_or_else(|| l.trim_start()))
}

/// The Markdown fence language for `path`, or empty when unknown.
fn fence_language(path: &str) -> &'static str {
    let extension = path.rsplit_once('.').map_or("", |(_, e)| e);
    match extension {
        "ts" | "mts" | "cts" => "ts",
        "tsx" => "tsx",
        "js" | "mjs" | "cjs" => "js",
        "jsx" => "jsx",
        "rs" => "rust",
        "py" => "python",
        "go" => "go",
        "rb" => "ruby",
        "java" => "java",
        "kt" | "kts" => "kotlin",
        "swift" => "swift",
        "c" | "h" => "c",
        "cc" | "cpp" | "cxx" | "hpp" => "cpp",
        "cs" => "csharp",
        "css" => "css",
        "scss" => "scss",
        "html" => "html",
        "json" => "json",
        "yaml" | "yml" => "yaml",
        "toml" => "toml",
        "md" => "markdown",
        "sh" | "bash" => "sh",
        "sql" => "sql",
        _ => "",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::anchor::AnchorState;

    fn comment(path: &str, start: u32, code: &[&str], text: &str) -> Comment {
        Comment {
            id: format!("{path}:{start}"),
            path: path.into(),
            target: Target::Lines {
                side: Side::New,
                start,
                code: code.iter().map(|s| (*s).to_owned()).collect(),
            },
            text: text.into(),
            suggestion: None,
            state: AnchorState::Current,
        }
    }

    fn request(comments: Vec<Comment>) -> InstructionsRequest {
        InstructionsRequest {
            head: Head::Branch {
                name: "agent/share-rate-limit".into(),
            },
            base: Base::Ref {
                name: "main".into(),
            },
            comments,
            note: Some("Keep the change scoped to the share endpoint.".into()),
            format: Format::Plain,
            include_code: true,
        }
    }

    #[test]
    fn writes_the_review_grouped_by_file_with_code_and_suggestions() {
        let handler = "src/api/share/handler.ts";
        let mut hash = comment(
            handler,
            20,
            &["    log.warn('share rate limited', { userId });"],
            "Don't log the raw userId. Hash it first.",
        );
        hash.suggestion =
            Some("    log.warn('share rate limited', { user: hashUserId(userId) });".into());
        let comments = vec![
            hash,
            comment(
                "config/limits.yaml",
                7,
                &["  maxPerWindow: 20"],
                "Make it 50.",
            ),
            comment(
                handler,
                21,
                &["    return res.status(429).json({", "    });"],
                "Share the 429 body.",
            ),
            comment(
                handler,
                18,
                &["  res.setHeader('X-RateLimit-Remaining', x);"],
                "Send the limit too.",
            ),
        ];
        let expected = "\
Please address these review comments on agent/share-rate-limit (compared with main).

General
Keep the change scoped to the share endpoint.

src/api/share/handler.ts
- L18 `res.setHeader('X-RateLimit-Remaining', x);`: Send the limit too.
- L20 `log.warn('share rate limited', { userId });`: Don't log the raw userId. Hash it first.
  Suggested change:
  ```ts
  log.warn('share rate limited', { user: hashUserId(userId) });
  ```
- L21–22 `return res.status(429).json({…`: Share the 429 body.

config/limits.yaml
- L7 `maxPerWindow: 20`: Make it 50.

When done, reply with one line per comment saying what you changed.
";
        assert_eq!(instructions(&request(comments)), expected);
    }

    #[test]
    fn markdown_marks_headings_and_code_can_be_left_out() {
        let mut request = request(vec![comment("a.rs", 3, &["let x = 1;"], "Name it.")]);
        request.format = Format::Markdown;
        request.include_code = false;
        request.note = Some("   ".into());
        let text = instructions(&request);
        assert!(text.contains("\n### a.rs\n- L3: Name it.\n"), "{text}");
        assert!(!text.contains("General"), "{text}");
    }

    #[test]
    fn removed_lines_and_whole_files_say_so() {
        let mut removed = comment("a.rs", 4, &["old()"], "Why remove this?");
        if let Target::Lines { side, .. } = &mut removed.target {
            *side = Side::Old;
        }
        let file = Comment {
            target: Target::File,
            text: "Smaller image?".into(),
            ..removed.clone()
        };
        let text = instructions(&request(vec![removed, file]));
        assert!(
            text.contains(
                "- The whole file: Smaller image?\n- removed L4 `old()`: Why remove this?\n"
            ),
            "{text}"
        );
    }

    #[test]
    fn long_code_is_cut_on_a_character_boundary() {
        let long = "é".repeat(QUOTE_MAX + 5);
        let quoted = quote(&[long]).unwrap();
        assert_eq!(quoted, format!(" `{}…`", "é".repeat(QUOTE_MAX)));
    }

    #[test]
    fn other_bases_and_a_detached_head_are_named() {
        let mut request = request(vec![]);
        request.head = Head::Detached {
            commit: "4e1b2a0".into(),
        };
        request.base = Base::Uncommitted;
        assert!(instructions(&request).starts_with(
            "Please address these review comments on the detached HEAD at 4e1b2a0 (uncommitted changes only)."
        ));
    }
}
