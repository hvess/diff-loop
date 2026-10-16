//! [`ReviewStore`] as one JSON file in the app's data directory (ADR 0004).

use std::{
    collections::{BTreeMap, HashSet},
    error::Error,
    fs, io,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use diff_loop_core::{ReviewStore, SavedReview, StoreError};
use serde::{Deserialize, Serialize};

/// The format [`JsonReviews`] writes (ADR 0020 §1). It also reads
/// [`EARLIER`]; a file with any other version is refused, never overwritten
/// (ADR 0004 §3).
const VERSION: u32 = 3;

/// The formats before: 1 without rounds, whose comments read as drafts
/// (ADR 0015 §9), and 2 without when each tree was last seen. The file is
/// written back as [`VERSION`] at the next save.
const EARLIER: [u32; 2] = [1, 2];

/// How long a review is kept once its working tree is gone: long enough for
/// a drive or share that is away for a while (ADR 0020 §2).
const KEPT_MISSING: Duration = Duration::from_secs(30 * 24 * 60 * 60);

/// The file's contents.
#[derive(Debug, Serialize, Deserialize)]
struct Kept {
    version: u32,
    /// By working-tree root; a `BTreeMap`, so rewriting the file reorders nothing.
    reviews: BTreeMap<String, Entry>,
}

/// One working tree's review, and when its tree was last seen.
#[derive(Debug, Serialize, Deserialize)]
struct Entry {
    #[serde(flatten)]
    review: SavedReview,
    /// Milliseconds since the Unix epoch; absent in an earlier format, when
    /// the next save counts it as seen then.
    #[serde(default)]
    seen: Option<u64>,
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
}

impl JsonReviews {
    pub(crate) fn new(path: PathBuf) -> Self {
        Self { path }
    }

    /// The file beside the reviews that every instance locks around a save;
    /// unlocked when the returned handle drops.
    fn lock_file(&self) -> Result<fs::File, StoreError> {
        let path = self.path.with_extension("json.lock");
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir).map_err(|e| failed(dir, &e))?;
        }
        let file = fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(&path)
            .map_err(|e| failed(&path, &e))?;
        file.lock().map_err(|e| failed(&path, &e))?;
        Ok(file)
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
        if version != VERSION && !EARLIER.contains(&version) {
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
        Ok(self
            .read()?
            .reviews
            .remove(root)
            .map(|entry| entry.review)
            .unwrap_or_default())
    }

    fn save(&self, root: &str, review: &SavedReview) -> Result<(), StoreError> {
        // Which trees are there, found before the lock: a share that hangs
        // must not hold up another instance's save.
        let mut present: HashSet<String> = self
            .read()?
            .reviews
            .into_keys()
            .filter(|root| Path::new(root).is_dir())
            .collect();
        present.insert(root.to_owned());
        // Every save, in this instance or another, takes its turn on the file
        // (ADR 0020 §3).
        let _file = self.lock_file()?;
        let mut kept = self.read()?;
        if review.is_empty() {
            kept.reviews.remove(root);
        } else {
            kept.reviews.insert(
                root.to_owned(),
                Entry {
                    review: review.clone(),
                    seen: None,
                },
            );
        }
        prune(&mut kept, millis(SystemTime::now()), |root| {
            present.contains(root)
        });
        self.write(&kept)
    }
}

/// `kept` with each tree `exists` says is there, and each not seen yet,
/// marked seen at `now`, and each one missing for longer than
/// [`KEPT_MISSING`] dropped (ADR 0020 §2). O(reviews) checks.
fn prune(kept: &mut Kept, now: u64, exists: impl Fn(&str) -> bool) {
    let limit = u64::try_from(KEPT_MISSING.as_millis()).unwrap_or(u64::MAX);
    kept.reviews.retain(|root, entry| {
        if exists(root) || entry.seen.is_none() {
            entry.seen = Some(now);
        }
        entry
            .seen
            .is_some_and(|seen| now.saturating_sub(seen) <= limit)
    });
}

/// `at` in milliseconds since the Unix epoch.
fn millis(at: SystemTime) -> u64 {
    at.duration_since(UNIX_EPOCH).map_or(0, |since| {
        u64::try_from(since.as_millis()).unwrap_or(u64::MAX)
    })
}

/// The one way this module reports a failed file operation: with its path.
fn failed(path: &Path, error: &dyn Error) -> StoreError {
    StoreError::Failed {
        message: format!("{}: {error}", path.display()),
    }
}

#[cfg(test)]
mod tests {
    use std::thread;

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
        assert_eq!(written["version"], 3);
        assert_eq!(store.saved("/a").unwrap(), with_comment("one"));
    }

    #[test]
    fn a_version_2_file_is_read_and_written_back_as_the_current_one() {
        let dir = TempDir::new().unwrap();
        let store = reviews(&dir);
        fs::create_dir_all(store.path.parent().unwrap()).unwrap();
        let earlier = r#"{"version":2,"reviews":{"/a":{"comments":[{"id":"c","path":"a.ts","target":{"kind":"file"},"text":"one","suggestion":null,"state":"current","place":null,"sent":null,"resolved":null}],"rounds":[]}}}"#;
        fs::write(&store.path, earlier).unwrap();
        assert_eq!(store.saved("/a").unwrap(), with_comment("one"));
        store.save("/b", &with_comment("two")).unwrap();
        let kept = store.read().unwrap();
        assert!(
            kept.reviews["/a"].seen.is_some(),
            "counted as seen at the save"
        );
        let written: serde_json::Value =
            serde_json::from_slice(&fs::read(&store.path).unwrap()).unwrap();
        assert_eq!(written["version"], 3);
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

    const DAY: u64 = 24 * 60 * 60 * 1000;

    fn entry(seen: Option<u64>) -> Entry {
        Entry {
            review: with_comment("one"),
            seen,
        }
    }

    #[test]
    fn a_tree_seen_is_marked_and_one_missing_past_thirty_days_is_dropped() {
        let mut kept = Kept {
            version: VERSION,
            reviews: BTreeMap::from([
                ("/here".into(), entry(Some(0))),
                ("/away".into(), entry(Some(40 * DAY - 30 * DAY))),
                ("/gone".into(), entry(Some(0))),
                ("/earlier".into(), entry(None)),
            ]),
        };
        prune(&mut kept, 40 * DAY, |root| root == "/here");
        let seen: Vec<_> = kept
            .reviews
            .iter()
            .map(|(root, e)| (root.as_str(), e.seen))
            .collect();
        assert_eq!(
            seen,
            [
                ("/away", Some(10 * DAY)),
                ("/earlier", Some(40 * DAY)),
                ("/here", Some(40 * DAY)),
            ]
        );
    }

    #[test]
    fn a_saved_review_records_when_its_tree_was_seen() {
        let dir = TempDir::new().unwrap();
        let store = reviews(&dir);
        let root = dir.path().to_str().unwrap();
        store.save(root, &with_comment("one")).unwrap();
        let kept = store.read().unwrap();
        assert!(kept.reviews[root].seen.is_some());
        assert_eq!(store.saved(root).unwrap(), with_comment("one"));
    }

    #[test]
    fn two_instances_saving_at_once_keep_each_others_reviews() {
        let dir = TempDir::new().unwrap();
        let roots: Vec<String> = (0..2)
            .map(|i| dir.path().join(format!("tree{i}")))
            .inspect(|tree| fs::create_dir_all(tree).unwrap())
            .map(|tree| tree.to_string_lossy().into_owned())
            .collect();
        thread::scope(|scope| {
            for root in &roots {
                // Each its own store, as each running app has.
                let store = reviews(&dir);
                scope.spawn(move || {
                    for i in 0..50 {
                        store.save(root, &with_comment(&i.to_string())).unwrap();
                    }
                });
            }
        });
        for root in &roots {
            assert_eq!(reviews(&dir).saved(root).unwrap(), with_comment("49"));
        }
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
        let newer = r#"{"version":4,"reviews":"elsewhere"}"#;
        fs::write(&store.path, newer).unwrap();
        let Err(StoreError::Failed { message }) = store.saved("/a") else {
            panic!("a newer format was read");
        };
        assert!(message.contains("another version"), "{message}");
        assert!(store.save("/a", &with_comment("one")).is_err());
        assert_eq!(fs::read_to_string(&store.path).unwrap(), newer);
    }
}
