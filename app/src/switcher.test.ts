import { describe, expect, it } from "vitest";
import type { Branch } from "./bindings/Branch";
import type { KeptReview } from "./bindings/KeptReview";
import type { ProjectCheck } from "./bindings/ProjectCheck";
import { type BranchRow, type Check, RECENT, type Row, listing, listsOf } from "./switcher";

const NOW = Date.UTC(2026, 9, 25, 12);
const HOUR = 3600000;
const P = "/home/me/code/drive-web/.git";

/** A local branch committed to `hours` ago, or one only on `remote`. */
const branch = (name: string, hours: number, remote?: string): Branch => ({
  name,
  commit: "c",
  updated: NOW - hours * HOUR,
  location: remote ? { kind: "remote", remote } : { kind: "local", remote: null, worktree: null },
});

const kept = (name: string, o: { open?: number; at?: number } = {}): KeptReview => ({
  key: { project: P, branch: name },
  summary: { open: o.open ?? 0, seen: o.at === undefined ? null : { commit: "c", at: o.at } },
});

const check = (branches: Branch[]): Check => ({ branches, gone: [] }) satisfies ProjectCheck;

const BRANCHES = [
  branch("main", 24),
  branch("agent/share-retry", 2),
  branch("agent/share-rate-limit", 1),
  branch("old/session-store", 2000),
  branch("agent/retry-backoff", 120, "origin"),
  branch("fix/sync-retry", 500, "origin"),
];

const names = (rows: Row[]) => rows.map((r) => (r.kind === "branch" ? r.name : `[${r.title}]`));

describe("the branch switcher", () => {
  it("opens on Recent: the branch shown, then the reviews last shown, then the local branches last committed to", () => {
    const sections = listing({
      query: "",
      list: null,
      check: check(BRANCHES),
      kept: [kept("main", { at: 5 }), kept("old/session-store", { at: 9, open: 2 })],
      shown: "agent/share-rate-limit",
      now: NOW,
    });
    expect(sections.map((s) => s.title)).toEqual(["Recent", ""]);
    expect(names(sections[0]!.rows)).toEqual(["agent/share-rate-limit", "old/session-store", "main", "agent/share-retry"]);
    expect(names(sections[1]!.rows)).toEqual(["[Local Branches]", "[origin]"]);
  });

  it("marks the branch shown, a review's open comments and each branch's age", () => {
    const [recent] = listing({ query: "", list: null, check: check(BRANCHES), kept: [kept("main", { open: 3 })], shown: "main", now: NOW });
    const rows = recent!.rows as BranchRow[];
    expect(rows[0]).toMatchObject({ name: "main", current: true, open: 3, age: "1d" });
    expect(rows[1]).toMatchObject({ current: false, open: 0, age: "1h" });
  });

  it("lists no more than the limit in Recent", () => {
    const many = Array.from({ length: RECENT + 4 }, (_, i) => branch(`b${i}`, i));
    const [recent] = listing({ query: "", list: null, check: check(many), kept: [], shown: null, now: NOW });
    expect(recent!.rows).toHaveLength(RECENT);
  });

  it("lists the reviews alone in Recent until the project's branches are read", () => {
    const sections = listing({ query: "", list: null, check: undefined, kept: [kept("main", { at: 1 })], shown: "x", now: NOW });
    expect(sections.map((s) => names(s.rows))).toEqual([["x", "main"]]);
  });

  it("searches every local and remote branch, grouped by list", () => {
    const sections = listing({ query: "RETRY", list: null, check: check(BRANCHES), kept: [], shown: null, now: NOW });
    expect(sections.map((s) => [s.title, names(s.rows)])).toEqual([
      ["Local Branches", ["agent/share-retry"]],
      ["origin", ["agent/retry-backoff", "fix/sync-retry"]],
    ]);
  });

  it("lists one list's branches when it is opened, narrowed by the query", () => {
    const all = listing({ query: "", list: "remote:origin", check: check(BRANCHES), kept: [], shown: null, now: NOW });
    expect(all.map((s) => names(s.rows))).toEqual([["agent/retry-backoff", "fix/sync-retry"]]);
    const narrowed = listing({ query: "sync", list: "remote:origin", check: check(BRANCHES), kept: [], shown: null, now: NOW });
    expect(narrowed.map((s) => names(s.rows))).toEqual([["fix/sync-retry"]]);
  });
});

describe("a project's lists", () => {
  it("are its local branches, then each remote's by name, leaving out an empty one", () => {
    const lists = listsOf([branch("a", 1, "upstream"), branch("b", 1), branch("c", 1, "origin")]);
    expect(lists.map((l) => [l.key, l.title, l.trail, l.branches.map((b) => b.name)])).toEqual([
      ["local", "Local Branches", "1", ["b"]],
      ["remote:origin", "origin", "1 branch", ["c"]],
      ["remote:upstream", "upstream", "1 branch", ["a"]],
    ]);
    expect(listsOf([branch("a", 1, "origin"), branch("b", 1, "origin")])[0]?.trail).toBe("2 branches");
    expect(listsOf([branch("a", 1, "origin")]).map((l) => l.key)).toEqual(["remote:origin"]);
  });
});
