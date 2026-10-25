//! [`ReviewStore`] as a file per branch in each project's common git
//! directory (ADR 0030 §1), shared by every process that keeps reviews, with
//! the projects that hold one listed in the app's data directory (ADR 0031).

mod file;
mod name;
mod projects;

use std::{
    fs, io,
    path::{Path, PathBuf},
};

use diff_loop_core::{OWN_FOLDER, ReviewKey, ReviewStore, SavedReview, StoreError};
use serde::{Deserialize, Serialize};

use crate::{file::failed, projects::Projects};

/// The format a review file is written in, and the only one read (ADR 0030
/// §2, as ADR 0031 §1 builds it up).
const VERSION: u32 = 1;

/// The folder under [`OWN_FOLDER`] holding the review files.
const REVIEWS: &str = "reviews";

/// A review file's contents.
#[derive(Debug, Serialize, Deserialize)]
struct Kept {
    version: u32,
    /// As [`ReviewKey::branch`]; the file's name says it too, but two branches
    /// that differ only in case share a file where names ignore case.
    branch: String,
    #[serde(flatten)]
    review: SavedReview,
}

/// Reviews kept in the projects they belong to.
#[derive(Debug)]
pub struct FileReviews {
    projects: Projects,
}

impl FileReviews {
    /// Reviews whose projects are listed in the file `projects`.
    #[must_use]
    pub fn new(projects: PathBuf) -> Self {
        Self {
            projects: Projects::new(projects),
        }
    }
}

impl ReviewStore for FileReviews {
    fn saved(&self, key: &ReviewKey) -> Result<SavedReview, StoreError> {
        Ok(read(&reviews_in(&key.project), &key.branch)?.unwrap_or_default())
    }

    fn save(&self, key: &ReviewKey, review: &SavedReview) -> Result<(), StoreError> {
        let project = Path::new(&key.project);
        if !project.is_dir() {
            // Never create a git directory that is gone; an empty review has
            // nothing left there to remove. The list still drops it.
            self.projects.note(&key.project, || Ok(false))?;
            return if review.is_empty() {
                Ok(())
            } else {
                Err(StoreError::Failed {
                    message: format!("{} no longer exists", project.display()),
                })
            };
        }
        let dir = reviews_in(&key.project);
        fs::create_dir_all(&dir).map_err(|e| failed(&dir, &e))?;
        let path = dir.join(name::file_name(&key.branch));
        {
            let _lock = file::lock(&path)?;
            // What cannot be read is never overwritten (ADR 0004 §3).
            file::read::<Kept>(&path, VERSION)?;
            if review.is_empty() {
                file::remove(&path)?;
            } else {
                file::write(
                    &path,
                    &Kept {
                        version: VERSION,
                        branch: key.branch.clone(),
                        review: review.clone(),
                    },
                )?;
            }
        }
        self.projects.note(&key.project, || holds_a_review(&dir))
    }

    fn kept(&self) -> Result<Vec<(ReviewKey, SavedReview)>, StoreError> {
        let mut kept: Vec<(ReviewKey, SavedReview)> = self
            .projects
            .listed()?
            .into_iter()
            .flat_map(|project| {
                let dir = reviews_in(&project);
                // A folder or file that cannot be read is left out, so it hides
                // no other review; opening its branch reports it (ADR 0031 §5).
                branches(&dir)
                    .unwrap_or_default()
                    .into_iter()
                    .filter_map(move |branch| {
                        let review = read(&dir, &branch).ok().flatten()?;
                        Some((
                            ReviewKey {
                                project: project.clone(),
                                branch,
                            },
                            review,
                        ))
                    })
            })
            .collect();
        kept.sort_unstable_by(|(a, _), (b, _)| a.cmp(b));
        Ok(kept)
    }
}

/// Where `project`'s reviews are kept.
fn reviews_in(project: &str) -> PathBuf {
    Path::new(project).join(OWN_FOLDER).join(REVIEWS)
}

/// `branch`'s review in `dir`, `None` when it has none. A file holding
/// another branch's, which shares its name where names ignore case, is none.
fn read(dir: &Path, branch: &str) -> Result<Option<SavedReview>, StoreError> {
    Ok(
        file::read::<Kept>(&dir.join(name::file_name(branch)), VERSION)?
            .filter(|kept| kept.branch == branch)
            .map(|kept| kept.review),
    )
}

/// The branches `dir` holds a review file for; none when `dir` is gone.
fn branches(dir: &Path) -> Result<Vec<String>, StoreError> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(failed(dir, &e)),
    };
    entries
        .map(|entry| {
            let entry = entry.map_err(|e| failed(dir, &e))?;
            Ok(entry.file_name().to_str().and_then(name::branch))
        })
        .filter_map(Result::transpose)
        .collect()
}

/// Whether `dir` holds any review file.
fn holds_a_review(dir: &Path) -> Result<bool, StoreError> {
    Ok(!branches(dir)?.is_empty())
}

#[cfg(test)]
mod tests {
    use std::thread;

    use diff_loop_core::{AnchorState, Comment, Target};
    use tempfile::TempDir;

    use super::*;

    /// A temporary app-data directory and projects beside it.
    struct Fixture {
        dir: TempDir,
    }

    impl Fixture {
        fn new() -> Self {
            Self {
                dir: TempDir::new().unwrap(),
            }
        }

        /// A fresh store, as each running process has.
        fn store(&self) -> FileReviews {
            FileReviews::new(self.dir.path().join("data").join("projects.json"))
        }

        /// A project's common git directory, made.
        fn project(&self, name: &str) -> String {
            let path = self.dir.path().join(name).join(".git");
            fs::create_dir_all(&path).unwrap();
            path.to_string_lossy().into_owned()
        }
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
        let fixture = Fixture::new();
        let p = fixture.project("p");
        assert_eq!(
            fixture.store().saved(&key(&p, "b")).unwrap(),
            SavedReview::default()
        );
        assert!(fixture.store().kept().unwrap().is_empty());
    }

    #[test]
    fn a_review_is_a_file_in_its_projects_git_directory() {
        let fixture = Fixture::new();
        let p = fixture.project("p");
        fixture
            .store()
            .save(&key(&p, "agent/share-retry"), &with_comment("one"))
            .unwrap();
        let path = Path::new(&p).join("diff-loop/reviews/agent%2Fshare-retry.json");
        let written: serde_json::Value = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
        assert_eq!(written["version"], 1);
        assert_eq!(written["branch"], "agent/share-retry");
        assert_eq!(written["comments"][0]["text"], "one");
    }

    #[test]
    fn a_saved_review_reads_back_per_project_and_branch() {
        let fixture = Fixture::new();
        let (p, q) = (fixture.project("p"), fixture.project("q"));
        let store = fixture.store();
        store.save(&key(&p, "a"), &with_comment("one")).unwrap();
        store.save(&key(&p, "a/b"), &with_comment("two")).unwrap();
        store.save(&key(&q, "a"), &with_comment("three")).unwrap();
        assert_eq!(store.saved(&key(&p, "a")).unwrap(), with_comment("one"));
        assert_eq!(
            fixture.store().saved(&key(&p, "a/b")).unwrap(),
            with_comment("two")
        );
        assert_eq!(store.saved(&key(&q, "a")).unwrap(), with_comment("three"));
        let kept: Vec<ReviewKey> = store.kept().unwrap().into_iter().map(|(k, _)| k).collect();
        assert_eq!(kept, [key(&p, "a"), key(&p, "a/b"), key(&q, "a")]);
    }

    #[test]
    fn saving_an_empty_review_removes_its_file_and_its_project_with_no_other() {
        let fixture = Fixture::new();
        let p = fixture.project("p");
        let store = fixture.store();
        store.save(&key(&p, "a"), &with_comment("one")).unwrap();
        store.save(&key(&p, "b"), &with_comment("two")).unwrap();
        store.save(&key(&p, "a"), &SavedReview::default()).unwrap();
        assert!(!reviews_in(&p).join("a.json").exists());
        assert_eq!(store.kept().unwrap().len(), 1);
        store.save(&key(&p, "b"), &SavedReview::default()).unwrap();
        assert!(store.kept().unwrap().is_empty());
        assert!(store.projects.listed().unwrap().is_empty());
    }

    #[test]
    fn a_project_whose_git_directory_is_gone_is_neither_listed_nor_made_again() {
        let fixture = Fixture::new();
        let (p, q) = (fixture.project("p"), fixture.project("q"));
        let store = fixture.store();
        store.save(&key(&p, "a"), &with_comment("one")).unwrap();
        store.save(&key(&q, "a"), &with_comment("two")).unwrap();
        fs::remove_dir_all(&p).unwrap();
        let kept: Vec<ReviewKey> = store.kept().unwrap().into_iter().map(|(k, _)| k).collect();
        assert_eq!(kept, [key(&q, "a")]);
        assert_eq!(store.projects.listed().unwrap().len(), 2);
        assert!(store.save(&key(&p, "a"), &with_comment("one")).is_err());
        assert!(!Path::new(&p).exists());
        assert_eq!(store.projects.listed().unwrap().len(), 1);
        store.save(&key(&p, "a"), &SavedReview::default()).unwrap();
        assert!(!Path::new(&p).exists());
    }

    #[test]
    fn a_file_holding_another_branchs_review_is_none_of_this_ones() {
        let fixture = Fixture::new();
        let p = fixture.project("p");
        let store = fixture.store();
        store.save(&key(&p, "Fix"), &with_comment("one")).unwrap();
        // What `fix` would find where file names ignore case: `Fix`'s file.
        let fix = fs::read(reviews_in(&p).join("Fix.json")).unwrap();
        fs::write(reviews_in(&p).join("other.json"), fix).unwrap();
        assert_eq!(
            store.saved(&key(&p, "other")).unwrap(),
            SavedReview::default()
        );
        assert_eq!(store.kept().unwrap().len(), 1);
    }

    #[test]
    fn two_instances_saving_at_once_keep_each_others_reviews() {
        let fixture = Fixture::new();
        let p = fixture.project("p");
        let branches = ["a", "b"];
        thread::scope(|scope| {
            for branch in branches {
                let store = fixture.store();
                let p = &p;
                scope.spawn(move || {
                    for i in 0..50 {
                        // Emptied and filled again, so the project's listing
                        // races too.
                        store
                            .save(&key(p, branch), &SavedReview::default())
                            .unwrap();
                        store
                            .save(&key(p, branch), &with_comment(&i.to_string()))
                            .unwrap();
                    }
                });
            }
        });
        let store = fixture.store();
        for branch in branches {
            assert_eq!(store.saved(&key(&p, branch)).unwrap(), with_comment("49"));
        }
        assert_eq!(store.kept().unwrap().len(), 2);
    }

    #[test]
    fn a_file_that_cannot_be_read_is_reported_left_alone_and_left_out_of_the_list() {
        let fixture = Fixture::new();
        let (p, q) = (fixture.project("p"), fixture.project("q"));
        let store = fixture.store();
        store.save(&key(&p, "b"), &with_comment("one")).unwrap();
        store.save(&key(&q, "b"), &with_comment("other")).unwrap();
        let path = reviews_in(&p).join("b.json");
        for unreadable in ["not json", r#"{"version":2,"branch":"b"}"#] {
            fs::write(&path, unreadable).unwrap();
            assert!(store.saved(&key(&p, "b")).is_err(), "{unreadable}");
            let kept: Vec<ReviewKey> = store.kept().unwrap().into_iter().map(|(k, _)| k).collect();
            assert_eq!(kept, [key(&q, "b")], "{unreadable}");
            assert!(store.save(&key(&p, "b"), &with_comment("two")).is_err());
            assert!(store.save(&key(&p, "b"), &SavedReview::default()).is_err());
            assert_eq!(fs::read_to_string(&path).unwrap(), unreadable);
        }
    }
}
