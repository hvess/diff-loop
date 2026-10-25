// What the review switcher and the sidebar's Other Reviews list (ADR 0026 §7; the design's flow 6 and 2a).
import type { Branch } from "./bindings/Branch";
import type { KeptReview } from "./bindings/KeptReview";
import type { ProjectCheck } from "./bindings/ProjectCheck";
import type { ReviewKey } from "./bindings/ReviewKey";
import type { RoundSummary } from "./bindings/RoundSummary";
import type { SinceSeen } from "./bindings/SinceSeen";
import { when } from "./format";
import { sameKey } from "./key";
import { projectRoot, tildify, whereIs } from "./path";
import { folded } from "./search";

/** A project's last check: done, or failed; absent until its first answers. */
export type Check = ProjectCheck | "failed";

/** A row: a kept review, a branch with none yet, or opening a folder. */
export type Row =
  | {
      kind: "review";
      key: ReviewKey;
      /** Whether its branch is checked out in a worktree: the dot is solid. */
      live: boolean;
      where: string;
      /** "+3 commits" or "Rewritten", drawn as a badge; null when the branch is where it was, or not checked yet. */
      moved: string | null;
      comments: string;
      /** Whether `comments` names open ones, drawn heavier. */
      open: boolean;
      round: string;
      /** Whether the window shows it. */
      current: boolean;
    }
  | { kind: "branch"; key: ReviewKey; live: boolean; where: string; current: boolean }
  | { kind: "openFolder" };

/** A group of rows under its name, and its trail: a project's path, or words. */
export type Group = { key: string; name: string; meta: string; rows: Row[] };

/** What the switcher lists, and above it, when the project has no review yet, how one starts. */
export type Listing = { empty: { title: string; body: string } | null; groups: Group[] };

/** What a row whose project is not checked yet says in its place line. */
export const CHECKING = "Checking…";

/** Most rows a group lists; typing narrows to the rest. */
const SHOWN = 50;

/** "+3 commits", or that the branch was rewritten, since the review was last shown. */
function movedOf(since: SinceSeen | undefined): Extract<Row, { kind: "review" }>["moved"] {
  if (!since || since.kind === "unchanged") return null;
  return since.kind === "moved" ? `+${since.count} ${since.count === 1 ? "commit" : "commits"}` : "Rewritten";
}

/** The root of the worktree that has `branch` checked out, if one does (as the core's `Branch::worktree`). */
const worktreeOf = (branch: Branch) => (branch.location.kind === "local" ? branch.location.worktree : null);

/** Where a branch is, as a row says it: live in a worktree, relative to its project, or its commits alone, and where those are. */
function whereOf(branch: Branch, project: string, home: string | null): string {
  const { location } = branch;
  if (location.kind === "remote") return `Committed only · on ${location.remote}`;
  return location.worktree === null ? "Committed only · not checked out" : `Live in ${whereIs(location.worktree, project, home)}`;
}

/** "Round 2 sent · 10 min ago", or "No rounds yet", as the canvas's 6a says it. */
export function roundOf(round: RoundSummary | null, now: number): string {
  return round ? `Round ${round.number} sent · ${when(round.at, now)}` : "No rounds yet";
}

/** A check's branches and reviews by branch name, built once per check, which is never changed. */
const byName = new WeakMap<ProjectCheck, { branches: Map<string, Branch>; since: Map<string, SinceSeen> }>();

function indexOf(check: ProjectCheck) {
  let index = byName.get(check);
  if (!index) {
    index = {
      branches: new Map(check.branches.map((b) => [b.name, b])),
      since: new Map(check.reviews.map((r) => [r.branch, r.since])),
    };
    byName.set(check, index);
  }
  return index;
}

/** A kept review's row; its branch's place once its project has been checked. */
export function reviewRow(
  review: KeptReview,
  check: Check | undefined,
  home: string | null,
  now: number,
  shown: ReviewKey | null = null,
  checking = CHECKING,
): Extract<Row, { kind: "review" }> {
  const { key, summary, elsewhere } = review;
  const index = check && check !== "failed" ? indexOf(check) : undefined;
  const branch = index?.branches.get(key.branch);
  const since = index?.since.get(key.branch);
  let where = checking;
  if (elsewhere) where = "Open in another window";
  else if (check === "failed") where = "Couldn’t be checked";
  else if (branch) where = whereOf(branch, key.project, home);
  return {
    kind: "review",
    key,
    live: branch !== undefined && worktreeOf(branch) !== null,
    where,
    moved: movedOf(since),
    comments: summary.open > 0 ? `${summary.open} open` : summary.comments > 0 ? "All resolved" : "",
    open: summary.open > 0,
    round: roundOf(summary.round, now),
    current: sameKey(key, shown),
  };
}

/** Most recently shown first; one never shown last. */
const byShown = (a: KeptReview, b: KeptReview) => (b.summary.seen?.at ?? -1) - (a.summary.seen?.at ?? -1);

/** Live branches first, then the most recently updated. */
const byPlace = (a: Branch, b: Branch) =>
  Number(worktreeOf(b) !== null) - Number(worktreeOf(a) !== null) || (b.updated ?? 0) - (a.updated ?? 0);

/** The remote a branch is on, as its upstream or alone, if any. */
const remoteOf = (branch: Branch) => branch.location.remote;

/** "6 local · 24 on origin": how many branches are local, and on each remote. */
function branchCounts(branches: Branch[]): string {
  const remotes = new Map<string, number>();
  for (const b of branches) {
    const remote = remoteOf(b);
    if (remote !== null) remotes.set(remote, (remotes.get(remote) ?? 0) + 1);
  }
  const local = branches.filter((b) => b.location.kind === "local").length;
  return [`${local} local`, ...[...remotes].map(([remote, n]) => `${n} on ${remote}`)].join(" · ");
}

function branchRow(branch: Branch, project: string, home: string | null, shown: ReviewKey | null): Row {
  const remote = remoteOf(branch);
  const live = worktreeOf(branch) !== null;
  const also = live && remote !== null ? ` · also on ${remote}` : "";
  const key = { project, branch: branch.name };
  return { kind: "branch", key, live, where: whereOf(branch, project, home) + also, current: sameKey(key, shown) };
}

/**
 * The switcher's rows (the design's 6a–6c): with no query, the project shown's reviews first, the
 * one shown at their top, then every other project's, each most recently shown first; a project
 * shown that has none says how a review starts and lists its branches. Typing lists the reviews
 * whose branch or project holds the query, then the project's branches without one. The last row
 * opens a folder. O(r log r + b log b) per call for r reviews and b branches, once per keystroke
 * or check, each row finding its branch by name in an index built once per check in O(b).
 */
export function listing(at: {
  query: string;
  /** The review shown and its project's name; null with no project open. */
  shown: { key: ReviewKey | null; project: string; name: string } | null;
  kept: KeptReview[];
  checks: Map<string, Check>;
  home: string | null;
  now: number;
  /** Said where a project is not checked yet: `CHECKING`, or nothing for the first 200 ms (ADR 0010 §6). */
  checking: string;
}): Listing {
  const q = folded(at.query.trim());
  const here = at.shown?.project ?? null;
  const check = here === null ? undefined : at.checks.get(here);
  const branches = check && check !== "failed" ? check.branches : [];
  const shownKey = at.shown?.key ?? null;
  const row = (review: KeptReview) => reviewRow(review, at.checks.get(review.key.project), at.home, at.now, shownKey, at.checking);
  const open: Row = { kind: "openFolder" };
  if (q) {
    const matches = at.kept.filter((r) => folded(r.key.branch).includes(q) || folded(r.name).includes(q)).sort(byShown);
    const reviewed = new Set(at.kept.filter((r) => r.key.project === here).map((r) => r.key.branch));
    const unreviewed = branches.filter((b) => !reviewed.has(b.name) && folded(b.name).includes(q)).sort(byPlace);
    const groups: Group[] = [{ key: "reviews", name: "Reviews", meta: matches.length === 0 ? "No matches" : "", rows: matches.slice(0, SHOWN).map(row) }];
    if (at.shown !== null && here !== null && unreviewed.length > 0) {
      // Named for its project, since the reviews above it are every project's (HIG `searching`).
      groups.push({
        key: "branches",
        name: `Branches without a review in ${at.shown.name}`,
        meta: "",
        rows: unreviewed.slice(0, SHOWN).map((b) => branchRow(b, here, at.home, shownKey)),
      });
    }
    groups.push({ key: "open", name: "", meta: "", rows: [open] });
    return { empty: null, groups };
  }
  const byProject = new Map<string, KeptReview[]>();
  for (const review of [...at.kept].sort(byShown)) {
    const list = byProject.get(review.key.project);
    if (list) list.push(review);
    else byProject.set(review.key.project, [review]);
  }
  const groups: Group[] = [];
  let empty: Listing["empty"] = null;
  if (at.shown !== null && here !== null) {
    const own = byProject.get(here) ?? [];
    byProject.delete(here);
    if (own.length > 0) {
      const ordered = [...own.filter((r) => sameKey(r.key, shownKey)), ...own.filter((r) => !sameKey(r.key, shownKey))];
      groups.push({ key: here, name: at.shown.name, meta: tildify(projectRoot(here), at.home), rows: ordered.slice(0, SHOWN).map(row) });
    } else {
      empty = {
        title: `No reviews in ${at.shown.name} yet`,
        body: "A review starts with your first comment on a branch. Looking at branches before then leaves nothing behind.",
      };
      groups.push({
        key: "branches",
        name: `Branches without a review in ${at.shown.name}`,
        meta: check === undefined ? at.checking : check === "failed" ? "Couldn’t be checked" : branchCounts(branches),
        rows: [...branches].sort(byPlace).slice(0, SHOWN).map((b) => branchRow(b, here, at.home, shownKey)),
      });
    }
  }
  for (const [project, reviews] of byProject) {
    groups.push({ key: project, name: reviews[0]!.name, meta: tildify(projectRoot(project), at.home), rows: reviews.slice(0, SHOWN).map(row) });
  }
  groups.push({ key: "open", name: "", meta: "", rows: [open] });
  return { empty, groups };
}

/** The sidebar's Other Reviews (the canvas's 2a): every project's, most recently shown first, at most `limit`. */
export function recentReviews(kept: KeptReview[], limit: number): KeptReview[] {
  return [...kept].sort(byShown).slice(0, limit);
}
