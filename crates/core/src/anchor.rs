//! Review comments, and keeping each on its code as the checkout changes.
//!
//! A draft is looked for by its code; a sent comment is judged against the
//! code it was sent on (ADR 0015 §2 and §3). Nothing here removes a comment.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{
    base::Base,
    code::{dedent, same_code, same_lines},
    diff::{FileDiff, Side, runs},
    repository::Head,
};

/// A review comment.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Comment {
    /// Unique within a review; chosen by the front end.
    pub id: String,
    /// The commented file's path on the new side.
    pub path: String,
    /// What the comment is on.
    pub target: Target,
    /// What the reviewer wrote; empty when the comment is only suggested code.
    pub text: String,
    /// Code proposed to replace the target lines, if any.
    pub suggestion: Option<String>,
    /// Whether the target is in the diff shown, on its code or, for a sent
    /// comment, on what is in its code's place.
    pub state: AnchorState,
    /// Where the comment's code was last seen; `None` for one saved before
    /// ADR 0015, which is then never lost, only outdated.
    #[serde(default)]
    pub place: Option<Place>,
    /// The round it was last sent in and what it was sent on; `None` for a draft.
    #[serde(default)]
    pub sent: Option<Sent>,
    /// How it was resolved, if it is.
    #[serde(default)]
    pub resolved: Option<Resolution>,
}

impl Comment {
    /// Whether the comment was edited since it was sent: it is copied again
    /// as "Still: …" (ADR 0015 §5).
    #[must_use]
    pub(crate) fn reopened(&self) -> bool {
        self.sent
            .as_ref()
            .is_some_and(|s| s.text != self.text || s.suggestion != self.suggestion)
    }
}

/// What a [`Comment`] is on.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum Target {
    /// The file as a whole.
    File,
    /// The consecutive lines from `start` on `side`, one per entry of `code`;
    /// the last is [`Target::end`].
    Lines {
        /// Which side the numbers refer to.
        side: Side,
        /// First line, 1-based.
        start: u32,
        /// The lines' text when the comment was written, or as they are now
        /// for a sent comment whose code changed. Empty reads as the one line
        /// `start`, whose code is unknown, so a draft never re-anchors from it.
        code: Vec<String>,
    },
}

impl Target {
    /// The last line of a [`Target::Lines`], inclusive; `None` for a whole file.
    #[must_use]
    pub(crate) fn end(&self) -> Option<u32> {
        match self {
            Self::File => None,
            Self::Lines { start, code, .. } => {
                let more = u32::try_from(code.len().saturating_sub(1)).unwrap_or(u32::MAX);
                Some(start.saturating_add(more))
            }
        }
    }
}

/// Whether a comment's target is in the diff shown.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum AnchorState {
    /// It is: a draft's code is there, possibly at new line numbers; a sent
    /// comment where it is judged (`Sent::judged_at`) is on what is in its code's place
    /// now (its verdict says what), while its file is in the diff.
    Current,
    /// The code is not in this diff: the base or branch compared does not
    /// hold it, or, for a sent comment where it is judged, its file left the
    /// diff (its verdict then removed). The target keeps its last position
    /// and code, so a later load can find it again (diff-loop-core.md
    /// Decision 4).
    Outdated,
    /// A draft's code is gone from the base and branch it was last seen on
    /// (ADR 0015 §2). It keeps its position and code until it is placed again.
    Lost,
}

/// A base and a branch: where a comment's code was seen, or a round was sent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Place {
    /// What the checkout was compared with.
    pub base: Base,
    /// What was checked out.
    pub head: Head,
}

impl Place {
    /// Whether `other` is the same base and branch; a detached `HEAD` counts
    /// as one branch, since a commit there moves it.
    #[must_use]
    fn same(&self, other: &Self) -> bool {
        self.base == other.base && self.same_head(other)
    }

    /// Whether `other` is on the same branch, whatever it is compared with.
    fn same_head(&self, other: &Self) -> bool {
        match (&self.head, &other.head) {
            (Head::Branch { name: a }, Head::Branch { name: b }) => a == b,
            (Head::Detached { .. }, Head::Detached { .. }) => true,
            _ => false,
        }
    }
}

/// What a comment was sent on: a round ends with every unresolved comment
/// carrying one (ADR 0015 §1).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Sent {
    /// The round's number.
    pub round: u32,
    /// Where it was sent; the judgement is made there, and for the
    /// uncommitted changes only at `commit` or against it (`judged_at`).
    pub place: Place,
    /// Full id of the commit at `HEAD` when sent; `None` before the first commit.
    pub commit: Option<String>,
    /// The target as sent, with the code it was on.
    pub target: Target,
    /// Up to three lines above the target's code, nearest last.
    pub before: Vec<String>,
    /// Up to three lines below the target's code, nearest first.
    pub after: Vec<String>,
    /// The text as sent; the comment is reopened once its text differs.
    pub text: String,
    /// The suggestion as sent.
    pub suggestion: Option<String>,
    /// What the last load found; `None` while the judgement is suspended.
    pub verdict: Option<Verdict>,
}

/// Whether `name` names the commit `id`: in full, or by a prefix of at least
/// seven hex digits, as the window shows one (ADR 0021 §2).
fn names(name: &str, id: &str) -> bool {
    name == id
        || (name.len() >= 7 && name.bytes().all(|b| b.is_ascii_hexdigit()) && id.starts_with(name))
}

impl Sent {
    /// Whether it is judged at `now`, with `commit` at `HEAD` (ADR 0015 §8,
    /// and for the uncommitted changes ADR 0017 §1 and ADR 0021 §2).
    fn judged_at(&self, now: &Place, commit: Option<&str>) -> bool {
        match (&self.place.base, &now.base) {
            (Base::Uncommitted, Base::Uncommitted) => {
                self.place.same_head(now) && commit == self.commit.as_deref()
            }
            (Base::Uncommitted, Base::Ref { name }) => {
                self.place.same_head(now) && self.commit.as_deref().is_some_and(|c| names(name, c))
            }
            _ => self.place.same(now),
        }
    }

    /// Whether a commit on top of `previous`, seen at `now`, is followed
    /// for it: on the uncommitted changes, it was judged at `previous`
    /// (ADR 0017 §2).
    pub(crate) fn follows(&self, now: &Place, previous: &str) -> bool {
        now.base == Base::Uncommitted && self.judged_at(now, Some(previous))
    }
}

/// How many lines of context a sent comment keeps on each side of its code.
pub(crate) const CONTEXT: usize = 3;

/// What became of a sent comment's code, judged at every load (ADR 0015 §3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Verdict {
    /// The code is where it was sent, with the lines around it.
    Untouched,
    /// The code is there, but the lines around it changed.
    NearbyChanged,
    /// Other code is in its place.
    Changed,
    /// Nothing is in its place.
    Removed,
    /// The suggestion is in its place, exactly.
    Applied,
}

/// How a comment was resolved (ADR 0015 §4).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Resolution {
    /// The reviewer resolved it.
    ByReviewer,
    /// A load found its suggestion in place.
    SuggestionApplied,
}

/// `comment` moved onto its code in `files`, as seen from `now` with `commit`
/// at `HEAD`.
///
/// A draft, or a sent comment not judged at `now`, is kept where its
/// code still is, moved to the nearest place it now is, or marked outdated
/// when it is gone: lost, for a draft last seen at `now`. A sent comment
/// judged at `now` (`Sent::judged_at`) is judged against what it was sent
/// on, and its target set to what is in that code's place.
///
/// Cost: O(f + L·k) for f changed files, L lines on the comment's side of
/// its file and k lines of code and context; judging adds O(m log m) for
/// the m places the context matches, at most L (`between`).
#[must_use]
pub(crate) fn reanchor(
    mut comment: Comment,
    files: &[FileDiff],
    now: &Place,
    commit: Option<&str>,
) -> Comment {
    let file = files
        .iter()
        .find(|f| f.path == comment.path || f.old_path() == comment.path);
    match comment.sent.take() {
        Some(sent) if sent.judged_at(now, commit) => judge(comment, sent, file, now),
        sent => anchor(Comment { sent, ..comment }, file, now),
    }
}

/// A draft, or a sent comment whose judgement is suspended, looked for by its code.
fn anchor(comment: Comment, file: Option<&FileDiff>, now: &Place) -> Comment {
    // Where it is not judged, a verdict is not shown (ADR 0015 §8, ADR 0017 §1).
    let comment = Comment {
        sent: comment.sent.map(|s| Sent { verdict: None, ..s }),
        ..comment
    };
    let Some(file) = file else {
        return gone(comment, now);
    };
    let path = file.path.clone();
    let Target::Lines {
        side, start, code, ..
    } = &comment.target
    else {
        return Comment {
            path,
            state: AnchorState::Current,
            place: Some(now.clone()),
            ..comment
        };
    };
    let lines: Vec<(u32, &str)> = file.lines(*side).collect();
    match nearest_index(&lines, &runs(&lines), *start, code).map(|i| lines[i].0) {
        Some(found) => Comment {
            path,
            target: Target::Lines {
                side: *side,
                start: found,
                code: code.clone(),
            },
            state: AnchorState::Current,
            place: Some(now.clone()),
            ..comment
        },
        None => gone(comment, now),
    }
}

/// A comment whose code `now` does not show: lost for a draft last seen at
/// `now`, outdated otherwise.
fn gone(comment: Comment, now: &Place) -> Comment {
    let last_seen_here = comment.place.as_ref().is_some_and(|p| p.same(now));
    let state = if comment.sent.is_none() && last_seen_here {
        AnchorState::Lost
    } else {
        AnchorState::Outdated
    };
    Comment { state, ..comment }
}

/// A sent comment judged at `now`, against what it was `sent` on;
/// `comment` comes without it, and leaves with it.
fn judge(comment: Comment, sent: Sent, file: Option<&FileDiff>, now: &Place) -> Comment {
    let Some(file) = file else {
        return judged(comment, sent, Verdict::Removed, AnchorState::Outdated, None);
    };
    let last = match &comment.target {
        Target::Lines { start, .. } => Some(*start),
        Target::File => None,
    };
    let (verdict, target) = verdict(&sent, file, last);
    let comment = Comment {
        path: file.path.clone(),
        place: Some(now.clone()),
        ..comment
    };
    judged(comment, sent, verdict, AnchorState::Current, Some(target))
}

/// What became of `sent`'s code in `file`, and what is in its place now;
/// `last` is the line the comment was last on.
fn verdict(sent: &Sent, file: &FileDiff, last: Option<u32>) -> (Verdict, Target) {
    let Target::Lines {
        side, start, code, ..
    } = &sent.target
    else {
        return (Verdict::Untouched, Target::File);
    };
    let (side, start) = (*side, *start);
    let lines: Vec<(u32, &str)> = file.lines(side).collect();
    let run_of = runs(&lines);
    let texts = |from: usize, count: usize| lines[from..from + count].iter().map(|(_, text)| *text);
    let lines_from = |from: usize, count: usize| -> Vec<String> {
        texts(from, count).map(str::to_owned).collect()
    };
    let target = |start: u32, code: Vec<String>| Target::Lines { side, start, code };
    let bracket = bracketed(&lines, &run_of, start, &sent.before, &sent.after).map(|(from, to)| {
        // With nothing between, the line after the context marks the place.
        let at = lines.get(from).map_or(start, |(no, _)| *no);
        (at, lines_from(from, to - from))
    });
    // The suggestion in place first: one that keeps a sent line would otherwise read as that line, untouched.
    if let Some((at, now)) = &bracket {
        let applied = sent
            .suggestion
            .as_deref()
            .is_some_and(|s| same_lines(dedent(s), dedent(&now.join("\n"))));
        if applied {
            return (Verdict::Applied, target(*at, now.clone()));
        }
    }
    if let Some(at) = nearest_index(&lines, &run_of, start, code) {
        let before = at >= sent.before.len()
            && same_lines(
                sent.before.iter().map(String::as_str),
                texts(at - sent.before.len(), sent.before.len()),
            )
            && run_of[at - sent.before.len()] == run_of[at];
        let end = at + code.len();
        let after = end + sent.after.len() <= lines.len()
            && same_lines(
                sent.after.iter().map(String::as_str),
                texts(end, sent.after.len()),
            )
            && run_of[end - 1] == run_of[end + sent.after.len() - 1];
        let verdict = if before && after {
            Verdict::Untouched
        } else {
            Verdict::NearbyChanged
        };
        return (verdict, target(lines[at].0, lines_from(at, code.len())));
    }
    if let Some((at, now)) = bracket {
        let verdict = if now.is_empty() {
            Verdict::Removed
        } else {
            Verdict::Changed
        };
        return (verdict, target(at, now));
    }
    // Neither the code nor its context: the pin stays as near its last known line as the diff shows.
    let last = last.unwrap_or(start);
    let at = lines
        .iter()
        .map(|(no, _)| *no)
        .min_by_key(|no| no.abs_diff(last))
        .unwrap_or(last);
    (Verdict::Removed, target(at, vec![]))
}

/// `comment` with `sent` back and its verdict, resolved when its suggestion
/// just arrived in place (ADR 0015 §4); `target` replaces its target when given.
fn judged(
    comment: Comment,
    mut sent: Sent,
    verdict: Verdict,
    state: AnchorState,
    target: Option<Target>,
) -> Comment {
    // Only on the way in, and from a known verdict: back from a suspended judgement (`None`) it may
    // have been applied, and unresolved by the reviewer, all along.
    let just_applied =
        verdict == Verdict::Applied && sent.verdict.is_some_and(|was| was != Verdict::Applied);
    let resolved = if just_applied && comment.resolved.is_none() {
        Some(Resolution::SuggestionApplied)
    } else {
        comment.resolved
    };
    sent.verdict = Some(verdict);
    Comment {
        target: target.unwrap_or(comment.target),
        state,
        sent: Some(sent),
        resolved,
        ..comment
    }
}

/// The index in `lines` of the run of lines matching `code`, in one run of
/// the diff (`run_of`, each line's run), nearest `start`; none for empty `code`.
fn nearest_index(
    lines: &[(u32, &str)],
    run_of: &[usize],
    start: u32,
    code: &[String],
) -> Option<usize> {
    if code.is_empty() {
        return None;
    }
    matches(lines, run_of, code).min_by_key(|&i| lines[i].0.abs_diff(start))
}

/// As [`between`], with the context cut down a line at a time from its far
/// ends until a pair brackets something: an edit next to the code must not
/// hide where the code went.
fn bracketed(
    lines: &[(u32, &str)],
    run_of: &[usize],
    start: u32,
    before: &[String],
    after: &[String],
) -> Option<(usize, usize)> {
    (1..=before.len().min(after.len())).rev().find_map(|k| {
        between(
            lines,
            run_of,
            start,
            &before[before.len() - k..],
            &after[..k],
        )
    })
}

/// Where `before` and `after` bracket the lines in a sent comment's place:
/// the indexes `from..to` of what lies between, in one run of the diff, for
/// the pair nearest `start` with the least between. Needs both; one alone
/// cannot bound the lines.
///
/// Cost: O(L·k) to find where each run of context matches, then O(b log a)
/// for b and a matches of each, each `before` paired only with the first
/// `after` past it in the same run of the diff.
fn between(
    lines: &[(u32, &str)],
    run_of: &[usize],
    start: u32,
    before: &[String],
    after: &[String],
) -> Option<(usize, usize)> {
    if before.is_empty() || after.is_empty() {
        return None;
    }
    // In order, as `windows` yields them, so the first past a point is found by binary search.
    let afters: Vec<usize> = matches(lines, run_of, after).collect();
    matches(lines, run_of, before)
        .filter_map(|b| {
            let from = b + before.len();
            let to = *afters.get(afters.partition_point(|&a| a < from))?;
            // `from - 1` is the context's last line; the whole span must be one run.
            (run_of[from - 1] == run_of[to]).then_some((from, to))
        })
        .min_by_key(|&(from, to)| {
            let at = lines.get(from).map_or(start, |(no, _)| *no);
            (at.abs_diff(start), to - from)
        })
}

/// The indexes where `code` matches `lines`, in order, each match within one
/// run of the diff (`run_of`, each line's run).
fn matches<'a>(
    lines: &'a [(u32, &str)],
    run_of: &'a [usize],
    code: &'a [String],
) -> impl Iterator<Item = usize> + 'a {
    lines
        .windows(code.len())
        .enumerate()
        .filter(move |(i, run)| {
            run_of[*i] == run_of[*i + code.len() - 1]
                && run.iter().zip(code).all(|((_, t), c)| same_code(t, c))
        })
        .map(|(i, _)| i)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diff::{
        Content, Hunk, Line, Status,
        tests::{add, ctx, text_file},
    };

    pub(crate) fn here() -> Place {
        Place {
            base: Base::Ref {
                name: "main".into(),
            },
            head: Head::Branch {
                name: "agent/x".into(),
            },
        }
    }

    fn elsewhere() -> Place {
        Place {
            head: Head::Branch {
                name: "agent/y".into(),
            },
            ..here()
        }
    }

    fn on_lines(path: &str, start: u32, code: &[&str]) -> Comment {
        Comment {
            id: "c1".into(),
            path: path.into(),
            target: Target::Lines {
                side: Side::New,
                start,
                code: code.iter().map(|s| (*s).to_owned()).collect(),
            },
            text: "Hash it first.".into(),
            suggestion: None,
            state: AnchorState::Current,
            place: Some(here()),
            sent: None,
            resolved: None,
        }
    }

    /// `comment` as sent in round 1 at `here`, with `before` and `after` around its code.
    fn sent(comment: Comment, before: &[&str], after: &[&str]) -> Comment {
        let strings = |l: &[&str]| l.iter().map(|s| (*s).to_owned()).collect();
        Comment {
            sent: Some(Sent {
                round: 1,
                place: here(),
                commit: Some("abc".into()),
                target: comment.target.clone(),
                before: strings(before),
                after: strings(after),
                text: comment.text.clone(),
                suggestion: comment.suggestion.clone(),
                verdict: Some(Verdict::Untouched),
            }),
            ..comment
        }
    }

    fn start_of(comment: &Comment) -> u32 {
        match comment.target {
            Target::Lines { start, .. } => start,
            Target::File => panic!("expected a line comment"),
        }
    }

    fn code_of(comment: &Comment) -> Vec<String> {
        match &comment.target {
            Target::Lines { code, .. } => code.clone(),
            Target::File => panic!("expected a line comment"),
        }
    }

    fn verdict_of(comment: &Comment) -> Option<Verdict> {
        comment.sent.as_ref().and_then(|s| s.verdict)
    }

    #[test]
    fn a_comment_whose_code_is_unchanged_stays() {
        let files = [text_file("a.ts", vec![ctx(1, 1, "a"), add(2, "log(user)")])];
        let comment = reanchor(on_lines("a.ts", 2, &["log(user)"]), &files, &here(), None);
        assert_eq!(comment.state, AnchorState::Current);
        assert_eq!(start_of(&comment), 2);
    }

    #[test]
    fn a_comment_follows_its_code_when_lines_are_inserted_above() {
        let files = [text_file(
            "a.ts",
            vec![add(1, "new"), add(2, "new"), add(3, "x"), add(4, "y")],
        )];
        let comment = reanchor(on_lines("a.ts", 1, &["x", "y"]), &files, &here(), None);
        assert_eq!(comment.state, AnchorState::Current);
        assert_eq!(comment.target, on_lines("a.ts", 3, &["x", "y"]).target);
    }

    #[test]
    fn of_two_matches_the_nearest_wins() {
        let lines = vec![
            add(1, "}"),
            add(2, "a"),
            add(3, "}"),
            add(4, "b"),
            add(5, "}"),
        ];
        let files = [text_file("a.ts", lines)];
        assert_eq!(
            start_of(&reanchor(
                on_lines("a.ts", 4, &["}"]),
                &files,
                &here(),
                None
            )),
            3
        );
    }

    #[test]
    fn a_run_must_be_consecutive_lines() {
        // Lines 2 and 9 sit in different hunks: never one run.
        let files = [text_file("a.ts", vec![add(2, "x"), add(9, "y")])];
        let comment = reanchor(on_lines("a.ts", 2, &["x", "y"]), &files, &here(), None);
        assert_eq!(comment.state, AnchorState::Lost);
    }

    #[test]
    fn a_draft_whose_code_changed_where_it_was_seen_is_lost_and_keeps_its_place() {
        let files = [text_file("a.ts", vec![add(1, "log(hash(user))")])];
        let comment = reanchor(on_lines("a.ts", 1, &["log(user)"]), &files, &here(), None);
        assert_eq!(comment.state, AnchorState::Lost);
        assert_eq!(comment.target, on_lines("a.ts", 1, &["log(user)"]).target);
        assert_eq!(comment.place, Some(here()));
    }

    #[test]
    fn a_draft_whose_code_is_gone_elsewhere_is_outdated() {
        let files = [text_file("a.ts", vec![add(1, "other")])];
        let comment = reanchor(
            on_lines("a.ts", 1, &["log(user)"]),
            &files,
            &elsewhere(),
            None,
        );
        assert_eq!(comment.state, AnchorState::Outdated);
        assert_eq!(comment.place, Some(here()), "where it was last seen");
    }

    #[test]
    fn a_draft_saved_without_a_place_is_outdated_never_lost() {
        let files = [text_file("a.ts", vec![add(1, "other")])];
        let comment = Comment {
            place: None,
            ..on_lines("a.ts", 1, &["log(user)"])
        };
        assert_eq!(
            reanchor(comment, &files, &here(), None).state,
            AnchorState::Outdated
        );
    }

    #[test]
    fn a_draft_found_elsewhere_is_seen_there() {
        let files = [text_file("a.ts", vec![add(1, "log(user)")])];
        let comment = reanchor(
            on_lines("a.ts", 1, &["log(user)"]),
            &files,
            &elsewhere(),
            None,
        );
        assert_eq!(comment.state, AnchorState::Current);
        assert_eq!(comment.place, Some(elsewhere()));
    }

    #[test]
    fn a_comment_on_a_file_that_left_the_diff_is_lost_where_it_was_seen() {
        let comment = reanchor(on_lines("a.ts", 1, &["x"]), &[], &here(), None);
        assert_eq!(comment.state, AnchorState::Lost);
    }

    #[test]
    fn a_lost_comment_is_current_again_where_its_code_is() {
        let files = [text_file("a.ts", vec![add(1, "new"), add(2, "x")])];
        let lost = Comment {
            state: AnchorState::Lost,
            ..on_lines("a.ts", 1, &["x"])
        };
        assert_eq!(
            reanchor(lost, &files, &here(), None),
            on_lines("a.ts", 2, &["x"])
        );
    }

    #[test]
    fn an_outdated_comment_on_a_file_back_in_the_diff_is_current_again() {
        let files = [text_file("a.ts", vec![add(1, "x")])];
        let outdated = Comment {
            target: Target::File,
            state: AnchorState::Outdated,
            ..on_lines("a.ts", 1, &["x"])
        };
        assert_eq!(
            reanchor(outdated, &files, &here(), None).state,
            AnchorState::Current
        );
    }

    #[test]
    fn a_lost_comment_whose_code_is_still_gone_stays_lost() {
        let files = [text_file("a.ts", vec![add(1, "y")])];
        let lost = Comment {
            state: AnchorState::Lost,
            ..on_lines("a.ts", 1, &["x"])
        };
        assert_eq!(reanchor(lost.clone(), &files, &here(), None), lost);
    }

    #[test]
    fn a_comment_follows_its_file_through_a_rename() {
        let mut file = text_file("b.ts", vec![add(1, "x")]);
        file.status = Status::Renamed {
            from: "a.ts".into(),
        };
        let comment = reanchor(on_lines("a.ts", 1, &["x"]), &[file], &here(), None);
        assert_eq!(
            (comment.path.as_str(), comment.state),
            ("b.ts", AnchorState::Current)
        );
    }

    #[test]
    fn whitespace_alone_does_not_move_a_comment() {
        let files = [text_file("a.ts", vec![add(1, "\tlog(user)  ")])];
        let comment = reanchor(
            on_lines("a.ts", 1, &["    log(user)"]),
            &files,
            &here(),
            None,
        );
        assert_eq!(comment.state, AnchorState::Current);
    }

    #[test]
    fn a_target_ends_at_its_last_line_of_code() {
        assert_eq!(
            on_lines("a.ts", 21, &["a", "b", "c", "d"]).target.end(),
            Some(24)
        );
        let unknown = Target::Lines {
            side: Side::New,
            start: 7,
            code: vec![],
        };
        assert_eq!(unknown.end(), Some(7));
        assert_eq!(Target::File.end(), None);
    }

    #[test]
    fn a_draft_with_no_code_is_lost_on_reload() {
        let files = [text_file("a.ts", vec![add(1, "x")])];
        let comment = Comment {
            target: Target::Lines {
                side: Side::New,
                start: 1,
                code: vec![],
            },
            ..on_lines("a.ts", 1, &["x"])
        };
        assert_eq!(
            reanchor(comment, &files, &here(), None).state,
            AnchorState::Lost
        );
    }

    /// The file a round was sent on: `a` and `b` above `x`, `c` and `d` below.
    fn sent_file(middle: &[&str]) -> FileDiff {
        let lines = ["a", "b"]
            .iter()
            .chain(middle)
            .chain(&["c", "d"])
            .enumerate()
            .map(|(i, text)| add(u32::try_from(i).unwrap() + 1, text))
            .collect();
        text_file("a.ts", lines)
    }

    fn sent_on_x() -> Comment {
        sent(on_lines("a.ts", 3, &["x"]), &["a", "b"], &["c", "d"])
    }

    #[test]
    fn a_sent_comment_whose_code_and_context_hold_is_untouched() {
        let comment = reanchor(sent_on_x(), &[sent_file(&["x"])], &here(), None);
        assert_eq!(verdict_of(&comment), Some(Verdict::Untouched));
        assert_eq!(comment.state, AnchorState::Current);
        assert_eq!(start_of(&comment), 3);
    }

    #[test]
    fn a_sent_comment_whose_code_holds_but_neighbours_changed_says_so() {
        let file = text_file(
            "a.ts",
            vec![
                add(1, "a"),
                add(2, "B"),
                add(3, "x"),
                add(4, "c"),
                add(5, "d"),
            ],
        );
        let comment = reanchor(sent_on_x(), &[file], &here(), None);
        assert_eq!(verdict_of(&comment), Some(Verdict::NearbyChanged));
    }

    #[test]
    fn a_sent_comment_whose_code_was_replaced_is_changed_and_targets_what_is_there_now() {
        let comment = reanchor(sent_on_x(), &[sent_file(&["y", "z"])], &here(), None);
        assert_eq!(verdict_of(&comment), Some(Verdict::Changed));
        assert_eq!(start_of(&comment), 3);
        assert_eq!(code_of(&comment), ["y", "z"]);
        // The sent code stays for the compare.
        assert_eq!(comment.sent.unwrap().target, sent_on_x().target);
    }

    /// Regression: every match of the context was paired with every other, O(L²) per sent comment.
    #[test]
    fn context_that_recurs_through_a_large_file_is_bracketed_in_one_pass() {
        let mut lines: Vec<Line> = (1..=40_000).map(|n| add(n, "}")).collect();
        lines[20_000] = add(20_001, "y");
        let file = text_file("a.ts", lines);
        let comment = sent(on_lines("a.ts", 20_001, &["x"]), &["}"], &["}"]);
        let comment = reanchor(comment, &[file], &here(), None);
        assert_eq!(verdict_of(&comment), Some(Verdict::Changed));
        assert_eq!(code_of(&comment), ["y"]);
        assert_eq!(start_of(&comment), 20_001);
    }

    #[test]
    fn context_edited_at_its_far_end_still_finds_where_the_code_went() {
        // `a` became `A`: the nearer `b` and `c` still bracket the new code.
        let file = text_file(
            "a.ts",
            vec![
                add(1, "A"),
                add(2, "b"),
                add(3, "y"),
                add(4, "c"),
                add(5, "d"),
            ],
        );
        let comment = reanchor(sent_on_x(), &[file], &here(), None);
        assert_eq!(verdict_of(&comment), Some(Verdict::Changed));
        assert_eq!(code_of(&comment), ["y"]);
    }

    #[test]
    fn a_sent_comment_whose_code_was_deleted_is_removed_at_the_line_after_its_context() {
        let comment = reanchor(sent_on_x(), &[sent_file(&[])], &here(), None);
        assert_eq!(verdict_of(&comment), Some(Verdict::Removed));
        assert_eq!(start_of(&comment), 3);
        assert!(code_of(&comment).is_empty());
    }

    #[test]
    fn a_sent_comment_whose_context_is_gone_too_is_removed_near_its_last_line() {
        let file = text_file("a.ts", vec![add(10, "p"), add(11, "q")]);
        let comment = reanchor(sent_on_x(), &[file], &here(), None);
        assert_eq!(verdict_of(&comment), Some(Verdict::Removed));
        assert_eq!(start_of(&comment), 10);
        assert_eq!(comment.state, AnchorState::Current);
    }

    #[test]
    fn a_sent_comment_whose_file_left_the_diff_is_removed_and_outdated() {
        let comment = reanchor(sent_on_x(), &[], &here(), None);
        assert_eq!(verdict_of(&comment), Some(Verdict::Removed));
        assert_eq!(comment.state, AnchorState::Outdated);
    }

    #[test]
    fn a_sent_comment_whose_suggestion_is_in_place_resolves_itself_once() {
        let suggested = Comment {
            suggestion: Some("  y".into()),
            ..sent_on_x()
        };
        let suggested = sent(suggested, &["a", "b"], &["c", "d"]);
        let applied = reanchor(suggested, &[sent_file(&["    y"])], &here(), None);
        assert_eq!(verdict_of(&applied), Some(Verdict::Applied));
        assert_eq!(applied.resolved, Some(Resolution::SuggestionApplied));
        // Unresolved by the reviewer, it is not resolved again while still applied.
        let unresolved = Comment {
            resolved: None,
            ..applied
        };
        let again = reanchor(unresolved, &[sent_file(&["    y"])], &here(), None);
        assert_eq!(again.resolved, None);
        assert_eq!(verdict_of(&again), Some(Verdict::Applied));
    }

    #[test]
    fn a_suggestion_that_keeps_the_sent_line_is_still_found_applied() {
        let suggested = Comment {
            suggestion: Some("x\ny".into()),
            ..sent_on_x()
        };
        let suggested = sent(suggested, &["a", "b"], &["c", "d"]);
        let applied = reanchor(suggested, &[sent_file(&["x", "y"])], &here(), None);
        assert_eq!(verdict_of(&applied), Some(Verdict::Applied));
        assert_eq!(code_of(&applied), ["x", "y"]);
    }

    /// Regression: an applied comment the reviewer unresolved was resolved again after a load elsewhere and back.
    #[test]
    fn an_applied_comment_unresolved_stays_unresolved_across_another_branch() {
        let suggested = Comment {
            suggestion: Some("y".into()),
            ..sent_on_x()
        };
        let suggested = sent(suggested, &["a", "b"], &["c", "d"]);
        let applied = reanchor(suggested, &[sent_file(&["y"])], &here(), None);
        assert_eq!(applied.resolved, Some(Resolution::SuggestionApplied));
        let unresolved = Comment {
            resolved: None,
            ..applied
        };
        let away = reanchor(unresolved, &[sent_file(&["y"])], &elsewhere(), None);
        assert_eq!(verdict_of(&away), None);
        let back = reanchor(away, &[sent_file(&["y"])], &here(), None);
        assert_eq!(verdict_of(&back), Some(Verdict::Applied));
        assert_eq!(back.resolved, None);
    }

    #[test]
    fn a_resolved_comment_keeps_its_resolution_when_judged() {
        let resolved = Comment {
            resolved: Some(Resolution::ByReviewer),
            ..sent_on_x()
        };
        let comment = reanchor(resolved, &[sent_file(&["y"])], &here(), None);
        assert_eq!(comment.resolved, Some(Resolution::ByReviewer));
        assert_eq!(verdict_of(&comment), Some(Verdict::Changed));
    }

    #[test]
    fn a_sent_comment_elsewhere_is_not_judged_but_still_found_by_its_code() {
        let comment = reanchor(sent_on_x(), &[sent_file(&["x"])], &elsewhere(), None);
        assert_eq!(verdict_of(&comment), None);
        assert_eq!(comment.state, AnchorState::Current);
        let gone = reanchor(sent_on_x(), &[sent_file(&["y"])], &elsewhere(), None);
        assert_eq!(gone.state, AnchorState::Outdated, "never lost: it was sent");
    }

    /// `sent_on_x` sent against the uncommitted changes at commit `abc`.
    fn sent_uncommitted() -> Comment {
        let mut comment = sent_on_x();
        if let Some(sent) = &mut comment.sent {
            sent.place.base = Base::Uncommitted;
        }
        comment
    }

    fn at(base: Base) -> Place {
        Place { base, ..here() }
    }

    #[test]
    fn a_comment_sent_on_uncommitted_changes_is_judged_at_its_commit() {
        let comment = reanchor(
            sent_uncommitted(),
            &[sent_file(&["x"])],
            &at(Base::Uncommitted),
            Some("abc"),
        );
        assert_eq!(verdict_of(&comment), Some(Verdict::Untouched));
    }

    #[test]
    fn a_commit_on_top_of_uncommitted_changes_suspends_their_judgement() {
        // The agent committed: the diff is empty, and the comment is not removed.
        let comment = reanchor(sent_uncommitted(), &[], &at(Base::Uncommitted), Some("def"));
        assert_eq!(verdict_of(&comment), None);
        assert_eq!(comment.state, AnchorState::Outdated);
    }

    #[test]
    fn comparing_with_the_short_id_uncommitted_changes_were_sent_on_judges_them() {
        let mut comment = sent_uncommitted();
        if let Some(sent) = &mut comment.sent {
            sent.commit = Some("9671d8a0c3b1e2f4a5b6c7d8e9f0a1b2c3d4e5f6".into());
        }
        let short = at(Base::Ref {
            name: "9671d8a".into(),
        });
        let comment = reanchor(comment, &[sent_file(&["y"])], &short, Some("def"));
        assert_eq!(verdict_of(&comment), Some(Verdict::Changed));
    }

    #[test]
    fn a_commit_is_named_in_full_or_by_a_short_id_of_seven_or_more() {
        let id = "9671d8a0c3b1e2f4a5b6c7d8e9f0a1b2c3d4e5f6";
        assert!(names(id, id));
        assert!(names("9671d8a", id));
        assert!(!names("9671d8", id), "six digits is not a short id");
        assert!(!names("9671d8b", id));
        assert!(!names("main", id));
    }

    #[test]
    fn comparing_with_the_commit_uncommitted_changes_were_sent_on_judges_them() {
        let since = at(Base::Ref { name: "abc".into() });
        let comment = reanchor(
            sent_uncommitted(),
            &[sent_file(&["y"])],
            &since,
            Some("def"),
        );
        assert_eq!(verdict_of(&comment), Some(Verdict::Changed));
        assert_eq!(comment.place, Some(since), "seen where it was judged");
        let other = at(Base::Ref {
            name: "main".into(),
        });
        let comment = reanchor(
            sent_uncommitted(),
            &[sent_file(&["y"])],
            &other,
            Some("def"),
        );
        assert_eq!(verdict_of(&comment), None);
    }

    #[test]
    fn a_sent_whole_file_comment_is_untouched_while_its_file_is_in_the_diff() {
        let whole = Comment {
            target: Target::File,
            ..on_lines("a.ts", 1, &[])
        };
        let whole = sent(whole, &[], &[]);
        let comment = reanchor(whole.clone(), &[sent_file(&["x"])], &here(), None);
        assert_eq!(verdict_of(&comment), Some(Verdict::Untouched));
        assert_eq!(
            verdict_of(&reanchor(whole, &[], &here(), None)),
            Some(Verdict::Removed)
        );
    }

    #[test]
    fn context_is_matched_only_as_one_run_of_the_diff() {
        // `a b` and `c d` sit in different hunks: nothing lies between them.
        let file = FileDiff {
            content: Content::Text {
                hunks: vec![
                    Hunk {
                        old_start: 1,
                        new_start: 1,
                        section: String::new(),
                        lines: vec![add(1, "a"), add(2, "b")],
                    },
                    Hunk {
                        old_start: 9,
                        new_start: 9,
                        section: String::new(),
                        lines: vec![add(9, "c"), add(10, "d")],
                    },
                ],
            },
            ..sent_file(&[])
        };
        let comment = reanchor(sent_on_x(), &[file], &here(), None);
        assert_eq!(verdict_of(&comment), Some(Verdict::Removed));
        assert_eq!(start_of(&comment), 2, "the diff's nearest line to its last");
    }

    #[test]
    fn a_comment_edited_since_it_was_sent_is_reopened() {
        let mut comment = sent_on_x();
        assert!(!comment.reopened());
        comment.text = "Hash it, then log it.".into();
        assert!(comment.reopened());
        assert!(!on_lines("a.ts", 1, &["x"]).reopened());
    }

    #[test]
    fn a_place_is_the_same_base_and_branch_and_any_detached_head_is_one_branch() {
        assert!(here().same(&here()));
        assert!(!here().same(&elsewhere()));
        let detached = |commit: &str| Place {
            head: Head::Detached {
                commit: commit.into(),
            },
            ..here()
        };
        assert!(detached("1").same(&detached("2")));
        assert!(!detached("1").same(&here()));
        let other_base = Place {
            base: Base::Uncommitted,
            ..here()
        };
        assert!(!here().same(&other_base));
    }
}
