//! The projects that hold a review, kept in the app's data directory so every
//! project's reviews can be listed (ADR 0031 §2). The reviews themselves stay
//! in each project.

use std::{
    collections::BTreeSet,
    fs,
    path::{Path, PathBuf},
};

use diff_loop_core::StoreError;
use serde::{Deserialize, Serialize};

use crate::file::{self, failed};

/// The format [`Projects`] writes; any other is refused, never overwritten.
const VERSION: u32 = 1;

/// The file's contents.
#[derive(Debug, Serialize, Deserialize)]
struct Listed {
    version: u32,
    /// Common git directories, as [`diff_loop_core::ReviewKey::project`].
    projects: BTreeSet<String>,
}

/// The list of projects with a review, as one JSON file.
#[derive(Debug)]
pub(crate) struct Projects {
    path: PathBuf,
}

impl Projects {
    pub(crate) fn new(path: PathBuf) -> Self {
        Self { path }
    }

    /// Every project listed, in order.
    pub(crate) fn listed(&self) -> Result<BTreeSet<String>, StoreError> {
        Ok(file::read::<Listed>(&self.path, VERSION)?
            .map(|listed| listed.projects)
            .unwrap_or_default())
    }

    /// Lists `project` when `reviewed` says it still holds a review, and
    /// otherwise drops it, along with every project whose git directory is
    /// gone. `reviewed` runs under the lock, after the review's own save, so
    /// that two saves in one project, one emptying it and one filling it,
    /// leave it listed. O(projects) checks for a directory, made before the
    /// lock: a share that hangs holds up no other instance's save.
    pub(crate) fn note(
        &self,
        project: &str,
        reviewed: impl FnOnce() -> Result<bool, StoreError>,
    ) -> Result<(), StoreError> {
        let gone: BTreeSet<String> = self
            .listed()?
            .into_iter()
            .filter(|listed| listed != project && !Path::new(listed).is_dir())
            .collect();
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir).map_err(|e| failed(dir, &e))?;
        }
        let _lock = file::lock(&self.path)?;
        let before = self.listed()?;
        let mut projects: BTreeSet<String> = before.difference(&gone).cloned().collect();
        if reviewed()? {
            projects.insert(project.to_owned());
        } else {
            projects.remove(project);
        }
        if projects == before {
            return Ok(());
        }
        file::write(
            &self.path,
            &Listed {
                version: VERSION,
                projects,
            },
        )
    }
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;

    fn projects(dir: &TempDir) -> Projects {
        Projects::new(dir.path().join("data").join("projects.json"))
    }

    fn project(dir: &TempDir, name: &str) -> String {
        let path = dir.path().join(name);
        fs::create_dir_all(&path).unwrap();
        path.to_string_lossy().into_owned()
    }

    #[test]
    fn a_project_is_listed_while_it_holds_a_review() {
        let dir = TempDir::new().unwrap();
        let list = projects(&dir);
        assert!(list.listed().unwrap().is_empty());
        let (p, q) = (project(&dir, "p"), project(&dir, "q"));
        list.note(&p, || Ok(true)).unwrap();
        list.note(&q, || Ok(true)).unwrap();
        assert_eq!(
            list.listed().unwrap(),
            BTreeSet::from([p.clone(), q.clone()])
        );
        list.note(&p, || Ok(false)).unwrap();
        assert_eq!(list.listed().unwrap(), BTreeSet::from([q]));
    }

    #[test]
    fn a_project_whose_git_directory_is_gone_is_dropped_at_the_next_note() {
        let dir = TempDir::new().unwrap();
        let list = projects(&dir);
        let (p, q) = (project(&dir, "p"), project(&dir, "q"));
        list.note(&p, || Ok(true)).unwrap();
        list.note(&q, || Ok(true)).unwrap();
        fs::remove_dir(&p).unwrap();
        assert_eq!(list.listed().unwrap().len(), 2);
        list.note(&q, || Ok(true)).unwrap();
        assert_eq!(list.listed().unwrap(), BTreeSet::from([q]));
    }

    #[test]
    fn a_list_of_another_version_is_refused_and_left_alone() {
        let dir = TempDir::new().unwrap();
        let list = projects(&dir);
        fs::create_dir_all(list.path.parent().unwrap()).unwrap();
        let newer = r#"{"version":2,"projects":"elsewhere"}"#;
        fs::write(&list.path, newer).unwrap();
        assert!(list.listed().is_err());
        assert!(list.note(&project(&dir, "p"), || Ok(true)).is_err());
        assert_eq!(fs::read_to_string(&list.path).unwrap(), newer);
    }
}
