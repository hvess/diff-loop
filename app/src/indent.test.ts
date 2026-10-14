import { describe, expect, it } from "vitest";
import { dedent } from "./indent";

describe("dedent", () => {
  it("drops the indent the lines share, keeping what is deeper", () => {
    expect(dedent(["    if (a) {", "      b();", "    }"])).toEqual(["if (a) {", "  b();", "}"]);
  });

  it("ignores blank lines when finding the indent, and empties them", () => {
    expect(dedent(["\tx", "", "  ", "\t\ty"])).toEqual(["x", "", "", "\ty"]);
  });

  it("takes a range as long as a large added file", () => {
    const lines = Array.from({ length: 300_000 }, () => "  x");
    expect(dedent(lines)[0]).toBe("x");
  });

  it("leaves lines with no shared indent, or only blank ones, alone", () => {
    expect(dedent(["a", "  b"])).toEqual(["a", "  b"]);
    expect(dedent(["  ", ""])).toEqual(["  ", ""]);
    expect(dedent([])).toEqual([]);
  });
});
