//! Untracked files as additions, read from disk rather than one `git` call each.

use std::{
    fs::{self, File},
    io::{self, BufRead, BufReader, Read},
    path::Path,
};

use diff_loop_core::{Content, FileDiff, Hunk, Line, RepoError, Status};

use crate::failed;

/// Bytes git inspects for a NUL to call a file binary.
const BINARY_PROBE: u64 = 8000;

/// An untracked file as git reads it: its first [`BINARY_PROBE`] bytes
/// decide whether it is text.
enum Untracked {
    /// A symlink, whose content is its target.
    Link(String),
    /// A file with a NUL in its first bytes; its size in bytes.
    Binary(u64),
    /// A text file: the bytes read so far, and the file to read the rest from.
    Text(Vec<u8>, File),
}

/// Opens the untracked file at `full`, read no further than [`BINARY_PROBE`].
fn open(full: &Path) -> Result<Untracked, RepoError> {
    let read_failed = |e: io::Error| failed(full, &e);
    let meta = fs::symlink_metadata(full).map_err(read_failed)?;
    if meta.file_type().is_symlink() {
        let target = fs::read_link(full).map_err(read_failed)?;
        return Ok(Untracked::Link(target.to_string_lossy().into_owned()));
    }
    let mut file = File::open(full).map_err(read_failed)?;
    let mut head = Vec::new();
    file.by_ref()
        .take(BINARY_PROBE)
        .read_to_end(&mut head)
        .map_err(read_failed)?;
    Ok(if head.contains(&0) {
        Untracked::Binary(meta.len())
    } else {
        Untracked::Text(head, file)
    })
}

/// The untracked file at `path` (relative to `root`) as an addition. A
/// binary file is read no further than [`BINARY_PROBE`].
///
/// # Errors
/// [`RepoError::Failed`] when the file cannot be read.
pub(crate) fn added(root: &Path, path: String) -> Result<FileDiff, RepoError> {
    let full = root.join(&path);
    let content = match open(&full)? {
        Untracked::Link(target) => text(&target),
        Untracked::Binary(size) => Content::Binary {
            old_size: None,
            new_size: Some(size),
        },
        Untracked::Text(mut bytes, mut rest) => {
            rest.read_to_end(&mut bytes)
                .map_err(|e| failed(&full, &e))?;
            text(&String::from_utf8_lossy(&bytes))
        }
    };
    Ok(FileDiff {
        path,
        status: Status::Added,
        content,
    })
}

/// How many lines [`added`] shows for the untracked file at `path`, counted
/// without keeping them: none for a binary file.
///
/// # Errors
/// [`RepoError::Failed`] when the file cannot be read.
pub(crate) fn added_lines(root: &Path, path: &str) -> Result<u32, RepoError> {
    let full = root.join(path);
    let mut lines = LineCount::default();
    match open(&full)? {
        Untracked::Link(target) => lines.add(target.as_bytes()),
        Untracked::Binary(_) => {}
        Untracked::Text(head, rest) => {
            lines.add(&head);
            let mut rest = BufReader::new(rest);
            loop {
                let buffer = rest.fill_buf().map_err(|e| failed(&full, &e))?;
                if buffer.is_empty() {
                    break;
                }
                lines.add(buffer);
                let read = buffer.len();
                rest.consume(read);
            }
        }
    }
    Ok(lines.total())
}

/// `str::lines`' count over bytes read in pieces: one per `\n`, and one
/// for a last line without it.
#[derive(Default)]
struct LineCount {
    newlines: u32,
    open: bool,
}

impl LineCount {
    fn add(&mut self, bytes: &[u8]) {
        let newlines = bytes.iter().filter(|&&b| b == b'\n').count();
        self.newlines = self
            .newlines
            .saturating_add(u32::try_from(newlines).unwrap_or(u32::MAX));
        if let Some(&last) = bytes.last() {
            self.open = last != b'\n';
        }
    }

    fn total(&self) -> u32 {
        self.newlines.saturating_add(u32::from(self.open))
    }
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
