//! A review written out as Markdown instructions for a coding agent.

use std::fmt::Write as _;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{
    anchor::{AnchorState, Ask, Comment, Target, Verdict},
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

/// The review as Markdown instructions an agent can act on: what is new, in
/// a numbered section per kind (ADR 0036 §3), then what was sent before and
/// is still open (ADR 0015 §6). With `kept_at`, the file the review is kept
/// in, each comment names its id and the agent is told to mark the ones it
/// dealt with resolved there (ADR 0032 §1).
#[must_use]
pub fn instructions(request: &InstructionsRequest, kept_at: Option<&str>) -> String {
    let mut out = String::new();
    let with_id = kept_at.is_some();
    let (still, new): (Vec<&Comment>, Vec<&Comment>) = request
        .comments
        .iter()
        .filter(|c| c.resolved.is_none())
        .partition(|c| c.sent.is_some() && !c.reopened());
    let counted = counts(&new, still.len());
    // `write!` to a String cannot fail.
    let _ = writeln!(
        out,
        "Review of {}{}{}{counted}.",
        head_label(&request.head),
        base_label(&request.base),
        if counted.is_empty() { "" } else { ": " },
    );
    let sections = KINDS
        .iter()
        .map(|words| {
            let of_kind: Vec<&Comment> =
                new.iter().copied().filter(|c| (words.is)(&c.ask)).collect();
            (words, of_kind)
        })
        .filter(|(_, comments)| !comments.is_empty());
    for (number, (words, comments)) in (1..).zip(sections) {
        let _ = write!(out, "\n## {number}. {}\n{}\n", words.title, words.ask);
        for (path, comments) in by_file(&comments) {
            let _ = write!(out, "\n### {path}\n");
            for comment in comments {
                write_comment(&mut out, comment, with_id, false);
            }
        }
    }
    if !still.is_empty() {
        let _ = write!(out, "\n## Still open\n{}\n", still_open(&still));
        for (path, comments) in by_file(&still) {
            let _ = write!(out, "\n### {path}\n");
            for comment in comments {
                // Among every kind, a question and a suggestion say what they are.
                write_comment(&mut out, comment, with_id, true);
            }
        }
    }
    out.push_str("\n## When you're done\n");
    match kept_at {
        Some(path) => {
            let _ = writeln!(
                out,
                "These are kept in `{path}`. Mark each one you dealt with resolved, with a \
                 one-line note saying what you changed or giving your answer: call \
                 `resolve_comment` on the `diff-loop` MCP server with its id and the note, or, \
                 without it, set its `\"resolved\"` to `\"byAgent\"` and its `\"note\"` to the \
                 note in that file, changing nothing else. Leave anything you did not do as it is."
            );
        }
        None => out.push_str(
            "Reply with one line per comment saying what you changed, and answer each question.\n",
        ),
    }
    out
}

/// A kind's words: its noun, and its section's title and one instruction.
struct Words {
    /// Whether a comment asks this.
    is: fn(&Ask) -> bool,
    one: &'static str,
    many: &'static str,
    title: &'static str,
    ask: &'static str,
}

/// Every kind's words, in the order the instructions take them (the canvas's 4c).
const KINDS: [Words; 3] = [
    Words {
        is: |ask| matches!(ask, Ask::Comment),
        one: "comment",
        many: "comments",
        title: "Address these comments",
        ask: "Change the code so each comment is dealt with.",
    },
    Words {
        is: |ask| matches!(ask, Ask::Question),
        one: "question",
        many: "questions",
        title: "Answer these questions",
        ask: "Answer each one. Don't change any code for them.",
    },
    Words {
        is: |ask| matches!(ask, Ask::Suggestion { .. }),
        one: "suggestion",
        many: "suggestions",
        title: "Implement these suggestions",
        ask: "Replace the lines named with the suggested code, as written. If it no longer \
              fits the code around it, leave it and say why.",
    },
];

/// "2 comments, 1 question and 1 suggestion", and how many are still open.
fn counts(new: &[&Comment], still: usize) -> String {
    let mut parts: Vec<String> = KINDS
        .iter()
        .filter_map(|words| {
            let n = new.iter().filter(|c| (words.is)(&c.ask)).count();
            (n > 0).then(|| format!("{n} {}", if n == 1 { words.one } else { words.many }))
        })
        .collect();
    let listed = match parts.len() {
        0 => String::new(),
        1 => parts.remove(0),
        _ => {
            let last = parts.pop().unwrap_or_default();
            format!("{} and {last}", parts.join(", "))
        }
    };
    match (listed.is_empty(), still) {
        (_, 0) => listed,
        (true, n) => format!("{n} still open from earlier rounds"),
        (false, n) => format!("{listed}; {n} still open from earlier rounds"),
    }
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

/// `comment` as one item, with its id when `with_id`, and when `labelled`, among
/// other kinds, a question's and a suggestion's kind said.
fn write_comment(out: &mut String, comment: &Comment, with_id: bool, labelled: bool) {
    let text = comment.text.trim();
    let still = if comment.reopened() { "Still: " } else { "" };
    let asked = if labelled && comment.ask == Ask::Question {
        "Question: "
    } else {
        ""
    };
    // Suggested code may stand without a reason; reopened, it still says so.
    let text = match (text.is_empty(), comment.reopened()) {
        (true, true) => ": Still: see the suggested change.".to_owned(),
        (true, false) => String::new(),
        (false, _) => format!(": {still}{asked}{text}"),
    };
    let id = if with_id {
        format!(" (id `{}`)", comment.id)
    } else {
        String::new()
    };
    let _ = writeln!(out, "- {}{text}{id}", where_label(comment));
    if let Some(suggestion) = comment.ask.code() {
        let label = if labelled {
            "  Suggested change:\n"
        } else {
            ""
        };
        let _ = writeln!(out, "{label}  ```{}", fence_language(&comment.path));
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
            ask: Ask::Comment,
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
                suggestion: comment.ask.code().map(str::to_owned),
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
    fn writes_each_kind_in_its_own_numbered_section_grouped_by_file() {
        let handler = "src/api/share/handler.ts";
        let mut hash = comment(
            handler,
            20,
            &["    log.warn('share rate limited', { userId });"],
            "Don't log the raw userId. Hash it first.",
        );
        hash.ask = Ask::Suggestion {
            code: "    log.warn('share rate limited', { user: hashUserId(userId) });".into(),
        };
        let mut ask = comment(
            handler,
            17,
            &["  const limit = await checkShareLimit(userId);"],
            "Should a failed share count against the limit?",
        );
        ask.ask = Ask::Question;
        let comments = vec![
            hash,
            comment(
                "config/limits.yaml",
                7,
                &["  maxPerWindow: 20"],
                "Make it 50.",
            ),
            ask,
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
Review of agent/share-rate-limit (compared with main): 3 comments, 1 question and 1 suggestion.

## 1. Address these comments
Change the code so each comment is dealt with.

### config/limits.yaml
- L7 `maxPerWindow: 20`: Make it 50.

### src/api/share/handler.ts
- L18 `res.setHeader('X-RateLimit-Remaining', x);`: Send the limit too.
- L21–22 `return res.status(429).json({…`: Share the 429 body.

## 2. Answer these questions
Answer each one. Don't change any code for them.

### src/api/share/handler.ts
- L17 `const limit = await checkShareLimit(userId);`: Should a failed share count against the limit?

## 3. Implement these suggestions
Replace the lines named with the suggested code, as written. If it no longer fits the code around it, leave it and say why.

### src/api/share/handler.ts
- L20 `log.warn('share rate limited', { userId });`: Don't log the raw userId. Hash it first.
  ```ts
  log.warn('share rate limited', { user: hashUserId(userId) });
  ```

## When you're done
Reply with one line per comment saying what you changed, and answer each question.
";
        assert_eq!(instructions(&request(comments), None), expected);
    }

    #[test]
    fn a_kind_with_nothing_new_has_no_section_and_the_rest_are_numbered_on() {
        let mut ask = comment("a.rs", 1, &["x"], "Why?");
        ask.ask = Ask::Question;
        let text = instructions(&request(vec![ask]), None);
        assert!(
            text.starts_with(
                "Review of agent/share-rate-limit (compared with main): 1 question.\n"
            ),
            "{text}"
        );
        assert!(text.contains("\n## 1. Answer these questions\n"), "{text}");
        assert!(!text.contains("Address these comments"), "{text}");
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
        assert!(!text.contains("Reply with one line"), "{text}");
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
Review of agent/share-rate-limit (compared with main): 3 comments; 3 still open from earlier rounds.

## 1. Address these comments
Change the code so each comment is dealt with.

### src/api/share/handler.ts
- L19 `res.setHeader('X-RateLimit-Limit', …)`: Send limit.max.

### src/api/share/rateLimit.ts
- Code no longer in the diff, was `const ttl = await redis.ttl(key);`: ttl is −1 when the key has no expiry.

### config/limits.yaml
- L7 `maxPerWindow: 20`: Still: Make it 50 for team accounts.

## Still open
Sent in earlier rounds and not resolved yet.

### src/api/share/handler.ts
- L18 `res.setHeader('X-RateLimit-Remaining', …)`: Also send X-RateLimit-Limit.
- L23 `return tooManyRequests(res, limit.resetAt);`, was L21–22: Pull this into a helper.
- Code removed since sent, was L31 `throw new Error('rate limiter unavailable');`: Return a 503 here.

## When you're done
Reply with one line per comment saying what you changed, and answer each question.
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
            text.contains("## Still open\nSent in round 3 and not resolved yet.\n"),
            "{text}"
        );
    }

    #[test]
    fn a_question_or_suggestion_still_open_says_what_it_is() {
        let mut ask = comment("a.rs", 1, &["x"], "Why?");
        ask.ask = Ask::Question;
        let mut code = comment("a.rs", 2, &["y"], "Use z.");
        code.ask = Ask::Suggestion { code: "z".into() };
        let still = [ask, code].map(|c| sent(c, 1, 1, &["x"], Verdict::Untouched));
        let text = instructions(&request(still.to_vec()), None);
        assert!(text.contains("- L1 `x`: Question: Why?\n"), "{text}");
        assert!(
            text.contains("- L2 `y`: Use z.\n  Suggested change:\n  ```rust\n"),
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
        only_code.ask = Ask::Suggestion {
            code: "let x = 2;".into(),
        };
        let text = instructions(&request(vec![only_code]), None);
        assert!(text.contains("\n- L3 `let x = 1;`\n  ```rust\n"), "{text}");
    }

    #[test]
    fn a_comment_reopened_by_its_suggestion_alone_still_says_so() {
        let mut only_code = comment("a.rs", 3, &["let x = 1;"], "");
        only_code.ask = Ask::Suggestion {
            code: "let x = 2;".into(),
        };
        let mut reopened = sent(only_code, 1, 3, &["let x = 1;"], Verdict::Untouched);
        reopened.ask = Ask::Suggestion {
            code: "let x = 3;".into(),
        };
        let text = instructions(&request(vec![reopened]), None);
        assert!(
            text.contains("\n- L3 `let x = 1;`: Still: see the suggested change.\n  ```rust\n"),
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
        assert!(
            instructions(&request, None).starts_with(
                "Review of the detached HEAD at 4e1b2a0 (uncommitted changes only).\n"
            )
        );
    }
}
