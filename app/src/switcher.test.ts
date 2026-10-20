import { describe, expect, it } from "vitest";
import type { Branch } from "./bindings/Branch";
import type { KeptReview } from "./bindings/KeptReview";
import type { ProjectCheck } from "./bindings/ProjectCheck";
import { type Check, type Row, listing, recentReviews, reviewRow, roundOf } from "./switcher";

const NOW = Date.UTC(2026, 9, 19, 12);
const P = "/home/me/code/drive-web/.git";
const Q = "/home/me/code/pass-cli/.git";

const kept = (project: string, branch: string, o: { open?: number; comments?: number; at?: number; round?: number } = {}): KeptReview => ({
  key: { project, branch },
  name: project === P ? "drive-web" : "pass-cli",
  summary: {
    comments: o.comments ?? o.open ?? 0,
    open: o.open ?? 0,
    round: o.round === undefined ? null : { number: o.round, at: NOW - 10 * 60000 },
    seen: o.at === undefined ? null : { commit: "c", at: o.at },
  },
  elsewhere: false,
});

/** A local branch, with its upstream's remote and worktree if given; or one only on `only`. */
const branch = (name: string, o: { worktree?: string; remote?: string; only?: string; updated?: number } = {}): Branch => ({
  name,
  commit: "c",
  updated: o.updated ?? 0,
  location: o.only ? { kind: "remote", remote: o.only } : { kind: "local", remote: o.remote ?? null, worktree: o.worktree ?? null },
});

const checked = (branches: Branch[], reviews: ProjectCheck["reviews"] = []): ProjectCheck => ({ branches, reviews, gone: [] });

const shown = (branchName: string | null) => ({
  key: branchName === null ? null : { project: P, branch: branchName },
  project: P,
  name: "drive-web",
});

const names = (rows: Row[]) => rows.map((r) => (r.kind === "openFolder" ? "open folder" : r.key.branch));

describe("the review switcher's list", () => {
  const reviews = [
    kept(P, "agent/share-retry", { open: 4, at: 3, round: 1 }),
    kept(P, "agent/share-rate-limit", { open: 3, at: 1, round: 2 }),
    kept(Q, "agent/fix-sync-retry", { open: 2, at: 2 }),
  ];

  it("lists the project's reviews first, the one shown at their top, then other projects', then opening a folder", () => {
    const { empty, groups } = listing({
      query: "",
      shown: shown("agent/share-rate-limit"),
      kept: reviews,
      checks: new Map(),
      home: "/home/me",
      now: NOW,
      checking: "Checking…",
    });
    expect(empty).toBeNull();
    expect(groups.map((g) => [g.name, g.meta])).toEqual([
      ["drive-web", "~/code/drive-web"],
      ["pass-cli", "~/code/pass-cli"],
      ["", ""],
    ]);
    expect(groups.map((g) => names(g.rows))).toEqual([["agent/share-rate-limit", "agent/share-retry"], ["agent/fix-sync-retry"], ["open folder"]]);
    // The review on screen is marked, and only it.
    expect(groups[0]?.rows.map((r) => r.kind === "review" && r.current)).toEqual([true, false]);
  });

  it("says how a review starts and lists the branches, live ones first, in a project with none", () => {
    const branches = [
      branch("feature/old-export", { updated: 9 }),
      branch("main", { worktree: "/home/me/code/drive-web", remote: "origin" }),
      branch("agent/x", { worktree: "/home/me/code/drive-web/.wt/x", updated: 5 }),
      branch("spike/webp", { only: "origin" }),
    ];
    const { empty, groups } = listing({
      query: "",
      shown: shown("agent/x"),
      kept: [],
      checks: new Map([[P, checked(branches)]]),
      home: "/home/me",
      now: NOW,
      checking: "Checking…",
    });
    expect(empty?.title).toBe("No reviews in drive-web yet");
    const [list] = groups;
    expect(list?.name).toBe("Branches without a review in drive-web");
    expect(list?.meta).toBe("3 local · 2 on origin");
    expect(list?.rows.map((r) => (r.kind === "branch" ? [r.key.branch, r.where, r.live] : null))).toEqual([
      ["agent/x", "Live in .wt/x", true],
      ["main", "Live in ~/code/drive-web · also on origin", true],
      ["feature/old-export", "Committed only · not checked out", false],
      ["spike/webp", "Committed only · on origin", false],
    ]);
  });

  it("finds reviews by branch or project, then branches without a review", () => {
    const branches = [
      branch("agent/thumbnail-cache", { worktree: "/home/me/code/drive-web/.wt/thumbnail-cache", remote: "origin" }),
      branch("agent/share-retry"),
      branch("spike/thumb-webp", { only: "origin" }),
    ];
    const at = (query: string) =>
      listing({ query, shown: shown("agent/share-retry"), kept: reviews, checks: new Map([[P, checked(branches)]]), home: null, now: NOW, checking: "Checking…" });
    const thumb = at("THUMB").groups;
    expect(thumb[0]).toMatchObject({ name: "Reviews", meta: "No matches", rows: [] });
    expect(thumb[1]?.name).toBe("Branches without a review in drive-web");
    expect(thumb[1]?.rows).toEqual([
      { kind: "branch", key: { project: P, branch: "agent/thumbnail-cache" }, live: true, where: "Live in .wt/thumbnail-cache · also on origin", current: false },
      { kind: "branch", key: { project: P, branch: "spike/thumb-webp" }, live: false, where: "Committed only · on origin", current: false },
    ]);
    expect(names(at("pass").groups[0]!.rows)).toEqual(["agent/fix-sync-retry"]);
    // A branch with a review is found as the review, not again as a branch.
    expect(at("share-retry").groups.map((g) => g.name)).toEqual(["Reviews", ""]);
  });
});

describe("a review's row", () => {
  const review = kept(P, "agent/share-retry", { open: 4, round: 1 });

  it("says it is being checked until its project is, and where its branch is after", () => {
    expect(reviewRow(review, undefined, null, NOW)).toMatchObject({ where: "Checking…", live: false, moved: null });
    const check: Check = checked([branch("agent/share-retry", { worktree: "/home/me/code/drive-web/.wt/share-retry" })], [
      { branch: "agent/share-retry", since: { kind: "moved", from: "a", count: 3 } },
    ]);
    expect(reviewRow(review, check, "/home/me", NOW)).toMatchObject({
      where: "Live in .wt/share-retry",
      live: true,
      moved: { label: "+3 commits", rewritten: false },
      comments: "4 comments",
      open: true,
      round: "Round 1 sent · 10 min ago",
    });
    expect(reviewRow(review, "failed", null, NOW).where).toBe("Couldn’t be checked");
  });

  it("names a rewrite, a review open in another window, and one all resolved", () => {
    const check: Check = checked([branch("agent/share-retry")], [{ branch: "agent/share-retry", since: { kind: "rewritten", from: "a" } }]);
    expect(reviewRow(review, check, null, NOW).moved).toEqual({ label: "Rewritten", rewritten: true });
    expect(reviewRow({ ...review, elsewhere: true }, check, null, NOW).where).toBe("Open in another window");
    const done = kept(P, "b", { comments: 2, open: 0 });
    done.summary.open = 0;
    expect(reviewRow(done, undefined, null, NOW)).toMatchObject({ comments: "All resolved", open: false, round: "Nothing sent yet" });
    expect(roundOf({ number: 3, at: NOW }, NOW)).toBe("Round 3 sent · Just now");
  });
});

describe("the welcome screen's reviews", () => {
  it("are every project's, most recently shown first, never shown last, up to the limit", () => {
    const list = recentReviews([kept(P, "a", { at: 1 }), kept(Q, "b"), kept(P, "c", { at: 5 }), kept(Q, "d", { at: 3 })], 3);
    expect(list.map((r) => r.key.branch)).toEqual(["c", "d", "a"]);
  });
});
