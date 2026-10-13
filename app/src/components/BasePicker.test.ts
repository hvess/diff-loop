import { describe, expect, it } from "vitest";
import { refHint, showOnly } from "./BasePicker";

describe("base picker notes", () => {
  it("say how far behind a branch the checkout is, and only when it is", () => {
    expect(refHint({ name: "main", kind: "branch", behind: 2 })).toBe("2 behind");
    expect(refHint({ name: "origin/main", kind: "remote", behind: 0 })).toBe("");
    expect(refHint({ name: "main", kind: "branch", behind: null })).toBe("");
    expect(refHint({ name: "v1", kind: "tag", behind: 3 })).toBe("Tag");
  });

  it("count uncommitted files and name the last commit", () => {
    const [uncommitted, last] = showOnly(1, "a1f3c9e5b2");
    expect(uncommitted?.hint).toBe("1 file");
    expect(last?.hint).toBe("a1f3c9e");
    expect(showOnly(3, null)[0]?.hint).toBe("3 files");
    expect(showOnly(null, undefined).map((c) => c.hint)).toEqual(["", ""]);
  });
});
