//! Untracked files as additions, read from disk rather than one `git` call each.

use std::{
    fs::{self, File},
    io::{self, Read},
    path::Path,
};

use diff_loop_core::{Content, FileDiff, Hunk, Line, RepoError, Status};

use crate::failed;

/// Bytes git inspects for a NUL to call a file binary.
const BINARY_PROBE: u64 = 8000;

/// The untracked file at `path` (relative to `root`) as an addition. A
/// binary file is read no further than [`BINARY_PROBE`].
///
/// # Errors
/// [`RepoError::Failed`] when the file cannot be read.
pub(crate) fn added(root: &Path, path: String) -> Result<FileDiff, RepoError> {
    let full = root.join(&path);
    let read_failed = |e: io::Error| failed(&full, &e);
    let meta = fs::symlink_metadata(&full).map_err(read_failed)?;
    let content = if meta.file_type().is_symlink() {
        text(&fs::read_link(&full).map_err(read_failed)?.to_string_lossy())
    } else {
        let mut file = File::open(&full).map_err(read_failed)?;
        let mut bytes = Vec::new();
        file.by_ref()
            .take(BINARY_PROBE)
            .read_to_end(&mut bytes)
            .map_err(read_failed)?;
        if bytes.contains(&0) {
            Content::Binary {
                old_size: None,
                new_size: Some(meta.len()),
            }
        } else {
            file.read_to_end(&mut bytes).map_err(read_failed)?;
            text(&String::from_utf8_lossy(&bytes))
        }
    };
    Ok(FileDiff {
        path,
        status: Status::Added,
        content,
    })
}

/// `text` as one hunk of added lines; no hunk when it is empty.
fn text(text: &str) -> Content {
    let lines: Vec<Line> = text
        .lines()
        .zip(1..)
        .map(|(line, new)| Line::Added {
            new,
            text: line.to_owned(),
        })
        .collect();
    let hunks = if lines.is_empty() {
        Vec::new()
    } else {
        vec![Hunk {
            old_start: 0,
            new_start: 1,
            section: String::new(),
            lines,
        }]
    };
    Content::Text { hunks }
}
