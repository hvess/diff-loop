/**
 * A review's dot (the canvas's `.live` / `.cold`): solid while its branch is live in a worktree, hollow when read
 * from its commits alone. Hidden from assistive tech: the place line beside it says the same.
 */
export function LiveDot({ live }: { live: boolean }) {
  return <span aria-hidden className={live ? "live" : "cold"} />;
}
