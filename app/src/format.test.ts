import { describe, expect, it } from "vitest";
import { shortId, when } from "./format";

describe("times and ids", () => {
  it("say how long ago, then the time or the day", () => {
    const now = new Date(2026, 9, 15, 10, 0).getTime();
    expect(when(now - 10_000, now)).toBe("Just now");
    expect(when(now - 18 * 60_000, now)).toBe("18 min ago");
    expect(when(now - 3 * 60 * 60_000, now)).toMatch(/7:00/);
    expect(when(now - 26 * 60 * 60_000, now)).toBe("Yesterday");
  });

  it("cut a commit id to seven characters, and show a dash for none", () => {
    expect(shortId("64ea9118c0ffee")).toBe("64ea911");
    expect(shortId(null)).toBe("—");
  });
});
