//! The agent's two tools over a branch's review: read its open comments, and
//! resolve one it fixed (ADR 0032 §1).

use diff_loop_core::{
    Base, Head, InstructionsRequest, RepoError, Resolution, ReviewKey, ReviewStore, StoreError,
    instructions,
};
use thiserror::Error;

/// Why a tool could not do what it was asked.
#[derive(Debug, Error)]
pub(crate) enum ToolError {
    #[error("{0}")]
    Repository(#[from] RepoError),
    #[error("{0}")]
    Store(#[from] StoreError),
    #[error("HEAD is detached here, and only a branch has a review")]
    Detached,
    #[error("no comment has the id `{0}` in this branch's review")]
    NoComment(String),
    #[error("comment `{0}` is already resolved")]
    Resolved(String),
    #[error("resolve_comment needs the comment's `id`")]
    NoId,
    #[error("no tool `{0}`: use get_review or resolve_comment")]
    NoTool(String),
}

/// The review kept for `key` as the instructions Copy would give, naming
/// its file and each comment's id; or a line saying nothing is open.
pub(crate) fn get_review(store: &dyn ReviewStore, key: &ReviewKey) -> Result<String, ToolError> {
    let review = store.saved(key)?;
    if review.comments.iter().all(|c| c.resolved.is_some()) {
        return Ok(format!("No open review comments on {}.", key.branch));
    }
    let request = InstructionsRequest {
        head: Head::Branch {
            name: key.branch.clone(),
        },
        base: review.base.unwrap_or(Base::Uncommitted),
        comments: review.comments,
    };
    Ok(instructions(&request, store.location(key).as_deref()))
}

/// Resolves the open comment `id` in `key`'s review as the agent's, with
/// `note` saying what it changed, or a question's answer (ADR 0036 §2).
pub(crate) fn resolve_comment(
    store: &dyn ReviewStore,
    key: &ReviewKey,
    id: &str,
    note: &str,
) -> Result<String, ToolError> {
    let mut outcome = Err(ToolError::NoComment(id.to_owned()));
    let review = store.change(key, &mut |review| {
        outcome = match review.comments.iter_mut().find(|c| c.id == id) {
            None => Err(ToolError::NoComment(id.to_owned())),
            Some(comment) if comment.resolved.is_some() => Err(ToolError::Resolved(id.to_owned())),
            Some(comment) => {
                comment.resolved = Some(Resolution::ByAgent);
                comment.note = Some(note.trim().to_owned()).filter(|n| !n.is_empty());
                Ok(())
            }
        };
    })?;
    outcome?;
    let open = review
        .comments
        .iter()
        .filter(|c| c.resolved.is_none())
        .count();
    Ok(format!("Resolved `{id}`; {open} open comment(s) left."))
}

#[cfg(test)]
mod tests {
    use diff_loop_core::{AnchorState, Comment, SavedReview, Target};

    use super::*;
    use crate::memory::Memory;

    fn comment(id: &str) -> Comment {
        Comment {
            id: id.into(),
            path: "a.rs".into(),
            target: Target::File,
            text: format!("Fix {id}."),
            suggestion: None,
            state: AnchorState::Current,
            place: None,
            sent: None,
            resolved: None,
            note: None,
            question: false,
        }
    }

    fn kept() -> (Memory, ReviewKey) {
        let key = ReviewKey {
            project: "/p/.git".into(),
            branch: "agent/x".into(),
        };
        let store = Memory::default();
        let review = SavedReview {
            comments: vec![comment("one"), comment("two")],
            ..SavedReview::default()
        };
        store.save(&key, &review).unwrap();
        (store, key)
    }

    #[test]
    fn the_review_names_its_file_and_each_open_comments_id() {
        let (store, key) = kept();
        let text = get_review(&store, &key).unwrap();
        assert!(
            text.contains("(id `one`)") && text.contains("(id `two`)"),
            "{text}"
        );
        assert!(text.contains("/p/.git/agent/x.json"), "{text}");
    }

    #[test]
    fn a_resolved_comment_keeps_its_note_and_leaves_the_review() {
        let (store, key) = kept();
        let said = resolve_comment(&store, &key, "one", " Renamed it. ").unwrap();
        assert!(said.contains("1 open"), "{said}");
        let one = &store.saved(&key).unwrap().comments[0];
        assert_eq!(one.resolved, Some(Resolution::ByAgent));
        assert_eq!(one.note.as_deref(), Some("Renamed it."));
        assert!(!get_review(&store, &key).unwrap().contains("(id `one`)"));
        assert!(matches!(
            resolve_comment(&store, &key, "one", ""),
            Err(ToolError::Resolved(_))
        ));
        resolve_comment(&store, &key, "two", "").unwrap();
        assert_eq!(store.saved(&key).unwrap().comments[1].note, None);
        assert!(
            get_review(&store, &key)
                .unwrap()
                .starts_with("No open review comments")
        );
    }

    #[test]
    fn an_unknown_comment_is_refused() {
        let (store, key) = kept();
        assert!(matches!(
            resolve_comment(&store, &key, "three", ""),
            Err(ToolError::NoComment(_))
        ));
    }
}
