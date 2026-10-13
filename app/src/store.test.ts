import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import type { Comment } from "./bindings/Comment";
import type { Opening } from "./bindings/Opening";
import type { Review } from "./bindings/Review";
import type { SavedReview } from "./bindings/SavedReview";
import { useStore } from "./store";

vi.mock("./api", () => ({
  api: {
    openRepository: vi.fn(),
    savedReview: vi.fn(),
    saveReview: vi.fn(),
    loadReview: vi.fn(),
    fingerprint: vi.fn(),
    watchRepository: vi.fn(() => Promise.resolve(true)),
  },
  describe: (error: unknown) => ({ title: "Saved comments are unavailable", detail: String(error) }),
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));

const opening = (root: string): Opening => ({
  checkout: { name: "r", root, head: { kind: "branch", name: "agent/x" }, commit: "abc" },
  refs: [],
  base: { kind: "uncommitted" },
});

const comment = (id: string): Comment => ({
  id,
  path: "a.ts",
  target: { kind: "file" },
  text: "t",
  suggestion: null,
  state: "current",
});

/** What load_review answers: the comments it was given, as from IPC, a fresh copy each time. */
function answerLoads(root: string) {
  vi.mocked(api.loadReview).mockImplementation((base, comments) =>
    Promise.resolve<Review>({
      checkout: opening(root).checkout,
      base,
      fingerprint: null,
      snapshot: { old: null, new: { kind: "workingTree" } },
      files: [],
      groups: [],
      comments: structuredClone(comments),
    }),
  );
}

async function openWith(root: string, saved: SavedReview | Error) {
  vi.mocked(api.openRepository).mockResolvedValue(opening(root));
  if (saved instanceof Error) vi.mocked(api.savedReview).mockRejectedValue(saved);
  else vi.mocked(api.savedReview).mockResolvedValue(structuredClone(saved));
  answerLoads(root);
  await useStore.getState().open(root);
}

describe("saving the review", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(api.saveReview).mockReset().mockResolvedValue(null);
  });

  it("opens with the saved review, and saves nothing it did not change", async () => {
    await openWith("/a", { comments: [comment("c")], note: "n" });
    await useStore.getState().reload();
    vi.advanceTimersByTime(300);
    await vi.runAllTimersAsync();
    expect(useStore.getState().comments.map((c) => c.id)).toEqual(["c"]);
    expect(useStore.getState().note).toBe("n");
    expect(api.saveReview).not.toHaveBeenCalled();
  });

  it("saves a comment change at once, for the open checkout", async () => {
    await openWith("/a", { comments: [], note: "" });
    useStore.setState({ comments: [comment("c")] });
    await vi.waitFor(() =>
      expect(api.saveReview).toHaveBeenCalledWith("/a", { comments: [comment("c")], note: "" }),
    );
  });

  it("saves the note once typing pauses", async () => {
    await openWith("/a", { comments: [], note: "" });
    useStore.getState().setNote("a");
    useStore.getState().setNote("ab");
    expect(api.saveReview).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(api.saveReview).toHaveBeenCalledTimes(1);
    expect(api.saveReview).toHaveBeenCalledWith("/a", { comments: [], note: "ab" });
  });

  it("saves a note typed before switching checkouts under the checkout it was typed in", async () => {
    await openWith("/a", { comments: [], note: "" });
    useStore.getState().setNote("for a");
    await openWith("/b", { comments: [], note: "" });
    await vi.advanceTimersByTimeAsync(300);
    expect(api.saveReview).toHaveBeenCalledWith("/a", { comments: [], note: "for a" });
    expect(api.saveReview).not.toHaveBeenCalledWith("/b", expect.anything());
  });

  it("lands saves in the order they were made", async () => {
    await openWith("/a", { comments: [], note: "" });
    let finishFirst = () => {};
    vi.mocked(api.saveReview).mockImplementationOnce(
      () => new Promise((resolve) => (finishFirst = () => resolve(null))),
    );
    useStore.setState({ comments: [comment("1")] });
    useStore.setState({ comments: [comment("1"), comment("2")] });
    await vi.waitFor(() => expect(api.saveReview).toHaveBeenCalledTimes(1));
    finishFirst();
    await vi.waitFor(() => expect(api.saveReview).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.saveReview).mock.calls.map(([, r]) => r.comments.length)).toEqual([1, 2]);
  });

  it("reports a failed save and clears the report once one succeeds", async () => {
    await openWith("/a", { comments: [], note: "" });
    vi.mocked(api.saveReview).mockRejectedValueOnce("disk full");
    useStore.setState({ comments: [comment("c")] });
    await vi.waitFor(() => expect(useStore.getState().saveProblem?.detail).toBe("disk full"));
    await useStore.getState().retrySave();
    expect(useStore.getState().saveProblem).toBeNull();
  });

  /** Regression: a window opened over an unreadable save then overwrote it. */
  it("saves nothing while the saved review cannot be read, then merges it on retry", async () => {
    await openWith("/a", new Error("busy"));
    expect(useStore.getState().saveProblem?.detail).toBe("Error: busy");
    useStore.setState({ comments: [comment("new")] });
    await vi.runAllTimersAsync();
    expect(api.saveReview).not.toHaveBeenCalled();

    vi.mocked(api.savedReview).mockResolvedValue({ comments: [comment("old")], note: "kept" });
    await useStore.getState().retrySave();
    expect(useStore.getState().comments.map((c) => c.id)).toEqual(["old", "new"]);
    expect(useStore.getState().saveProblem).toBeNull();
    await vi.waitFor(() =>
      expect(api.saveReview).toHaveBeenLastCalledWith("/a", {
        comments: [comment("old"), comment("new")],
        note: "kept",
      }),
    );
  });
});

describe("reloading", () => {
  beforeEach(() => {
    vi.mocked(api.saveReview).mockReset().mockResolvedValue(null);
    vi.mocked(api.fingerprint).mockReset();
  });

  it("keeps the window's state when nothing reviewed changed", async () => {
    await openWith("/a", { comments: [comment("c")], note: "" });
    const before = useStore.getState().review;
    await useStore.getState().reload();
    expect(useStore.getState().review).toBe(before);
  });

  it("takes a load that changed something", async () => {
    await openWith("/a", { comments: [], note: "" });
    const before = useStore.getState().review;
    vi.mocked(api.loadReview).mockImplementationOnce((base) =>
      Promise.resolve<Review>({
        checkout: opening("/a").checkout,
        base,
        fingerprint: null,
        snapshot: { old: null, new: { kind: "workingTree" } },
        files: [
          {
            kind: "changed",
            signature: "s",
            diff: { path: "a.ts", status: { kind: "added" }, content: { kind: "text", hunks: [] } },
          },
        ],
        groups: [{ role: "source", files: [0] }],
        comments: [],
      }),
    );
    await useStore.getState().reload();
    expect(useStore.getState().review).not.toBe(before);
    expect(useStore.getState().review?.changes.files.map((f) => f.path)).toEqual(["a.ts"]);
  });

  it("clears a load problem when the next load shows the same", async () => {
    await openWith("/a", { comments: [], note: "" });
    useStore.setState({ loadProblem: { title: "Git reported a problem", detail: "busy" } });
    await useStore.getState().reload();
    expect(useStore.getState().loadProblem).toBeNull();
  });

  it("takes a load whose fingerprint moved, so a poll compares against it", async () => {
    await openWith("/a", { comments: [], note: "" });
    const before = useStore.getState().review;
    vi.mocked(api.loadReview).mockImplementationOnce((base, comments) =>
      Promise.resolve<Review>({
        checkout: opening("/a").checkout,
        base,
        fingerprint: "newer",
        snapshot: { old: null, new: { kind: "workingTree" } },
        files: [],
        groups: [],
        comments: structuredClone(comments),
      }),
    );
    await useStore.getState().reload();
    expect(useStore.getState().review).not.toBe(before);
    expect(useStore.getState().review?.fingerprint).toBe("newer");
  });

  it("checks again after a load during which a change was reported", async () => {
    await openWith("/a", { comments: [], note: "" });
    useStore.setState({ watching: true });
    vi.mocked(api.loadReview).mockClear();
    const loading = useStore.getState().reload();
    await useStore.getState().poll();
    expect(api.loadReview).toHaveBeenCalledTimes(1);
    await loading;
    await vi.waitFor(() => expect(api.loadReview).toHaveBeenCalledTimes(2));
  });

  it("while watching, checks for changes by loading, not by a fingerprint", async () => {
    await openWith("/a", { comments: [], note: "" });
    useStore.setState({ watching: true });
    vi.mocked(api.loadReview).mockClear();
    await useStore.getState().poll();
    expect(api.loadReview).toHaveBeenCalledTimes(1);
    expect(api.fingerprint).not.toHaveBeenCalled();
  });
});
