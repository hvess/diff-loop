/**
 * A review's dot (the canvas's `.live` / `.cold`): solid while its branch is live in a worktree, hollow when read
 * from its commits alone. `named` where no words beside it say the same; elsewhere its place line does.
 */
export function LiveDot({ live, named = false }: { live: boolean; named?: boolean }) {
  const className = live ? "live" : "cold";
  if (!named) return <span aria-hidden className={className} />;
  return <span role="img" aria-label={live ? "Live in a worktree" : "Committed only"} className={className} />;
}
