//! Rounds: a copy of the instructions ends one, and every comment it included
//! is sent (ADR 0015 §1 and §9).

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{
    anchor::{AnchorState, CONTEXT, Comment, Place, Sent, Target, Verdict},
    diff::{FileDiff, runs},
    saved::SavedReview,
};

/// One round: a copy of the instructions, as sent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Round {
    /// Counted from 1 per review; never reused once a round is dropped.
    pub number: u32,
    /// When it was copied, in milliseconds since the Unix epoch.
    #[ts(type = "number")]
    pub at: i64,
    /// Where it was sent.
    pub place: Place,
    /// Full id of the commit at `HEAD` when sent; `None` before the first commit.
    pub commit: Option<String>,
    /// The instructions as copied, a kept preview edit included.
    pub markdown: String,
}

/// Everything [`end_round`] needs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RoundRequest {
    /// The review as it stands.
    pub review: SavedReview,
    /// The changed files the unresolved comments are in, for their context;
    /// a comment whose file is missing is sent without any.
    pub files: Vec<FileDiff>,
    /// Where the copy was made.
    pub place: Place,
    /// Full id of the commit at `HEAD`; `None` before the first commit.
    pub commit: Option<String>,
    /// When, in milliseconds since the Unix epoch.
    #[ts(type = "number")]
    pub at: i64,
    /// The instructions as copied.
    pub markdown: String,
}

/// How many rounds a review keeps; an older one drops with its resolved
/// comments, never with an open one (ADR 0015 §9).
const KEPT_ROUNDS: usize = 20;

/// The review after a copy: every unresolved comment sent in a new round,
/// with the code it is on and up to three lines either side, and the round
/// recorded. With no unresolved comment, nothing was sent and nothing changes.
#[must_use]
pub fn end_round(request: RoundRequest) -> SavedReview {
    let RoundRequest {
        review,
        files,
        place,
        commit,
        at,
        markdown,
    } = request;
    let SavedReview {
        comments,
        mut rounds,
        base,
        seen,
    } = review;
    if comments.iter().all(|c| c.resolved.is_some()) {
        return SavedReview {
            comments,
            rounds,
            base,
            seen,
        };
    }
    let number = rounds.last().map_or(1, |r| r.number + 1);
    let comments = comments
        .into_iter()
        .map(|comment| {
            if comment.resolved.is_some() {
                return comment;
            }
            // Only a comment on its code has context: a lost or outdated one's start holds other lines.
            let file = files
                .iter()
                .find(|f| f.path == comment.path)
                .filter(|_| comment.state == AnchorState::Current);
            let (before, after) = context(&comment.target, file);
            // Lost is a draft's state (ADR 0015 §2): sent, it is outdated until a load judges it.
            let state = match comment.state {
                AnchorState::Lost => AnchorState::Outdated,
                state => state,
            };
            Comment {
                state,
                sent: Some(Sent {
                    round: number,
                    place: place.clone(),
                    commit: commit.clone(),
                    target: comment.target.clone(),
                    before,
                    after,
                    text: comment.text.clone(),
                    suggestion: comment.ask.code().map(str::to_owned),
                    verdict: Some(Verdict::Untouched),
                }),
                ..comment
            }
        })
        .collect();
    rounds.push(Round {
        number,
        at,
        place,
        commit,
        markdown,
    });
    prune(SavedReview {
        comments,
        rounds,
        base,
        seen,
    })
}

/// Up to [`CONTEXT`] lines above and below `target` in `file`, as one run
/// of the diff on the target's side: a gap the diff leaves out ends it.
/// A target on no code (one judged removed) has nothing to bracket, so it
/// gets none: context around its line would read that line as its code.
fn context(target: &Target, file: Option<&FileDiff>) -> (Vec<String>, Vec<String>) {
    let (Target::Lines { side, start, code }, Some(file)) = (target, file) else {
        return (vec![], vec![]);
    };
    let lines: Vec<(u32, &str)> = file.lines(*side).collect();
    let Some(at) = lines.iter().position(|(no, _)| no == start) else {
        return (vec![], vec![]);
    };
    let Some(end) = code.len().checked_sub(1).map(|n| at + n) else {
        return (vec![], vec![]);
    };
    // Each line must be in the code's run of the diff.
    let run_of = runs(&lines);
    let run = run_of[at];
    let text_of = |i: usize| lines[i].1.to_owned();
    let mut before: Vec<String> = (0..at)
        .rev()
        .take(CONTEXT)
        .take_while(|i| run_of[*i] == run)
        .map(text_of)
        .collect();
    before.reverse();
    let after = (end + 1..lines.len())
        .take(CONTEXT)
        .take_while(|i| run_of[*i] == run)
        .map(text_of)
        .collect();
    (before, after)
}

/// A review read from the store merged into the window's, once saving can
/// resume (ADR 0004 §5): saved comments the window lacks are added, and
/// rounds copied while the saved ones could not be read count on from them,
/// their comments following; at most [`KEPT_ROUNDS`] rounds are kept. The
/// window's base and where it saw the branch stand, the saved ones only
/// where it has none.
#[must_use]
pub fn merge(window: SavedReview, saved: SavedReview) -> SavedReview {
    let after = saved.rounds.last().map_or(0, |r| r.number);
    let renumbered = |round: u32| round + after;
    let rounds: Vec<Round> = saved
        .rounds
        .into_iter()
        .chain(window.rounds.into_iter().map(|r| Round {
            number: renumbered(r.number),
            ..r
        }))
        .collect();
    let ids: HashSet<String> = window.comments.iter().map(|c| c.id.clone()).collect();
    let comments = saved
        .comments
        .into_iter()
        .filter(|c| !ids.contains(&c.id))
        .chain(window.comments.into_iter().map(|c| Comment {
            sent: c.sent.map(|s| Sent {
                round: renumbered(s.round),
                ..s
            }),
            ..c
        }))
        .collect();
    prune(SavedReview {
        comments,
        rounds,
        base: window.base.or(saved.base),
        seen: window.seen.or(saved.seen),
    })
}

/// `review` with at most [`KEPT_ROUNDS`] rounds: the oldest go, each with the
/// resolved comments sent in it.
fn prune(review: SavedReview) -> SavedReview {
    let SavedReview {
        mut comments,
        mut rounds,
        base,
        seen,
    } = review;
    let excess = rounds.len().saturating_sub(KEPT_ROUNDS);
    let dropped: Vec<u32> = rounds.drain(..excess).map(|r| r.number).collect();
    comments.retain(|c| {
        c.resolved.is_none() || c.sent.as_ref().is_none_or(|s| !dropped.contains(&s.round))
    });
    SavedReview {
        comments,
        rounds,
        base,
        seen,
    }
}

/// The round a commit on top of `previous` is followed for, seen at `now`:
/// the newest with an open comment sent against the uncommitted changes at
/// `previous` on `now`'s branch (ADR 0017 §2), or, `previous` a round's
/// commit and `now` comparing with it by name, as a follow under way does,
/// the newest such round still open there (ADR 0022 §1). O(comments), once
/// per move of `HEAD`.
#[must_use]
pub fn round_to_follow(comments: &[Comment], now: &Place, previous: &str) -> Option<u32> {
    comments
        .iter()
        .filter(|c| c.resolved.is_none())
        .filter_map(|c| c.sent.as_ref())
        .filter(|sent| sent.follows(now, previous))
        .map(|sent| sent.round)
        .max()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        anchor::{Ask, Resolution},
        base::Base,
        diff::{
            Side,
            tests::{add, text_file},
        },
        repository::Head,
        saved::Seen,
    };

    fn place() -> Place {
        Place {
            base: Base::Ref {
                name: "main".into(),
            },
            head: Head::Branch {
                name: "agent/x".into(),
            },
        }
    }

    fn draft(id: &str, start: u32, code: &[&str]) -> Comment {
        Comment {
            id: id.into(),
            path: "a.ts".into(),
            target: Target::Lines {
                side: Side::New,
                start,
                code: code.iter().map(|s| (*s).to_owned()).collect(),
            },
            text: "t".into(),
            ask: Ask::Comment,
            state: AnchorState::Current,
            place: Some(place()),
            sent: None,
            resolved: None,
            note: None,
        }
    }

    /// Lines 1–7: `l1` … `l7`.
    fn file() -> FileDiff {
        text_file("a.ts", (1..=7).map(|n| add(n, &format!("l{n}"))).collect())
    }

    fn request(comments: Vec<Comment>, rounds: Vec<Round>) -> RoundRequest {
        RoundRequest {
            review: SavedReview {
                comments,
                rounds,
                ..SavedReview::default()
            },
            files: vec![file()],
            place: place(),
            commit: Some("abc".into()),
            at: 1_000,
            markdown: "md".into(),
        }
    }

    /// `comments` sent in a round against the uncommitted changes at `abc`.
    fn sent_uncommitted(comments: Vec<Comment>, rounds: Vec<Round>) -> SavedReview {
        let mut request = request(comments, rounds);
        request.place.base = Base::Uncommitted;
        end_round(request)
    }

    #[test]
    fn a_commit_on_top_follows_the_newest_round_with_an_open_comment_sent_on_uncommitted_changes() {
        let first = sent_uncommitted(vec![draft("a", 4, &["l4"])], vec![]);
        let mut comments = first.comments;
        comments.push(draft("b", 1, &["l1"]));
        let mut second = sent_uncommitted(comments, first.rounds);
        let uncommitted = Place {
            base: Base::Uncommitted,
            ..place()
        };
        assert_eq!(
            round_to_follow(&second.comments, &uncommitted, "abc"),
            Some(2)
        );
        second.comments[1].resolved = Some(Resolution::ByReviewer);
        second.comments[0].resolved = Some(Resolution::ByReviewer);
        assert_eq!(round_to_follow(&second.comments, &uncommitted, "abc"), None);
    }

    #[test]
    fn compared_with_the_rounds_commit_a_later_commit_still_follows_it() {
        let review = sent_uncommitted(vec![draft("a", 4, &["l4"])], vec![]);
        let since = Place {
            base: Base::Ref { name: "abc".into() },
            ..place()
        };
        assert_eq!(round_to_follow(&review.comments, &since, "abc"), Some(1));
        // A move that started elsewhere is not the round's: a base the reviewer
        // picked stays as it is.
        assert_eq!(round_to_follow(&review.comments, &since, "def"), None);
        // A round sent against that commit by name is not the uncommitted
        // changes', though it is judged on the very same base.
        let mut by_name = request(vec![draft("b", 4, &["l4"])], vec![]);
        by_name.place = since.clone();
        let by_name = end_round(by_name);
        assert_eq!(round_to_follow(&by_name.comments, &since, "abc"), None);
    }

    #[test]
    fn a_commit_on_top_is_not_followed_on_another_base_branch_or_commit() {
        let review = sent_uncommitted(vec![draft("a", 4, &["l4"])], vec![]);
        let uncommitted = Place {
            base: Base::Uncommitted,
            ..place()
        };
        let other_branch = Place {
            head: Head::Branch {
                name: "agent/y".into(),
            },
            ..uncommitted.clone()
        };
        assert_eq!(round_to_follow(&review.comments, &place(), "abc"), None);
        assert_eq!(
            round_to_follow(&review.comments, &other_branch, "abc"),
            None
        );
        assert_eq!(round_to_follow(&review.comments, &uncommitted, "def"), None);
        let drafts = [draft("d", 1, &["l1"])];
        assert_eq!(round_to_follow(&drafts, &uncommitted, "abc"), None);
    }

    fn strings(l: &[&str]) -> Vec<String> {
        l.iter().map(|s| (*s).to_owned()).collect()
    }

    #[test]
    fn a_copy_sends_every_unresolved_comment_with_its_code_and_context() {
        let comments = vec![draft("a", 4, &["l4"]), draft("b", 1, &["l1", "l2"])];
        let review = end_round(request(comments, vec![]));
        assert_eq!(review.rounds.len(), 1);
        let round = &review.rounds[0];
        assert_eq!(
            (round.number, round.at, round.markdown.as_str()),
            (1, 1_000, "md")
        );
        let a = review.comments[0].sent.as_ref().unwrap();
        assert_eq!(a.round, 1);
        assert_eq!(a.before, strings(&["l1", "l2", "l3"]));
        assert_eq!(a.after, strings(&["l5", "l6", "l7"]));
        assert_eq!(a.target, draft("a", 4, &["l4"]).target);
        assert_eq!(a.verdict, Some(Verdict::Untouched));
        let b = review.comments[1].sent.as_ref().unwrap();
        assert!(b.before.is_empty());
        assert_eq!(b.after, strings(&["l3", "l4", "l5"]));
    }

    #[test]
    fn context_stops_at_a_gap_the_diff_leaves_out() {
        let file = text_file(
            "a.ts",
            vec![add(1, "l1"), add(4, "l4"), add(5, "l5"), add(9, "l9")],
        );
        let (before, after) = context(&draft("a", 4, &["l4"]).target, Some(&file));
        assert!(before.is_empty(), "l1 is not the line above l4");
        assert_eq!(after, strings(&["l5"]));
    }

    #[test]
    fn a_comment_whose_file_is_not_given_is_sent_without_context() {
        let mut request = request(vec![draft("a", 4, &["l4"])], vec![]);
        request.files.clear();
        let sent = end_round(request).comments[0].sent.clone().unwrap();
        assert!(sent.before.is_empty() && sent.after.is_empty());
    }

    /// Regression: a lost draft was sent with the lines now at its old start as its context, and judged changed.
    #[test]
    fn a_comment_not_on_its_code_is_sent_without_context() {
        let lost = Comment {
            state: AnchorState::Lost,
            ..draft("a", 4, &["gone"])
        };
        let outdated = Comment {
            state: AnchorState::Outdated,
            ..draft("b", 4, &["gone"])
        };
        let review = end_round(request(vec![lost, outdated], vec![]));
        for comment in &review.comments {
            let sent = comment.sent.as_ref().unwrap();
            assert!(
                sent.before.is_empty() && sent.after.is_empty(),
                "{}",
                comment.id
            );
            assert_eq!(comment.state, AnchorState::Outdated, "{}", comment.id);
        }
    }

    /// Regression: a comment judged removed, sent again, took the lines around its
    /// line as context, so the next load read that line as its code and judged it changed.
    #[test]
    fn a_comment_on_removed_code_is_sent_again_without_context() {
        let removed = draft("a", 4, &[]);
        let sent = end_round(request(vec![removed], vec![])).comments[0]
            .sent
            .clone()
            .unwrap();
        assert!(sent.before.is_empty() && sent.after.is_empty());
    }

    #[test]
    fn rounds_count_on_from_the_last_and_resolved_comments_are_not_sent_again() {
        let resolved = Comment {
            resolved: Some(Resolution::ByReviewer),
            ..draft("r", 2, &["l2"])
        };
        let earlier = Round {
            number: 4,
            at: 0,
            place: place(),
            commit: None,
            markdown: String::new(),
        };
        let review = end_round(request(
            vec![resolved.clone(), draft("a", 4, &["l4"])],
            vec![earlier],
        ));
        assert_eq!(review.rounds.last().unwrap().number, 5);
        assert_eq!(review.comments[0], resolved);
        assert_eq!(review.comments[1].sent.as_ref().unwrap().round, 5);
    }

    #[test]
    fn with_nothing_unresolved_no_round_is_recorded() {
        let resolved = Comment {
            resolved: Some(Resolution::ByReviewer),
            ..draft("r", 2, &["l2"])
        };
        let review = end_round(request(vec![resolved], vec![]));
        assert!(review.rounds.is_empty());
    }

    /// Regression: rounds copied while the saved review could not be read kept their numbers, which the saved ones also used.
    #[test]
    fn a_review_merged_back_counts_the_windows_rounds_on_from_the_saved_ones() {
        let in_round = |id: &str, round: u32| Comment {
            sent: Some(Sent {
                round,
                place: place(),
                commit: None,
                target: Target::File,
                before: vec![],
                after: vec![],
                text: "t".into(),
                suggestion: None,
                verdict: Some(Verdict::Untouched),
            }),
            ..draft(id, 1, &["l1"])
        };
        let round_n = |number: u32| Round {
            number,
            at: 0,
            place: place(),
            commit: None,
            markdown: String::new(),
        };
        let saved = SavedReview {
            comments: vec![in_round("old", 2), draft("shared", 1, &["l1"])],
            rounds: vec![round_n(1), round_n(2)],
            ..SavedReview::default()
        };
        let window = SavedReview {
            comments: vec![
                in_round("new", 1),
                Comment {
                    text: "mine".into(),
                    ..draft("shared", 1, &["l1"])
                },
            ],
            rounds: vec![round_n(1)],
            ..SavedReview::default()
        };
        let merged = merge(window, saved);
        assert_eq!(
            merged.rounds.iter().map(|r| r.number).collect::<Vec<_>>(),
            [1, 2, 3]
        );
        let rounds: Vec<(&str, Option<u32>)> = merged
            .comments
            .iter()
            .map(|c| (c.id.as_str(), c.sent.as_ref().map(|s| s.round)))
            .collect();
        assert_eq!(
            rounds,
            [("old", Some(2)), ("new", Some(3)), ("shared", None)]
        );
        assert_eq!(merged.comments[2].text, "mine", "the window's copy wins");
    }

    #[test]
    fn a_review_merged_back_keeps_the_windows_base_and_seen_and_the_saved_ones_where_it_has_none() {
        let seen = |commit: &str| {
            Some(Seen {
                commit: commit.into(),
                at: 1,
            })
        };
        let saved = SavedReview {
            base: Some(Base::LastCommit),
            seen: seen("old"),
            ..SavedReview::default()
        };
        let window = SavedReview {
            base: Some(Base::Uncommitted),
            ..SavedReview::default()
        };
        let merged = merge(window, saved.clone());
        assert_eq!(merged.base, Some(Base::Uncommitted));
        assert_eq!(merged.seen, seen("old"));
        assert_eq!(
            merge(SavedReview::default(), saved).base,
            Some(Base::LastCommit)
        );
    }

    #[test]
    fn a_review_merged_back_keeps_the_bound() {
        let round_n = |number: u32| Round {
            number,
            at: 0,
            place: place(),
            commit: None,
            markdown: String::new(),
        };
        let saved = SavedReview {
            comments: vec![],
            rounds: (1..=KEPT_ROUNDS)
                .map(|n| round_n(u32::try_from(n).unwrap()))
                .collect(),
            ..SavedReview::default()
        };
        let window = SavedReview {
            comments: vec![],
            rounds: vec![round_n(1), round_n(2)],
            ..SavedReview::default()
        };
        let merged = merge(window, saved);
        assert_eq!(merged.rounds.len(), KEPT_ROUNDS);
        assert_eq!(merged.rounds.last().unwrap().number, 22);
    }

    #[test]
    fn the_oldest_round_past_the_bound_drops_with_its_resolved_comments_only() {
        let rounds: Vec<Round> = (1..=KEPT_ROUNDS)
            .map(|n| Round {
                number: u32::try_from(n).unwrap(),
                at: 0,
                place: place(),
                commit: None,
                markdown: String::new(),
            })
            .collect();
        let in_round = |id: &str, round: u32, resolved: Option<Resolution>| Comment {
            sent: Some(Sent {
                round,
                place: place(),
                commit: None,
                target: Target::File,
                before: vec![],
                after: vec![],
                text: "t".into(),
                suggestion: None,
                verdict: Some(Verdict::Untouched),
            }),
            resolved,
            ..draft(id, 1, &["l1"])
        };
        let comments = vec![
            in_round("gone", 1, Some(Resolution::ByReviewer)),
            in_round("kept", 2, Some(Resolution::ByReviewer)),
            in_round("open", 1, None),
            draft("d", 4, &["l4"]),
        ];
        let review = end_round(request(comments, rounds));
        assert_eq!(review.rounds.len(), KEPT_ROUNDS);
        assert_eq!(review.rounds[0].number, 2);
        let ids: Vec<&str> = review.comments.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(ids, ["kept", "open", "d"]);
        // The open one was sent again, in the new round.
        assert_eq!(review.comments[1].sent.as_ref().unwrap().round, 21);
    }
}
