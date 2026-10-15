import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import type { Comment } from "./bindings/Comment";
import type { Opening } from "./bindings/Opening";
import type { Review } from "./bindings/Review";
import type { SavedReview } from "./bindings/SavedReview";
import type { FileDiff } from "./bindings/FileDiff";
import { CODE_UPDATED, type Composer, canSave, commentText, bannerDetail, keptEdit, requestOf, reviewKey, useStore } from "./store";

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
    fileLines: vi.fn(),
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
    expect(useStore.getState().find).toEqual({ query: "user", focusPending: true, step: 1 });
    useStore.getState().findFocused();
    expect(useStore.getState().find?.focusPending).toBe(false);
    useStore.getState().openFind();
    expect(useStore.getState().find).toEqual({ query: "user", focusPending: true, step: 1 });
    useStore.getState().setFindQuery("userId");
    expect(useStore.getState().find?.step).toBe(0);
    useStore.getState().closeFind();
    useStore.getState().stepFind(1);
    expect(useStore.getState().find).toBeNull();
  });
});

describe("find across files", () => {
  it("starts at the first match of a file opened next, and keeps its place when the open file is selected again", () => {
    useStore.setState({ find: { query: "user", focusPending: false, step: 3 }, selected: "a.ts" });
    useStore.getState().select("a.ts");
    expect(useStore.getState().find?.step).toBe(3);
    useStore.getState().select("b.ts");
    expect(useStore.getState().find).toEqual({ query: "user", focusPending: false, step: 0 });
  });

  it("starts again too when a comment in another file is shown, but not one in the same file", () => {
    const other: Comment = { ...comment("o"), path: "b.ts" };
    useStore.setState({ comments: [comment("c"), other], find: { query: "user", focusPending: false, step: 3 }, selected: "a.ts" });
    useStore.getState().showComment("c");
    expect(useStore.getState().find?.step).toBe(3);
    useStore.getState().showComment("o");
    expect(useStore.getState().find?.step).toBe(0);
  });
});

describe("the preview's kept edit", () => {
  beforeEach(async () => {
    await openWith("/a", { comments: [comment("c")] });
  });

  const kept = () => keptEdit(useStore.getState().previewEdit, reviewKey(requestOf(useStore.getState())));
  /** As the preview does: the edit under the key of the review it was typed over. */
  const setEdit = (text: string) => useStore.getState().setPreviewEdit({ key: reviewKey(requestOf(useStore.getState())), text });

  it("is kept while the review is rebuilt unchanged", () => {
    setEdit("mine");
    useStore.setState({ comments: useStore.getState().comments.map((c) => ({ ...c })) });
    expect(kept()).toBe("mine");
  });

  it("is not kept once the comments, the base or what is checked out change", () => {
    const start = useStore.getState();
    for (const change of [
      { comments: [{ ...comment("c"), text: "other" }] },
      { base: { kind: "ref", name: "main" } as const },
      { review: { ...start.review!, checkout: { ...start.review!.checkout, head: { kind: "branch", name: "agent/y" } as const } } },
    ]) {
      useStore.setState({ comments: start.comments, base: start.base, review: start.review });
      setEdit("mine");
      expect(kept()).toBe("mine");
      useStore.setState(change);
      expect(kept()).toBeNull();
    }
  });

  it("is what Copy review copies, and is dropped once copied", async () => {
    const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
    setEdit("mine");
    await useStore.getState().copyReview();
    expect(writeText).toHaveBeenLastCalledWith("mine");
    expect(useStore.getState().previewEdit).toBeNull();
  });
});

describe("editing a comment saved with an indented suggestion", () => {
  it("shows and compares the suggestion without its indent, so unchanged code still needs a reason", async () => {
    const old: Comment = {
      ...comment("c"),
      text: "",
      target: { kind: "lines", side: "new", start: 3, code: ["    a();"] },
      suggestion: "    a();",
    };
    await openWith("/a", { comments: [old] });
    useStore.getState().editComment("c");
    const composer = useStore.getState().composer!;
    expect(composer.suggestion).toBe("a();");
    expect(canSave(composer)).toBe(false);
  });
});

/** Opens `/a` with `files`, nothing viewed, the first file selected. */
async function openFiles(files: FileDiff[]) {
  answerWithFiles("/a", files);
  vi.mocked(api.openRepository).mockResolvedValue(opening("/a"));
  vi.mocked(api.savedReview).mockResolvedValue({ comments: [] });
  await useStore.getState().open("/a");
}

describe("moving between files by key", () => {
  beforeEach(() => openFiles([added("a.ts", 1), added("b.ts", 1), added("c.ts", 1)]));
  const selected = () => useStore.getState().selected;

  it("steps through the sidebar's order and stops at either end, keeping the selection there", () => {
    useStore.getState().stepFile(1);
    useStore.getState().stepFile(1);
    expect(selected()).toBe("c.ts");
    const lines = { path: "c.ts", side: "new" as const, anchor: 1, head: 1, dragging: false };
    useStore.setState({ selection: lines });
    useStore.getState().stepFile(1);
    expect(selected()).toBe("c.ts");
    expect(useStore.getState().selection).toBe(lines);
    useStore.getState().stepFile(-1);
    expect(selected()).toBe("b.ts");
  });

  it("goes to the next or previous file not viewed, wrapping round", () => {
    useStore.getState().toggleViewed("b.ts");
    useStore.getState().stepUnviewed(1);
    expect(selected()).toBe("c.ts");
    useStore.getState().stepUnviewed(1);
    expect(selected()).toBe("a.ts");
    useStore.getState().stepUnviewed(-1);
    expect(selected()).toBe("c.ts");
  });

  it("stays put, keeping the selection, when no other file is left to view", () => {
    useStore.getState().toggleViewed("b.ts");
    useStore.getState().toggleViewed("c.ts");
    const lines = { path: "a.ts", side: "new" as const, anchor: 1, head: 1, dragging: false };
    useStore.setState({ selection: lines });
    useStore.getState().stepUnviewed(1);
    expect(selected()).toBe("a.ts");
    expect(useStore.getState().selection).toBe(lines);
  });

  it("marks the file viewed and goes on to the next not viewed, never unmarking one", () => {
    useStore.getState().viewedAndNext();
    expect(useStore.getState().viewed.has("a.ts")).toBe(true);
    expect(selected()).toBe("b.ts");
    useStore.getState().toggleViewed("c.ts");
    useStore.getState().select("c.ts");
    useStore.getState().viewedAndNext();
    expect(useStore.getState().viewed.has("c.ts")).toBe(true);
    expect(selected()).toBe("b.ts");
    useStore.getState().toggleViewed("b.ts");
    useStore.getState().viewedAndNext();
    expect(useStore.getState().viewed.size).toBe(3);
    expect(selected()).toBe("b.ts");
  });
});

describe("showing every unchanged line", () => {
  // Line 3 changed and line 8 added, each with a line of context: gaps 1, 5–6 and after 9.
  const file: FileDiff = {
    path: "m.ts",
    status: { kind: "modified" },
    content: {
      kind: "text",
      hunks: [
        { oldStart: 2, newStart: 2, section: "", lines: [{ kind: "context", old: 2, new: 2, text: "2" }, { kind: "removed", old: 3, text: "-" }, { kind: "added", new: 3, text: "3" }, { kind: "context", old: 4, new: 4, text: "4" }] },
        { oldStart: 7, newStart: 7, section: "", lines: [{ kind: "context", old: 7, new: 7, text: "7" }, { kind: "added", new: 8, text: "8" }, { kind: "context", old: 8, new: 9, text: "9" }] },
      ],
    },
  };
  const gaps = () => useStore.getState().expanded.get("m.ts")?.gaps;

  beforeEach(async () => {
    await openFiles([file]);
    vi.mocked(api.fileLines).mockReset();
  });

  it("reads the file once, from the first gap on, and shows each gap's own lines", async () => {
    vi.mocked(api.fileLines).mockResolvedValue(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"]);
    await useStore.getState().showAllLines("m.ts");
    expect(api.fileLines).toHaveBeenCalledTimes(1);
    expect(api.fileLines).toHaveBeenCalledWith({ old: null, new: { kind: "workingTree" } }, "new", "m.ts", 1, 0xffffffff);
    expect(gaps()).toEqual({ "h:2:2": ["1"], "h:7:7": ["5", "6"], rest: ["10", "11"] });
    await useStore.getState().showAllLines("m.ts");
    expect(api.fileLines).toHaveBeenCalledTimes(1);
  });

  it("reads again only the gaps not shown, a failed read among them", async () => {
    vi.mocked(api.fileLines).mockResolvedValueOnce(["5", "6"]);
    await useStore.getState().expandGaps("m.ts", [{ key: "h:7:7", gap: { oldFirst: 5, newFirst: 5, count: 2 } }]);
    expect(api.fileLines).toHaveBeenLastCalledWith(expect.anything(), "new", "m.ts", 5, 6);
    vi.mocked(api.fileLines).mockRejectedValueOnce(new Error("gone"));
    await useStore.getState().showAllLines("m.ts");
    expect(api.fileLines).toHaveBeenLastCalledWith(expect.anything(), "new", "m.ts", 1, 0xffffffff);
    expect(gaps()).toEqual({ "h:2:2": "failed", "h:7:7": ["5", "6"], rest: "failed" });
    vi.mocked(api.fileLines).mockResolvedValueOnce(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
    await useStore.getState().showAllLines("m.ts");
    expect(gaps()).toEqual({ "h:2:2": ["1"], "h:7:7": ["5", "6"], rest: ["10"] });
  });
});

describe("checking for changes now", () => {
  beforeEach(async () => {
    await openWith("/a", { comments: [] });
    useStore.setState({ watching: true });
    vi.mocked(api.loadReview).mockClear();
  });
  const fullReads = () => vi.mocked(api.loadReview).mock.calls.filter((call) => call[3]).length;

  it("reads everything again, even while a watch runs", async () => {
    await useStore.getState().refresh();
    expect(api.loadReview).toHaveBeenCalledTimes(1);
    expect(fullReads()).toBe(1);
    await useStore.getState().reload();
    expect(fullReads()).toBe(1);
  });

  it("asked for during a load, reads everything once it ends, whatever a poll asked for since", async () => {
    const loading = useStore.getState().reload();
    void useStore.getState().refresh();
    void useStore.getState().poll();
    expect(api.loadReview).toHaveBeenCalledTimes(1);
    await loading;
    await vi.waitFor(() => expect(api.loadReview).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.loadReview).mock.calls[1]![3]).toBe(true);
  });
});

describe("keys that would lose work", () => {
  it("commenting on the selection keeps a comment being written", async () => {
    await openFiles([added("a.ts", 4)]);
    useStore.getState().composeOnLines("a.ts", "new", 1, 2);
    useStore.getState().updateComposer({ text: "draft" });
    useStore.getState().composeOnSelection();
    expect(useStore.getState().composer?.text).toBe("draft");
  });
});

describe("Copy review", () => {
  it("says why it failed, until a copy succeeds", async () => {
    const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
    await openWith("/a", { comments: [comment("c")] });
    useStore.getState().setPreviewEdit({ key: reviewKey(requestOf(useStore.getState())), text: "mine" });
    vi.mocked(writeText).mockRejectedValueOnce(new Error("no clipboard"));
    await useStore.getState().copyReview();
    // Described as the window's other problems are (`describe`, mocked above).
    expect(useStore.getState().copyProblem).toEqual({ title: "Saved comments are unavailable", detail: "Error: no clipboard" });
    await useStore.getState().copyReview();
    expect(useStore.getState().copyProblem).toBeNull();
  });

  it("drops a failure that settles once the checkout is closed", async () => {
    const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
    await openWith("/a", { comments: [comment("c")] });
    useStore.getState().setPreviewEdit({ key: reviewKey(requestOf(useStore.getState())), text: "mine" });
    let fail: (error: Error) => void = () => {};
    vi.mocked(writeText).mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)));
    const copying = useStore.getState().copyReview();
    useStore.getState().closeRepository();
    fail(new Error("no clipboard"));
    await copying;
    expect(useStore.getState().copyProblem).toBeNull();
  });
});

describe("closing the checkout", () => {
  it("closes its lists and dialogs, and forgets a failed copy, so the next one opens without them", async () => {
    await openWith("/a", { comments: [] });
    const left = { commentList: true, basePicker: true, preview: true, copyProblem: { title: "t", detail: "no clipboard" } };
    useStore.setState(left);
    useStore.getState().closeRepository();
    const now = () => {
      const { commentList, basePicker, preview, copyProblem } = useStore.getState();
      return [commentList, basePicker, preview, copyProblem];
    };
    expect(now()).toEqual([false, false, false, null]);
    // Opening another without closing the first does the same.
    useStore.setState(left);
    await openWith("/b", { comments: [] });
    expect(now()).toEqual([false, false, false, null]);
  });
});
