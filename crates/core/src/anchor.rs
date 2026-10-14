//! Review comments, and keeping each on its code as the checkout changes.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::diff::{FileDiff, Side};

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
    /// Whether the target still holds the code commented on.
    pub state: AnchorState,
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
        /// The lines' text when the comment was written. Empty reads as the
        /// one line `start`, whose code is unknown, so it never re-anchors.
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

/// Whether a comment's target still holds the code commented on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum AnchorState {
    /// It does, possibly at new line numbers.
    Current,
    /// The code is not in this diff: it changed, or the base or branch
    /// compared does not hold it. The target keeps its last position and
    /// code, so a later load can find it again (diff-loop-core.md Decision 4).
    Outdated,
}

/// `comment` moved onto its code in `files`: kept where the code still is,
/// moved to the nearest place it now is, or marked outdated when it is gone.
/// An outdated comment is looked for again, and is current once found.
///
/// Cost: O(f + L·k) for f changed files, L lines on the comment's side of
/// its file and k commented lines.
#[must_use]
pub(crate) fn reanchor(comment: Comment, files: &[FileDiff]) -> Comment {
    let Some(file) = files
        .iter()
        .find(|f| f.path == comment.path || f.old_path() == comment.path)
    else {
        return Comment {
            state: AnchorState::Outdated,
            ..comment
        };
    };
    let path = file.path.clone();
    let Target::Lines {
        side, start, code, ..
    } = &comment.target
    else {
        return Comment {
            path,
            state: AnchorState::Current,
            ..comment
        };
    };
    match nearest(file, *side, *start, code) {
        Some(found) => {
            let target = Target::Lines {
                side: *side,
                start: found,
                code: code.clone(),
            };
            Comment {
                path,
                target,
                state: AnchorState::Current,
                ..comment
            }
        }
        None => Comment {
            state: AnchorState::Outdated,
            ..comment
        },
    }
}

/// The first line of the run of consecutive lines on `side` matching `code`
/// that is nearest `start`.
fn nearest(file: &FileDiff, side: Side, start: u32, code: &[String]) -> Option<u32> {
    if code.is_empty() {
        return None;
    }
    let lines: Vec<(u32, &str)> = file.lines(side).collect();
    lines
        .windows(code.len())
        .filter(|run| {
            run.iter()
                .zip(code)
                .enumerate()
                .all(|(i, ((number, text), want))| {
                    *text == want && u32::try_from(i).is_ok_and(|i| *number == run[0].0 + i)
                })
        })
        .map(|run| run[0].0)
        .min_by_key(|found| found.abs_diff(start))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diff::{
        Status,
        tests::{add, ctx, text_file},
    };

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
        }
    }

    fn start_of(comment: &Comment) -> u32 {
        match comment.target {
            Target::Lines { start, .. } => start,
            Target::File => panic!("expected a line comment"),
        }
    }

    #[test]
    fn a_comment_whose_code_is_unchanged_stays() {
        let files = [text_file("a.ts", vec![ctx(1, 1, "a"), add(2, "log(user)")])];
        let comment = reanchor(on_lines("a.ts", 2, &["log(user)"]), &files);
        assert_eq!(comment.state, AnchorState::Current);
        assert_eq!(start_of(&comment), 2);
    }

    #[test]
    fn a_comment_follows_its_code_when_lines_are_inserted_above() {
        let files = [text_file(
            "a.ts",
            vec![add(1, "new"), add(2, "new"), add(3, "x"), add(4, "y")],
        )];
        let comment = reanchor(on_lines("a.ts", 1, &["x", "y"]), &files);
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
        assert_eq!(start_of(&reanchor(on_lines("a.ts", 4, &["}"]), &files)), 3);
    }

    #[test]
    fn a_run_must_be_consecutive_lines() {
        // Lines 2 and 9 sit in different hunks: never one run.
        let files = [text_file("a.ts", vec![add(2, "x"), add(9, "y")])];
        let comment = reanchor(on_lines("a.ts", 2, &["x", "y"]), &files);
        assert_eq!(comment.state, AnchorState::Outdated);
    }

    #[test]
    fn a_comment_whose_code_changed_is_outdated_and_keeps_its_place() {
        let files = [text_file("a.ts", vec![add(1, "log(hash(user))")])];
        let comment = reanchor(on_lines("a.ts", 1, &["log(user)"]), &files);
        assert_eq!(comment.state, AnchorState::Outdated);
        assert_eq!(comment.target, on_lines("a.ts", 1, &["log(user)"]).target);
    }

    #[test]
    fn a_comment_on_a_file_that_left_the_diff_is_outdated() {
        let comment = reanchor(on_lines("a.ts", 1, &["x"]), &[]);
        assert_eq!(comment.state, AnchorState::Outdated);
    }

    #[test]
    fn an_outdated_comment_is_current_again_where_its_code_is() {
        let files = [text_file("a.ts", vec![add(1, "new"), add(2, "x")])];
        let outdated = Comment {
            state: AnchorState::Outdated,
            ..on_lines("a.ts", 1, &["x"])
        };
        assert_eq!(reanchor(outdated, &files), on_lines("a.ts", 2, &["x"]));
    }

    #[test]
    fn an_outdated_comment_on_a_file_back_in_the_diff_is_current_again() {
        let files = [text_file("a.ts", vec![add(1, "x")])];
        let outdated = Comment {
            target: Target::File,
            state: AnchorState::Outdated,
            ..on_lines("a.ts", 1, &["x"])
        };
        assert_eq!(reanchor(outdated, &files).state, AnchorState::Current);
    }

    #[test]
    fn an_outdated_comment_whose_code_is_still_gone_stays_outdated() {
        let files = [text_file("a.ts", vec![add(1, "y")])];
        let outdated = Comment {
            state: AnchorState::Outdated,
            ..on_lines("a.ts", 1, &["x"])
        };
        assert_eq!(reanchor(outdated.clone(), &files), outdated);
    }

    #[test]
    fn a_comment_follows_its_file_through_a_rename() {
        let mut file = text_file("b.ts", vec![add(1, "x")]);
        file.status = Status::Renamed {
            from: "a.ts".into(),
        };
        let comment = reanchor(on_lines("a.ts", 1, &["x"]), &[file]);
        assert_eq!(
            (comment.path.as_str(), comment.state),
            ("b.ts", AnchorState::Current)
        );
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
    fn a_target_with_no_code_is_outdated_on_reload() {
        let files = [text_file("a.ts", vec![add(1, "x")])];
        let comment = Comment {
            target: Target::Lines {
                side: Side::New,
                start: 1,
                code: vec![],
            },
            ..on_lines("a.ts", 1, &["x"])
        };
        assert_eq!(reanchor(comment, &files).state, AnchorState::Outdated);
    }
}
