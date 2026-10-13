//! A range of a file's lines, for the unchanged lines a diff leaves out.

use crate::{
    diff::Side,
    repository::{RepoError, Repository, Snapshot},
};

/// Lines `first..=last` (1-based) of `path` on `side` of `snapshot`, for the
/// unchanged lines a diff leaves out; fewer when the file ends sooner. Read
/// as `str::lines` reads them, like the diff's own lines.
///
/// # Errors
/// As [`Repository::blob`].
pub fn lines(
    repository: &(impl Repository + ?Sized),
    snapshot: &Snapshot,
    side: Side,
    path: &str,
    first: u32,
    last: u32,
) -> Result<Vec<String>, RepoError> {
    let bytes = repository.blob(snapshot, side, path)?;
    let skip = first.saturating_sub(1) as usize;
    let take = last.saturating_add(1).saturating_sub(first.max(1)) as usize;
    Ok(String::from_utf8_lossy(&bytes)
        .lines()
        .skip(skip)
        .take(take)
        .map(str::to_owned)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{repository::NewSide, review::tests::Fixed};

    fn lines_of(first: u32, last: u32) -> Vec<String> {
        let snapshot = Snapshot {
            old: None,
            new: NewSide::WorkingTree,
        };
        lines(&Fixed(vec![]), &snapshot, Side::New, "a.ts", first, last).unwrap()
    }

    #[test]
    fn lines_returns_the_range_asked_for_without_line_endings() {
        assert_eq!(lines_of(1, 2), ["one", "two"]);
        assert_eq!(lines_of(2, 4), ["two", "three", "four"]);
        assert_eq!(lines_of(3, 3), ["three"]);
    }

    #[test]
    fn lines_past_the_end_or_in_an_empty_range_are_left_out() {
        assert_eq!(lines_of(4, 9), ["four"]);
        assert!(lines_of(5, 9).is_empty());
        assert!(lines_of(3, 2).is_empty());
        assert_eq!(lines_of(0, 1), ["one"]);
        assert_eq!(lines_of(4, u32::MAX), ["four"]);
    }
}
