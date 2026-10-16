//! [`ReviewStore`] as one JSON file in the app's data directory (ADR 0004).

use std::{
    collections::BTreeMap,
    error::Error,
    fs, io,
    path::{Path, PathBuf},
    sync::Mutex,
};

use diff_loop_core::{ReviewStore, SavedReview, StoreError};
use serde::{Deserialize, Serialize};

use crate::lock;

/// The format [`JsonReviews`] writes (ADR 0015 §9). It also reads
/// [`EARLIER`]; a file with any other version is refused, never overwritten
/// (ADR 0004 §3).
const VERSION: u32 = 2;

/// The format before rounds (ADR 0004 §3): its comments read as drafts, and
/// the file is written back as [`VERSION`] at the next save.
const EARLIER: u32 = 1;

/// The file's contents.
#[derive(Debug, Serialize, Deserialize)]
struct Kept {
    version: u32,
    /// By working-tree root; a `BTreeMap`, so rewriting the file reorders nothing.
    reviews: BTreeMap<String, SavedReview>,
}

/// Just the version, read before the rest so a newer format is named as such.
#[derive(Deserialize)]
struct Version {
    version: u32,
}

/// Reviews kept in one JSON file.
#[derive(Debug)]
pub(crate) struct JsonReviews {
    path: PathBuf,
    /// Held across each read-modify-write in [`ReviewStore::save`].
    writing: Mutex<()>,
}

impl JsonReviews {
    pub(crate) fn new(path: PathBuf) -> Self {
        Self {
            path,
            writing: Mutex::new(()),
        }
    }

    /// What the file holds; nothing when it does not exist yet.
    fn read(&self) -> Result<Kept, StoreError> {
        let bytes = match fs::read(&self.path) {
            Ok(bytes) => bytes,
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                return Ok(Kept {
                    version: VERSION,
                    reviews: BTreeMap::new(),
                });
            }
            Err(e) => return Err(failed(&self.path, &e)),
        };
        let unreadable = |e: serde_json::Error| failed(&self.path, &e);
        let Version { version } = serde_json::from_slice(&bytes).map_err(unreadable)?;
        if version != VERSION && version != EARLIER {
            return Err(StoreError::Failed {
                message: format!(
                    "{} was written by another version of Diff Loop (format {version})",
                    self.path.display()
                ),
            });
        }
        let kept: Kept = serde_json::from_slice(&bytes).map_err(unreadable)?;
        Ok(Kept {
            version: VERSION,
            ..kept
        })
    }

    /// Replaces the file whole: written beside it, then renamed over it, so
    /// a crash mid-write leaves the old file.
    fn write(&self, kept: &Kept) -> Result<(), StoreError> {
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir).map_err(|e| failed(dir, &e))?;
        }
        let json = serde_json::to_vec_pretty(kept).map_err(|e| failed(&self.path, &e))?;
        let next = self.path.with_extension("json.next");
        fs::write(&next, json).map_err(|e| failed(&next, &e))?;
        fs::rename(&next, &self.path).map_err(|e| failed(&self.path, &e))
    }
}

impl ReviewStore for JsonReviews {
    fn saved(&self, root: &str) -> Result<SavedReview, StoreError> {
        Ok(self.read()?.reviews.remove(root).unwrap_or_default())
    }

    fn save(&self, root: &str, review: &SavedReview) -> Result<(), StoreError> {
        let _writing = lock(&self.writing);
        let mut kept = self.read()?;
        if review.is_empty() {
            kept.reviews.remove(root);
        } else {
            kept.reviews.insert(root.to_owned(), review.clone());
        }
        self.write(&kept)
    }
}

/// The one way this module reports a failed file operation: with its path.
fn failed(path: &Path, error: &dyn Error) -> StoreError {
    StoreError::Failed {
        message: format!("{}: {error}", path.display()),
    }
}

#[cfg(test)]
mod tests {
    use diff_loop_core::{AnchorState, Comment, Target};
    use tempfile::TempDir;

    use super::*;

    fn reviews(dir: &TempDir) -> JsonReviews {
        JsonReviews::new(dir.path().join("data").join("reviews.json"))
    }

    fn with_comment(text: &str) -> SavedReview {
        SavedReview {
            comments: vec![Comment {
                id: "c".into(),
                path: "a.ts".into(),
                target: Target::File,
                text: text.into(),
                suggestion: None,
                state: AnchorState::Current,
                place: None,
                sent: None,
                resolved: None,
            }],
            rounds: vec![],
        }
    }

    #[test]
    fn nothing_saved_reads_as_an_empty_review() {
        let dir = TempDir::new().unwrap();
        assert_eq!(reviews(&dir).saved("/r").unwrap(), SavedReview::default());
    }

    #[test]
    fn a_saved_review_reads_back_per_root() {
        let dir = TempDir::new().unwrap();
        let store = reviews(&dir);
        store.save("/a", &with_comment("one")).unwrap();
        store.save("/b", &with_comment("two")).unwrap();
        assert_eq!(store.saved("/a").unwrap(), with_comment("one"));
        assert_eq!(reviews(&dir).saved("/b").unwrap(), with_comment("two"));
    }

    #[test]
    fn a_note_kept_by_an_earlier_version_is_ignored() {
        let dir = TempDir::new().unwrap();
        let store = reviews(&dir);
        fs::create_dir_all(store.path.parent().unwrap()).unwrap();
        let earlier = r#"{"version":1,"reviews":{"/a":{"comments":[],"note":"Keep it small."}}}"#;
        fs::write(&store.path, earlier).unwrap();
        assert_eq!(store.saved("/a").unwrap(), SavedReview::default());
    }

    #[test]
    fn an_earlier_format_reads_its_comments_as_drafts_and_is_written_back_as_the_current_one() {
        let dir = TempDir::new().unwrap();
        let store = reviews(&dir);
        fs::create_dir_all(store.path.parent().unwrap()).unwrap();
        let earlier = r#"{"version":1,"reviews":{"/a":{"comments":[{"id":"c","path":"a.ts","target":{"kind":"file"},"text":"one","suggestion":null,"state":"current"}]}}}"#;
        fs::write(&store.path, earlier).unwrap();
        assert_eq!(store.saved("/a").unwrap(), with_comment("one"));
        store.save("/b", &with_comment("two")).unwrap();
        let written: serde_json::Value =
            serde_json::from_slice(&fs::read(&store.path).unwrap()).unwrap();
        assert_eq!(written["version"], 2);
        assert_eq!(store.saved("/a").unwrap(), with_comment("one"));
    }

    #[test]
    fn saving_an_empty_review_removes_it() {
        let dir = TempDir::new().unwrap();
        let store = reviews(&dir);
        store.save("/a", &with_comment("one")).unwrap();
        store.save("/a", &SavedReview::default()).unwrap();
        let kept = store.read().unwrap();
        assert!(kept.reviews.is_empty());
    }

    #[test]
    fn a_file_that_cannot_be_read_is_reported_and_left_alone() {
        let dir = TempDir::new().unwrap();
        let store = reviews(&dir);
        fs::create_dir_all(store.path.parent().unwrap()).unwrap();
        fs::write(&store.path, "not json").unwrap();
        assert!(matches!(store.saved("/a"), Err(StoreError::Failed { .. })));
        assert!(store.save("/a", &with_comment("one")).is_err());
        assert_eq!(fs::read_to_string(&store.path).unwrap(), "not json");
    }

    #[test]
    fn a_newer_format_is_refused_and_left_alone() {
        let dir = TempDir::new().unwrap();
        let store = reviews(&dir);
        fs::create_dir_all(store.path.parent().unwrap()).unwrap();
        let newer = r#"{"version":3,"reviews":"elsewhere"}"#;
        fs::write(&store.path, newer).unwrap();
        let Err(StoreError::Failed { message }) = store.saved("/a") else {
            panic!("a newer format was read");
        };
        assert!(message.contains("another version"), "{message}");
        assert!(store.save("/a", &with_comment("one")).is_err());
        assert_eq!(fs::read_to_string(&store.path).unwrap(), newer);
    }
}
