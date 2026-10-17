//! Loading a checkout for review.

use std::{
    collections::{HashMap, hash_map::DefaultHasher},
    hash::{Hash, Hasher},
};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{
    anchor::{Comment, Place, reanchor},
    base::{Base, BaseRef, default_base},
    diff::FileDiff,
    repository::{Changes, Checkout, FileStates, RepoError, Repository, Snapshot, Touched},
    update::{Updated, covers, update},
};

/// A checkout's changes against a base, ready to review.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Review {
    /// What is checked out.
    pub checkout: Checkout,
    /// What it is compared with.
    pub base: Base,
    /// [`Repository::fingerprint`] for `base`, taken before `files`; `None`
    /// for a load since the last one against `base` under a watch, which
    /// takes none.
    pub fingerprint: Option<String>,
    /// The two trees compared, for [`Repository::blob`].
    pub snapshot: Snapshot,
    /// Every changed file, in path order; in full only where the caller's
    /// copy is missing or stale.
    pub files: Vec<ReviewFile>,
    /// The comments passed in, moved onto their code.
    pub comments: Vec<Comment>,
}

/// One changed file in a [`Review`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum ReviewFile {
    /// The caller already holds this version: its [`KnownFile`] matched.
    Unchanged {
        /// The file's path on the new side.
        path: String,
        /// As the caller sent it.
        signature: String,
    },
    /// New to the caller, or changed since its copy.
    Changed {
        /// Identifies this version of `diff` within one run of the app.
        signature: String,
        /// The file in full.
        diff: FileDiff,
    },
}

/// A file version the caller of [`load`] already holds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct KnownFile {
    /// The file's path on the new side.
    pub path: String,
    /// The signature [`load`] returned with it.
    pub signature: String,
}

/// A checkout just opened: what it is, what it can be compared with, and
/// what it is compared with first.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Opening {
    /// What is checked out.
    pub checkout: Checkout,
    /// Branches and tags to compare with.
    pub refs: Vec<BaseRef>,
    /// The [`default_base`].
    pub base: Base,
}

/// What `repository` is and the base to review it against first.
///
/// # Errors
/// As [`Repository::checkout`], [`Repository::refs`] and [`Repository::remote_default`].
pub fn open(repository: &(impl Repository + ?Sized)) -> Result<Opening, RepoError> {
    let checkout = repository.checkout()?;
    let refs = repository.refs()?;
    let base = default_base(
        &checkout.head,
        &refs,
        repository.remote_default()?.as_deref(),
    );
    Ok(Opening {
        checkout,
        refs,
        base,
    })
}

/// What a review was last loaded from, so the next [`load`] can read only
/// what was touched since.
#[derive(Debug, Clone)]
pub struct Loaded {
    base: Base,
    changes: Changes,
    /// Each file's signature, by path, kept for files the next load does
    /// not read again.
    signatures: HashMap<String, String>,
    /// The file states taken before the load, by [`load_polled`]: what the
    /// next one compares to know what changed.
    states: Option<FileStates>,
}

/// The checkout's changes against `base`, with `comments` moved onto their
/// code (see [`reanchor`]), and what it was loaded from. Files whose version
/// matches one in `known` are named, not sent.
///
/// `since` is the last load and what a watch saw touched after it: when it
/// was against `base` too, no fingerprint is taken and `update` reads again
/// only the touched paths, unless it must read everything (ADR 0005 §3).
///
/// # Errors
/// As [`Repository::checkout`] and [`Repository::changes`].
pub fn load(
    repository: &(impl Repository + ?Sized),
    base: Base,
    comments: Vec<Comment>,
    known: Vec<KnownFile>,
    since: Option<(Loaded, Touched)>,
) -> Result<(Review, Loaded), RepoError> {
    load_with(repository, base, comments, known, since, None)
}

/// As [`load`] with no watch: the file states are taken first, and against
/// `last`'s, when it was against `base` too, they name what changed, so
/// only that is read again (ADR 0023). The review always has a fingerprint,
/// the states', which the next poll compares.
///
/// # Errors
/// As [`load`], and [`Repository::file_states`].
pub fn load_polled(
    repository: &(impl Repository + ?Sized),
    base: Base,
    comments: Vec<Comment>,
    known: Vec<KnownFile>,
    last: Option<Loaded>,
) -> Result<(Review, Loaded), RepoError> {
    let states = repository.file_states(&base)?;
    let since = last.and_then(|loaded| {
        let touched = loaded.states.as_ref()?.touched_since(&states);
        Some((loaded, touched))
    });
    load_with(repository, base, comments, known, since, Some(states))
}

/// [`load`], with `states` taken first when there is no watch.
fn load_with(
    repository: &(impl Repository + ?Sized),
    base: Base,
    comments: Vec<Comment>,
    known: Vec<KnownFile>,
    since: Option<(Loaded, Touched)>,
    states: Option<FileStates>,
) -> Result<(Review, Loaded), RepoError> {
    let checkout = repository.checkout()?;
    let polled = states.as_ref().map(FileStates::fingerprint);
    let (fingerprint, changes, reread, held) = match since {
        Some((loaded, touched)) if loaded.base == base => {
            let Updated { changes, reread } = update(repository, &base, loaded.changes, touched)?;
            (polled, changes, reread, loaded.signatures)
        }
        // Taken first: a change landing between the two shows as a newer
        // fingerprint on the next poll, never as a missed one.
        _ => (
            Some(match polled {
                Some(fingerprint) => fingerprint,
                None => repository.fingerprint(&base)?,
            }),
            repository.changes(&base)?,
            None,
            HashMap::new(),
        ),
    };
    // A file not read again keeps its signature: hashing every file would
    // cost the whole diff on every watch event.
    let signatures: HashMap<String, String> = changes
        .files
        .iter()
        .map(|diff| {
            let unread = reread
                .as_ref()
                .is_some_and(|r| !covers(r, &diff.path) && !covers(r, diff.old_path()));
            let signature = unread
                .then(|| held.get(&diff.path).cloned())
                .flatten()
                .unwrap_or_else(|| signature(diff));
            (diff.path.clone(), signature)
        })
        .collect();
    let now = Place {
        base: base.clone(),
        head: checkout.head.clone(),
    };
    let comments = comments
        .into_iter()
        .map(|c| reanchor(c, &changes.files, &now, checkout.commit.as_deref()))
        .collect();
    let known: HashMap<String, String> = known.into_iter().map(|k| (k.path, k.signature)).collect();
    // Only what is sent is cloned: the changes move whole into `Loaded`.
    let files = changes
        .files
        .iter()
        .map(|diff| {
            // Built from these files just above, so every path is present.
            let signature = signatures[&diff.path].clone();
            if known.get(&diff.path) == Some(&signature) {
                ReviewFile::Unchanged {
                    path: diff.path.clone(),
                    signature,
                }
            } else {
                ReviewFile::Changed {
                    signature,
                    diff: diff.clone(),
                }
            }
        })
        .collect();
    let review = Review {
        checkout,
        base: base.clone(),
        fingerprint,
        snapshot: changes.snapshot.clone(),
        files,
        comments,
    };
    let loaded = Loaded {
        base,
        changes,
        signatures,
        states,
    };
    Ok((review, loaded))
}

/// Identifies a version of `file` within one run of the app: `DefaultHasher`
/// is not stable across Rust versions, and signatures are never stored.
fn signature(file: &FileDiff) -> String {
    let mut hasher = DefaultHasher::new();
    file.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

#[cfg(test)]
pub(crate) mod tests {
    use std::collections::BTreeSet;

    use super::*;
    use crate::{
        anchor::{AnchorState, Sent, Target, Verdict},
        base::RefKind,
        diff::{
            Side,
            tests::{add, text_file},
        },
        repository::{Head, NewSide, OnChange, WatchGuard},
    };

    /// A repository with these changes, whose every blob is `one\r\ntwo\nthree\nfour`.
    pub(crate) struct Fixed(pub(crate) Vec<FileDiff>);

    impl Repository for Fixed {
        fn checkout(&self) -> Result<Checkout, RepoError> {
            Ok(Checkout {
                name: "drive-web".into(),
                root: "/code/drive-web".into(),
                head: Head::Branch {
                    name: "agent/x".into(),
                },
                commit: Some("abc".into()),
            })
        }
        fn refs(&self) -> Result<Vec<BaseRef>, RepoError> {
            Ok(vec![BaseRef {
                name: "main".into(),
                kind: RefKind::Branch,
                behind: None,
            }])
        }
        fn remote_default(&self) -> Result<Option<String>, RepoError> {
            Ok(None)
        }
        fn changes(&self, base: &Base) -> Result<Changes, RepoError> {
            match base {
                Base::Ref { name } if name == "nope" => {
                    Err(RepoError::UnknownBase { name: name.clone() })
                }
                _ => Ok(Changes {
                    snapshot: Snapshot {
                        old: None,
                        new: NewSide::WorkingTree,
                    },
                    files: self.0.clone(),
                }),
            }
        }
        fn changes_in(&self, base: &Base, paths: &BTreeSet<String>) -> Result<Changes, RepoError> {
            let mut changes = self.changes(base)?;
            changes.files.retain(|f| paths.contains(&f.path));
            Ok(changes)
        }
        fn fingerprint(&self, _: &Base) -> Result<String, RepoError> {
            Ok("f1".into())
        }
        /// States that see each file's path and status, not its lines, so a
        /// test can tell a file read again from one kept.
        fn file_states(&self, _: &Base) -> Result<FileStates, RepoError> {
            let files = self
                .0
                .iter()
                .map(|f| {
                    let mut hasher = DefaultHasher::new();
                    f.status.hash(&mut hasher);
                    (f.path.clone(), hasher.finish())
                })
                .collect();
            Ok(FileStates {
                snapshot: self.changes(&Base::Uncommitted)?.snapshot,
                files,
            })
        }
        fn blob(&self, _: &Snapshot, _: Side, _: &str) -> Result<Vec<u8>, RepoError> {
            Ok(b"one\r\ntwo\nthree\nfour".to_vec())
        }
        fn commits_between(&self, _: &str, _: &str) -> Result<Option<u32>, RepoError> {
            Ok(Some(0))
        }
        fn uncommitted_files(&self) -> Result<u32, RepoError> {
            Ok(0)
        }
        fn watch(&self, _: OnChange) -> Result<WatchGuard, RepoError> {
            Ok(Box::new(()))
        }
    }

    #[test]
    fn load_moves_comments_onto_their_code() {
        let repo = Fixed(vec![
            text_file("src/a.test.ts", vec![]),
            text_file("src/a.ts", vec![add(1, "new"), add(2, "x")]),
        ]);
        let comment = Comment {
            id: "c".into(),
            path: "src/a.ts".into(),
            target: Target::Lines {
                side: Side::New,
                start: 1,
                code: vec!["x".into()],
            },
            text: "t".into(),
            suggestion: None,
            state: AnchorState::Current,
            place: None,
            sent: None,
            resolved: None,
        };
        let (review, _) = load(&repo, Base::Uncommitted, vec![comment], vec![], None).unwrap();
        assert_eq!(review.fingerprint.as_deref(), Some("f1"));
        assert!(matches!(
            review.comments[0].target,
            Target::Lines { start: 2, .. }
        ));
    }

    #[test]
    fn load_judges_a_round_sent_on_uncommitted_changes_only_at_or_against_its_commit() {
        let repo = Fixed(vec![text_file("a.ts", vec![add(1, "x")])]);
        let target = Target::Lines {
            side: Side::New,
            start: 1,
            code: vec!["x".into()],
        };
        let place = Place {
            base: Base::Uncommitted,
            head: Head::Branch {
                name: "agent/x".into(),
            },
        };
        // Sent at `old`; the repository's `HEAD` is `abc`, a commit on top.
        let comment = Comment {
            id: "c".into(),
            path: "a.ts".into(),
            target: target.clone(),
            text: "t".into(),
            suggestion: None,
            state: AnchorState::Current,
            place: Some(place.clone()),
            sent: Some(Sent {
                round: 1,
                place,
                commit: Some("old".into()),
                target,
                before: vec![],
                after: vec![],
                text: "t".into(),
                suggestion: None,
                verdict: Some(Verdict::Untouched),
            }),
            resolved: None,
        };
        let verdict = |base: Base| {
            let (review, _) = load(&repo, base, vec![comment.clone()], vec![], None).unwrap();
            review.comments[0].sent.as_ref().unwrap().verdict
        };
        assert_eq!(verdict(Base::Uncommitted), None);
        assert_eq!(
            verdict(Base::Ref { name: "old".into() }),
            Some(Verdict::Untouched)
        );
    }

    #[test]
    fn a_load_with_no_watch_reads_again_only_the_files_whose_state_changed() {
        let first = Fixed(vec![
            text_file("a.ts", vec![add(1, "x")]),
            text_file("b.ts", vec![add(1, "y")]),
        ]);
        let (_, loaded) = load_polled(&first, Base::Uncommitted, vec![], vec![], None).unwrap();
        // `a.ts` edited in a way its state does not show; `b.ts` gone, `c.ts` new.
        let then = Fixed(vec![
            text_file("a.ts", vec![add(1, "edited")]),
            text_file("c.ts", vec![add(1, "z")]),
        ]);
        let (review, _) =
            load_polled(&then, Base::Uncommitted, vec![], vec![], Some(loaded)).unwrap();
        let paths: Vec<_> = review
            .files
            .iter()
            .map(|f| match f {
                ReviewFile::Changed { diff, .. } => diff.path.as_str(),
                ReviewFile::Unchanged { path, .. } => path.as_str(),
            })
            .collect();
        assert_eq!(paths, ["a.ts", "c.ts"]);
        let ReviewFile::Changed { diff, .. } = &review.files[0] else {
            panic!("a.ts is sent");
        };
        assert_eq!(
            diff,
            &text_file("a.ts", vec![add(1, "x")]),
            "kept, not read again"
        );
        let states = then.file_states(&Base::Uncommitted).unwrap();
        assert_eq!(review.fingerprint, Some(states.fingerprint()));
    }

    #[test]
    fn load_sends_only_files_the_caller_lacks_or_holds_stale() {
        let repo = Fixed(vec![
            text_file("a.ts", vec![add(1, "a")]),
            text_file("b.ts", vec![add(1, "b")]),
        ]);
        let (first, _) = load(&repo, Base::Uncommitted, vec![], vec![], None).unwrap();
        let known: Vec<KnownFile> = first
            .files
            .iter()
            .map(|f| match f {
                ReviewFile::Changed { signature, diff } => KnownFile {
                    path: diff.path.clone(),
                    signature: signature.clone(),
                },
                ReviewFile::Unchanged { .. } => panic!("nothing was known yet"),
            })
            .collect();
        let edited = Fixed(vec![
            text_file("a.ts", vec![add(1, "a")]),
            text_file("b.ts", vec![add(1, "B")]),
        ]);
        let (second, _) = load(&edited, Base::Uncommitted, vec![], known, None).unwrap();
        assert!(matches!(&second.files[0], ReviewFile::Unchanged { path, .. } if path == "a.ts"));
        assert!(
            matches!(&second.files[1], ReviewFile::Changed { diff, .. } if diff.path == "b.ts")
        );
    }

    #[test]
    fn open_starts_from_the_default_base() {
        let opening = open(&Fixed(vec![])).unwrap();
        assert_eq!(
            opening.base,
            Base::Ref {
                name: "main".into()
            }
        );
        assert_eq!(opening.refs.len(), 1);
    }

    #[test]
    fn load_reports_an_unknown_base() {
        let error = load(
            &Fixed(vec![]),
            Base::Ref {
                name: "nope".into(),
            },
            vec![],
            vec![],
            None,
        )
        .unwrap_err();
        assert_eq!(
            error,
            RepoError::UnknownBase {
                name: "nope".into()
            }
        );
    }

    #[test]
    fn a_load_since_the_last_reads_only_what_was_touched() {
        let before = Fixed(vec![
            text_file("a.ts", vec![add(1, "a")]),
            text_file("b.ts", vec![add(1, "b")]),
        ]);
        let (_, loaded) = load(&before, Base::Uncommitted, vec![], vec![], None).unwrap();
        let after = Fixed(vec![
            text_file("a.ts", vec![add(1, "A")]),
            text_file("b.ts", vec![add(1, "B")]),
        ]);
        let touched = Touched::Paths(["a.ts".to_owned()].into());
        let (review, _) = load(
            &after,
            Base::Uncommitted,
            vec![],
            vec![],
            Some((loaded, touched)),
        )
        .unwrap();
        assert_eq!(review.fingerprint, None);
        let texts: Vec<&str> = review
            .files
            .iter()
            .map(|f| match f {
                ReviewFile::Changed { diff, .. } => diff.lines(Side::New).next().unwrap().1,
                ReviewFile::Unchanged { .. } => panic!("nothing was known"),
            })
            .collect();
        assert_eq!(texts, ["A", "b"]);
    }

    #[test]
    fn a_file_not_read_again_keeps_its_signature() {
        let repo = Fixed(vec![
            text_file("a.ts", vec![add(1, "a")]),
            text_file("b.ts", vec![add(1, "b")]),
        ]);
        let (_, mut loaded) = load(&repo, Base::Uncommitted, vec![], vec![], None).unwrap();
        let computed = loaded.signatures["a.ts"].clone();
        loaded.signatures.insert("a.ts".into(), "held a".into());
        loaded.signatures.insert("b.ts".into(), "held b".into());
        let touched = Touched::Paths(["a.ts".to_owned()].into());
        let (review, _) = load(
            &repo,
            Base::Uncommitted,
            vec![],
            vec![],
            Some((loaded, touched)),
        )
        .unwrap();
        let signatures: Vec<&str> = review
            .files
            .iter()
            .map(|f| match f {
                ReviewFile::Changed { signature, .. } | ReviewFile::Unchanged { signature, .. } => {
                    signature.as_str()
                }
            })
            .collect();
        assert_eq!(signatures, [computed.as_str(), "held b"]);
    }

    #[test]
    fn a_load_against_another_base_reads_everything() {
        let repo = Fixed(vec![text_file("a.ts", vec![add(1, "a")])]);
        let (_, loaded) = load(&repo, Base::LastCommit, vec![], vec![], None).unwrap();
        let since = Some((loaded, Touched::default()));
        let (review, _) = load(&repo, Base::Uncommitted, vec![], vec![], since).unwrap();
        assert_eq!(review.fingerprint.as_deref(), Some("f1"));
        assert_eq!(review.files.len(), 1);
    }
}
