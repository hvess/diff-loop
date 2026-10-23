import { describe, expect, it } from "vitest";
import type { Base } from "../bindings/Base";
import type { BaseRef } from "../bindings/BaseRef";
import {
  arrival,
  baseLabel,
  groupCount,
  groupSize,
  groupsOf,
  listItems,
  matching,
  picks,
  refTrail,
  remoteOf,
  type Item,
} from "./BasePicker";

const NOW = Date.UTC(2026, 9, 17, 12);
const HOUR = 60 * 60 * 1000;
const ref = (name: string, kind: BaseRef["kind"], updated: number | null = NOW - HOUR): BaseRef => ({
  name,
  kind,
  updated,
});

const refs = [
  ref("agent/fix-upload-retry", "branch"),
  ref("origin/main", "remote"),
  ref("main", "branch"),
  ref("v1.2", "tag"),
  ref("upstream/main", "remote"),
  ref("origin/agent/x", "remote"),
];

const keys = (items: Item[]) => items.map((item) => (item.kind === "group" ? item.group.key : item.choice.key));

const top = (base: Base, defaultBranch: string | null = "main", committedOnly: string | null = null) =>
  listItems({
    group: null,
    query: "",
    groups: groupsOf(refs, "agent/x"),
    refs,
    defaultBranch,
    base,
    uncommitted: { added: 42, removed: 8 },
    commit: "a1f3c9e5b2",
    committedOnly,
    now: NOW,
  }).items;

describe("the base picker's first list", () => {
  it("offers no uncommitted changes, and says why, for a branch no worktree has checked out", () => {
    const [first] = top({ kind: "ref", name: "main" }, "main", "feature/old-export");
    expect(first?.kind === "choice" && first.choice).toMatchObject({
      key: "uncommitted",
      base: null,
      why: "feature/old-export isn’t checked out in any worktree. Check it out in one to compare with its uncommitted changes.",
    });
    expect(picks(first)).toBe(false);
  });

  it("orders uncommitted changes, the last commit, the default branch, then the lists", () => {
    expect(keys(top({ kind: "ref", name: "main" }))).toEqual([
      "uncommitted",
      "lastCommit",
      "default",
      "local",
      "remote:origin",
      "remote:upstream",
      "tags",
    ]);
  });

  it("lists a base other than the default under it, so it can be kept", () => {
    expect(keys(top({ kind: "ref", name: "v1.2" })).slice(0, 4)).toEqual([
      "uncommitted",
      "lastCommit",
      "default",
      "ref:v1.2",
    ]);
    const commit = top({
      kind: "ref",
      name: "9671d8a0c3b1e2f4a5b6c7d8e9f0a1b2c3d4e5f6",
    })[3];
    expect(commit?.kind === "choice" && [commit.choice.label, commit.choice.trail]).toEqual(["9671d8a", "Commit"]);
  });

  it("has no default row when the checkout is the default branch", () => {
    expect(keys(top({ kind: "uncommitted" }, null)).slice(0, 3)).toEqual(["uncommitted", "lastCommit", "local"]);
  });

  it("highlights the base on opening, and the list just left on coming back", () => {
    const items = top({ kind: "lastCommit" });
    expect(arrival(items, { kind: "lastCommit" }, null)).toBe(1);
    const tags = groupsOf(refs, "agent/x").find((g) => g.key === "tags") ?? null;
    expect(arrival(items, { kind: "lastCommit" }, tags)).toBe(6);
    expect(arrival(items, { kind: "ref", name: "nowhere" }, null)).toBe(0);
  });
});

describe("the lists it opens in place", () => {
  const groups = groupsOf(refs, "agent/x");

  it("split local branches, each remote by name and tags, keeping the refs' order", () => {
    expect(groups.map((g) => [g.title, g.refs.map((r) => r.name)])).toEqual([
      ["Local Branches", ["agent/fix-upload-retry", "main"]],
      ["origin", ["origin/main", "origin/agent/x"]],
      ["upstream", ["upstream/main"]],
      ["Tags", ["v1.2"]],
    ]);
  });

  it("count the checked-out branch among local branches, first and not to be picked", () => {
    const local = groups[0]!;
    expect(groupSize(local)).toBe(3);
    const listed = listItems({
      group: local,
      query: "",
      groups,
      refs,
      defaultBranch: "main",
      base: { kind: "ref", name: "main" },
      uncommitted: null,
      commit: null,
      committedOnly: null,
      now: NOW,
    });
    expect(keys(listed.items)).toEqual(["current", "ref:agent/fix-upload-retry", "ref:main"]);
    expect(picks(listed.items[0])).toBe(false);
    expect(arrival(listed.items, { kind: "ref", name: "main" }, null)).toBe(2);
    expect(arrival(listed.items, { kind: "uncommitted" }, null)).toBe(1);
  });

  it("count their rows in branches or tags, as their rows say it", () => {
    expect(groups.map(groupCount)).toEqual(["3 branches", "2 branches", "1 branch", "1 tag"]);
  });

  it("leave out a list with nothing in it, but keep local branches for the checked-out one", () => {
    expect(groupsOf([], null)).toEqual([]);
    expect(groupsOf([], "main").map((g) => [g.key, groupSize(g)])).toEqual([["local", 1]]);
  });

  it("search only their own refs", () => {
    const origin = groups[1]!;
    const listed = listItems({
      group: origin,
      query: "agent",
      groups,
      refs,
      defaultBranch: null,
      base: { kind: "uncommitted" },
      uncommitted: null,
      commit: null,
      committedOnly: null,
      now: NOW,
    });
    expect(keys(listed.items)).toEqual(["ref:origin/agent/x"]);
  });
});

describe("searching every ref", () => {
  it("puts an exact name first and offers a typed name as a commit", () => {
    expect(matching(refs, "main").matches.map((r) => r.name)).toEqual(["main", "origin/main", "upstream/main"]);
    const typed = listItems({
      group: null,
      query: "a1f3",
      groups: [],
      refs,
      defaultBranch: null,
      base: { kind: "uncommitted" },
      uncommitted: null,
      commit: null,
      committedOnly: null,
      now: NOW,
    });
    expect(keys(typed.items)).toEqual(["typed"]);
  });

  it("stops at fifty matches and says there are more", () => {
    const many = Array.from({ length: 60 }, (_, i) => ref(`b${i}`, "branch"));
    const { matches, more } = matching(many, "b");
    expect([matches.length, more]).toEqual([50, true]);
    expect(matching(many.slice(0, 50), "b").more).toBe(false);
  });
});

describe("a ref's trail", () => {
  it("says its age, its date in full on hover, and in search results that a tag is one", () => {
    expect(refTrail(ref("main", "branch", NOW - 2 * HOUR), NOW, false).trail).toBe("2h");
    expect(refTrail(ref("main", "branch", NOW - 2 * HOUR), NOW, false).title).toBeTruthy();
    expect(refTrail(ref("v1", "tag", NOW - 2 * HOUR), NOW, true)).toEqual({
      trail: "Tag",
    });
    expect(refTrail(ref("v1", "tag", NOW - 2 * HOUR), NOW, false).trail).toBe("2h");
    expect(refTrail(ref("x", "branch", null), NOW, false)).toEqual({
      trail: "",
    });
  });

  it("splits a remote's name at its first slash", () => {
    expect(remoteOf("origin/agent/x")).toEqual(["origin", "agent/x"]);
    expect(remoteOf("main")).toEqual(["", "main"]);
  });
});

describe("the base's label", () => {
  it("names a commit given in full by its short id, and any other ref as given", () => {
    expect(
      baseLabel({
        kind: "ref",
        name: "9671d8a0c3b1e2f4a5b6c7d8e9f0a1b2c3d4e5f6",
      }),
    ).toBe("9671d8a");
    expect(baseLabel({ kind: "ref", name: "a".repeat(64) })).toBe("aaaaaaa");
    expect(baseLabel({ kind: "ref", name: "9671d8a" })).toBe("9671d8a");
    expect(baseLabel({ kind: "ref", name: "main" })).toBe("main");
    expect(baseLabel({ kind: "uncommitted" })).toBe("uncommitted changes");
  });
});
