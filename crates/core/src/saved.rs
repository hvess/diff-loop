//! What of a review outlasts a run of the app, and the port to where it is kept.

use serde::{Deserialize, Serialize};
use thiserror::Error;
use ts_rs::TS;

use crate::anchor::Comment;

/// A checkout's review as kept between runs: one per working tree, whatever
/// the base (ADR 0004 §1). A `note` kept by an earlier version is ignored
/// (ADR 0013 §3).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SavedReview {
    /// As last saved; moved onto their code when the review next loads.
    pub comments: Vec<Comment>,
}

impl SavedReview {
    /// Whether there is nothing to keep.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.comments.is_empty()
    }
}

/// Where reviews are kept between runs, by working-tree root.
pub trait ReviewStore {
    /// The review saved for `root`, or an empty one when none is.
    ///
    /// # Errors
    /// [`StoreError::Failed`] when what is kept cannot be read.
    fn saved(&self, root: &str) -> Result<SavedReview, StoreError>;

    /// Keeps `review` for `root` in place of any before it; an empty review
    /// removes the entry.
    ///
    /// # Errors
    /// [`StoreError::Failed`] when it cannot be written, or when what is
    /// kept cannot be read, so writing would lose it.
    fn save(&self, root: &str, review: &SavedReview) -> Result<(), StoreError>;
}

/// Why a [`ReviewStore`] could not answer.
#[derive(Debug, Clone, PartialEq, Eq, Error, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum StoreError {
    /// Reading or writing failed, with the underlying message.
    #[error("{message}")]
    Failed {
        /// Why, in the adapter's words.
        message: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::anchor::{AnchorState, Target};

    #[test]
    fn a_review_with_a_comment_is_not_empty() {
        assert!(SavedReview::default().is_empty());
        let comment = SavedReview {
            comments: vec![Comment {
                id: "c".into(),
                path: "a.ts".into(),
                target: Target::File,
                text: "t".into(),
                suggestion: None,
                state: AnchorState::Current,
            }],
        };
        assert!(!comment.is_empty());
    }
}
