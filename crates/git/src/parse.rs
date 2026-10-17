//! `git diff` output read into [`FileDiff`]s.
//!
//! Expects what `command::DIFF_FLAGS` sets (`a/` and `b/` prefixes, renames
//! detected, no colour) and `command::CONFIG` forces (`core.quotePath=false`).

use diff_loop_core::{Content, FileDiff, Hunk, Line, LineCounts, Status};

/// The files in `output`, in output order. Binary files get no sizes; the
/// caller fills them in.
pub(crate) fn parse(output: &str) -> Vec<FileDiff> {
    let mut files = Vec::new();
    let mut lines = output.lines().peekable();
    while let Some(line) = lines.next() {
        let Some(header) = line.strip_prefix("diff --git ") else {
            continue;
        };
        let mut file = Pending::from_header(header);
        while let Some(&line) = lines.peek() {
            if line.starts_with("diff --git ") {
                break;
            }
            lines.next();
            if let Some(range) = line.strip_prefix("@@ ") {
                if let Some(hunk) = read_hunk(range, &mut lines) {
                    file.hunks.push(hunk);
                }
            } else {
                file.header_line(line);
            }
        }
        files.push(file.finish());
    }
    files
}

/// Each file in `git diff --numstat -z` output, with its new-side path;
/// `None` counts for a binary file, which git counts as `-`.
pub(crate) fn numstat(output: &str) -> Vec<(Option<LineCounts>, &str)> {
    let mut files = Vec::new();
    let mut fields = output.split('\0');
    // A loop, not an iterator chain: a rename's entry takes the next two
    // fields of the same iterator.
    while let Some(entry) = fields.next() {
        let mut parts = entry.splitn(3, '\t');
        let (Some(added), Some(removed), Some(path)) = (parts.next(), parts.next(), parts.next())
        else {
            continue;
        };
        // A rename leaves the path empty and gives the old and new paths
        // as the next two fields.
        let path = if path.is_empty() {
            fields.nth(1).unwrap_or_default()
        } else {
            path
        };
        let counts = added
            .parse()
            .ok()
            .zip(removed.parse().ok())
            .map(|(added, removed)| LineCounts { added, removed });
        files.push((counts, path));
    }
    files
}

/// A file whose header lines are still being read.
#[derive(Default)]
struct Pending {
    old_path: Option<String>,
    new_path: Option<String>,
    added: bool,
    deleted: bool,
    renamed: bool,
    binary: bool,
    hunks: Vec<Hunk>,
}

impl Pending {
    /// Starts from `a/<old> b/<new>`. Only an identical pair can be split
    /// without ambiguity; a rename's paths come from its `rename` lines.
    fn from_header(header: &str) -> Self {
        let quoted = header.starts_with('"') || header.contains(" \"b/");
        let (old, new) = if quoted {
            split_quoted(header)
        } else {
            split_same(header)
        }
        .unwrap_or_default();
        Self {
            old_path: old,
            new_path: new,
            ..Self::default()
        }
    }

    fn header_line(&mut self, line: &str) {
        if line.starts_with("new file mode") {
            self.added = true;
        } else if line.starts_with("deleted file mode") {
            self.deleted = true;
        } else if let Some(path) = line.strip_prefix("rename from ") {
            self.renamed = true;
            self.old_path = Some(unquote(path));
        } else if let Some(path) = line.strip_prefix("rename to ") {
            self.renamed = true;
            self.new_path = Some(unquote(path));
        } else if let Some(path) = line.strip_prefix("--- ") {
            if let Some(path) = side_path(path, "a/") {
                self.old_path = Some(path);
            }
        } else if let Some(path) = line.strip_prefix("+++ ") {
            if let Some(path) = side_path(path, "b/") {
                self.new_path = Some(path);
            }
        } else if line.starts_with("Binary files ") || line == "GIT binary patch" {
            self.binary = true;
        }
    }

    fn finish(self) -> FileDiff {
        let old = self.old_path.unwrap_or_default();
        let new = self.new_path.unwrap_or_else(|| old.clone());
        let (path, status) = if self.added {
            (new, Status::Added)
        } else if self.deleted {
            (old, Status::Deleted)
        } else if self.renamed {
            (new, Status::Renamed { from: old })
        } else {
            (new, Status::Modified)
        };
        let content = if self.binary {
            Content::Binary {
                old_size: None,
                new_size: None,
            }
        } else {
            Content::Text { hunks: self.hunks }
        };
        FileDiff {
            path,
            status,
            content,
        }
    }
}

/// The path in a `---`/`+++` line, without `prefix`; `None` for `/dev/null`.
fn side_path(raw: &str, prefix: &str) -> Option<String> {
    let path = unquote(raw.trim_end_matches('\t'));
    path.strip_prefix(prefix).map(str::to_owned)
}

/// `a/<p> b/<p>` split into its two halves when both name the same path.
fn split_same(header: &str) -> Option<(Option<String>, Option<String>)> {
    // "a/" + p + " b/" + p is 2·len(p) + 5 bytes.
    let len = header.len().checked_sub(5)? / 2;
    let old = header.get(2..2 + len)?;
    let new = header.get(len + 5..)?;
    (header.starts_with("a/") && header.get(2 + len..len + 5) == Some(" b/") && old == new)
        .then(|| (Some(old.to_owned()), Some(new.to_owned())))
}

/// `"a/<p>" "b/<q>"`, either half possibly unquoted, split and unquoted.
fn split_quoted(header: &str) -> Option<(Option<String>, Option<String>)> {
    let (old, new) = if header.starts_with('"') {
        let (old, rest) = header.split_at(closing_quote(header)? + 1);
        (unquote(old), unquote(rest.trim_start()))
    } else {
        let (old, new) = header.split_once(" \"b/")?;
        (old.to_owned(), unquote(&format!("\"b/{new}")))
    };
    Some((
        Some(old.strip_prefix("a/")?.to_owned()),
        Some(new.strip_prefix("b/")?.to_owned()),
    ))
}

/// Byte index of the quote closing the one `s` starts with.
fn closing_quote(s: &str) -> Option<usize> {
    let mut escaped = false;
    for (i, c) in s.char_indices().skip(1) {
        match c {
            '\\' if !escaped => escaped = true,
            '"' if !escaped => return Some(i),
            _ => escaped = false,
        }
    }
    None
}

/// A path as git prints it, with C-style quoting removed when present.
fn unquote(raw: &str) -> String {
    let Some(inner) = raw.strip_prefix('"').and_then(|r| r.strip_suffix('"')) else {
        return raw.to_owned();
    };
    let mut bytes = Vec::with_capacity(inner.len());
    let mut chars = inner.bytes().peekable();
    while let Some(b) = chars.next() {
        if b != b'\\' {
            bytes.push(b);
            continue;
        }
        match chars.next() {
            Some(b'n') => bytes.push(b'\n'),
            Some(b't') => bytes.push(b'\t'),
            Some(b'r') => bytes.push(b'\r'),
            Some(b'a') => bytes.push(0x07),
            Some(b'b') => bytes.push(0x08),
            Some(b'f') => bytes.push(0x0c),
            Some(b'v') => bytes.push(0x0b),
            Some(d @ b'0'..=b'7') => {
                let mut value = u32::from(d - b'0');
                for _ in 0..2 {
                    if let Some(&d @ b'0'..=b'7') = chars.peek() {
                        value = value * 8 + u32::from(d - b'0');
                        chars.next();
                    }
                }
                bytes.push(u8::try_from(value).unwrap_or(b'?'));
            }
            Some(other) => bytes.push(other),
            None => {}
        }
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

/// The hunk whose `@@` line is `range` (after the `@@ `), reading exactly the
/// lines its counts promise.
fn read_hunk<'a>(range: &str, lines: &mut impl Iterator<Item = &'a str>) -> Option<Hunk> {
    let (counts, section) = range.split_once(" @@").unwrap_or((range, ""));
    let (old, new) = counts.split_once(' ')?;
    let (old_start, mut old_left) = start_and_count(old.strip_prefix('-')?)?;
    let (new_start, mut new_left) = start_and_count(new.strip_prefix('+')?)?;
    let (mut old_no, mut new_no) = (old_start, new_start);
    let mut out = Vec::new();
    while old_left > 0 || new_left > 0 {
        let line = lines.next()?;
        let (marker, text) = line.split_at_checked(1).unwrap_or((" ", ""));
        let text = text.to_owned();
        match marker {
            "+" => {
                out.push(Line::Added { new: new_no, text });
                new_no += 1;
                new_left -= 1;
            }
            "-" => {
                out.push(Line::Removed { old: old_no, text });
                old_no += 1;
                old_left -= 1;
            }
            // "\ No newline at end of file" counts toward neither side.
            "\\" => {}
            _ => {
                out.push(Line::Context {
                    old: old_no,
                    new: new_no,
                    text,
                });
                old_no += 1;
                new_no += 1;
                old_left = old_left.saturating_sub(1);
                new_left = new_left.saturating_sub(1);
            }
        }
    }
    Some(Hunk {
        old_start,
        new_start,
        section: section.trim().to_owned(),
        lines: out,
    })
}

/// `start[,count]`; a missing count is 1.
fn start_and_count(spec: &str) -> Option<(u32, u32)> {
    match spec.split_once(',') {
        Some((start, count)) => Some((start.parse().ok()?, count.parse().ok()?)),
        None => Some((spec.parse().ok()?, 1)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const OUTPUT: &str = "\
diff --git a/f.txt b/f.txt
index 422c2b7..de98044 100644
--- a/f.txt
+++ b/f.txt
@@ -1,2 +1,3 @@ fn main()
 a
-b
+B
+c
\\ No newline at end of file
diff --git a/img.bin b/img.bin
deleted file mode 100644
index bdc955b..0000000
Binary files a/img.bin and /dev/null differ
diff --git a/old.txt b/new name.txt
similarity index 100%
rename from old.txt
rename to new name.txt
diff --git a/new.txt b/new.txt
new file mode 100644
index 0000000..4ae8ef0
--- /dev/null
+++ b/new.txt
@@ -0,0 +1 @@
+u
";

    #[test]
    fn reads_modified_binary_renamed_and_added_files() {
        let files = parse(OUTPUT);
        let summary: Vec<_> = files.iter().map(|f| (f.path.as_str(), &f.status)).collect();
        assert_eq!(
            summary,
            [
                ("f.txt", &Status::Modified),
                ("img.bin", &Status::Deleted),
                (
                    "new name.txt",
                    &Status::Renamed {
                        from: "old.txt".into()
                    }
                ),
                ("new.txt", &Status::Added),
            ]
        );
        assert_eq!(
            files[1].content,
            Content::Binary {
                old_size: None,
                new_size: None
            }
        );
        assert_eq!(files[2].content, Content::Text { hunks: vec![] });
    }

    #[test]
    fn numbers_hunk_lines_on_both_sides() {
        let files = parse(OUTPUT);
        let Content::Text { hunks } = &files[0].content else {
            panic!("text expected")
        };
        assert_eq!(hunks[0].section, "fn main()");
        assert_eq!(
            hunks[0].lines,
            [
                Line::Context {
                    old: 1,
                    new: 1,
                    text: "a".into()
                },
                Line::Removed {
                    old: 2,
                    text: "b".into()
                },
                Line::Added {
                    new: 2,
                    text: "B".into()
                },
                Line::Added {
                    new: 3,
                    text: "c".into()
                },
            ]
        );
    }

    #[test]
    fn a_hunk_line_that_looks_like_a_header_is_still_code() {
        let output =
            "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+diff --git a/y b/y\n";
        let files = parse(output);
        assert_eq!(files.len(), 1);
        let Content::Text { hunks } = &files[0].content else {
            panic!("text expected")
        };
        assert_eq!(
            hunks[0].lines[1],
            Line::Added {
                new: 1,
                text: "diff --git a/y b/y".into()
            }
        );
    }

    #[test]
    fn an_empty_context_line_without_its_space_is_context() {
        let output = "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n\n-a\n+b\n";
        let files = parse(output);
        let Content::Text { hunks } = &files[0].content else {
            panic!("text expected")
        };
        assert_eq!(
            hunks[0].lines[0],
            Line::Context {
                old: 1,
                new: 1,
                text: String::new()
            }
        );
    }

    #[test]
    fn quoted_paths_are_unquoted() {
        let output = "diff --git \"a/tab\\there\" \"b/tab\\there\"\nnew file mode 100644\n--- /dev/null\n+++ \"b/tab\\there\"\n@@ -0,0 +1 @@\n+x\n";
        assert_eq!(parse(output)[0].path, "tab\there");
        assert_eq!(unquote("\"caf\\303\\251\""), "café");
    }

    #[test]
    fn a_binary_add_takes_its_path_from_the_header() {
        let output = "diff --git a/p q.png b/p q.png\nnew file mode 100644\nBinary files /dev/null and b/p q.png differ\n";
        let file = &parse(output)[0];
        assert_eq!(
            (file.path.as_str(), &file.status),
            ("p q.png", &Status::Added)
        );
    }

    #[test]
    fn empty_output_has_no_files() {
        assert!(parse("").is_empty());
    }

    #[test]
    fn numstat_reads_counts_renames_and_binaries() {
        let output = "2\t1\tsrc/a.ts\0-\t-\tlogo.png\x003\t0\t\0old name.txt\0new\tname.txt\0";
        assert_eq!(
            numstat(output),
            [
                (
                    Some(LineCounts {
                        added: 2,
                        removed: 1
                    }),
                    "src/a.ts"
                ),
                (None, "logo.png"),
                (
                    Some(LineCounts {
                        added: 3,
                        removed: 0
                    }),
                    "new\tname.txt"
                ),
            ]
        );
        assert!(numstat("").is_empty());
    }
}
