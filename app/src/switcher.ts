// What the branch switcher lists: the project's branches only (ADR 0035; the canvas's 6a, 6b).
import type { Branch } from "./bindings/Branch";
import type { KeptReview } from "./bindings/KeptReview";
import type { ProjectCheck } from "./bindings/ProjectCheck";
import { age } from "./format";
import { folded } from "./search";

/** A project's last check: done, or failed; absent until its first answers. */
export type Check = ProjectCheck | "failed";

/** A branch's row: its name, its review's open comments, its last commit's age, and whether the window shows it. */
export type BranchRow = {
  kind: "branch";
  name: string;
  /** The review's open comments, drawn as a badge; 0 with none or no review. */
  open: number;
  /** "2h": the age of its last commit; "" when it has none. */
  age: string;
  /** Its last commit's date in full, the age's tooltip. */
  title: string | undefined;
  current: boolean;
};

/** A row that opens a list of branches in place: the local ones, or one remote's, with its count ("24 branches"). */
export type ListRow = { kind: "list"; key: string; title: string; trail: string };

export type Row = BranchRow | ListRow;

/** A heading over rows: "Recent", or in a search, the list its matches come from. */
export type Section = { key: string; title: string; rows: Row[] };

/** How many branches Recent lists. */
export const RECENT = 8;

/** Most rows a list or a search group shows; typing narrows to the rest. */
const SHOWN = 50;

/** The lists a project's branches fall into: its local branches, then each remote's, by name. O(b). */
export function listsOf(branches: Branch[]): { key: string; title: string; trail: string; branches: Branch[] }[] {
  const local: Branch[] = [];
  const remotes = new Map<string, Branch[]>();
  for (const branch of branches) {
    if (branch.location.kind === "local") {
      local.push(branch);
      continue;
    }
    const list = remotes.get(branch.location.remote);
    if (list) list.push(branch);
    else remotes.set(branch.location.remote, [branch]);
  }
  // The canvas's 6a counts a remote's in words and the local ones bare.
  const lists = local.length > 0 ? [{ key: "local", title: "Local Branches", trail: `${local.length}`, branches: local }] : [];
  for (const [remote, list] of [...remotes].sort(([a], [b]) => a.localeCompare(b))) {
    lists.push({ key: `remote:${remote}`, title: remote, trail: `${list.length} ${list.length === 1 ? "branch" : "branches"}`, branches: list });
  }
  return lists;
}

/**
 * The switcher's sections (the canvas's 6a, 6b). In a list opened in place, its branches matching `query`. With a
 * query, every branch matching it, grouped by list. Otherwise Recent, then a row opening each list. O(b log b + r log r) per
 * call for b branches and r reviews, once per keystroke or check.
 */
export function listing(at: {
  query: string;
  /** The list opened in place, by key; null for the first view. */
  list: string | null;
  /** The project's check; its branches are listed once it has answered. */
  check: Check | undefined;
  /** The project's own kept reviews. */
  kept: KeptReview[];
  /** The branch the window shows. */
  shown: string | null;
  now: number;
}): Section[] {
  const branches = at.check && at.check !== "failed" ? at.check.branches : [];
  const reviews = new Map(at.kept.map((r) => [r.key.branch, r]));
  const row = (name: string, branch: Branch | undefined): BranchRow => {
    const updated = branch?.updated ?? null;
    return {
      kind: "branch",
      name,
      open: reviews.get(name)?.summary.open ?? 0,
      age: updated === null ? "" : age(updated, at.now),
      title: updated === null ? undefined : new Date(updated).toLocaleString(),
      current: name === at.shown,
    };
  };
  const lists = listsOf(branches);
  const q = folded(at.query.trim());
  const opened = at.list === null ? undefined : lists.find((l) => l.key === at.list);
  if (opened) {
    const rows = opened.branches.filter((b) => folded(b.name).includes(q)).slice(0, SHOWN);
    return [{ key: opened.key, title: "", rows: rows.map((b) => row(b.name, b)) }];
  }
  if (q) {
    return lists.flatMap((l) => {
      const rows = l.branches.filter((b) => folded(b.name).includes(q)).slice(0, SHOWN);
      return rows.length === 0 ? [] : [{ key: l.key, title: l.title, rows: rows.map((b) => row(b.name, b)) }];
    });
  }
  const byName = new Map(branches.map((b) => [b.name, b]));
  // The shown branch, then the reviews last shown, then the local branches last committed to.
  const shownFirst = at.shown === null ? [] : [at.shown];
  const reviewed = [...at.kept].sort((a, b) => (b.summary.seen?.at ?? -1) - (a.summary.seen?.at ?? -1)).map((r) => r.key.branch);
  const committed = branches
    .filter((b) => b.location.kind === "local")
    .sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0))
    .map((b) => b.name);
  const recent = [...new Set([...shownFirst, ...reviewed, ...committed])].slice(0, RECENT);
  const sections: Section[] = [{ key: "recent", title: "Recent", rows: recent.map((name) => row(name, byName.get(name))) }];
  if (lists.length > 0) {
    sections.push({ key: "lists", title: "", rows: lists.map((l) => ({ kind: "list", key: l.key, title: l.title, trail: l.trail })) });
  }
  return sections;
}
