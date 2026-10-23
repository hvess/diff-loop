import { describe, expect, it } from "vitest";
import type { FileDiff } from "./bindings/FileDiff";
import { filterTree, fold, folderKeys, keptOrder, treeRows } from "./tree";

const file = (path: string): FileDiff => ({ path, status: { kind: "modified" }, content: { kind: "text", hunks: [] } });

const shape = (paths: string[]) =>
  treeRows(paths.map(file)).map((r) => `${"  ".repeat(r.depth)}${r.kind === "folder" ? `${r.name}/` : r.file.path}`);

describe("treeRows", () => {
  it("nests files in their folders, folders first, each by name, as the design's tree", () => {
    expect(
      shape([
        "src/lib/redis.ts",
        "config/limits.yaml",
        "src/api/share/rateLimit.ts",
        "README.md",
        "src/api/share/handler.ts",
        "src/api/share/handler.test.ts",
        "docs/api/share.md",
      ]),
    ).toEqual([
      "config/",
      "  config/limits.yaml",
      "docs/api/",
      "  docs/api/share.md",
      "src/",
      "  api/share/",
      "    src/api/share/handler.test.ts",
      "    src/api/share/handler.ts",
      "    src/api/share/rateLimit.ts",
      "  lib/",
      "    src/lib/redis.ts",
      "README.md",
    ]);
  });

  it("reads a chain of lone folders as one row, but not a folder holding a file", () => {
    expect(shape(["a/b/c/x.ts"])).toEqual(["a/b/c/", "  a/b/c/x.ts"]);
    expect(shape(["a/b/x.ts", "a/y.ts"])).toEqual(["a/", "  b/", "    a/b/x.ts", "  a/y.ts"]);
  });

  it("folds a closed folder's rows away", () => {
    const rows = treeRows(["a/b/x.ts", "a/y.ts", "z.ts"].map(file));
    const shown = fold(rows, new Set(["d:a/b/"]));
    expect(shown.map((r) => r.key)).toEqual(["d:a/", "d:a/b/", "f:a/y.ts", "f:z.ts"]);
    expect(fold(rows, new Set(["d:a/"])).map((r) => r.key)).toEqual(["d:a/", "f:z.ts"]);
    expect(fold(rows, new Set())).toBe(rows);
  });


  it("names the folders each file is under", () => {
    const rows = treeRows(["a/b/x.ts", "a/y.ts", "z.ts"].map(file));
    expect(folderKeys(rows)).toEqual(
      new Map([
        ["a/b/x.ts", ["d:a/", "d:a/b/"]],
        ["a/y.ts", ["d:a/"]],
        ["z.ts", []],
      ]),
    );
  });

  it("orders numbers by value", () => {
    expect(shape(["v10.ts", "v9.ts"])).toEqual(["v9.ts", "v10.ts"]);
  });


  it("has no rows for no files", () => {
    expect(treeRows([])).toEqual([]);
  });
});

describe("Filter Files", () => {
  const files = ["src/api/Résumé.ts", "src/lib/redis.ts", "docs/api/share.md"].map(file);
  const rows = treeRows(files);
  const paths = (query: string) => filterTree(rows, query).flatMap((r) => (r.kind === "file" ? [r.file.path] : []));

  it("keeps the files whose path holds what is typed, ignoring case and diacritics", () => {
    expect(paths("api")).toEqual(["docs/api/share.md", "src/api/Résumé.ts"]);
    expect(paths("RESUME")).toEqual(["src/api/Résumé.ts"]);
    expect(paths("redis")).toEqual(["src/lib/redis.ts"]);
  });

  it("keeps every file for a blank query, and none when nothing holds it", () => {
    expect(filterTree(rows, "  ")).toBe(rows);
    expect(filterTree(rows, "nowhere")).toEqual([]);
  });

  it("keeps the open file's row, which the pane still shows, whatever is typed", () => {
    expect(filterTree(rows, "redis", "docs/api/share.md").map((r) => r.key)).toEqual([
      "d:docs/api/",
      "f:docs/api/share.md",
      "d:src/",
      "d:src/lib/",
      "f:src/lib/redis.ts",
    ]);
  });

  it("finds the files kept once per query, with each one's place", () => {
    const kept = keptOrder(files, "API");
    expect(kept.files.map((f) => f.path)).toEqual(["src/api/Résumé.ts", "docs/api/share.md"]);
    expect(kept.position.get("docs/api/share.md")).toBe(1);
    expect(keptOrder(files, "API")).toBe(kept);
    expect(keptOrder(files, "redis").files.map((f) => f.path)).toEqual(["src/lib/redis.ts"]);
    // The query before stays cached beside the latest, as the sidebar's deferred one trails the typed one.
    expect(keptOrder(files, "API")).toBe(kept);
  });

  it("keeps the folders above a match, once each, and no others", () => {
    expect(filterTree(rows, "redis").map((r) => r.key)).toEqual(["d:src/", "d:src/lib/", "f:src/lib/redis.ts"]);
    expect(filterTree(rows, ".ts").map((r) => r.key)).toEqual(["d:src/", "d:src/api/", "f:src/api/Résumé.ts", "d:src/lib/", "f:src/lib/redis.ts"]);
  });
});
