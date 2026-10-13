//! Loading a checkout for review.

use std::{
    collections::{HashMap, hash_map::DefaultHasher},
    hash::{Hash, Hasher},
};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{
    anchor::{Comment, reanchor},
    base::{Base, BaseRef, default_base},
    diff::FileDiff,
    repository::{Checkout, RepoError, Repository, Snapshot},
    role::{FileGroup, group},
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
    /// [`Repository::fingerprint`] for `base`, taken before `files`.
    pub fingerprint: String,
    /// The two trees compared, for [`Repository::blob`].
    pub snapshot: Snapshot,
    /// Every changed file, in path order; in full only where the caller's
    /// copy is missing or stale.
    pub files: Vec<ReviewFile>,
    /// `files` by role.
    pub groups: Vec<FileGroup>,
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

/// The checkout's changes against `base`, with `comments` moved onto their
/// code (see [`reanchor`]). Files whose version matches one in `known` are
/// named, not sent.
///
/// # Errors
/// As [`Repository::checkout`] and [`Repository::changes`].
pub fn load(
    repository: &(impl Repository + ?Sized),
    base: Base,
    comments: Vec<Comment>,
    known: Vec<KnownFile>,
) -> Result<Review, RepoError> {
    let checkout = repository.checkout()?;
    // Taken first: a change landing between the two shows as a newer fingerprint
    // on the next poll, never as a missed one.
    let fingerprint = repository.fingerprint(&base)?;
    let changes = repository.changes(&base)?;
    let groups = group(&changes.files);
    let comments = comments
        .into_iter()
        .map(|c| reanchor(c, &changes.files))
        .collect();
    let known: HashMap<String, String> = known.into_iter().map(|k| (k.path, k.signature)).collect();
    let files = changes
        .files
        .into_iter()
        .map(|diff| {
            let signature = signature(&diff);
            if known.get(&diff.path) == Some(&signature) {
                ReviewFile::Unchanged {
                    path: diff.path,
                    signature,
                }
            } else {
                ReviewFile::Changed { signature, diff }
            }
        })
        .collect();
    Ok(Review {
        checkout,
        base,
        fingerprint,
        snapshot: changes.snapshot,
        files,
        groups,
        comments,
    })
}

/// Identifies a version of `file` within one run of the app: `DefaultHasher`
/// is not stable across Rust versions, and signatures are never stored.
fn signature(file: &FileDiff) -> String {
    let mut hasher = DefaultHasher::new();
    file.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        anchor::{AnchorState, Target},
        base::RefKind,
        diff::{
            Side,
            tests::{add, text_file},
        },
        repository::{Changes, Head, NewSide, OnChange, WatchGuard},
        role::Role,
    };

    struct Fixed(Vec<FileDiff>);

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
        fn fingerprint(&self, _: &Base) -> Result<String, RepoError> {
            Ok("f1".into())
        }
        fn blob(&self, _: &Snapshot, _: Side, _: &str) -> Result<Vec<u8>, RepoError> {
            Ok(vec![])
        }
        fn commits_between(&self, _: &str, _: &str) -> Result<Option<u32>, RepoError> {
            Ok(Some(0))
        }
        fn watch(&self, _: OnChange) -> Result<WatchGuard, RepoError> {
            Ok(Box::new(()))
        }
    }

    #[test]
    fn load_groups_files_and_moves_comments_onto_their_code() {
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
        };
        let review = load(&repo, Base::Uncommitted, vec![comment], vec![]).unwrap();
        assert_eq!(review.fingerprint, "f1");
        assert_eq!(
            review.groups.iter().map(|g| g.role).collect::<Vec<_>>(),
            [Role::Source, Role::Tests]
        );
        assert!(matches!(
            review.comments[0].target,
            Target::Lines { start: 2, .. }
        ));
    }

    #[test]
    fn load_sends_only_files_the_caller_lacks_or_holds_stale() {
        let repo = Fixed(vec![
            text_file("a.ts", vec![add(1, "a")]),
            text_file("b.ts", vec![add(1, "b")]),
        ]);
        let first = load(&repo, Base::Uncommitted, vec![], vec![]).unwrap();
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
        let second = load(&edited, Base::Uncommitted, vec![], known).unwrap();
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
        )
        .unwrap_err();
        assert_eq!(
            error,
            RepoError::UnknownBase {
                name: "nope".into()
            }
        );
    }
}
