/** Where a review is read from, as the design draws it: solid while live in a worktree, hollow otherwise. */
export function Dot({ live }: { live: boolean }) {
  return (
    <span
      aria-hidden
      className={`size-[7px] flex-none rounded-full ${live ? "bg-live" : "shadow-[inset_0_0_0_1.5px_var(--color-faint)]"}`}
    />
  );
}
