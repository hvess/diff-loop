//! `git diff --raw -z` output read into the paths it names: the fingerprint's
//! view of which files differ (diff-loop-git.md Decision 4).

use std::iter;

/// The paths `git diff --raw -z` names, read by position: a record is its
/// header, then one path, or two for a rename or copy; a path may itself
/// begin with `:`. O(output).
pub(crate) fn raw_paths(raw: &str) -> impl Iterator<Item = &str> {
    let mut fields = raw.split('\0').filter(|field| !field.is_empty());
    // How many paths the last header promised that are still to come.
    let mut owed = 0;
    iter::from_fn(move || {
        loop {
            let field = fields.next()?;
            if owed > 0 {
                owed -= 1;
                return Some(field);
            }
            let status = field.rsplit(' ').next().unwrap_or_default();
            owed = if status.starts_with(['R', 'C']) { 2 } else { 1 };
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn raw_records_name_their_paths_by_position() {
        let raw =
            ":100644 100644 aaa 000 M\0:notes.md\0:100644 100644 bbb 000 R087\0old.ts\0new.ts\0";
        assert_eq!(
            raw_paths(raw).collect::<Vec<_>>(),
            [":notes.md", "old.ts", "new.ts"]
        );
    }
}
