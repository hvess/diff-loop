// A review's key as the front end compares and names it (ADR 0026 §1).
import type { ReviewKey } from "./bindings/ReviewKey";

/** Whether `a` and `b` name the same review; null names none. */
export const sameKey = (a: ReviewKey | null, b: ReviewKey | null) =>
  a === b || (a !== null && b !== null && a.project === b.project && a.branch === b.branch);

/** A string naming the review, for a map's key or a list's. */
export const idOf = (key: ReviewKey) => JSON.stringify([key.project, key.branch]);
