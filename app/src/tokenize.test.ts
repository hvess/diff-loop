import { describe, expect, it } from "vitest";
import { tokenize } from "./tokenize";

const COMMENT = "var(--shiki-token-comment)";

describe("tokenize", () => {
  it("does not carry a comment a run leaves open into the next run", async () => {
    const tokens = await tokenize({
      id: 0,
      path: "a.ts",
      sides: { old: [], new: [["/**", " * open"], ["const later = 2;"]] },
    });
    expect(tokens?.new).toHaveLength(3);
    expect(tokens?.new[1]?.every((t) => t.color === COMMENT)).toBe(true);
    expect(tokens?.new[2]?.[0]).toMatchObject({ content: "const" });
    expect(tokens?.new[2]?.some((t) => t.color === COMMENT)).toBe(false);
  });

  it("gives one row per line sent, empty lines included", async () => {
    const tokens = await tokenize({ id: 0, path: "a.ts", sides: { old: [["", "x"], [""]], new: [] } });
    expect(tokens?.old).toHaveLength(3);
    expect(tokens?.new).toEqual([]);
  });

  it("is null for a language Shiki does not know", async () => {
    expect(await tokenize({ id: 0, path: "a.unknownext", sides: { old: [], new: [] } })).toBeNull();
  });
});
