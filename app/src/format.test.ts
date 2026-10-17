import { describe, expect, it } from "vitest";
import { age, shortId, when } from "./format";

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

  it("say a ref's age in its largest whole unit, and a date ahead of the clock as now", () => {
    const now = Date.UTC(2026, 9, 17);
    const ago = (minutes: number) => age(now - minutes * 60_000, now);
    expect([ago(0.5), ago(-5), ago(1), ago(59), ago(60), ago(23 * 60 + 59)]).toEqual([
      "now",
      "now",
      "1m",
      "59m",
      "1h",
      "23h",
    ]);
    const day = 24 * 60;
    expect([
      ago(day),
      ago(6 * day),
      ago(7 * day),
      ago(29 * day),
      ago(30 * day),
      ago(364 * day),
      ago(365 * day),
    ]).toEqual(["1d", "6d", "1w", "4w", "1mo", "11mo", "1y"]);
  });
});
