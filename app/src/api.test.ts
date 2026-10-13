import { describe as group, expect, it } from "vitest";
import { describe } from "./api";

group("describe", () => {
  it("shows a failure from the IPC layer as it came", () => {
    expect(describe("command not found")).toEqual({ title: "Something went wrong", detail: "command not found" });
  });

  it("words each command error", () => {
    expect(describe({ kind: "noRepository" }).title).toBe("No repository is open");
    expect(describe({ kind: "store", error: { kind: "failed", message: "disk full" } })).toEqual({
      title: "Saved comments are unavailable",
      detail: "disk full",
    });
    expect(describe({ kind: "internal", message: "panicked" }).detail).toBe("panicked");
  });

  it("words each repository error", () => {
    const repo = (error: object) => describe({ kind: "repository", error });
    expect(repo({ kind: "notARepository", path: "/tmp/x" }).title).toBe("Not a git repository");
    expect(repo({ kind: "unknownBase", name: "main" }).title).toBe("Can’t find main");
    expect(repo({ kind: "noCommits" }).title).toBe("No commits yet");
    expect(repo({ kind: "outsideRepository", path: "../x" }).title).toBe("File outside the repository");
    expect(repo({ kind: "failed", message: "bad object" }).detail).toBe("bad object");
  });

  it("shows a kind it does not know as its JSON, not [object Object]", () => {
    expect(describe({ kind: "repository", error: { kind: "newKind" } })).toEqual({
      title: "Something went wrong",
      detail: '{"kind":"newKind"}',
    });
    expect(describe({ kind: "newKind" }).detail).toBe('{"kind":"newKind"}');
  });
});
