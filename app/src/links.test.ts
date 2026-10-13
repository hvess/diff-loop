import { describe, expect, it } from "vitest";
import type { FileDiff } from "./bindings/FileDiff";
import type { Status } from "./bindings/Status";
import { captionOf, linksOf, testedName } from "./links";

const file = (path: string, added: string[] = [], status: Status = { kind: "modified" }): FileDiff => ({
  path,
  status,
  content: {
    kind: "text",
    hunks: [
      {
        oldStart: 1,
        newStart: 1,
        section: "",
        lines: added.map((text, i) => ({ kind: "added", new: i + 1, text })),
      },
    ],
  },
});
const isNew: Status = { kind: "added" };

describe("testedName", () => {
  it("strips a test marker from the name", () => {
    expect(testedName("src/api/handler.test.ts")).toBe("handler.ts");
    expect(testedName("src/a.spec.tsx")).toBe("a.tsx");
    expect(testedName("crates/git/parse_test.go")).toBe("parse.go");
    expect(testedName("tests/test_foo.py")).toBe("foo.py");
  });

  it("is null for a test file that names nothing", () => {
    expect(testedName("tests/integration.rs")).toBeNull();
  });
});

describe("linksOf", () => {
  it("links a test to the source beside it, as the design's captions show", () => {
    const files = [
      file("src/api/share/handler.test.ts", [], isNew),
      file("src/api/share/handler.ts", ['import { limit } from "./rateLimit";']),
      file("src/api/share/rateLimit.ts", ["export const limit = 1;"], isNew),
      file("src/lib/redis.ts"),
    ];
    const links = linksOf(files, new Set(["src/api/share/handler.test.ts"]));
    expect(captionOf(links, "src/api/share/handler.ts")).toEqual(["tested by handler.test.ts"]);
    expect(captionOf(links, "src/api/share/rateLimit.ts")).toEqual(["new, imported by handler.ts"]);
    expect(captionOf(links, "src/api/share/handler.test.ts")).toEqual(["covers handler.ts"]);
    expect(captionOf(links, "src/lib/redis.ts")).toEqual([]);
  });

  it("prefers the source beside a test, and ignores an ambiguous name elsewhere", () => {
    const tests = new Set(["web/a.test.ts", "other/b.test.ts"]);
    const files = [
      file("web/a.test.ts"),
      file("web/a.ts"),
      file("lib/a.ts"),
      file("other/b.test.ts"),
      file("x/b.ts"),
      file("y/b.ts"),
    ];
    const links = linksOf(files, tests);
    expect(links.covers.get("web/a.test.ts")).toEqual(["web/a.ts"]);
    expect(links.covers.has("other/b.test.ts")).toBe(false);
  });

  it("finds a test in another directory when its name is unique", () => {
    const links = linksOf([file("tests/test_parse.py"), file("src/parse.py")], new Set(["tests/test_parse.py"]));
    expect(captionOf(links, "src/parse.py")).toEqual(["tested by test_parse.py"]);
  });

  it("names an importer only on an added line that imports, never the file itself", () => {
    const files = [
      file("src/limit.ts", ["// limit things", "export const limit = 1;"], isNew),
      file("src/a.ts", ["const limit = 2;"]),
      file("src/lib.rs", ["mod limit;"]),
    ];
    const links = linksOf(files, new Set());
    expect(links.importedBy.get("src/limit.ts")).toEqual(["src/lib.rs"]);
  });

  it("counts the rest when several files link", () => {
    const files = [
      file("a.ts", [], isNew),
      file("b.ts", ['import "./a"']),
      file("c.ts", ['import "./a"']),
      file("d.ts", ['import "./a"']),
    ];
    expect(captionOf(linksOf(files, new Set()), "a.ts")).toEqual(["new, imported by b.ts and 2 more"]);
  });
});
