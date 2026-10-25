import { describe, expect, it } from "vitest";
import { noteRuns, shownNote } from "./note";

describe("the agent's note", () => {
  it("sets what is in backticks apart as code", () => {
    expect(noteRuns("Renamed it to `count`.")).toEqual([
      { code: false, text: "Renamed it to " },
      { code: true, text: "count" },
      { code: false, text: "." },
    ]);
    expect(noteRuns("`a` and `b`")).toEqual([
      { code: true, text: "a" },
      { code: false, text: " and " },
      { code: true, text: "b" },
    ]);
  });

  it("keeps a lone backtick as text", () => {
    expect(noteRuns("it`s done")).toEqual([{ code: false, text: "it`s done" }]);
    expect(noteRuns("plain")).toEqual([{ code: false, text: "plain" }]);
  });

  it("shows a blank note as none", () => {
    expect(shownNote("  ")).toBeNull();
    expect(shownNote(null)).toBeNull();
    expect(shownNote("Done.")).toBe("Done.");
  });
});
