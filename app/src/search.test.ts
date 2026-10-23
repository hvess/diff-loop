import { describe, expect, it } from "vitest";
import { folded } from "./search";

describe("typed text against a list", () => {
  it("ignores case and diacritics", () => {
    expect(folded("Résumé.TS")).toBe("resume.ts");
    expect(folded("Ünïcödé")).toBe("unicode");
    expect(folded("")).toBe("");
  });
});
