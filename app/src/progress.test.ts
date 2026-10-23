import { describe, expect, it } from "vitest";
import { barLines, progressText } from "./progress";

describe("the bottom bar's progress", () => {
  it("counts files left, and the lines reviewed out of all, up as the ring fills", () => {
    expect(progressText(5, 0, 71)).toEqual(["5 files left", "71 lines to review"]);
    expect(progressText(5, 13, 71)).toEqual(["5 files left", "13 of 71 lines reviewed"]);
    expect(progressText(1, 0, 1)).toEqual(["1 file left", "1 line to review"]);
  });

  it("says all is viewed once no file is left", () => {
    expect(progressText(0, 71, 71)).toEqual(["All files viewed", "71 lines reviewed"]);
  });

  it("has no second part when no file has a changed line", () => {
    expect(progressText(3, 0, 0)).toEqual(["3 files left", ""]);
  });
});

describe("the bottom bar's lines", () => {
  const left: [string, string] = ["5 files left", "13 of 71 lines reviewed"];

  it("before any round, follows the lines with the drafts and that nothing is sent", () => {
    const strip = { title: "Nothing sent yet", stage: "none" as const, parts: [], meta: "4 drafts" };
    expect(barLines(left, strip)).toEqual({ title: "5 files left", detail: ["13 of 71 lines reviewed", "4 drafts", "nothing sent yet"], parts: [] });
  });

  it("leaves out what is empty", () => {
    const strip = { title: "Nothing sent yet", stage: "none" as const, parts: [], meta: "" };
    expect(barLines(["3 files left", ""], strip).detail).toEqual(["nothing sent yet"]);
  });

  it("once a round is sent and unanswered, keeps what is left and says when it went", () => {
    const strip = { title: "Round 2 sent", stage: "sent" as const, parts: [{ filter: null, text: "3 comments" }], meta: "10 min ago" };
    expect(barLines(left, strip)).toEqual({ title: "5 files left", detail: ["13 of 71 lines reviewed", "Round 2 sent", "10 min ago"], parts: [] });
  });

  it("while the agent's answer shows, titles the round and lists its counts", () => {
    const parts = [
      { filter: "changed" as const, text: "2 changed" },
      { filter: "untouched" as const, text: "1 untouched" },
    ];
    const strip = { title: "Round 2", stage: "answered" as const, parts, meta: "" };
    expect(barLines(left, strip)).toEqual({ title: "Round 2", detail: [], parts });
  });
});
