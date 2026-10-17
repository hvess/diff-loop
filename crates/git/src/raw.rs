//! `git diff --raw -z` output read into the paths it names: the file states'
//! view of which files differ (diff-loop-git.md Decision 4).

use std::iter;

/// The paths `git diff --raw -z` names, each with its record's header
/// (modes, ids, status), read by position: a record is its header, then one
/// path, or two for a rename or copy; a path may itself begin with `:`.
/// O(output).
pub(crate) fn raw_records(raw: &str) -> impl Iterator<Item = (&str, &str)> {
    let mut fields = raw.split('\0').filter(|field| !field.is_empty());
    // The last header, and how many paths it promised are still to come.
    let mut header = "";
    let mut owed = 0;
    iter::from_fn(move || {
        loop {
            let field = fields.next()?;
            if owed > 0 {
                owed -= 1;
                return Some((header, field));
            }
            header = field;
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
        let rename = ":100644 100644 bbb 000 R087";
        assert_eq!(
            raw_records(raw).collect::<Vec<_>>(),
            [
                (":100644 100644 aaa 000 M", ":notes.md"),
                (rename, "old.ts"),
                (rename, "new.ts")
            ]
        );
    }
}
