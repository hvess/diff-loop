//! Changed files grouped by what they are for: source, tests, config, docs, assets.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::diff::{Content, FileDiff};

/// What a file is for. Variant order is display order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Role {
    /// Program code.
    Source,
    /// Tests and test fixtures.
    Tests,
    /// Configuration, manifests, lockfiles, CI.
    Config,
    /// Prose.
    Docs,
    /// Images, fonts, media and other binaries.
    Assets,
}

/// The changed files with one role.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FileGroup {
    /// What these files are for.
    pub role: Role,
    /// Indices into the grouped slice, in path order.
    pub files: Vec<usize>,
}

const TEST_DIRS: [&str; 5] = ["test", "tests", "__tests__", "spec", "e2e"];
const TEST_MARKERS: [&str; 4] = [".test.", ".spec.", "_test.", "_spec."];
const DOC_EXTENSIONS: [&str; 5] = ["md", "mdx", "rst", "adoc", "txt"];
const CONFIG_EXTENSIONS: [&str; 8] = ["json", "yaml", "yml", "toml", "ini", "cfg", "conf", "lock"];
const CONFIG_NAMES: [&str; 4] = ["Dockerfile", "Makefile", "justfile", "Procfile"];
const ASSET_EXTENSIONS: [&str; 16] = [
    "png", "jpg", "jpeg", "gif", "webp", "avif", "ico", "svg", "bmp", "woff", "woff2", "ttf",
    "otf", "mp3", "mp4", "wav",
];

impl Role {
    /// The role of `file`, judged from its path, and from its content only
    /// when that is binary.
    #[must_use]
    pub(crate) fn of(file: &FileDiff) -> Self {
        let path = file.path.as_str();
        let (dirs, name) = path.rsplit_once('/').unwrap_or(("", path));
        let extension = name
            .rsplit_once('.')
            .map_or("", |(_, e)| e)
            .to_ascii_lowercase();
        let in_dir = |set: &[&str]| dirs.split('/').any(|d| set.contains(&d));
        if matches!(file.content, Content::Binary { .. }) {
            Self::Assets
        } else if in_dir(&TEST_DIRS)
            || TEST_MARKERS.iter().any(|m| name.contains(m))
            || name.starts_with("test_")
        {
            Self::Tests
        } else if ASSET_EXTENSIONS.contains(&extension.as_str()) {
            Self::Assets
        } else if DOC_EXTENSIONS.contains(&extension.as_str()) || in_dir(&["docs", "doc"]) {
            Self::Docs
        } else if CONFIG_EXTENSIONS.contains(&extension.as_str())
            || CONFIG_NAMES.contains(&name)
            || name.starts_with('.')
            || dirs.split('/').any(|d| d.starts_with('.'))
        {
            Self::Config
        } else {
            Self::Source
        }
    }
}

/// `files` grouped by [`Role`], groups in role order, empty groups left out.
#[must_use]
pub(crate) fn group(files: &[FileDiff]) -> Vec<FileGroup> {
    let mut order: Vec<(Role, &str, usize)> = files
        .iter()
        .enumerate()
        .map(|(i, f)| (Role::of(f), f.path.as_str(), i))
        .collect();
    order.sort_unstable();
    order
        .chunk_by(|a, b| a.0 == b.0)
        .map(|chunk| FileGroup {
            role: chunk[0].0,
            files: chunk.iter().map(|e| e.2).collect(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diff::{Status, tests::text_file};

    fn role(path: &str) -> Role {
        Role::of(&text_file(path, vec![]))
    }

    #[test]
    fn roles_follow_the_path() {
        assert_eq!(role("src/api/share/handler.ts"), Role::Source);
        assert_eq!(role("src/api/share/handler.test.ts"), Role::Tests);
        assert_eq!(role("tests/integration.rs"), Role::Tests);
        assert_eq!(role("crates/git/src/parse_test.go"), Role::Tests);
        assert_eq!(role("config/limits.yaml"), Role::Config);
        assert_eq!(role("Cargo.toml"), Role::Config);
        assert_eq!(role(".github/workflows/ci.yml"), Role::Config);
        assert_eq!(role(".gitignore"), Role::Config);
        assert_eq!(role("docs/api/share.md"), Role::Docs);
        assert_eq!(role("README.md"), Role::Docs);
        assert_eq!(role("public/img/share-preview.png"), Role::Assets);
    }

    #[test]
    fn a_binary_file_is_an_asset_whatever_its_name() {
        let file = FileDiff {
            path: "bin/tool".into(),
            status: Status::Added,
            content: Content::Binary {
                old_size: None,
                new_size: Some(1),
            },
        };
        assert_eq!(Role::of(&file), Role::Assets);
        let fixture = FileDiff {
            path: "tests/fixture.test.bin".into(),
            ..file
        };
        assert_eq!(Role::of(&fixture), Role::Assets);
    }

    #[test]
    fn groups_come_in_role_order_with_files_in_path_order() {
        let files = [
            text_file("docs/share.md", vec![]),
            text_file("src/b.ts", vec![]),
            text_file("src/a.test.ts", vec![]),
            text_file("src/a.ts", vec![]),
        ];
        let groups = group(&files);
        assert_eq!(
            groups,
            [
                FileGroup {
                    role: Role::Source,
                    files: vec![3, 1]
                },
                FileGroup {
                    role: Role::Tests,
                    files: vec![2]
                },
                FileGroup {
                    role: Role::Docs,
                    files: vec![0]
                },
            ]
        );
    }

    #[test]
    fn no_files_make_no_groups() {
        assert!(group(&[]).is_empty());
    }
}
