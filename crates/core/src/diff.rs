//! What changed in one file, as hunks of numbered lines.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// One changed file.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FileDiff {
    /// Path relative to the repository root, on the new side.
    pub path: String,
    /// How the file changed as a whole.
    pub status: Status,
    /// The change to its contents.
    pub content: Content,
}

/// How a file changed as a whole.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum Status {
    /// New on the new side.
    Added,
    /// Present on both sides.
    Modified,
    /// Gone on the new side; `path` is its old path.
    Deleted,
    /// Moved from `from`, possibly with content changes.
    Renamed {
        /// Path on the old side.
        from: String,
    },
}

/// The change to a file's contents.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum Content {
    /// A text diff. Empty when only the name or mode changed.
    Text {
        /// In file order.
        hunks: Vec<Hunk>,
    },
    /// A binary file; sizes in bytes, `None` on a side where it is absent.
    Binary {
        /// Size on the old side.
        #[serde(rename = "oldSize")]
        #[ts(rename = "oldSize", type = "number | null")]
        old_size: Option<u64>,
        /// Size on the new side.
        #[serde(rename = "newSize")]
        #[ts(rename = "newSize", type = "number | null")]
        new_size: Option<u64>,
    },
}

/// A run of changed lines with their context.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Hunk {
    /// First old-side line number covered.
    pub old_start: u32,
    /// First new-side line number covered.
    pub new_start: u32,
    /// The enclosing function or section git names after `@@`, or empty.
    pub section: String,
    /// In file order.
    pub lines: Vec<Line>,
}

/// One line of a hunk. Line numbers are 1-based.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum Line {
    /// Unchanged.
    Context {
        /// Old-side line number.
        old: u32,
        /// New-side line number.
        new: u32,
        /// Without the line ending.
        text: String,
    },
    /// Only on the new side.
    Added {
        /// New-side line number.
        new: u32,
        /// Without the line ending.
        text: String,
    },
    /// Only on the old side.
    Removed {
        /// Old-side line number.
        old: u32,
        /// Without the line ending.
        text: String,
    },
}

/// Which side of a diff a line number refers to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Side {
    /// The base.
    Old,
    /// The checkout.
    New,
}

impl Line {
    /// This line's number and text on `side`, if it exists there.
    #[must_use]
    pub(crate) fn on(&self, side: Side) -> Option<(u32, &str)> {
        match (self, side) {
            (Self::Context { old, text, .. } | Self::Removed { old, text }, Side::Old) => {
                Some((*old, text))
            }
            (Self::Context { new, text, .. } | Self::Added { new, text }, Side::New) => {
                Some((*new, text))
            }
            _ => None,
        }
    }
}

/// Each line's run of the diff, by index into `lines`: lines are in one run
/// while their numbers follow each other, and a gap the diff leaves out
/// starts the next. O(L).
#[must_use]
pub(crate) fn runs(lines: &[(u32, &str)]) -> Vec<usize> {
    lines
        .iter()
        .scan(
            (0, None),
            |(run, last): &mut (usize, Option<u32>), (no, _)| {
                if last.is_some_and(|l| l + 1 != *no) {
                    *run += 1;
                }
                *last = Some(*no);
                Some(*run)
            },
        )
        .collect()
}

impl FileDiff {
    /// Every line the diff shows on `side`, in file order, as (number, text).
    pub(crate) fn lines(&self, side: Side) -> impl Iterator<Item = (u32, &str)> {
        let hunks = match &self.content {
            Content::Text { hunks } => hunks.as_slice(),
            Content::Binary { .. } => &[],
        };
        hunks
            .iter()
            .flat_map(|hunk| &hunk.lines)
            .filter_map(move |line| line.on(side))
    }

    /// The path this file had on the old side.
    #[must_use]
    pub fn old_path(&self) -> &str {
        match &self.status {
            Status::Renamed { from } => from,
            _ => &self.path,
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) fn text_file(path: &str, lines: Vec<Line>) -> FileDiff {
        FileDiff {
            path: path.to_owned(),
            status: Status::Modified,
            content: Content::Text {
                hunks: vec![Hunk {
                    old_start: 1,
                    new_start: 1,
                    section: String::new(),
                    lines,
                }],
            },
        }
    }

    pub(crate) fn ctx(old: u32, new: u32, text: &str) -> Line {
        Line::Context {
            old,
            new,
            text: text.to_owned(),
        }
    }

    pub(crate) fn add(new: u32, text: &str) -> Line {
        Line::Added {
            new,
            text: text.to_owned(),
        }
    }

    pub(crate) fn del(old: u32, text: &str) -> Line {
        Line::Removed {
            old,
            text: text.to_owned(),
        }
    }

    #[test]
    fn lines_on_each_side_skip_the_other_sides_only_lines() {
        let file = text_file("a.ts", vec![ctx(1, 1, "a"), del(2, "b"), add(2, "c")]);
        let old: Vec<_> = file.lines(Side::Old).collect();
        let new: Vec<_> = file.lines(Side::New).collect();
        assert_eq!(old, [(1, "a"), (2, "b")]);
        assert_eq!(new, [(1, "a"), (2, "c")]);
    }

    #[test]
    fn runs_break_where_line_numbers_skip() {
        let lines = [(1, "a"), (2, "b"), (4, "c"), (5, "d"), (9, "e")];
        assert_eq!(runs(&lines), [0, 0, 1, 1, 2]);
        assert!(runs(&[]).is_empty());
    }

    #[test]
    fn a_binary_file_has_no_lines() {
        let file = FileDiff {
            path: "a.png".into(),
            status: Status::Added,
            content: Content::Binary {
                old_size: None,
                new_size: Some(3),
            },
        };
        assert_eq!(file.lines(Side::New).count(), 0);
    }
}
