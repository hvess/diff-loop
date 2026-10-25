//! A JSON file kept whole: a lock beside it held around a change, and every
//! write made beside it and renamed over it (ADR 0030 §4).

use std::{
    error::Error,
    ffi::OsString,
    fs, io,
    path::{Path, PathBuf},
};

use diff_loop_core::StoreError;
use serde::{Deserialize, Serialize, de::DeserializeOwned};

/// Just the version, read before the rest so a newer format is named as such.
#[derive(Deserialize)]
struct Version {
    version: u32,
}

/// Holds the lock beside `path` until the returned handle drops, so saves by
/// any process take turns. Its directory must exist.
pub(crate) fn lock(path: &Path) -> Result<fs::File, StoreError> {
    let lock = beside(path, ".lock");
    let file = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(&lock)
        .map_err(|e| failed(&lock, &e))?;
    file.lock().map_err(|e| failed(&lock, &e))?;
    Ok(file)
}

/// What `path` holds, `None` when it does not exist. A file of another
/// version than `version`, or that does not parse, is an error, so a save
/// never overwrites it (ADR 0004 §3).
pub(crate) fn read<T: DeserializeOwned>(
    path: &Path,
    version: u32,
) -> Result<Option<T>, StoreError> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(failed(path, &e)),
    };
    let unreadable = |e: serde_json::Error| failed(path, &e);
    let Version { version: found } = serde_json::from_slice(&bytes).map_err(unreadable)?;
    if found != version {
        return Err(StoreError::Failed {
            message: format!(
                "{} was written by another version of Diff Loop (format {found})",
                path.display()
            ),
        });
    }
    serde_json::from_slice(&bytes).map(Some).map_err(unreadable)
}

/// Replaces `path` whole with `value`: written beside it, then renamed over
/// it, so a crash mid-write leaves the old file. Its directory must exist.
pub(crate) fn write(path: &Path, value: &impl Serialize) -> Result<(), StoreError> {
    let json = serde_json::to_vec_pretty(value).map_err(|e| failed(path, &e))?;
    let next = beside(path, ".next");
    fs::write(&next, json).map_err(|e| failed(&next, &e))?;
    fs::rename(&next, path).map_err(|e| failed(path, &e))
}

/// Removes `path`; one already gone is no error.
pub(crate) fn remove(path: &Path) -> Result<(), StoreError> {
    match fs::remove_file(path) {
        Err(e) if e.kind() != io::ErrorKind::NotFound => Err(failed(path, &e)),
        _ => Ok(()),
    }
}

/// `path` with `suffix` appended: `fix.json` → `fix.json.lock`. Not
/// `with_extension`, which would replace part of a branch named `v1.2`.
fn beside(path: &Path, suffix: &str) -> PathBuf {
    let mut name = OsString::from(path);
    name.push(suffix);
    PathBuf::from(name)
}

/// The one way this crate reports a failed file operation: with its path.
pub(crate) fn failed(path: &Path, error: &dyn Error) -> StoreError {
    StoreError::Failed {
        message: format!("{}: {error}", path.display()),
    }
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;

    #[derive(Debug, PartialEq, Serialize, Deserialize)]
    struct Kept {
        version: u32,
        text: String,
    }

    #[test]
    fn a_file_written_reads_back_and_one_missing_reads_as_none() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("v1.2.json");
        assert_eq!(read::<Kept>(&path, 1).unwrap(), None);
        let kept = Kept {
            version: 1,
            text: "one".into(),
        };
        write(&path, &kept).unwrap();
        assert_eq!(read::<Kept>(&path, 1).unwrap(), Some(kept));
        assert!(!dir.path().join("v1.2.json.next").exists());
        drop(lock(&path).unwrap());
        assert!(dir.path().join("v1.2.json.lock").exists());
        remove(&path).unwrap();
        remove(&path).unwrap();
        assert_eq!(read::<Kept>(&path, 1).unwrap(), None);
    }

    #[test]
    fn another_version_or_a_damaged_file_is_an_error() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("a.json");
        fs::write(&path, r#"{"version":2,"text":"x"}"#).unwrap();
        let Err(StoreError::Failed { message }) = read::<Kept>(&path, 1) else {
            panic!("another version was read");
        };
        assert!(message.contains("another version"), "{message}");
        fs::write(&path, "not json").unwrap();
        assert!(read::<Kept>(&path, 1).is_err());
    }
}
