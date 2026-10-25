//! A branch's name as one file name (ADR 0030 §1): `%` written `%25` and
//! `/` written `%2F`, so that `a` and `a/b` never collide.

/// What every review file's name ends with.
const EXTENSION: &str = ".json";

/// The file `branch`'s review is kept in.
pub(crate) fn file_name(branch: &str) -> String {
    // `%` first, or the `%` of each `%2F` would be escaped again.
    format!(
        "{}{EXTENSION}",
        branch.replace('%', "%25").replace('/', "%2F")
    )
}

/// The branch whose review `file_name` holds; `None` for a file that is not
/// one ([`file_name`] never wrote it), a lock or a write in progress among them.
pub(crate) fn branch(file_name: &str) -> Option<String> {
    // A loop, not `replace`: an escape other than these two means a file no
    // review was written to.
    let mut rest = file_name.strip_suffix(EXTENSION)?;
    let mut branch = String::with_capacity(rest.len());
    while let Some(at) = rest.find('%') {
        branch.push_str(&rest[..at]);
        let escape = rest.get(at..at + 3)?;
        branch.push(match escape {
            "%25" => '%',
            "%2F" => '/',
            _ => return None,
        });
        rest = &rest[at + 3..];
    }
    branch.push_str(rest);
    (!branch.is_empty()).then_some(branch)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_branch_is_one_file_name_and_reads_back() {
        for (branch, file) in [
            ("main", "main.json"),
            ("agent/share-retry", "agent%2Fshare-retry.json"),
            ("a/b/c", "a%2Fb%2Fc.json"),
            ("100%/fix", "100%25%2Ffix.json"),
            ("%2F", "%252F.json"),
            ("v1.2", "v1.2.json"),
        ] {
            assert_eq!(file_name(branch), file, "{branch}");
            assert_eq!(super::branch(file).as_deref(), Some(branch), "{file}");
        }
    }

    #[test]
    fn a_file_no_review_was_written_to_names_no_branch() {
        for file in [
            "main.json.lock",
            "main.json.next",
            "main",
            ".json",
            "a%2.json",
            "a%2Gb.json",
            "a%.json",
        ] {
            assert_eq!(branch(file), None, "{file}");
        }
    }
}
