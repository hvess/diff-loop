import { describe, expect, it } from "vitest";
import { progressText } from "./Sidebar";

describe("the sidebar's progress", () => {
  it("counts files left, and the lines reviewed out of all, up as the ring fills", () => {
    expect(progressText(5, 0, 71)).toEqual(["5 files left", "71 lines to review"]);
    expect(progressText(5, 13, 71)).toEqual(["5 files left", "13 of 71 lines reviewed"]);
    expect(progressText(1, 0, 1)).toEqual(["1 file left", "1 line to review"]);
  });

  it("says all is viewed once no file is left", () => {
    expect(progressText(0, 71, 71)).toEqual(["All files viewed", "71 lines reviewed"]);
  });

  it("has no second line when no file has a changed line", () => {
    expect(progressText(3, 0, 0)).toEqual(["3 files left", ""]);
  });
});
