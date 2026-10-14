import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import type { Comment } from "./bindings/Comment";
import type { Opening } from "./bindings/Opening";
import type { Review } from "./bindings/Review";
import type { SavedReview } from "./bindings/SavedReview";
import type { FileDiff } from "./bindings/FileDiff";
import { CODE_UPDATED, type Composer, canSave, commentText, bannerDetail, useStore } from "./store";

vi.mock("./api", () => ({
  api: {
    openRepository: vi.fn(),
    savedReview: vi.fn(),
    saveReview: vi.fn(),
    loadReview: vi.fn(),
    fingerprint: vi.fn(),
    commitsBetween: vi.fn(() => Promise.resolve(1)),
    refs: vi.fn(() => Promise.resolve([])),
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
      comments: structuredClone(comments),
    }),
  );
}

/** The next load finds no comment's code, with `branch` checked out. */
function answerNextLoadWithCodeGone(root: string, branch = "agent/x") {
  vi.mocked(api.loadReview).mockImplementationOnce((base, comments) =>
    Promise.resolve<Review>({
      checkout: { ...opening(root).checkout, head: { kind: "branch", name: branch } },
      base,
      fingerprint: null,
      snapshot: { old: null, new: { kind: "workingTree" } },
      files: [],
      comments: comments.map((c) => ({ ...c, state: "outdated" })),
    }),
  );
}

/** A file of `n` added lines, each `    line <no>`. */
const added = (path: string, n: number): FileDiff => ({
  path,
  status: { kind: "added" },
  content: {
    kind: "text",
    hunks: [
      {
        oldStart: 0,
        newStart: 1,
        section: "",
        lines: Array.from({ length: n }, (_, i) => ({ kind: "added" as const, new: i + 1, text: `    line ${i + 1}` })),
      },
    ],
  },
});

/** Every load answers with `files`. */
function answerWithFiles(root: string, files: FileDiff[]) {
  vi.mocked(api.loadReview).mockImplementation((base, comments) =>
    Promise.resolve<Review>({
      checkout: opening(root).checkout,
      base,
      fingerprint: null,
      snapshot: { old: null, new: { kind: "workingTree" } },
      files: files.map((diff) => ({ kind: "changed", signature: diff.path, diff })),
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
    await openWith("/a", { comments: [comment("c")] });
    await useStore.getState().reload();
    vi.advanceTimersByTime(300);
    await vi.runAllTimersAsync();
    expect(useStore.getState().comments.map((c) => c.id)).toEqual(["c"]);
    expect(api.saveReview).not.toHaveBeenCalled();
  });

  it("saves a comment change at once, for the open checkout", async () => {
    await openWith("/a", { comments: [] });
    useStore.setState({ comments: [comment("c")] });
    await vi.waitFor(() =>
      expect(api.saveReview).toHaveBeenCalledWith("/a", { comments: [comment("c")] }),
    );
  });

  it("lands saves in the order they were made", async () => {
    await openWith("/a", { comments: [] });
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
    await openWith("/a", { comments: [] });
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

    vi.mocked(api.savedReview).mockResolvedValue({ comments: [comment("old")] });
    await useStore.getState().retrySave();
    expect(useStore.getState().comments.map((c) => c.id)).toEqual(["old", "new"]);
    expect(useStore.getState().saveProblem).toBeNull();
    await vi.waitFor(() =>
      expect(api.saveReview).toHaveBeenLastCalledWith("/a", {
        comments: [comment("old"), comment("new")],
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
    await openWith("/a", { comments: [comment("c")] });
    const before = useStore.getState().review;
    await useStore.getState().reload();
    expect(useStore.getState().review).toBe(before);
  });

  it("takes a load that changed something", async () => {
    await openWith("/a", { comments: [] });
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
        comments: [],
      }),
    );
    await useStore.getState().reload();
    expect(useStore.getState().review).not.toBe(before);
    expect(useStore.getState().review?.changes.files.map((f) => f.path)).toEqual(["a.ts"]);
  });

  it("clears a load problem when the next load shows the same", async () => {
    await openWith("/a", { comments: [] });
    useStore.setState({ loadProblem: { title: "Git reported a problem", detail: "busy" } });
    await useStore.getState().reload();
    expect(useStore.getState().loadProblem).toBeNull();
  });

  it("takes a load whose fingerprint moved, so a poll compares against it", async () => {
    await openWith("/a", { comments: [] });
    const before = useStore.getState().review;
    vi.mocked(api.loadReview).mockImplementationOnce((base, comments) =>
      Promise.resolve<Review>({
        checkout: opening("/a").checkout,
        base,
        fingerprint: "newer",
        snapshot: { old: null, new: { kind: "workingTree" } },
        files: [],
        comments: structuredClone(comments),
      }),
    );
    await useStore.getState().reload();
    expect(useStore.getState().review).not.toBe(before);
    expect(useStore.getState().review?.fingerprint).toBe("newer");
  });

  it("checks again after a load during which a change was reported", async () => {
    await openWith("/a", { comments: [] });
    useStore.setState({ watching: true });
    vi.mocked(api.loadReview).mockClear();
    const loading = useStore.getState().reload();
    await useStore.getState().poll();
    expect(api.loadReview).toHaveBeenCalledTimes(1);
    await loading;
    await vi.waitFor(() => expect(api.loadReview).toHaveBeenCalledTimes(2));
  });

  it("deletes a comment whose code is gone against the same base and branch", async () => {
    await openWith("/a", { comments: [comment("c")] });
    useStore.setState({ openComment: "c" });
    answerNextLoadWithCodeGone("/a");
    await useStore.getState().reload();
    expect(useStore.getState().comments).toEqual([]);
    expect(useStore.getState().openComment).toBeNull();
    await vi.waitFor(() => expect(api.saveReview).toHaveBeenCalledWith("/a", { comments: [] }));
  });

  it("says the agent updated the code when a load removes comments under the same commit", async () => {
    await openWith("/a", { comments: [comment("c")] });
    answerNextLoadWithCodeGone("/a");
    await useStore.getState().reload();
    expect(useStore.getState().banner).toEqual({ title: CODE_UPDATED, removed: [comment("c")], previous: null });
  });

  it("adds what a later load removes to the banner already up", async () => {
    await openWith("/a", { comments: [comment("1")] });
    answerNextLoadWithCodeGone("/a");
    await useStore.getState().reload();
    useStore.setState({ comments: [comment("2")] });
    answerNextLoadWithCodeGone("/a");
    await useStore.getState().reload();
    expect(useStore.getState().banner?.removed.map((c) => c.id)).toEqual(["1", "2"]);
  });

  it("brings removed comments back as not in this diff, so the next load keeps them", async () => {
    await openWith("/a", { comments: [comment("c")] });
    answerNextLoadWithCodeGone("/a");
    await useStore.getState().reload();
    useStore.getState().undoRemoved();
    expect(useStore.getState().comments).toEqual([{ ...comment("c"), state: "outdated" }]);
    expect(useStore.getState().banner).toBeNull();
    answerNextLoadWithCodeGone("/a");
    await useStore.getState().reload();
    expect(useStore.getState().comments.map((c) => c.id)).toEqual(["c"]);
  });

  it("keeps what a banner already up removed when HEAD then moves", async () => {
    await openWith("/a", { comments: [comment("1")] });
    answerNextLoadWithCodeGone("/a");
    await useStore.getState().reload();
    useStore.setState({ comments: [comment("2")] });
    vi.mocked(api.loadReview).mockImplementationOnce((base, comments) =>
      Promise.resolve<Review>({
        checkout: { ...opening("/a").checkout, commit: "def" },
        base,
        fingerprint: null,
        snapshot: { old: null, new: { kind: "workingTree" } },
        files: [],
        comments: comments.map((c) => ({ ...c, state: "outdated" })),
      }),
    );
    await useStore.getState().reload();
    const banner = useStore.getState().banner;
    expect(banner?.title).toBe("The branch moved: 1 new commit");
    expect(banner?.removed.map((c) => c.id)).toEqual(["1", "2"]);
  });

  it("keeps a moved HEAD's banner after Undo, with nothing left to undo", async () => {
    await openWith("/a", { comments: [] });
    useStore.setState({ banner: { title: "The branch moved: 1 new commit", removed: [comment("c")], previous: "abc" } });
    useStore.getState().undoRemoved();
    expect(useStore.getState().banner).toEqual({ title: "The branch moved: 1 new commit", removed: [], previous: "abc" });
    expect(useStore.getState().comments.map((c) => c.id)).toEqual(["c"]);
  });

  /** Regression: a comment moved by a handle while a load ran went back to where the load put it. */
  it("keeps a comment changed while a load ran as it was changed", async () => {
    await openWith("/a", { comments: [comment("c")] });
    let answer = () => {};
    vi.mocked(api.loadReview).mockImplementationOnce(
      (base, comments) =>
        new Promise<Review>((resolve) => {
          answer = () =>
            resolve({
              checkout: opening("/a").checkout,
              base,
              fingerprint: null,
              snapshot: { old: null, new: { kind: "workingTree" } },
              files: [],
              comments: comments.map((c) => ({ ...c, target: { kind: "lines", side: "new", start: 9, code: ["old"] } })),
            });
        }),
    );
    const loading = useStore.getState().reload();
    const moved: Comment = { ...comment("c"), target: { kind: "lines", side: "new", start: 3, code: ["new"] }, text: "edited" };
    useStore.setState({ comments: [moved] });
    answer();
    await loading;
    expect(useStore.getState().comments).toEqual([moved]);
  });

  it("keeps a saved comment whose code is gone when the checkout opens, hidden", async () => {
    answerNextLoadWithCodeGone("/a");
    await openWith("/a", { comments: [comment("c")] });
    expect(useStore.getState().comments).toEqual([{ ...comment("c"), state: "outdated" }]);
  });

  it("keeps a comment whose code is gone after the base changed, hidden", async () => {
    await openWith("/a", { comments: [comment("c")] });
    answerNextLoadWithCodeGone("/a");
    await useStore.getState().setBase({ kind: "ref", name: "main" });
    expect(useStore.getState().comments).toEqual([{ ...comment("c"), state: "outdated" }]);
  });

  it("closes the card of a comment that becomes hidden", async () => {
    await openWith("/a", { comments: [comment("c")] });
    useStore.setState({ openComment: "c" });
    answerNextLoadWithCodeGone("/a");
    await useStore.getState().setBase({ kind: "ref", name: "main" });
    expect(useStore.getState().openComment).toBeNull();
  });

  it("keeps a comment whose code is gone after another branch was checked out, hidden", async () => {
    await openWith("/a", { comments: [comment("c")] });
    answerNextLoadWithCodeGone("/a", "agent/y");
    await useStore.getState().reload();
    expect(useStore.getState().comments).toEqual([{ ...comment("c"), state: "outdated" }]);
  });

  it("deletes a comment whose code is gone while the HEAD stays detached", async () => {
    const detached = { kind: "detached", commit: "abc" } as const;
    vi.mocked(api.openRepository).mockResolvedValue({ ...opening("/a"), checkout: { ...opening("/a").checkout, head: detached } });
    vi.mocked(api.savedReview).mockResolvedValue({ comments: [comment("c")] });
    vi.mocked(api.loadReview).mockImplementation((base, comments) =>
      Promise.resolve<Review>({
        checkout: { ...opening("/a").checkout, head: detached },
        base,
        fingerprint: null,
        snapshot: { old: null, new: { kind: "workingTree" } },
        files: [],
        comments: structuredClone(comments),
      }),
    );
    await useStore.getState().open("/a");
    vi.mocked(api.loadReview).mockImplementationOnce((base, comments) =>
      Promise.resolve<Review>({
        checkout: { ...opening("/a").checkout, head: { kind: "detached", commit: "def" } },
        base,
        fingerprint: null,
        snapshot: { old: null, new: { kind: "workingTree" } },
        files: [],
        comments: comments.map((c) => ({ ...c, state: "outdated" })),
      }),
    );
    await useStore.getState().reload();
    expect(useStore.getState().comments).toEqual([]);
  });

  it("keeps a hidden comment whose code is still gone", async () => {
    const hidden: Comment = { ...comment("c"), state: "outdated" };
    await openWith("/a", { comments: [hidden] });
    answerNextLoadWithCodeGone("/a");
    await useStore.getState().reload();
    expect(useStore.getState().comments).toEqual([hidden]);
  });

  it("keeps a comment being edited whose code is gone", async () => {
    await openWith("/a", { comments: [comment("c")] });
    useStore.getState().editComment("c");
    answerNextLoadWithCodeGone("/a");
    await useStore.getState().reload();
    expect(useStore.getState().comments.map((c) => c.id)).toEqual(["c"]);
  });

  it("jumps past a hidden comment", async () => {
    const hidden: Comment = { ...comment("h"), state: "outdated" };
    await openWith("/a", { comments: [hidden, comment("c")] });
    useStore.getState().jumpComment(1);
    expect(useStore.getState().openComment).toBe("c");
    useStore.getState().jumpComment(1);
    expect(useStore.getState().openComment).toBe("c");
  });

  it("while watching, checks for changes by loading, not by a fingerprint", async () => {
    await openWith("/a", { comments: [] });
    useStore.setState({ watching: true });
    vi.mocked(api.loadReview).mockClear();
    await useStore.getState().poll();
    expect(api.loadReview).toHaveBeenCalledTimes(1);
    expect(api.fingerprint).not.toHaveBeenCalled();
  });
});

describe("the banner's detail", () => {
  it("says how many comments were removed, then what became of the rest", () => {
    expect(bannerDetail(2, 1, 4)).toBe(
      "2 comments were addressed and removed. 1 is not in this diff. 3 are still open.",
    );
    expect(bannerDetail(1, 0, 1)).toBe("1 comment was addressed and removed. 1 is still open.");
  });

  it("names comments in its first sentence, whichever that is", () => {
    expect(bannerDetail(0, 2, 3)).toBe("2 comments are not in this diff. 1 is still open.");
    expect(bannerDetail(0, 0, 1)).toBe("1 comment is still open.");
  });

  it("is empty when there are no comments", () => {
    expect(bannerDetail(0, 0, 0)).toBe("");
  });
});

describe("what the composer can save", () => {
  const lines = (text: string, suggestion: string | null): Composer => ({
    path: "a.rs",
    target: { kind: "lines", side: "new", start: 3, code: ["let x = 1;"] },
    text,
    suggestion,
    editing: null,
  });

  it("saves a comment with text", () => {
    expect(canSave(lines("Name it.", null))).toBe(true);
    expect(canSave(lines("  ", null))).toBe(false);
  });

  it("saves suggested code that changes the lines without a reason", () => {
    expect(canSave(lines("", "let x = 2;"))).toBe(true);
  });

  it("saves no suggestion that leaves the lines as they are, unless it says why", () => {
    expect(canSave(lines("", "let x = 1;"))).toBe(false);
    expect(canSave(lines("Keep it.", "let x = 1;"))).toBe(true);
  });

  it("names a comment that is only suggested code", () => {
    const only = { ...comment("a"), text: "", suggestion: "let x = 2;" };
    expect(commentText(only)).toBe("Suggested change");
    expect(commentText(comment("a"))).toBe("t");
  });
});

describe("suggested code", () => {
  const indented = (suggestion: string | null): Composer => ({
    path: "a.ts",
    target: { kind: "lines", side: "new", start: 3, code: ["    if (a) {", "      b();"] },
    text: "",
    suggestion,
    editing: null,
  });

  it("is unchanged when it is the lines without their shared indent", () => {
    expect(canSave(indented("if (a) {\n  b();"))).toBe(false);
    expect(canSave(indented("if (b) {\n  b();"))).toBe(true);
  });
});

describe("the composer's range", () => {
  beforeEach(async () => {
    answerWithFiles("/a", [added("a.ts", 6)]);
    vi.mocked(api.openRepository).mockResolvedValue(opening("/a"));
    vi.mocked(api.savedReview).mockResolvedValue({ comments: [] });
    await useStore.getState().open("/a");
    useStore.getState().composeOnLines("a.ts", "new", 2, 2);
  });

  it("follows a handle dragged past either end, keeping the draft", () => {
    useStore.getState().updateComposer({ text: "draft" });
    useStore.getState().resizeComposer(2, 4);
    const { composer, selection } = useStore.getState();
    expect(composer?.target).toEqual({ kind: "lines", side: "new", start: 2, code: ["    line 2", "    line 3", "    line 4"] });
    expect(composer?.text).toBe("draft");
    expect(selection).toMatchObject({ anchor: 2, head: 4 });
    useStore.getState().resizeComposer(4, 1);
    expect(useStore.getState().composer?.target).toMatchObject({ start: 1, code: ["    line 1", "    line 2", "    line 3", "    line 4"] });
  });

  it("carries untouched suggested code along, and leaves edited code as it is", () => {
    useStore.getState().updateComposer({ suggestion: "line 2" });
    useStore.getState().resizeComposer(2, 3);
    expect(useStore.getState().composer?.suggestion).toBe("line 2\nline 3");
    useStore.getState().updateComposer({ suggestion: "mine" });
    useStore.getState().resizeComposer(2, 4);
    expect(useStore.getState().composer?.suggestion).toBe("mine");
  });
});

describe("viewed files", () => {
  it("count their changed lines as each is marked, and again at each load", async () => {
    answerWithFiles("/a", [added("a.ts", 3), added("b.ts", 5)]);
    vi.mocked(api.openRepository).mockResolvedValue(opening("/a"));
    vi.mocked(api.savedReview).mockResolvedValue({ comments: [] });
    await useStore.getState().open("/a");
    useStore.getState().toggleViewed("a.ts");
    useStore.getState().toggleViewed("b.ts");
    expect(useStore.getState().viewedLines).toBe(8);
    useStore.getState().toggleViewed("a.ts");
    expect(useStore.getState().viewedLines).toBe(5);
    answerWithFiles("/a", [added("a.ts", 3), { ...added("b.ts", 2) }]);
    vi.mocked(api.loadReview).mockImplementationOnce((base, comments) =>
      Promise.resolve<Review>({
        checkout: opening("/a").checkout,
        base,
        fingerprint: null,
        snapshot: { old: null, new: { kind: "workingTree" } },
        // b.ts changed: its viewed mark goes.
        files: [
          { kind: "changed", signature: "a.ts", diff: added("a.ts", 3) },
          { kind: "changed", signature: "b2", diff: added("b.ts", 2) },
        ],
        comments: structuredClone(comments),
      }),
    );
    await useStore.getState().reload();
    expect(useStore.getState().viewedLines).toBe(0);
  });

  it("follow the tree's order", async () => {
    answerWithFiles("/a", [added("z.ts", 1), added("src/b.ts", 1), added("src/a.ts", 1)]);
    vi.mocked(api.openRepository).mockResolvedValue(opening("/a"));
    vi.mocked(api.savedReview).mockResolvedValue({ comments: [] });
    await useStore.getState().open("/a");
    expect(useStore.getState().review?.order.map((f) => f.path)).toEqual(["src/a.ts", "src/b.ts", "z.ts"]);
    expect(useStore.getState().selected).toBe("src/a.ts");
  });
});

describe("find in file", () => {
  it("opens keeping its query, steps either way, and starts over when the query changes", () => {
    useStore.setState({ find: null });
    useStore.getState().openFind();
    useStore.getState().setFindQuery("user");
    useStore.getState().stepFind(1);
    useStore.getState().stepFind(1);
    useStore.getState().stepFind(-1);
    expect(useStore.getState().find).toEqual({ query: "user", focus: 1, step: 1 });
    useStore.getState().openFind();
    expect(useStore.getState().find).toEqual({ query: "user", focus: 2, step: 1 });
    useStore.getState().setFindQuery("userId");
    expect(useStore.getState().find?.step).toBe(0);
    useStore.getState().closeFind();
    useStore.getState().stepFind(1);
    expect(useStore.getState().find).toBeNull();
  });
});
