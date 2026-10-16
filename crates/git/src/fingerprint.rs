//! What the fingerprint hashes of the working tree's files without reading
//! the patch (diff-loop-git.md Decision 4).

#[cfg(unix)]
use std::os::unix::fs::MetadataExt;
use std::{
    fs,
    hash::{Hash, Hasher},
    io::Read,
    path::Path,
    time::{Duration, SystemTime},
};

/// How recent a file's modification time is too recent to tell two writes
/// apart by it: past the coarsest clock tick the app can meet (two seconds,
/// FAT), with room for a poll's own time.
const RACY: Duration = Duration::from_secs(3);

/// How much of one racy file is read: its length already shows a file that
/// grows, as a log does, so only a rewrite in place needs its bytes.
const RACY_BYTES: u64 = 1 << 20;

/// How much of all racy files one check reads.
const RACY_BUDGET: u64 = 16 << 20;

/// Hashes into `hasher` each of `paths`, relative to `root`, with what shows
/// a change to it (`hash_file`). O(paths) stats, and at most `RACY_BUDGET`
/// bytes read. Owned paths: the untracked ones come as `String`s, and the
/// borrowed raw ones join them in one stream.
pub(crate) fn hash_files(
    root: &Path,
    paths: impl Iterator<Item = String>,
    hasher: &mut impl Hasher,
) {
    let now = SystemTime::now();
    let mut budget = RACY_BUDGET;
    for path in paths {
        let full = root.join(&path);
        path.hash(hasher);
        hash_file(&full, now, &mut budget, hasher);
    }
}

/// Hashes into `hasher` what shows a change to the file at `path`: its size,
/// modification time and `identity`; and while that time is `RACY`, a
/// symlink's target as git diffs it, or a regular file's first `RACY_BYTES`
/// out of `budget`. A file the budget cannot cover hashes `now` instead, so
/// the check reads as changed and a load decides. Only a path
/// `symlink_metadata` found a regular file is opened: no link is followed,
/// unless one is swapped in between the two calls.
fn hash_file(path: &Path, now: SystemTime, budget: &mut u64, hasher: &mut impl Hasher) {
    let meta = fs::symlink_metadata(path).ok();
    let modified = meta.as_ref().and_then(|m| m.modified().ok());
    let len = meta.as_ref().map(fs::Metadata::len);
    (len, modified, meta.as_ref().and_then(identity)).hash(hasher);
    let racy = modified.is_some_and(|at| now.duration_since(at).map_or(true, |age| age < RACY));
    let Some(meta) = meta.filter(|_| racy) else {
        return;
    };
    if meta.is_symlink() {
        fs::read_link(path).ok().hash(hasher);
    } else if meta.is_file() {
        let wanted = meta.len().min(RACY_BYTES);
        if wanted > *budget {
            now.hash(hasher);
            return;
        }
        *budget -= wanted;
        first_bytes(path, wanted).hash(hasher);
    }
}

/// Up to `limit` bytes from the start of the file at `path`; `None` when it
/// cannot be read, as when permission is refused.
fn first_bytes(path: &Path, limit: u64) -> Option<Vec<u8>> {
    let mut bytes = Vec::new();
    fs::File::open(path)
        .ok()?
        .take(limit)
        .read_to_end(&mut bytes)
        .ok()?;
    Some(bytes)
}

/// What else git's index compares to tell a change: the inode's change time
/// and number, which restoring a modification time (`cp -p`, `tar`) moves.
#[cfg(unix)]
fn identity(meta: &fs::Metadata) -> Option<(i64, i64, u64)> {
    Some((meta.ctime(), meta.ctime_nsec(), meta.ino()))
}

/// What else git's index compares to tell a change; the standard library
/// gives neither the inode's change time nor its number here.
#[cfg(not(unix))]
fn identity(_: &fs::Metadata) -> Option<(i64, i64, u64)> {
    None
}

#[cfg(test)]
mod tests {
    use std::collections::hash_map::DefaultHasher;

    use tempfile::TempDir;

    use super::*;

    #[test]
    fn a_racy_file_past_the_budget_reads_as_changed_unread() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("new.ts");
        fs::write(&path, "x\n").unwrap();
        let hashed = |now: SystemTime| {
            let mut hasher = DefaultHasher::new();
            // One byte left, two wanted.
            hash_file(&path, now, &mut 1, &mut hasher);
            hasher.finish()
        };
        let now = SystemTime::now();
        assert_ne!(hashed(now), hashed(now + Duration::from_millis(1)));
    }
}
