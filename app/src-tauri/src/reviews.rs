//! [`ReviewStore`] as one JSON file in the app's data directory (ADR 0004).

use std::{
    collections::{BTreeMap, HashSet},
    error::Error,
    fs, io,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use diff_loop_core::{ReviewKey, ReviewStore, SavedReview, StoreError};
use serde::{Deserialize, Serialize};

/// The format [`JsonReviews`] writes (ADR 0026 §8): reviews by project, then
/// by branch. It also reads [`EARLIER`]; a file with any other version is
/// refused, never overwritten (ADR 0004 §3).
const VERSION: u32 = 4;

/// The formats before, kept by working tree, which say nothing of a branch:
/// read as holding no review, and written back as [`VERSION`] at the next
/// save, so their reviews are dropped (ADR 0026 §8).
const EARLIER: [u32; 3] = [1, 2, 3];

/// How long a project's reviews are kept once its git directory is gone:
/// long enough for a drive or share that is away for a while (ADR 0020 §2).
const KEPT_MISSING: Duration = Duration::from_secs(30 * 24 * 60 * 60);

/// The file's contents.
#[derive(Debug, Serialize, Deserialize)]
struct Kept {
    version: u32,
    /// By project, as [`ReviewKey::project`]; `BTreeMap`s, so rewriting the
    /// file reorders nothing.
    projects: BTreeMap<String, Entry>,
}

/// One project's reviews, and when its git directory was last seen.
#[derive(Debug, Default, Serialize, Deserialize)]
struct Entry {
    /// By branch, as [`ReviewKey::branch`].
    reviews: BTreeMap<String, SavedReview>,
    /// Milliseconds since the Unix epoch; `None` until a save first finds it.
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
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Kept::empty()),
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
        if EARLIER.contains(&version) {
            return Ok(Kept::empty());
        }
        serde_json::from_slice(&bytes).map_err(unreadable)
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

impl Kept {
    fn empty() -> Self {
        Self {
            version: VERSION,
            projects: BTreeMap::new(),
        }
    }
}

impl ReviewStore for JsonReviews {
    fn saved(&self, key: &ReviewKey) -> Result<SavedReview, StoreError> {
        Ok(self
            .read()?
            .projects
            .remove(&key.project)
            .and_then(|mut entry| entry.reviews.remove(&key.branch))
            .unwrap_or_default())
    }

    fn save(&self, key: &ReviewKey, review: &SavedReview) -> Result<(), StoreError> {
        // Which projects are there, found before the lock: a share that hangs
        // must not hold up another instance's save.
        let mut present: HashSet<String> = self
            .read()?
            .projects
            .into_keys()
            .filter(|project| Path::new(project).is_dir())
            .collect();
        present.insert(key.project.clone());
        // Every save, in this instance or another, takes its turn on the file
        // (ADR 0020 §3).
        let _file = self.lock_file()?;
        let mut kept = self.read()?;
        let entry = kept.projects.entry(key.project.clone()).or_default();
        if review.is_empty() {
            entry.reviews.remove(&key.branch);
        } else {
            entry.reviews.insert(key.branch.clone(), review.clone());
        }
        prune(&mut kept, millis(SystemTime::now()), |project| {
            present.contains(project)
        });
        self.write(&kept)
    }

    fn kept(&self) -> Result<Vec<(ReviewKey, SavedReview)>, StoreError> {
        Ok(self
            .read()?
            .projects
            .into_iter()
            .flat_map(|(project, entry)| {
                entry.reviews.into_iter().map(move |(branch, review)| {
                    (
                        ReviewKey {
                            project: project.clone(),
                            branch,
                        },
                        review,
                    )
                })
            })
            .collect())
    }
}

/// `kept` with each project `exists` says is there, and each not seen yet,
/// marked seen at `now`; each one missing for longer than [`KEPT_MISSING`],
/// and each with no review left, dropped (ADR 0020 §2). O(projects) checks.
fn prune(kept: &mut Kept, now: u64, exists: impl Fn(&str) -> bool) {
    let limit = u64::try_from(KEPT_MISSING.as_millis()).unwrap_or(u64::MAX);
    kept.projects.retain(|project, entry| {
        if exists(project) || entry.seen.is_none() {
            entry.seen = Some(now);
        }
        !entry.reviews.is_empty()
            && entry
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

    fn key(project: &str, branch: &str) -> ReviewKey {
        ReviewKey {
            project: project.into(),
            branch: branch.into(),
        }
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
            ..SavedReview::default()
        }
    }

    #[test]
    fn nothing_saved_reads_as_an_empty_review() {
        let dir = TempDir::new().unwrap();
        assert_eq!(
            reviews(&dir).saved(&key("/p", "b")).unwrap(),
            SavedReview::default()
        );
        assert!(reviews(&dir).kept().unwrap().is_empty());
    }

    #[test]
    fn a_saved_review_reads_back_per_project_and_branch() {
        let dir = TempDir::new().unwrap();
        let store = reviews(&dir);
        store.save(&key("/p", "a"), &with_comment("one")).unwrap();
        store.save(&key("/p", "b"), &with_comment("two")).unwrap();
        store.save(&key("/q", "a"), &with_comment("three")).unwrap();
        assert_eq!(store.saved(&key("/p", "a")).unwrap(), with_comment("one"));
        assert_eq!(
            reviews(&dir).saved(&key("/p", "b")).unwrap(),
            with_comment("two")
        );
        assert_eq!(store.saved(&key("/q", "a")).unwrap(), with_comment("three"));
        let kept: Vec<ReviewKey> = store.kept().unwrap().into_iter().map(|(k, _)| k).collect();
        assert_eq!(kept, [key("/p", "a"), key("/p", "b"), key("/q", "a")]);
    }

    #[test]
    fn an_earlier_format_kept_by_working_tree_is_dropped_at_the_next_save() {
        for earlier in [
            r#"{"version":1,"reviews":{"/a":{"comments":[],"note":"Keep it small."}}}"#,
            r#"{"version":2,"reviews":{"/a":{"comments":[],"rounds":[]}}}"#,
            r#"{"version":3,"reviews":{"/a":{"comments":[],"rounds":[],"seen":1}}}"#,
        ] {
            let dir = TempDir::new().unwrap();
            let store = reviews(&dir);
            fs::create_dir_all(store.path.parent().unwrap()).unwrap();
            fs::write(&store.path, earlier).unwrap();
            assert!(store.kept().unwrap().is_empty(), "{earlier}");
            store.save(&key("/p", "b"), &with_comment("two")).unwrap();
            let written: serde_json::Value =
                serde_json::from_slice(&fs::read(&store.path).unwrap()).unwrap();
            assert_eq!(written["version"], 4);
            assert_eq!(store.kept().unwrap().len(), 1);
        }
    }

    #[test]
    fn saving_an_empty_review_removes_it_and_its_project_with_no_other() {
        let dir = TempDir::new().unwrap();
        let store = reviews(&dir);
        store.save(&key("/p", "a"), &with_comment("one")).unwrap();
        store.save(&key("/p", "b"), &with_comment("two")).unwrap();
        store
            .save(&key("/p", "a"), &SavedReview::default())
            .unwrap();
        assert_eq!(store.read().unwrap().projects["/p"].reviews.len(), 1);
        store
            .save(&key("/p", "b"), &SavedReview::default())
            .unwrap();
        assert!(store.read().unwrap().projects.is_empty());
    }

    const DAY: u64 = 24 * 60 * 60 * 1000;

    fn entry(seen: Option<u64>) -> Entry {
        Entry {
            reviews: BTreeMap::from([("b".to_owned(), with_comment("one"))]),
            seen,
        }
    }

    #[test]
    fn a_project_seen_is_marked_and_one_missing_past_thirty_days_is_dropped() {
        let mut kept = Kept {
            version: VERSION,
            projects: BTreeMap::from([
                ("/here".into(), entry(Some(0))),
                ("/away".into(), entry(Some(40 * DAY - 30 * DAY))),
                ("/gone".into(), entry(Some(0))),
                ("/new".into(), entry(None)),
            ]),
        };
        prune(&mut kept, 40 * DAY, |project| project == "/here");
        let seen: Vec<_> = kept
            .projects
            .iter()
            .map(|(project, e)| (project.as_str(), e.seen))
            .collect();
        assert_eq!(
            seen,
            [
                ("/away", Some(10 * DAY)),
                ("/here", Some(40 * DAY)),
                ("/new", Some(40 * DAY)),
            ]
        );
    }

    #[test]
    fn a_saved_review_records_when_its_project_was_seen() {
        let dir = TempDir::new().unwrap();
        let store = reviews(&dir);
        let project = dir.path().to_str().unwrap();
        store
            .save(&key(project, "b"), &with_comment("one"))
            .unwrap();
        assert!(store.read().unwrap().projects[project].seen.is_some());
        assert_eq!(
            store.saved(&key(project, "b")).unwrap(),
            with_comment("one")
        );
    }

    #[test]
    fn two_instances_saving_at_once_keep_each_others_reviews() {
        let dir = TempDir::new().unwrap();
        let projects: Vec<String> = (0..2)
            .map(|i| dir.path().join(format!("project{i}")))
            .inspect(|project| fs::create_dir_all(project).unwrap())
            .map(|project| project.to_string_lossy().into_owned())
            .collect();
        thread::scope(|scope| {
            for project in &projects {
                // Each its own store, as each running app has.
                let store = reviews(&dir);
                scope.spawn(move || {
                    for i in 0..50 {
                        store
                            .save(&key(project, "b"), &with_comment(&i.to_string()))
                            .unwrap();
                    }
                });
            }
        });
        for project in &projects {
            assert_eq!(
                reviews(&dir).saved(&key(project, "b")).unwrap(),
                with_comment("49")
            );
        }
    }

    #[test]
    fn a_file_that_cannot_be_read_is_reported_and_left_alone() {
        let dir = TempDir::new().unwrap();
        let store = reviews(&dir);
        fs::create_dir_all(store.path.parent().unwrap()).unwrap();
        fs::write(&store.path, "not json").unwrap();
        assert!(matches!(
            store.saved(&key("/p", "b")),
            Err(StoreError::Failed { .. })
        ));
        assert!(store.save(&key("/p", "b"), &with_comment("one")).is_err());
        assert_eq!(fs::read_to_string(&store.path).unwrap(), "not json");
    }

    #[test]
    fn a_newer_format_is_refused_and_left_alone() {
        let dir = TempDir::new().unwrap();
        let store = reviews(&dir);
        fs::create_dir_all(store.path.parent().unwrap()).unwrap();
        let newer = r#"{"version":5,"projects":"elsewhere"}"#;
        fs::write(&store.path, newer).unwrap();
        let Err(StoreError::Failed { message }) = store.saved(&key("/p", "b")) else {
            panic!("a newer format was read");
        };
        assert!(message.contains("another version"), "{message}");
        assert!(store.save(&key("/p", "b"), &with_comment("one")).is_err());
        assert_eq!(fs::read_to_string(&store.path).unwrap(), newer);
    }
}
