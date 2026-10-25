//! A review written out as Markdown instructions for a coding agent.

use std::fmt::Write as _;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{
    anchor::{AnchorState, Comment, Target, Verdict},
    base::Base,
    code::dedent,
    diff::Side,
    repository::Head,
};

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
    /// A resolved comment is left out.
    pub comments: Vec<Comment>,
}

/// Longest quoted code before it is cut with `…`, in characters.
const QUOTE_MAX: usize = 60;

/// The review as Markdown instructions an agent can act on: what is new,
/// then what was sent before and is still open (ADR 0015 §6). With
/// `kept_at`, the file the review is kept in, each comment names its id and
/// the agent is told to mark the ones it fixed resolved there (ADR 0032 §1).
#[must_use]
pub fn instructions(request: &InstructionsRequest, kept_at: Option<&str>) -> String {
    let mut out = String::new();
    // `write!` to a String cannot fail.
    let _ = writeln!(
        out,
        "Please address these review comments on {}{}.",
        head_label(&request.head),
        base_label(&request.base)
    );
    let (still, new): (Vec<&Comment>, Vec<&Comment>) = request
        .comments
        .iter()
        .filter(|c| c.resolved.is_none())
        .partition(|c| c.sent.is_some() && !c.reopened());
    for (path, comments) in by_file(&new) {
        let _ = write!(out, "\n### {path}\n");
        for comment in comments {
            write_comment(&mut out, comment, kept_at.is_some());
        }
    }
    if !still.is_empty() {
        let _ = write!(out, "\n### Still open\n{}\n", still_open(&still));
        for (path, comments) in by_file(&still) {
            let _ = write!(out, "\n#### {path}\n");
            for comment in comments {
                write_comment(&mut out, comment, kept_at.is_some());
            }
        }
    }
    match kept_at {
        Some(path) => {
            let _ = write!(
                out,
                "\nThese comments are kept in `{path}`. When you have fixed one, mark it \
                 resolved with a one-line note saying what you changed: call \
                 `resolve_comment` on the `diff-loop` MCP server with its id and the \
                 note, or, without it, set the comment's `\"resolved\"` to `\"byAgent\"` \
                 and its `\"note\"` to the note in that file, changing nothing else. \
                 Leave a comment you did not fix as it is.\n"
            );
        }
        None => {
            out.push_str("\nWhen done, reply with one line per comment saying what you changed.\n")
        }
    }
    out
}

/// The sentence under "Still open": which rounds the comments were sent in.
fn still_open(still: &[&Comment]) -> String {
    let mut rounds = still.iter().filter_map(|c| Some(c.sent.as_ref()?.round));
    match rounds.next() {
        Some(first) if rounds.all(|r| r == first) => {
            format!("Sent in round {first} and not resolved yet.")
        }
        _ => "Sent in earlier rounds and not resolved yet.".to_owned(),
    }
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
fn by_file<'a>(comments: &[&'a Comment]) -> Vec<(&'a str, Vec<&'a Comment>)> {
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

/// `comment` as one item, with its id when `with_id`.
fn write_comment(out: &mut String, comment: &Comment, with_id: bool) {
    let text = comment.text.trim();
    let still = if comment.reopened() { "Still: " } else { "" };
    // Suggested code may stand without a reason; reopened, it still says so.
    let text = match (text.is_empty(), comment.reopened()) {
        (true, true) => ": Still: see the suggested change.".to_owned(),
        (true, false) => String::new(),
        (false, _) => format!(": {still}{text}"),
    };
    let id = if with_id {
        format!(" (id `{}`)", comment.id)
    } else {
        String::new()
    };
    let _ = writeln!(out, "- {}{text}{id}", where_label(comment));
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

/// Where the comment is: its lines and their code, or what became of them.
fn where_label(comment: &Comment) -> String {
    let sent = comment.sent.as_ref();
    let verdict = sent.and_then(|s| s.verdict);
    match &comment.target {
        Target::File => "The whole file".to_owned(),
        Target::Lines { code, .. } if comment.state == AnchorState::Lost => {
            format!(
                "Code no longer in the diff, was{}",
                quote(code).unwrap_or_default()
            )
        }
        target @ Target::Lines { side, code, .. } => {
            let removed = if *side == Side::Old { "removed " } else { "" };
            match (verdict, sent.map(|s| &s.target)) {
                (
                    Some(Verdict::Removed),
                    Some(
                        was @ Target::Lines {
                            code: sent_code, ..
                        },
                    ),
                ) => {
                    format!(
                        "Code removed since sent, was {removed}{}{}",
                        lines_label(was),
                        quote(sent_code).unwrap_or_default()
                    )
                }
                (Some(Verdict::Changed | Verdict::Applied), Some(was @ Target::Lines { .. }))
                    if lines_label(was) != lines_label(target) =>
                {
                    format!(
                        "{removed}{}{}, was {}",
                        lines_label(target),
                        quote(code).unwrap_or_default(),
                        lines_label(was)
                    )
                }
                _ => format!(
                    "{removed}{}{}",
                    lines_label(target),
                    quote(code).unwrap_or_default()
                ),
            }
        }
    }
}

/// `L7`, or `L21–24` for a range.
fn lines_label(target: &Target) -> String {
    match target {
        Target::File => String::new(),
        Target::Lines { start, .. } => {
            let end = target.end().unwrap_or(*start);
            if *start == end {
                format!("L{start}")
            } else {
                format!("L{start}–{end}")
            }
        }
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
    use crate::anchor::{Place, Resolution, Sent};

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
            place: None,
            sent: None,
            resolved: None,
            note: None,
        }
    }

    /// `comment` as sent in `round` on `code` at `start`, with `verdict`.
    fn sent(comment: Comment, round: u32, start: u32, code: &[&str], verdict: Verdict) -> Comment {
        Comment {
            sent: Some(Sent {
                round,
                place: Place {
                    base: Base::Uncommitted,
                    head: Head::Branch { name: "b".into() },
                },
                commit: None,
                target: Target::Lines {
                    side: Side::New,
                    start,
                    code: code.iter().map(|s| (*s).to_owned()).collect(),
                },
                before: vec![],
                after: vec![],
                text: comment.text.clone(),
                suggestion: comment.suggestion.clone(),
                verdict: Some(verdict),
            }),
            ..comment
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

### src/api/share/handler.ts
- L18 `res.setHeader('X-RateLimit-Remaining', x);`: Send the limit too.
- L20 `log.warn('share rate limited', { userId });`: Don't log the raw userId. Hash it first.
  Suggested change:
  ```ts
  log.warn('share rate limited', { user: hashUserId(userId) });
  ```
- L21–22 `return res.status(429).json({…`: Share the 429 body.

### config/limits.yaml
- L7 `maxPerWindow: 20`: Make it 50.

When done, reply with one line per comment saying what you changed.
";
        assert_eq!(instructions(&request(comments), None), expected);
    }

    #[test]
    fn with_its_file_each_comment_names_its_id_and_the_agent_is_told_how_to_resolve() {
        let text = instructions(
            &request(vec![comment("a.rs", 3, &["let x = 1;"], "Name it.")]),
            Some("/p/.git/diff-loop/reviews/b.json"),
        );
        assert!(
            text.contains("- L3 `let x = 1;`: Name it. (id `a.rs:3`)\n"),
            "{text}"
        );
        assert!(
            text.contains("kept in `/p/.git/diff-loop/reviews/b.json`"),
            "{text}"
        );
        assert!(text.contains("`resolve_comment`"), "{text}");
        assert!(!text.contains("When done, reply"), "{text}");
    }

    #[test]
    fn sent_comments_still_open_follow_the_new_ones_and_resolved_ones_are_left_out() {
        let handler = "src/api/share/handler.ts";
        let new = comment(
            handler,
            19,
            &["res.setHeader('X-RateLimit-Limit', …)"],
            "Send limit.max.",
        );
        let lost = Comment {
            state: AnchorState::Lost,
            ..comment(
                "src/api/share/rateLimit.ts",
                20,
                &["const ttl = await redis.ttl(key);"],
                "ttl is −1 when the key has no expiry.",
            )
        };
        let reopened = Comment {
            text: "Make it 50 for team accounts.".into(),
            ..sent(
                comment(
                    "config/limits.yaml",
                    7,
                    &["maxPerWindow: 20"],
                    "20 is too low.",
                ),
                2,
                7,
                &["maxPerWindow: 20"],
                Verdict::Untouched,
            )
        };
        let untouched = sent(
            comment(
                handler,
                18,
                &["res.setHeader('X-RateLimit-Remaining', …)"],
                "Also send X-RateLimit-Limit.",
            ),
            2,
            18,
            &["res.setHeader('X-RateLimit-Remaining', …)"],
            Verdict::Untouched,
        );
        let changed = sent(
            comment(
                handler,
                23,
                &["return tooManyRequests(res, limit.resetAt);"],
                "Pull this into a helper.",
            ),
            2,
            21,
            &["return res.status(429).json({", "});"],
            Verdict::Changed,
        );
        let removed = sent(
            comment(handler, 31, &[], "Return a 503 here."),
            1,
            31,
            &["throw new Error('rate limiter unavailable');"],
            Verdict::Removed,
        );
        let resolved = Comment {
            resolved: Some(Resolution::ByReviewer),
            ..sent(
                comment(handler, 22, &["x"], "Hash it."),
                2,
                22,
                &["x"],
                Verdict::Untouched,
            )
        };
        let expected = "\
Please address these review comments on agent/share-rate-limit (compared with main).

### src/api/share/handler.ts
- L19 `res.setHeader('X-RateLimit-Limit', …)`: Send limit.max.

### src/api/share/rateLimit.ts
- Code no longer in the diff, was `const ttl = await redis.ttl(key);`: ttl is −1 when the key has no expiry.

### config/limits.yaml
- L7 `maxPerWindow: 20`: Still: Make it 50 for team accounts.

### Still open
Sent in earlier rounds and not resolved yet.

#### src/api/share/handler.ts
- L18 `res.setHeader('X-RateLimit-Remaining', …)`: Also send X-RateLimit-Limit.
- L23 `return tooManyRequests(res, limit.resetAt);`, was L21–22: Pull this into a helper.
- Code removed since sent, was L31 `throw new Error('rate limiter unavailable');`: Return a 503 here.

When done, reply with one line per comment saying what you changed.
";
        let comments = vec![new, lost, reopened, untouched, changed, removed, resolved];
        assert_eq!(instructions(&request(comments), None), expected);
    }

    #[test]
    fn still_open_names_the_one_round_its_comments_were_sent_in() {
        let one = sent(
            comment("a.rs", 1, &["x"], "t"),
            3,
            1,
            &["x"],
            Verdict::Untouched,
        );
        let text = instructions(&request(vec![one]), None);
        assert!(
            text.contains("### Still open\nSent in round 3 and not resolved yet.\n"),
            "{text}"
        );
    }

    #[test]
    fn a_changed_comment_at_its_own_lines_says_nothing_of_where_it_was() {
        let changed = sent(
            comment("a.rs", 4, &["new"], "t"),
            1,
            4,
            &["old"],
            Verdict::Changed,
        );
        let text = instructions(&request(vec![changed]), None);
        assert!(text.contains("\n- L4 `new`: t\n"), "{text}");
    }

    #[test]
    fn a_suggestion_without_a_reason_has_no_trailing_colon() {
        let mut only_code = comment("a.rs", 3, &["let x = 1;"], "");
        only_code.suggestion = Some("let x = 2;".into());
        let text = instructions(&request(vec![only_code]), None);
        assert!(
            text.contains("\n- L3 `let x = 1;`\n  Suggested change:\n"),
            "{text}"
        );
    }

    #[test]
    fn a_comment_reopened_by_its_suggestion_alone_still_says_so() {
        let mut only_code = comment("a.rs", 3, &["let x = 1;"], "");
        only_code.suggestion = Some("let x = 2;".into());
        let mut reopened = sent(only_code, 1, 3, &["let x = 1;"], Verdict::Untouched);
        reopened.suggestion = Some("let x = 3;".into());
        let text = instructions(&request(vec![reopened]), None);
        assert!(
            text.contains(
                "\n- L3 `let x = 1;`: Still: see the suggested change.\n  Suggested change:\n"
            ),
            "{text}"
        );
    }

    #[test]
    fn a_line_with_only_blanks_is_not_quoted() {
        let text = instructions(
            &request(vec![comment("a.rs", 3, &["   "], "Name it.")]),
            None,
        );
        assert!(text.contains("\n### a.rs\n- L3: Name it.\n"), "{text}");
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
        let text = instructions(&request(vec![removed, file]), None);
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
        assert!(instructions(&request, None).starts_with(
            "Please address these review comments on the detached HEAD at 4e1b2a0 (uncommitted changes only)."
        ));
    }
}
