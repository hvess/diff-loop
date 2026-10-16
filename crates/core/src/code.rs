//! How two lines of code are compared: whitespace alone is not a change (ADR 0015 §7).

/// Whether `a` and `b` are the same code: trailing whitespace trimmed, and a
/// run of leading whitespace counting only as present or absent.
#[must_use]
pub(crate) fn same_code(a: &str, b: &str) -> bool {
    let (a, b) = (a.trim_end(), b.trim_end());
    let indented = |s: &str| s.len() != s.trim_start().len();
    indented(a) == indented(b) && a.trim_start() == b.trim_start()
}

/// Whether `code` and `other` are the same lines, as many and each by
/// [`same_code`].
#[must_use]
pub(crate) fn same_lines<'a, 'b>(
    code: impl IntoIterator<Item = &'a str>,
    other: impl IntoIterator<Item = &'b str>,
) -> bool {
    let mut other = other.into_iter();
    code.into_iter()
        .all(|a| other.next().is_some_and(|b| same_code(a, b)))
        && other.next().is_none()
}

/// `text`'s lines with their common leading whitespace removed.
pub(crate) fn dedent(text: &str) -> impl Iterator<Item = &str> {
    let indent = text
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| l.len() - l.trim_start().len())
        .min()
        .unwrap_or(0);
    text.lines()
        .map(move |l| l.get(indent..).unwrap_or_else(|| l.trim_start()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn whitespace_alone_is_not_a_change() {
        assert!(same_code("  foo();  ", "\tfoo();"));
        assert!(same_code("foo();", "foo();   "));
        assert!(!same_code("foo();", "  foo();"));
        assert!(!same_code("foo( );", "foo();"));
    }

    #[test]
    fn lines_are_the_same_only_when_every_one_is() {
        let code = ["  a", "b"];
        assert!(same_lines(code, ["    a", "b "]));
        assert!(!same_lines(code, ["  a"]));
        assert!(!same_lines(code, ["  a", "b", "c"]));
        assert!(!same_lines(code, ["  a", "c"]));
    }

    #[test]
    fn dedent_removes_the_shared_indent_and_leaves_blank_lines_empty() {
        let lines: Vec<&str> = dedent("    a\n\n      b").collect();
        assert_eq!(lines, ["a", "", "  b"]);
    }
}
