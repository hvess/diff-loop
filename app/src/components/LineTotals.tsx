import type { LineCounts } from "../bindings/LineCounts";

/** "+42 −8": lines added and removed, a zero left out. In a flex row, the gap spaces the two. */
export function LineTotals({ counts }: { counts: LineCounts }) {
  return (
    <>
      {counts.added > 0 && <span className="text-add">+{counts.added}</span>}
      {counts.added > 0 && counts.removed > 0 && " "}
      {counts.removed > 0 && <span className="text-del">−{counts.removed}</span>}
    </>
  );
}
