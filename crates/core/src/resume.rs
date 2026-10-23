//! Showing a kept review again: where its branch went meanwhile (ADR 0026 §4).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{
    base::Base,
    repository::{Checkout, RepoError, Repository},
    saved::{SavedReview, Seen},
};

/// What a branch did since its review was last shown.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum SinceSeen {
    /// Where it was, or never seen.
    Unchanged,
    /// `count` new commits on top of `from`.
    Moved {
        /// Full id of the commit it was at.
        from: String,
        /// How many commits it gained.
        count: u32,
    },
    /// Its history was replaced: `from` is no longer under it.
    Rewritten {
        /// Full id of the commit it was at.
        from: String,
    },
}

/// A kept review ready to show again ([`resume`]).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Resumed {
    /// The review as kept, seen now, without the rounds `dropped` names.
    pub review: SavedReview,
    /// What to compare the branch with: the review's base, unless the
    /// checkout cannot show it.
    pub base: Base,
    /// Where the branch went since the review was last shown.
    pub since: SinceSeen,
    /// The rounds sent on commits a rewrite took away, deleted with them.
    pub dropped: Vec<u32>,
}

/// `review` as `checkout`, `repository`'s just read, shows it now, at `at` (milliseconds since the
/// Unix epoch): compared with its own base, or `default` when it has none or
/// keeps the uncommitted changes and the checkout has no working tree; with
/// where its branch went since it was last seen, and, when its history was
/// rewritten, without the rounds sent on commits no longer under it (ADR 0026
/// §4). One [`Repository::commits_between`] for where the branch went, and
/// one more per round when it was rewritten.
///
/// # Errors
/// As [`Repository::commits_between`].
pub fn resume(
    repository: &(impl Repository + ?Sized),
    checkout: &Checkout,
    review: SavedReview,
    default: Base,
    at: i64,
) -> Result<Resumed, RepoError> {
    let now = checkout.commit.clone();
    let between = |from: &str, to: &str| repository.commits_between(from, to);
    let since = since_seen(
        review.seen.as_ref().map(|s| s.commit.as_str()),
        now.as_deref(),
        between,
    )?;
    let base = review
        .base
        .clone()
        .filter(|base| checkout.worktree.is_some() || *base != Base::Uncommitted)
        .unwrap_or(default);
    let SavedReview {
        comments,
        rounds,
        base: kept,
        seen: _,
    } = review;
    let (rounds, dropped) = match (&since, now.as_deref()) {
        (SinceSeen::Rewritten { .. }, Some(now)) => {
            rounds.into_iter().try_fold(
                (Vec::new(), Vec::new()),
                |(mut kept, mut dropped), round| {
                    // A round sent before the first commit has none to lose.
                    let gone = match &round.commit {
                        Some(commit) => between(commit, now)?.is_none(),
                        None => false,
                    };
                    if gone {
                        dropped.push(round.number);
                    } else {
                        kept.push(round);
                    }
                    Ok::<_, RepoError>((kept, dropped))
                },
            )?
        }
        _ => (rounds, Vec::new()),
    };
    Ok(Resumed {
        review: SavedReview {
            comments,
            rounds,
            base: kept,
            seen: now.map(|commit| Seen { commit, at }),
        },
        base,
        since,
        dropped,
    })
}

/// Where a branch at `now` went since it was seen at `seen`, by
/// `commits_between` ([`Repository::commits_between`]).
pub(crate) fn since_seen(
    seen: Option<&str>,
    now: Option<&str>,
    commits_between: impl Fn(&str, &str) -> Result<Option<u32>, RepoError>,
) -> Result<SinceSeen, RepoError> {
    let (Some(from), Some(now)) = (seen, now) else {
        return Ok(SinceSeen::Unchanged);
    };
    if from == now {
        return Ok(SinceSeen::Unchanged);
    }
    let from = from.to_owned();
    Ok(match commits_between(&from, now)? {
        Some(count) => SinceSeen::Moved { from, count },
        None => SinceSeen::Rewritten { from },
    })
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::*;
    use crate::{
        anchor::Place,
        base::BaseRef,
        diff::{LineCounts, Side},
        repository::{Changes, Checkout, FileStates, Head, OnChange, Snapshot, WatchGuard},
        review::tests::Fixed,
        rounds::Round,
    };

    /// History as a line of commits named by one letter each: `a` before `b`
    /// before `c`. `x` lies on no line with them, as a rewrite leaves one.
    fn between(from: &str, to: &str) -> Result<Option<u32>, RepoError> {
        let line = ["a", "b", "c"];
        let at = |id: &str| line.iter().position(|c| *c == id);
        Ok(match (at(from), at(to)) {
            (Some(f), Some(t)) if f <= t => Some(u32::try_from(t - f).unwrap()),
            _ => None,
        })
    }

    #[test]
    fn a_branch_never_seen_or_where_it_was_is_unchanged() {
        assert_eq!(
            since_seen(None, Some("c"), between),
            Ok(SinceSeen::Unchanged)
        );
        assert_eq!(
            since_seen(Some("a"), None, between),
            Ok(SinceSeen::Unchanged)
        );
        assert_eq!(
            since_seen(Some("c"), Some("c"), between),
            Ok(SinceSeen::Unchanged)
        );
    }

    #[test]
    fn a_branch_moved_on_counts_its_new_commits_and_one_rewritten_says_so() {
        assert_eq!(
            since_seen(Some("a"), Some("c"), between),
            Ok(SinceSeen::Moved {
                from: "a".into(),
                count: 2
            })
        );
        assert_eq!(
            since_seen(Some("x"), Some("c"), between),
            Ok(SinceSeen::Rewritten { from: "x".into() })
        );
    }

    /// The fake repository at `commit`, with `worktree` or none.
    struct At {
        commit: &'static str,
        worktree: bool,
    }

    impl Repository for At {
        fn checkout(&self) -> Result<Checkout, RepoError> {
            Ok(Checkout {
                project: "/code/drive-web/.git".into(),
                worktree: self.worktree.then(|| "/code/drive-web".into()),
                commit: Some(self.commit.into()),
                ..Fixed(vec![]).checkout()?
            })
        }
        fn refs(&self) -> Result<Vec<BaseRef>, RepoError> {
            Fixed(vec![]).refs()
        }
        fn remote_default(&self) -> Result<Option<String>, RepoError> {
            Ok(None)
        }
        fn changes(&self, base: &Base) -> Result<Changes, RepoError> {
            Fixed(vec![]).changes(base)
        }
        fn changes_in(&self, base: &Base, paths: &BTreeSet<String>) -> Result<Changes, RepoError> {
            Fixed(vec![]).changes_in(base, paths)
        }
        fn file_states(&self, base: &Base) -> Result<FileStates, RepoError> {
            Fixed(vec![]).file_states(base)
        }
        fn blob(&self, snapshot: &Snapshot, side: Side, path: &str) -> Result<Vec<u8>, RepoError> {
            Fixed(vec![]).blob(snapshot, side, path)
        }
        fn commits_between(&self, from: &str, to: &str) -> Result<Option<u32>, RepoError> {
            between(from, to)
        }
        fn uncommitted_lines(&self) -> Result<LineCounts, RepoError> {
            Fixed(vec![]).uncommitted_lines()
        }
        fn watch(&self, on_change: OnChange) -> Result<WatchGuard, RepoError> {
            Fixed(vec![]).watch(on_change)
        }
    }

    fn round(number: u32, commit: Option<&str>) -> Round {
        Round {
            number,
            at: 0,
            place: Place {
                base: Base::Uncommitted,
                head: Head::Branch {
                    name: "agent/x".into(),
                },
            },
            commit: commit.map(str::to_owned),
            markdown: String::new(),
        }
    }

    fn seen_at(commit: &str) -> Option<Seen> {
        Some(Seen {
            commit: commit.into(),
            at: 1,
        })
    }

    #[test]
    fn a_rewrite_deletes_the_rounds_sent_on_commits_it_took_away() {
        let review = SavedReview {
            rounds: vec![round(1, Some("x")), round(2, Some("b")), round(3, None)],
            seen: seen_at("x"),
            ..SavedReview::default()
        };
        let at = At {
            commit: "c",
            worktree: true,
        };
        let resumed = resume(&at, &at.checkout().unwrap(), review, Base::LastCommit, 7).unwrap();
        assert_eq!(resumed.since, SinceSeen::Rewritten { from: "x".into() });
        assert_eq!(resumed.dropped, [1]);
        let left: Vec<u32> = resumed.review.rounds.iter().map(|r| r.number).collect();
        assert_eq!(left, [2, 3]);
        assert_eq!(
            resumed.review.seen,
            Some(Seen {
                commit: "c".into(),
                at: 7
            })
        );
    }

    #[test]
    fn a_move_keeps_every_round() {
        let review = SavedReview {
            rounds: vec![round(1, Some("a"))],
            seen: seen_at("a"),
            ..SavedReview::default()
        };
        let at = At {
            commit: "c",
            worktree: true,
        };
        let resumed = resume(&at, &at.checkout().unwrap(), review, Base::LastCommit, 7).unwrap();
        assert_eq!(
            resumed.since,
            SinceSeen::Moved {
                from: "a".into(),
                count: 2
            }
        );
        assert!(resumed.dropped.is_empty());
        assert_eq!(resumed.review.rounds.len(), 1);
    }

    #[test]
    fn a_review_keeps_its_base_unless_the_checkout_cannot_show_it() {
        let main = Base::Ref {
            name: "main".into(),
        };
        let with = |base: Base| SavedReview {
            base: Some(base),
            ..SavedReview::default()
        };
        let live = At {
            commit: "c",
            worktree: true,
        };
        let committed = At {
            commit: "c",
            worktree: false,
        };
        let resumed = |at: &At, review| {
            resume(at, &at.checkout().unwrap(), review, Base::LastCommit, 0).unwrap()
        };
        assert_eq!(resumed(&live, with(main.clone())).base, main);
        assert_eq!(
            resumed(&live, with(Base::Uncommitted)).base,
            Base::Uncommitted
        );
        assert_eq!(
            resumed(&committed, with(Base::Uncommitted)).base,
            Base::LastCommit
        );
        assert_eq!(resumed(&committed, with(main.clone())).base, main);
        assert_eq!(
            resumed(&live, SavedReview::default()).base,
            Base::LastCommit,
            "none kept: the default"
        );
        assert_eq!(
            resumed(&committed, with(Base::Uncommitted)).review.base,
            Some(Base::Uncommitted),
            "the kept base stays for when it can be shown again"
        );
    }
}
