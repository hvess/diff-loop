import { describe, expect, it } from "vitest";
import type { FileDiff } from "./bindings/FileDiff";
import { treeRows } from "./tree";

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
      "docs/",
      "  api/",
      "    docs/api/share.md",
      "src/",
      "  api/",
      "    share/",
      "      src/api/share/handler.test.ts",
      "      src/api/share/handler.ts",
      "      src/api/share/rateLimit.ts",
      "  lib/",
      "    src/lib/redis.ts",
      "README.md",
    ]);
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
