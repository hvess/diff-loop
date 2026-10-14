import { describe as group, expect, it, vi } from "vitest";
import { api, describe } from "./api";
import type { Review } from "./bindings/Review";
import type { ReviewFile } from "./bindings/ReviewFile";
import type { ReviewPart } from "./bindings/ReviewPart";

/** What the fake `load_review` sends through its channel, and whether it then fails. */
const sent: { parts: ReviewPart[]; fails: boolean } = { parts: [], fails: false };

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    constructor(public onmessage: (part: unknown) => void) {}
  },
  invoke: (_command: string, args: { parts: { onmessage: (part: unknown) => void } }) => {
    for (const part of sent.parts) args.parts.onmessage(part);
    return sent.fails ? Promise.reject(new Error("gone")) : Promise.resolve(null);
  },
}));

const unchanged = (path: string): ReviewFile => ({ kind: "unchanged", path, signature: path });
const rest = { checkout: { name: "r" }, files: [] } as unknown as Review;

group("api.loadReview", () => {
  it("joins the batches, in order, under the rest of the review", async () => {
    sent.parts = [
      { kind: "files", files: [unchanged("a"), unchanged("b")] },
      { kind: "files", files: [unchanged("c")] },
      { kind: "rest", review: rest },
    ];
    sent.fails = false;
    const review = await api.loadReview({ kind: "uncommitted" }, [], []);
    expect(review.files.map((f) => (f.kind === "unchanged" ? f.path : ""))).toEqual(["a", "b", "c"]);
    expect(review.checkout).toBe(rest.checkout);
  });

  it("fails when the command does", async () => {
    sent.parts = [];
    sent.fails = true;
    await expect(api.loadReview({ kind: "uncommitted" }, [], [])).rejects.toThrow("gone");
  });
});

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
