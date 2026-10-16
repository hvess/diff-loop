import { describe, expect, it } from "vitest";
import type { FileDiff } from "./bindings/FileDiff";
import { fold, folderCounts, folderKeys, treeRows } from "./tree";

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

  it("folds a closed folder's rows away and draws the guides for what is left", () => {
    const rows = treeRows(["a/b/x.ts", "a/y.ts", "z.ts"].map(file));
    const shown = fold(rows, new Set(["d:a/b/"]));
    expect(shown.map((r) => r.key)).toEqual(["d:a/", "d:a/b/", "f:a/y.ts", "f:z.ts"]);
    expect(shown[1]?.guides).toEqual([{ start: true, end: false }]);
    expect(shown[2]?.guides).toEqual([{ start: false, end: true }]);
    expect(fold(rows, new Set(["d:a/"])).map((r) => r.key)).toEqual(["d:a/", "f:z.ts"]);
    expect(fold(rows, new Set())).toBe(rows);
  });

  it("counts the files each folder holds, at any depth", () => {
    const rows = treeRows(["a/b/x.ts", "a/y.ts", "z.ts"].map(file));
    expect(folderCounts(folderKeys(rows))).toEqual(
      new Map([
        ["d:a/", 2],
        ["d:a/b/", 1],
      ]),
    );
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

  it("starts a guide under its folder and stops it at the folder's last row", () => {
    const rows = treeRows(["a/b/x.ts", "a/y.ts", "z.ts"].map(file));
    // a/, b/, x.ts, y.ts, z.ts
    expect(rows.map((r) => r.guides)).toEqual([
      [],
      [{ start: true, end: false }],
      [
        { start: false, end: false },
        { start: true, end: true },
      ],
      [{ start: false, end: true }],
      [],
    ]);
  });

  it("has no rows for no files", () => {
    expect(treeRows([])).toEqual([]);
  });
});
