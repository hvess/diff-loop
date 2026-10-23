import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import type { Base } from "./bindings/Base";
import type { Checkout } from "./bindings/Checkout";
import type { Comment } from "./bindings/Comment";
import type { Opening } from "./bindings/Opening";
import type { Resumed } from "./bindings/Resumed";
import type { Review } from "./bindings/Review";
import type { SavedReview } from "./bindings/SavedReview";
import type { FileDiff } from "./bindings/FileDiff";
import type { KeptReview } from "./bindings/KeptReview";
import type { ReviewKey } from "./bindings/ReviewKey";
import type { Round } from "./bindings/Round";
import {
  type Composer,
  bannerDetail,
  canComment,
  canSave,
  canSend,
  commentText,
  keptEdit,
  requestOf,
  resumedBanner,
  reviewKey,
  useStore,
  windowTitle,
} from "./store";

vi.mock("./api", () => ({
  api: {
    openRepository: vi.fn(),
    savedReview: vi.fn(),
    saveReview: vi.fn(),
    loadReview: vi.fn(),
    fingerprint: vi.fn(),
    commitsBetween: vi.fn(() => Promise.resolve(1)),
    roundToFollow: vi.fn(() => Promise.resolve(null)),
    baseChoices: vi.fn(() => Promise.resolve({ refs: [], defaultBranch: null })),
    watchRepository: vi.fn(() => Promise.resolve(true)),
    fileLines: vi.fn(),
    instructions: vi.fn(() => Promise.resolve("md")),
    endRound: vi.fn(),
    mergeReviews: vi.fn((window: SavedReview, saved: SavedReview) =>
      Promise.resolve({ ...window, comments: [...saved.comments, ...window.comments], rounds: [...saved.rounds, ...window.rounds] }),
    ),
    // As the core: seen now at the checkout's commit, compared with its own base, the branch where it was.
    resumeReview: vi.fn((review: SavedReview, _checkout: Checkout, fallback: Base, at: number) =>
      Promise.resolve({ review: { ...review, seen: { commit: "abc", at } }, base: review.base ?? fallback, since: { kind: "unchanged" }, dropped: [] }),
    ),
    openReview: vi.fn(),
    worktreeOf: vi.fn(() => Promise.resolve(null)),
    closeRepository: vi.fn(() => Promise.resolve(null)),
    keptReviews: vi.fn(() => Promise.resolve([])),
    checkProject: vi.fn(),
  },
  describe: (error: unknown) => ({ title: "Saved comments are unavailable", detail: String(error) }),
  isOpenElsewhere: (error: unknown) => error === "elsewhere",
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));

/** The review `checkout` shows, as the core keys it. */
const keyed = (checkout: Checkout): ReviewKey | null =>
  checkout.head.kind === "branch" ? { project: checkout.project, branch: checkout.head.name } : null;

/** An opening of `checkout`, keyed. */
const openingWith = (checkout: Checkout): Opening => ({
  checkout,
  key: keyed(checkout),
  choices: { refs: [], defaultBranch: null },
  base: { kind: "uncommitted" },
});

const opening = (root: string): Opening =>
  openingWith({ name: "r", project: `${root}/.git`, worktree: root, head: { kind: "branch", name: "agent/x" }, commit: "abc" });

/** The review `root`'s checkout shows: `agent/x`'s. */
const key = (root: string): ReviewKey => ({ project: `${root}/.git`, branch: "agent/x" });

/** A review as kept, with no base chosen and never seen. */
const keptReview = (comments: Comment[], rounds: Round[]): SavedReview => ({ comments, rounds, base: null, seen: null });

const comment = (id: string): Comment => ({
  id,
  path: "a.ts",
  target: { kind: "file" },
  text: "t",
  suggestion: null,
  state: "current",
  place: null,
  sent: null,
  resolved: null,
});

/** `c` as sent in round `round`, untouched. */
const sent = (c: Comment, round = 1): Comment => ({
  ...c,
  sent: {
    round,
    place: { base: { kind: "uncommitted" }, head: { kind: "branch", name: "agent/x" } },
    commit: "abc",
    target: c.target,
    before: [],
    after: [],
    text: c.text,
    suggestion: c.suggestion,
    verdict: "untouched",
  },
});

const round = (number: number): Round => ({
  number,
  at: 1000,
  place: { base: { kind: "uncommitted" }, head: { kind: "branch", name: "agent/x" } },
  commit: "abc",
  markdown: "md",
});

/** What load_review answers: the comments it was given, as from IPC, a fresh copy each time. */
function answerLoads(root: string, checkout = opening(root).checkout) {
  vi.mocked(api.loadReview).mockImplementation((base, comments) =>
    Promise.resolve<Review>({
      checkout,
      key: keyed(checkout),
      base,
      fingerprint: null,
      snapshot: { old: null, new: { kind: "workingTree" } },
      files: [],
      comments: structuredClone(comments),
    }),
  );
}

/** The next load finds no comment's code, marking each `state`, with `branch` checked out and `commit` at HEAD. */
function answerNextLoadWithCodeGone(root: string, state: Comment["state"] = "outdated", branch = "agent/x", commit = "abc") {
  vi.mocked(api.loadReview).mockImplementationOnce((base, comments) =>
    Promise.resolve<Review>({
      checkout: { ...opening(root).checkout, head: { kind: "branch", name: branch }, commit },
      key: keyed({ ...opening(root).checkout, head: { kind: "branch", name: branch }, commit }),
      base,
      fingerprint: null,
      snapshot: { old: null, new: { kind: "workingTree" } },
      files: [],
      comments: comments.map((c) => ({ ...c, state })),
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
function answerWithFiles(root: string, files: FileDiff[], checkout = opening(root).checkout) {
  vi.mocked(api.loadReview).mockImplementation((base, comments) =>
    Promise.resolve<Review>({
      checkout,
      key: keyed(checkout),
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

describe("the banner on showing a review again", () => {
  const resumed = (since: Resumed["since"], dropped: number[] = [], comments = [comment("c")]): Resumed => ({
    review: keptReview(comments, []),
    base: { kind: "uncommitted" },
    since,
    dropped,
  });

  it("says nothing when the branch is where it was", () => {
    expect(resumedBanner("agent/x", resumed({ kind: "unchanged" }), "abc")).toBeNull();
  });

  it("says how far the branch moved, and offers what changed", () => {
    const moved = resumedBanner("agent/share-retry", resumed({ kind: "moved", from: "9b04e1a11", count: 3 }), "2d7f3c0aa");
    expect(moved).toEqual({
      title: "agent/share-retry moved since you last looked",
      body: "3 new commits, 9b04e1a → 2d7f3c0. Comments follow their code.",
      action: { kind: "base", label: "Show What Changed", base: { kind: "ref", name: "9b04e1a11" } },
    });
  });

  it("names the rounds a rewrite deleted", () => {
    const one = resumedBanner("b", resumed({ kind: "rewritten", from: "x" }, [1]), "y");
    expect(one?.body).toBe(
      "A rebase or force-push replaced its history. Round 1 was sent on commits that are gone and was deleted. Comments follow their code where it still exists.",
    );
    const three = resumedBanner("b", resumed({ kind: "rewritten", from: "x" }, [1, 2, 3], []), "y");
    expect(three?.body).toBe(
      "A rebase or force-push replaced its history. Rounds 1, 2 and 3 were sent on commits that are gone and were deleted.",
    );
    expect(three?.title).toBe("b was rewritten while you were away");
  });
});

describe("the base picker's choices", () => {
  it("are kept for the checkout they were read for, and dropped once another opens", async () => {
    await openWith("/a", keptReview([], []));
    let answer: (choices: { refs: never[]; defaultBranch: string | null }) => void = () => {};
    vi.mocked(api.baseChoices).mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    useStore.getState().refreshChoices();
    await openWith("/b", keptReview([], []));
    answer({ refs: [], defaultBranch: "main" });
    await vi.waitFor(() => expect(api.baseChoices).toHaveBeenCalled());
    await Promise.resolve();
    expect(useStore.getState().choices.defaultBranch).toBeNull();

    vi.mocked(api.baseChoices).mockResolvedValueOnce({ refs: [], defaultBranch: "trunk" });
    useStore.getState().refreshChoices();
    await vi.waitFor(() => expect(useStore.getState().choices.defaultBranch).toBe("trunk"));
  });
});

describe("saving the review", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(api.saveReview).mockReset().mockResolvedValue(null);
  });

  it("opens with the saved review, keeps where its branch was seen, and saves nothing else it did not change", async () => {
    await openWith("/a", keptReview([comment("c")], []));
    await useStore.getState().reload();
    vi.advanceTimersByTime(300);
    await vi.runAllTimersAsync();
    expect(useStore.getState().comments.map((c) => c.id)).toEqual(["c"]);
    expect(api.saveReview).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.saveReview).mock.lastCall?.[1].seen?.commit).toBe("abc");
  });

  it("writes nothing for a branch only looked at, then keeps its review from the first comment", async () => {
    await openWith("/a", keptReview([], []));
    await vi.runAllTimersAsync();
    expect(api.saveReview).not.toHaveBeenCalled();
    await useStore.getState().chooseBase({ kind: "lastCommit" });
    await vi.runAllTimersAsync();
    expect(api.saveReview).not.toHaveBeenCalled();
    useStore.setState({ comments: [comment("c")] });
    await vi.waitFor(() =>
      expect(api.saveReview).toHaveBeenCalledWith(
        key("/a"),
        expect.objectContaining({ comments: [comment("c")], base: { kind: "lastCommit" } }),
      ),
    );
    // Its last comment deleted, the review goes from the store.
    useStore.setState({ comments: [] });
    await vi.waitFor(() => expect(vi.mocked(api.saveReview).mock.lastCall?.[1].comments).toEqual([]));
  });

  it("is shown against its own base, and only the reviewer's choice is kept with it", async () => {
    await openWith("/a", { ...keptReview([comment("c")], []), base: { kind: "ref", name: "main" } });
    expect(useStore.getState().base).toEqual({ kind: "ref", name: "main" });
    await useStore.getState().setBase({ kind: "lastCommit" });
    expect(useStore.getState().keptBase).toEqual({ kind: "ref", name: "main" });
    await useStore.getState().chooseBase({ kind: "uncommitted" });
    expect(useStore.getState().keptBase).toEqual({ kind: "uncommitted" });
  });

  it("saves a comment change at once, for the open checkout", async () => {
    await openWith("/a", keptReview([], []));
    useStore.setState({ comments: [comment("c")] });
    await vi.waitFor(() =>
      expect(api.saveReview).toHaveBeenCalledWith(key("/a"), expect.objectContaining({ comments: [comment("c")], rounds: [] })),
    );
  });

  it("lands saves in the order they were made", async () => {
    await openWith("/a", keptReview([], []));
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
    await openWith("/a", keptReview([], []));
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

    vi.mocked(api.savedReview).mockResolvedValue(keptReview([comment("old")], []));
    await useStore.getState().retrySave();
    expect(useStore.getState().comments.map((c) => c.id)).toEqual(["old", "new"]);
    expect(useStore.getState().saveProblem).toBeNull();
    await vi.waitFor(() =>
      expect(api.saveReview).toHaveBeenLastCalledWith(
        key("/a"),
        expect.objectContaining({ comments: [comment("old"), comment("new")], rounds: [] }),
      ),
    );
  });
});

describe("reloading", () => {
  beforeEach(() => {
    vi.mocked(api.saveReview).mockReset().mockResolvedValue(null);
    vi.mocked(api.fingerprint).mockReset();
  });

  it("keeps the window's state when nothing reviewed changed", async () => {
    await openWith("/a", keptReview([comment("c")], []));
    const before = useStore.getState().review;
    await useStore.getState().reload();
    expect(useStore.getState().review).toBe(before);
  });

  it("takes a load that changed something", async () => {
    await openWith("/a", keptReview([], []));
    const before = useStore.getState().review;
    vi.mocked(api.loadReview).mockImplementationOnce((base) =>
      Promise.resolve<Review>({
        checkout: opening("/a").checkout,
        key: keyed(opening("/a").checkout),
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
    await openWith("/a", keptReview([], []));
    useStore.setState({ loadProblem: { title: "Git reported a problem", detail: "busy" } });
    await useStore.getState().reload();
    expect(useStore.getState().loadProblem).toBeNull();
  });

  it("takes a load whose fingerprint moved, so a poll compares against it", async () => {
    await openWith("/a", keptReview([], []));
    const before = useStore.getState().review;
    vi.mocked(api.loadReview).mockImplementationOnce((base, comments) =>
      Promise.resolve<Review>({
        checkout: opening("/a").checkout,
        key: keyed(opening("/a").checkout),
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
    await openWith("/a", keptReview([], []));
    useStore.setState({ watching: true });
    vi.mocked(api.loadReview).mockClear();
    const loading = useStore.getState().reload();
    await useStore.getState().poll();
    expect(api.loadReview).toHaveBeenCalledTimes(1);
    await loading;
    await vi.waitFor(() => expect(api.loadReview).toHaveBeenCalledTimes(2));
  });

  /** Regression: a comment moved by a handle while a load ran went back to where the load put it. */
  it("keeps a comment changed while a load ran as it was changed", async () => {
    await openWith("/a", keptReview([comment("c")], []));
    let answer = () => {};
    vi.mocked(api.loadReview).mockImplementationOnce(
      (base, comments) =>
        new Promise<Review>((resolve) => {
          answer = () =>
            resolve({
              checkout: opening("/a").checkout,
              key: opening("/a").key,
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

  it("removes nothing: a comment the load marks lost stays, and its card closes", async () => {
    await openWith("/a", keptReview([comment("c")], []));
    useStore.setState({ openComment: "c" });
    answerNextLoadWithCodeGone("/a", "lost");
    await useStore.getState().reload();
    expect(useStore.getState().comments).toEqual([{ ...comment("c"), state: "lost" }]);
    expect(useStore.getState().openComment).toBeNull();
    expect(useStore.getState().banner).toBeNull();
  });

  it("says only that the branch moved, with what to compare against", async () => {
    await openWith("/a", keptReview([comment("c")], []));
    answerNextLoadWithCodeGone("/a", "outdated", "agent/x", "def");
    await useStore.getState().reload();
    expect(useStore.getState().banner).toEqual({
      title: "The branch moved: 1 new commit",
      body: null,
      action: { kind: "base", label: "Show What Changed", base: { kind: "ref", name: "abc" } },
    });
    expect(useStore.getState().comments.map((c) => c.id)).toEqual(["c"]);
  });

  it("follows a commit made on top of a round the core names, comparing with the round's commit", async () => {
    await openWith("/a", keptReview([sent(comment("c"))], [round(1)]));
    vi.mocked(api.roundToFollow).mockResolvedValueOnce(1);
    answerNextLoadWithCodeGone("/a", "outdated", "agent/x", "def");
    answerNextLoadWithCodeGone("/a", "current", "agent/x", "def");
    await useStore.getState().reload();
    expect(vi.mocked(api.roundToFollow).mock.lastCall?.slice(1)).toEqual([
      { base: { kind: "uncommitted" }, head: { kind: "branch", name: "agent/x" } },
      "abc",
    ]);
    expect(useStore.getState().base).toEqual({ kind: "ref", name: "abc" });
    expect(useStore.getState().banner).toEqual({
      title: "The branch moved: 1 new commit · showing changes since round 1 (abc)",
      body: null,
      action: { kind: "base", label: "Show Uncommitted Changes", base: { kind: "uncommitted" } },
    });
    answerNextLoadWithCodeGone("/a", "outdated", "agent/x", "def");
    await useStore.getState().takeBannerAction();
    expect(useStore.getState().base).toEqual({ kind: "uncommitted" });
    expect(useStore.getState().banner).toBeNull();
  });

  it("follows a commit made on top of the newest round while the window was closed", async () => {
    answerNextLoadWithCodeGone("/a", "outdated", "agent/x", "def");
    answerNextLoadWithCodeGone("/a", "current", "agent/x", "def");
    vi.mocked(api.roundToFollow).mockResolvedValueOnce(1);
    await openWith("/a", keptReview([sent(comment("c"))], [round(1)]));
    expect(vi.mocked(api.roundToFollow).mock.lastCall?.[2]).toBe("abc");
    expect(useStore.getState().base).toEqual({ kind: "ref", name: "abc" });
    expect(useStore.getState().banner?.title).toBe("The branch moved: 1 new commit · showing changes since round 1 (abc)");
  });

  it("says nothing on opening after the newest round's commit was rewritten away", async () => {
    vi.mocked(api.roundToFollow).mockClear();
    vi.mocked(api.commitsBetween).mockResolvedValueOnce(null);
    answerNextLoadWithCodeGone("/a", "outdated", "agent/x", "def");
    await openWith("/a", keptReview([sent(comment("c"))], [round(1)]));
    expect(api.roundToFollow).not.toHaveBeenCalled();
    expect(useStore.getState().base).toEqual({ kind: "uncommitted" });
    expect(useStore.getState().banner).toBeNull();
  });

  it("follows nothing when the reviewer chooses the uncommitted changes after a failed load", async () => {
    vi.mocked(api.loadReview).mockRejectedValueOnce(new Error("no such ref"));
    await openWith("/a", keptReview([sent(comment("c"))], [round(1)]));
    expect(useStore.getState().review).toBeNull();
    vi.mocked(api.roundToFollow).mockClear();
    answerNextLoadWithCodeGone("/a", "outdated", "agent/x", "def");
    await useStore.getState().setBase({ kind: "uncommitted" });
    expect(api.roundToFollow).not.toHaveBeenCalled();
    expect(useStore.getState().base).toEqual({ kind: "uncommitted" });
  });

  it("says nothing on opening at the newest round's own commit", async () => {
    vi.mocked(api.roundToFollow).mockClear();
    await openWith("/a", keptReview([sent(comment("c"))], [round(1)]));
    expect(api.roundToFollow).not.toHaveBeenCalled();
    expect(useStore.getState().banner).toBeNull();
  });

  it("does not follow a commit when the reviewer has just chosen the uncommitted changes", async () => {
    await openWith("/a", keptReview([sent(comment("c"))], [round(1)]));
    await useStore.getState().setBase({ kind: "lastCommit" });
    vi.mocked(api.roundToFollow).mockClear();
    answerNextLoadWithCodeGone("/a", "outdated", "agent/x", "def");
    await useStore.getState().setBase({ kind: "uncommitted" });
    expect(api.roundToFollow).not.toHaveBeenCalled();
    expect(useStore.getState().base).toEqual({ kind: "uncommitted" });
    expect(useStore.getState().banner?.title).toBe("The branch moved: 1 new commit");
  });

  it("drops the follow's banner when the reviewer picks another base while it loads", async () => {
    await openWith("/a", keptReview([sent(comment("c"))], [round(1)]));
    vi.mocked(api.roundToFollow).mockResolvedValueOnce(1);
    answerNextLoadWithCodeGone("/a", "outdated", "agent/x", "def");
    vi.mocked(api.loadReview).mockImplementationOnce((base, comments) => {
      useStore.setState({ base: { kind: "lastCommit" } });
      return Promise.resolve<Review>({
        checkout: { ...opening("/a").checkout, commit: "def" },
        key: keyed({ ...opening("/a").checkout, commit: "def" }),
        base,
        fingerprint: null,
        snapshot: { old: null, new: { kind: "workingTree" } },
        files: [],
        comments: structuredClone(comments),
      });
    });
    await useStore.getState().reload();
    expect(useStore.getState().base).toEqual({ kind: "lastCommit" });
    expect(useStore.getState().banner).toBeNull();
  });

  it("keeps saying it follows the round when a second commit lands on top", async () => {
    await openWith("/a", keptReview([sent(comment("c"))], [round(1)]));
    vi.mocked(api.roundToFollow).mockResolvedValueOnce(1);
    answerNextLoadWithCodeGone("/a", "outdated", "agent/x", "def");
    answerNextLoadWithCodeGone("/a", "current", "agent/x", "def");
    await useStore.getState().reload();
    expect(useStore.getState().base).toEqual({ kind: "ref", name: "abc" });
    // The next commit: one since the last load, two since the round's commit.
    vi.mocked(api.commitsBetween).mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    vi.mocked(api.roundToFollow).mockResolvedValueOnce(1);
    answerNextLoadWithCodeGone("/a", "current", "agent/x", "ghi");
    await useStore.getState().reload();
    expect(useStore.getState().base).toEqual({ kind: "ref", name: "abc" });
    expect(useStore.getState().banner).toEqual({
      title: "The branch moved: 2 new commits · showing changes since round 1 (abc)",
      body: null,
      action: { kind: "base", label: "Show Uncommitted Changes", base: { kind: "uncommitted" } },
    });
  });

  it("stops following a round when the round's commit is rewritten away", async () => {
    await openWith("/a", keptReview([sent(comment("c"))], [round(1)]));
    vi.mocked(api.roundToFollow).mockResolvedValueOnce(1);
    answerNextLoadWithCodeGone("/a", "outdated", "agent/x", "def");
    answerNextLoadWithCodeGone("/a", "current", "agent/x", "def");
    await useStore.getState().reload();
    expect(useStore.getState().following).toEqual({ round: 1, since: "abc" });
    // One commit since the last load, but the round's own commit is gone from under HEAD.
    vi.mocked(api.commitsBetween).mockResolvedValueOnce(1).mockResolvedValueOnce(null);
    answerNextLoadWithCodeGone("/a", "current", "agent/x", "ghi");
    await useStore.getState().reload();
    expect(useStore.getState().following).toBeNull();
    expect(useStore.getState().banner?.title).toBe("The branch was rewritten");
  });

  it("stops following a round the core no longer names, its comments resolved", async () => {
    await openWith("/a", keptReview([sent(comment("c"))], [round(1)]));
    vi.mocked(api.roundToFollow).mockResolvedValueOnce(1);
    answerNextLoadWithCodeGone("/a", "outdated", "agent/x", "def");
    answerNextLoadWithCodeGone("/a", "current", "agent/x", "def");
    await useStore.getState().reload();
    vi.mocked(api.commitsBetween).mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    vi.mocked(api.roundToFollow).mockResolvedValueOnce(null);
    answerNextLoadWithCodeGone("/a", "current", "agent/x", "ghi");
    await useStore.getState().reload();
    expect(useStore.getState().following).toBeNull();
    expect(useStore.getState().banner).toEqual({
      title: "The branch moved: 1 new commit",
      body: null,
      action: { kind: "base", label: "Show What Changed", base: { kind: "ref", name: "def" } },
    });
  });

  it("starts no follow from the round's commit the reviewer picked", async () => {
    await openWith("/a", keptReview([sent(comment("c"))], [round(1)]));
    await useStore.getState().setBase({ kind: "ref", name: "abc1234" });
    vi.mocked(api.roundToFollow).mockClear();
    answerNextLoadWithCodeGone("/a", "current", "agent/x", "def");
    await useStore.getState().reload();
    expect(api.roundToFollow).not.toHaveBeenCalled();
    expect(useStore.getState().base).toEqual({ kind: "ref", name: "abc1234" });
    expect(useStore.getState().banner?.title).toBe("The branch moved: 1 new commit");
  });

  it("stops following a round once the reviewer picks another base", async () => {
    await openWith("/a", keptReview([sent(comment("c"))], [round(1)]));
    vi.mocked(api.roundToFollow).mockResolvedValueOnce(1);
    answerNextLoadWithCodeGone("/a", "outdated", "agent/x", "def");
    answerNextLoadWithCodeGone("/a", "current", "agent/x", "def");
    await useStore.getState().reload();
    expect(useStore.getState().following).toEqual({ round: 1, since: "abc" });
    answerNextLoadWithCodeGone("/a", "current", "agent/x", "def");
    await useStore.getState().setBase({ kind: "lastCommit" });
    expect(useStore.getState().following).toBeNull();
  });

  it("does not follow a commit once the reviewer has picked another base", async () => {
    await openWith("/a", keptReview([sent(comment("c"))], [round(1)]));
    vi.mocked(api.roundToFollow).mockImplementationOnce(() => {
      useStore.setState({ base: { kind: "lastCommit" } });
      return Promise.resolve(1);
    });
    answerNextLoadWithCodeGone("/a", "outdated", "agent/x", "def");
    await useStore.getState().reload();
    expect(useStore.getState().base).toEqual({ kind: "lastCommit" });
    expect(useStore.getState().banner).toBeNull();
  });

  it("counts the comments a load resolved itself", async () => {
    const applied = sent(comment("c"));
    await openWith("/a", keptReview([applied], [round(1)]));
    vi.mocked(api.loadReview).mockImplementationOnce((base, comments) =>
      Promise.resolve<Review>({
        checkout: opening("/a").checkout,
        key: keyed(opening("/a").checkout),
        base,
        fingerprint: null,
        snapshot: { old: null, new: { kind: "workingTree" } },
        files: [],
        comments: comments.map((c) => ({ ...c, resolved: "suggestionApplied", sent: c.sent && { ...c.sent, verdict: "applied" } })),
      }),
    );
    await useStore.getState().reload();
    expect(useStore.getState().autoResolved).toBe(1);
    expect(useStore.getState().comments[0]?.resolved).toEqual("suggestionApplied");
  });

  it("keeps a saved comment whose code is gone when the checkout opens, hidden", async () => {
    answerNextLoadWithCodeGone("/a");
    await openWith("/a", keptReview([comment("c")], []));
    expect(useStore.getState().comments).toEqual([{ ...comment("c"), state: "outdated" }]);
  });

  it("keeps a comment whose code is gone after the base changed, hidden", async () => {
    await openWith("/a", keptReview([comment("c")], []));
    answerNextLoadWithCodeGone("/a");
    await useStore.getState().setBase({ kind: "ref", name: "main" });
    expect(useStore.getState().comments).toEqual([{ ...comment("c"), state: "outdated" }]);
  });

  it("closes the card of a comment that becomes hidden", async () => {
    await openWith("/a", keptReview([comment("c")], []));
    useStore.setState({ openComment: "c" });
    answerNextLoadWithCodeGone("/a");
    await useStore.getState().setBase({ kind: "ref", name: "main" });
    expect(useStore.getState().openComment).toBeNull();
  });

  it("shows the review from its branch's commits once its worktree checks out another branch", async () => {
    await openWith("/a", keptReview([comment("c")], []));
    vi.mocked(api.openReview).mockResolvedValueOnce(openingWith({ ...opening("/a").checkout, worktree: null }));
    answerNextLoadWithCodeGone("/a", "outdated", "agent/y");
    await useStore.getState().reload();
    await vi.waitFor(() => expect(useStore.getState().opening?.checkout.worktree).toBeNull());
    expect(api.openReview).toHaveBeenLastCalledWith(key("/a"));
    expect(useStore.getState().key).toEqual(key("/a"));
    // The other branch's load is not this review's: its comments were never moved by it.
    expect(useStore.getState().comments).toEqual([comment("c")]);
    expect(useStore.getState().banner).toEqual({
      title: "now has agent/y checked out".replace(/^/, "/a "),
      body: "agent/x isn’t checked out in any worktree. This review shows its committed changes only. Check it out in one to send its comments.",
      action: { kind: "review", label: "Open agent/y", key: { project: "/a/.git", branch: "agent/y" } },
    });
  });

  /** Opens `/a`'s `agent/x` as no worktree has it: from its commits. */
  async function openCommitted(saved: SavedReview) {
    const committed = { ...opening("/a").checkout, worktree: null };
    vi.mocked(api.openRepository).mockResolvedValue(openingWith(committed));
    vi.mocked(api.savedReview).mockResolvedValue(saved);
    answerLoads("/a", committed);
    await useStore.getState().open("/a");
  }

  it("follows its branch to the worktree that checks it out, saying nothing", async () => {
    await openCommitted(keptReview([comment("c")], []));
    expect(useStore.getState().opening?.checkout.worktree).toBeNull();
    vi.mocked(api.worktreeOf).mockResolvedValueOnce("/a");
    vi.mocked(api.openReview).mockResolvedValueOnce(opening("/a"));
    answerLoads("/a");
    await useStore.getState().poll();
    expect(api.openReview).toHaveBeenLastCalledWith(key("/a"));
    expect(useStore.getState().opening?.checkout.worktree).toBe("/a");
    expect(useStore.getState().banner).toBeNull();
  });

  it("sends no round, but keeps comments, for a branch no worktree has checked out", async () => {
    vi.mocked(api.endRound).mockClear();
    await openCommitted(keptReview([comment("c")], []));
    expect(canSend(useStore.getState())).toBe(false);
    expect(canComment(useStore.getState())).toBe(true);
    await useStore.getState().copyReview();
    expect(api.endRound).not.toHaveBeenCalled();
    expect(useStore.getState().copied).toBeNull();
  });

  it("writes and sends nothing on a detached HEAD, and says why", async () => {
    const detached = { ...opening("/a").checkout, head: { kind: "detached" as const, commit: "4e1b2a0" } };
    vi.mocked(api.openRepository).mockResolvedValue(openingWith(detached));
    vi.mocked(api.savedReview).mockClear();
    answerWithFiles("/a", [added("a.ts", 2)], detached);
    await useStore.getState().open("/a");
    const s = useStore.getState();
    expect(s.key).toBeNull();
    expect(api.savedReview).not.toHaveBeenCalled();
    expect(s.banner?.title).toBe("HEAD is detached at 4e1b2a0");
    s.composeOnLines("a.ts", "new", 1, 1);
    s.composeOnFile("a.ts");
    expect(useStore.getState().composer).toBeNull();
    expect(canSend(s)).toBe(false);
  });

  it("keeps a hidden comment whose code is still gone", async () => {
    const hidden: Comment = { ...comment("c"), state: "outdated" };
    await openWith("/a", keptReview([hidden], []));
    answerNextLoadWithCodeGone("/a");
    await useStore.getState().reload();
    expect(useStore.getState().comments).toEqual([hidden]);
  });

  it("jumps past a hidden comment", async () => {
    const hidden: Comment = { ...comment("h"), state: "outdated" };
    await openWith("/a", keptReview([hidden, comment("c")], []));
    useStore.getState().jumpComment(1);
    expect(useStore.getState().openComment).toBe("c");
    useStore.getState().jumpComment(1);
    expect(useStore.getState().openComment).toBe("c");
  });

  it("while watching, checks for changes by loading, not by a fingerprint", async () => {
    await openWith("/a", keptReview([], []));
    useStore.setState({ watching: true });
    vi.mocked(api.loadReview).mockClear();
    await useStore.getState().poll();
    expect(api.loadReview).toHaveBeenCalledTimes(1);
    expect(api.fingerprint).not.toHaveBeenCalled();
  });
});

describe("the banner's detail", () => {
  it("counts the open comments not in this diff, and says nothing with none", () => {
    expect(bannerDetail(1)).toBe("1 comment is not in this diff.");
    expect(bannerDetail(2)).toBe("2 comments are not in this diff.");
    expect(bannerDetail(0)).toBe("");
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
    vi.mocked(api.savedReview).mockResolvedValue(keptReview([], []));
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
    vi.mocked(api.savedReview).mockResolvedValue(keptReview([], []));
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
        key: keyed(opening("/a").checkout),
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
    vi.mocked(api.savedReview).mockResolvedValue(keptReview([], []));
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
    vi.mocked(api.endRound).mockImplementation((r) => Promise.resolve(r.review));
    await openWith("/a", keptReview([comment("c")], []));
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

  it("is what Copy Review copies, and is dropped once copied", async () => {
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
    await openWith("/a", keptReview([old], []));
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
  vi.mocked(api.savedReview).mockResolvedValue(keptReview([], []));
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

  it("steps only through the files Filter Files keeps", () => {
    useStore.getState().setFileFilter("C");
    useStore.getState().stepFile(1);
    expect(selected()).toBe("c.ts");
    useStore.getState().stepFile(-1);
    expect(selected()).toBe("c.ts");
    useStore.getState().setFileFilter("b");
    useStore.getState().stepUnviewed(1);
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
    await openWith("/a", keptReview([], []));
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

describe("Copy Review", () => {
  it("says why it failed, until a copy succeeds", async () => {
    const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
    await openWith("/a", keptReview([comment("c")], []));
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
    await openWith("/a", keptReview([comment("c")], []));
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
    await openWith("/a", keptReview([], []));
    const left = { commentList: true, basePicker: true, preview: true, copyProblem: { title: "t", detail: "no clipboard" } };
    useStore.setState(left);
    vi.mocked(api.closeRepository).mockClear();
    useStore.getState().closeRepository();
    // Closed, the review is let go for another window (ADR 0026 §9).
    expect(api.closeRepository).toHaveBeenCalledTimes(1);
    expect(useStore.getState().key).toBeNull();
    const now = () => {
      const { commentList, basePicker, preview, copyProblem } = useStore.getState();
      return [commentList, basePicker, preview, copyProblem];
    };
    expect(now()).toEqual([false, false, false, null]);
    // Opening another without closing the first does the same.
    useStore.setState(left);
    await openWith("/b", keptReview([], []));
    expect(now()).toEqual([false, false, false, null]);
  });
});

describe("rounds", () => {
  beforeEach(async () => {
    vi.mocked(api.saveReview).mockReset().mockResolvedValue(null);
    vi.mocked(api.endRound).mockReset().mockImplementation((r) =>
      Promise.resolve({
        ...r.review,
        comments: r.review.comments.map((c) => (c.resolved === null ? sent(c, r.review.rounds.length + 1) : c)),
        rounds: [...r.review.rounds, { ...round(r.review.rounds.length + 1), markdown: r.markdown }],
      }),
    );
    await openWith("/a", keptReview([comment("a"), { ...sent(comment("r")), resolved: "byReviewer" }], [round(1)]));
  });

  it("are ended by a copy: every open comment is sent, the round is kept, and the copy says so", async () => {
    await useStore.getState().copyReview();
    const s = useStore.getState();
    expect(s.rounds.map((r) => r.number)).toEqual([1, 2]);
    expect(s.comments.map((c) => c.sent?.round)).toEqual([2, 1]);
    expect(s.copied).toEqual({ round: 2 });
    expect(vi.mocked(api.endRound).mock.calls[0]?.[0]).toMatchObject({ markdown: "md", place: { base: { kind: "uncommitted" }, head: { kind: "branch", name: "agent/x" } } });
    await vi.waitFor(() =>
      expect(api.saveReview).toHaveBeenLastCalledWith(key("/a"), expect.objectContaining({ comments: s.comments, rounds: s.rounds })),
    );
  });

  it("can be taken back as not sent until the next load changes something", async () => {
    await useStore.getState().copyReview();
    expect(useStore.getState().unsend?.rounds.length).toBe(1);
    useStore.getState().unsendRound();
    expect(useStore.getState().rounds.map((r) => r.number)).toEqual([1]);
    expect(useStore.getState().comments[0]?.sent).toBeNull();
    expect(useStore.getState().copied).toBeNull();
    await useStore.getState().copyReview();
    useStore.getState().dismissCopied();
    expect(useStore.getState().unsend).toBeNull();
    await useStore.getState().copyReview();
    answerNextLoadWithCodeGone("/a", "outdated", "agent/x", "def");
    await useStore.getState().reload();
    expect(useStore.getState().unsend).toBeNull();
    expect(useStore.getState().copied).toBeNull();
  });

  it("does not offer Not Sent when a comment changed while the round was recorded", async () => {
    let answer = () => {};
    vi.mocked(api.endRound).mockImplementationOnce(
      (r) => new Promise((resolve) => (answer = () => resolve({ ...r.review, comments: r.review.comments.map((c) => sent(c, 2)), rounds: [...r.review.rounds, round(2)] }))),
    );
    const copying = useStore.getState().copyReview();
    await vi.waitFor(() => expect(api.endRound).toHaveBeenCalled());
    useStore.setState({ comments: [...useStore.getState().comments, comment("new")] });
    answer();
    await copying;
    expect(useStore.getState().rounds.map((r) => r.number)).toEqual([1, 2]);
    expect(useStore.getState().unsend).toBeNull();
  });

  /** Regression: a comment changed while the round was recorded made the copy record no round. */
  it("records the round even when a comment changed while it was being recorded", async () => {
    let answer = () => {};
    vi.mocked(api.endRound).mockImplementationOnce(
      (r) =>
        new Promise((resolve) => {
          answer = () => resolve({ ...r.review, comments: r.review.comments.map((c) => (c.resolved === null ? sent(c, 2) : c)), rounds: [...r.review.rounds, round(2)] });
        }),
    );
    const copying = useStore.getState().copyReview();
    await vi.waitFor(() => expect(api.endRound).toHaveBeenCalled());
    useStore.setState({ comments: [{ ...comment("a"), text: "edited" }, ...useStore.getState().comments.slice(1), comment("new")] });
    answer();
    await copying;
    const s = useStore.getState();
    expect(s.rounds.map((r) => r.number)).toEqual([1, 2]);
    expect(s.comments.map((c) => [c.id, c.text, c.sent?.round ?? null])).toEqual([
      ["a", "edited", 2],
      ["r", "t", 1],
      ["new", "t", null],
    ]);
  });

  it("ends the offer to take a round back once a comment is written", async () => {
    await useStore.getState().copyReview();
    expect(useStore.getState().unsend).not.toBeNull();
    useStore.getState().composeOnFile("a.ts");
    useStore.getState().updateComposer({ text: "next" });
    useStore.getState().saveComposer();
    expect(useStore.getState().unsend).toBeNull();
    expect(useStore.getState().copied).toBeNull();
  });

  it("ends the offer to take a round back once a comment is resolved", async () => {
    await useStore.getState().copyReview();
    expect(useStore.getState().unsend).not.toBeNull();
    const id = useStore.getState().comments[0]?.id ?? "";
    useStore.getState().resolveComment(id);
    expect(useStore.getState().comments[0]?.resolved).toBe("byReviewer");
    expect(useStore.getState().unsend).toBeNull();
    expect(useStore.getState().copied).toBeNull();
  });

  it("send nothing when every comment is resolved", async () => {
    useStore.setState({ comments: [{ ...sent(comment("r")), resolved: "byReviewer" }] });
    await useStore.getState().copyReview();
    expect(api.endRound).not.toHaveBeenCalled();
  });
});

describe("resolving", () => {
  const draft = comment("d");
  const open = sent(comment("s"));

  beforeEach(() => {
    useStore.setState({ comments: [draft, open], openComment: "s", review: null, commentFilter: null });
  });

  it("resolves a sent comment and closes its card, then unresolves it and opens the card again", () => {
    useStore.getState().resolveComment("s");
    expect(useStore.getState().comments[1]?.resolved).toEqual("byReviewer");
    expect(useStore.getState().openComment).toBeNull();
    expect(useStore.getState().lastResolved).toBe("s");
    useStore.getState().resolveComment("s");
    expect(useStore.getState().comments[1]?.resolved).toBeNull();
    expect(useStore.getState().openComment).toBe("s");
    expect(useStore.getState().lastResolved).toBeNull();
  });

  it("unresolves a comment with no card without showing it", () => {
    const away: Comment = { ...sent(comment("o")), state: "outdated", resolved: "byReviewer" };
    useStore.setState({ comments: [away], openComment: null, selected: "a.ts" });
    useStore.getState().resolveComment("o");
    expect(useStore.getState().comments[0]?.resolved).toBeNull();
    expect(useStore.getState().openComment).toBeNull();
  });

  it("forgets the comment R last resolved once another is shown, by the list or a margin note", () => {
    useStore.getState().resolveComment("s");
    useStore.getState().showComment("d");
    expect(useStore.getState().lastResolved).toBeNull();
    useStore.getState().resolveComment("s");
    useStore.getState().toggleComment("d");
    expect(useStore.getState().lastResolved).toBeNull();
  });

  it("leaves a draft never sent alone", () => {
    useStore.getState().resolveComment("d");
    expect(useStore.getState().comments[0]).toBe(draft);
  });

  it("jumps past lost and resolved comments, and with a filter only through those it names", () => {
    const lost: Comment = { ...comment("l"), state: "lost" };
    const changed: Comment = { ...sent(comment("c")), sent: { ...sent(comment("c")).sent!, verdict: "changed" } };
    useStore.setState({ comments: [lost, { ...open, resolved: "byReviewer" }, draft, changed], openComment: null });
    useStore.getState().jumpComment(1);
    expect(useStore.getState().openComment).toBe("d");
    useStore.getState().jumpComment(1);
    expect(useStore.getState().openComment).toBe("c");
    useStore.getState().setCommentFilter("changed");
    expect(useStore.getState().openComment).toBe("c");
    useStore.getState().jumpComment(1);
    expect(useStore.getState().openComment).toBe("c");
    useStore.getState().setCommentFilter("untouched");
    expect(useStore.getState().openComment).toBe("c");
  });

  it("opens the list when a strip count names comments with no card", () => {
    const gone: Comment = { ...sent(comment("g")), state: "outdated", sent: { ...sent(comment("g")).sent!, verdict: "removed" } };
    useStore.setState({ comments: [gone], openComment: null, commentList: false });
    useStore.getState().setCommentFilter("changed");
    expect(useStore.getState().commentList).toBe(true);
    expect(useStore.getState().openComment).toBeNull();
  });

  it("deletes only drafts, with Undo", () => {
    useStore.getState().deleteDrafts();
    expect(useStore.getState().comments).toEqual([open]);
    expect(useStore.getState().undo?.label).toBe("1 draft deleted");
    useStore.getState().undoLast();
    expect(useStore.getState().comments).toEqual([draft, open]);
  });
});

describe("placing a lost draft again", () => {
  beforeEach(async () => {
    await openFiles([added("a.ts", 3), added("b.ts", 3)]);
    const lost: Comment = { ...comment("l"), path: "b.ts", target: { kind: "lines", side: "new", start: 9, code: ["gone"] }, state: "lost" };
    useStore.setState({ comments: [lost] });
  });

  it("goes to its file, takes the chosen line as its code, and can be undone", () => {
    useStore.getState().startReplace("l");
    expect(useStore.getState().replacing).toBe("l");
    expect(useStore.getState().selected).toBe("b.ts");
    useStore.getState().placeComment("new", 2);
    const placed = useStore.getState().comments[0]!;
    expect(placed.target).toEqual({ kind: "lines", side: "new", start: 2, code: ["    line 2"] });
    expect(placed.state).toBe("current");
    expect(placed.place).toEqual({ base: { kind: "uncommitted" }, head: { kind: "branch", name: "agent/x" } });
    expect(useStore.getState().replacing).toBeNull();
    expect(useStore.getState().openComment).toBe("l");
    expect(useStore.getState().undo?.label).toBe("Placed on line 2. It is a draft again.");
    useStore.getState().undoLast();
    expect(useStore.getState().comments[0]?.state).toBe("lost");
  });

  it("is left where it was by Esc", () => {
    useStore.getState().startReplace("l");
    useStore.getState().cancelReplace();
    expect(useStore.getState().replacing).toBeNull();
    expect(useStore.getState().comments[0]?.state).toBe("lost");
  });

  it("starts only for a lost comment", () => {
    useStore.setState({ comments: [comment("c")] });
    useStore.getState().startReplace("c");
    expect(useStore.getState().replacing).toBeNull();
  });
});

describe("a comment written now", () => {
  it("records where it was written", async () => {
    await openFiles([added("a.ts", 3)]);
    useStore.getState().composeOnLines("a.ts", "new", 1, 1);
    useStore.getState().updateComposer({ text: "hi" });
    useStore.getState().saveComposer();
    expect(useStore.getState().comments[0]).toMatchObject({
      text: "hi",
      place: { base: { kind: "uncommitted" }, head: { kind: "branch", name: "agent/x" } },
      sent: null,
      resolved: null,
    });
  });

  it("keeps a sent comment's round when edited, which reopens it", async () => {
    await openFiles([added("a.ts", 3)]);
    const was = sent({ ...comment("s"), target: { kind: "lines", side: "new", start: 1, code: ["    line 1"] } });
    useStore.setState({ comments: [was] });
    useStore.getState().editComment("s");
    useStore.getState().updateComposer({ text: "more" });
    useStore.getState().saveComposer();
    expect(useStore.getState().comments[0]).toMatchObject({ text: "more", sent: { round: 1, text: "t" } });
  });
});

describe("the sidebar's folders", () => {
  it("open for a file selected inside one", async () => {
    await openFiles([added("src/a.ts", 1), added("z.ts", 1)]);
    useStore.getState().toggleFolder("d:src/");
    expect(useStore.getState().closed.has("d:src/")).toBe(true);
    useStore.getState().select("z.ts");
    expect(useStore.getState().closed.has("d:src/")).toBe(true);
    useStore.getState().select("src/a.ts");
    expect(useStore.getState().closed.has("d:src/")).toBe(false);
  });

  it("open for the file a load selects when the selected one left the diff", async () => {
    await openFiles([added("a.ts", 1), added("src/b.ts", 1)]);
    useStore.getState().select("a.ts");
    useStore.getState().toggleFolder("d:src/");
    answerWithFiles("/a", [added("src/b.ts", 1)]);
    await useStore.getState().reload();
    expect(useStore.getState().selected).toBe("src/b.ts");
    expect(useStore.getState().closed.has("d:src/")).toBe(false);
  });

  it("keep the width inside its bounds", () => {
    useStore.getState().setSidebarWidth(9000);
    expect(useStore.getState().sidebarWidth).toBe(560);
    useStore.getState().setSidebarWidth(10);
    expect(useStore.getState().sidebarWidth).toBe(200);
  });
});

describe("the review switcher", () => {
  const kept = (project: string, branch: string): KeptReview => ({
    key: { project, branch },
    name: "r",
    summary: { comments: 1, open: 1, round: null, seen: null },
    elsewhere: false,
  });

  beforeEach(async () => {
    vi.mocked(api.saveReview).mockReset().mockResolvedValue(null);
    await openWith("/a", keptReview([comment("c")], []));
  });

  it("checks the project shown first, and drops a review whose branch was deleted, saying so", async () => {
    vi.mocked(api.keptReviews).mockResolvedValueOnce([kept("/a/.git", "agent/x"), kept("/b/.git", "gone")]);
    const gone = { key: { project: "/b/.git", branch: "gone" }, comments: 1 };
    vi.mocked(api.checkProject).mockReset().mockImplementation((project) =>
      Promise.resolve({ branches: [], reviews: [], gone: project === "/b/.git" ? [gone] : [] }),
    );
    useStore.getState().setSwitcher(true);
    await vi.waitFor(() => expect(useStore.getState().reviews.checks.size).toBe(2));
    expect(vi.mocked(api.checkProject).mock.calls.map(([p]) => p)).toEqual(["/a/.git", "/b/.git"]);
    expect(useStore.getState().reviews.kept?.map((r) => r.key.branch)).toEqual(["agent/x"]);
    expect(useStore.getState().gone).toEqual([gone]);
    // Said once: closing the switcher lets it go.
    useStore.getState().setSwitcher(false);
    expect(useStore.getState().gone).toEqual([]);
  });

  /** Regression: a second refresh while one ran dropped the first's answers, and with them its deletions' notice. */
  it("joins a refresh already running, so a deletion it finds is said", async () => {
    vi.mocked(api.keptReviews).mockClear().mockResolvedValueOnce([kept("/b/.git", "gone")]);
    const gone = { key: { project: "/b/.git", branch: "gone" }, comments: 1 };
    vi.mocked(api.checkProject).mockReset().mockImplementation((project) =>
      Promise.resolve({ branches: [], reviews: [], gone: project === "/b/.git" ? [gone] : [] }),
    );
    await Promise.all([useStore.getState().refreshReviews(), useStore.getState().refreshReviews()]);
    expect(api.keptReviews).toHaveBeenCalledTimes(1);
    expect(useStore.getState().gone).toEqual([gone]);
    useStore.getState().dismissGone();
  });

  it("saves the review on screen no more once its branch is found deleted", async () => {
    vi.mocked(api.keptReviews).mockResolvedValueOnce([kept("/a/.git", "agent/x")]);
    const gone = { key: { project: "/a/.git", branch: "agent/x" }, comments: 1 };
    vi.mocked(api.checkProject).mockReset().mockResolvedValue({ branches: [], reviews: [], gone: [gone] });
    await useStore.getState().refreshReviews();
    vi.mocked(api.saveReview).mockClear();
    useStore.setState({ comments: [comment("late")] });
    await Promise.resolve();
    expect(api.saveReview).not.toHaveBeenCalled();
    useStore.getState().dismissGone();
  });

  it("marks a project that cannot be checked, and deletes nothing of it", async () => {
    vi.mocked(api.keptReviews).mockResolvedValueOnce([kept("/a/.git", "agent/x")]);
    vi.mocked(api.checkProject).mockReset().mockRejectedValue(new Error("gone away"));
    await useStore.getState().refreshReviews();
    expect(useStore.getState().reviews.checks.get("/a/.git")).toBe("failed");
    expect(useStore.getState().reviews.kept).toHaveLength(1);
  });

  it("stays open, saying where it is, when the review picked is open in another window", async () => {
    useStore.getState().setSwitcher(true);
    vi.mocked(api.openReview).mockRejectedValueOnce("elsewhere");
    await useStore.getState().pickReview({ project: "/a/.git", branch: "agent/y" });
    expect(useStore.getState().switcher).toBe(true);
    expect(useStore.getState().elsewhere).not.toBeNull();
    expect(useStore.getState().key).toEqual(key("/a"));
    // Picked again and shown, it closes.
    vi.mocked(api.openReview).mockResolvedValueOnce(openingWith({ ...opening("/a").checkout, head: { kind: "branch", name: "agent/y" } }));
    answerLoads("/a", { ...opening("/a").checkout, head: { kind: "branch", name: "agent/y" } });
    await useStore.getState().pickReview({ project: "/a/.git", branch: "agent/y" });
    expect(useStore.getState().switcher).toBe(false);
    expect(useStore.getState().elsewhere).toBeNull();
  });

  it("is closed once a folder is opened, whatever opened it", async () => {
    useStore.getState().setSwitcher(true);
    await openWith("/a", keptReview([], []));
    expect(useStore.getState().switcher).toBe(false);
  });

  it("names the review in the window's title", () => {
    expect(windowTitle(useStore.getState())).toBe("r · agent/x");
    expect(windowTitle({ opening: null })).toBe("Diff Loop");
  });

  it("notes the review saved once, as its first comment starts it", async () => {
    answerWithFiles("/b", [added("a.ts", 2)]);
    await openWith("/b", keptReview([], []));
    answerWithFiles("/b", [added("a.ts", 2)]);
    await useStore.getState().reload(true);
    const s = useStore.getState();
    s.composeOnLines("a.ts", "new", 1, 1);
    s.updateComposer({ text: "why" });
    useStore.getState().saveComposer();
    expect(useStore.getState().reviewSaved).toBe(true);
    useStore.getState().dismissReviewSaved();
    useStore.getState().composeOnLines("a.ts", "new", 2, 2);
    useStore.getState().updateComposer({ text: "and this" });
    useStore.getState().saveComposer();
    expect(useStore.getState().reviewSaved).toBe(false);
  });
});

describe("showing a review", () => {
  it("watches the checkout before its first load", async () => {
    const order: string[] = [];
    vi.mocked(api.watchRepository).mockImplementationOnce(() => {
      order.push("watch");
      return Promise.resolve(true);
    });
    vi.mocked(api.openRepository).mockResolvedValue(opening("/w"));
    vi.mocked(api.savedReview).mockResolvedValue(keptReview([], []));
    answerLoads("/w");
    const load = vi.mocked(api.loadReview).getMockImplementation()!;
    vi.mocked(api.loadReview).mockImplementation((...args) => {
      order.push("load");
      return load(...args);
    });
    await useStore.getState().open("/w");
    expect(order.slice(0, 2)).toEqual(["watch", "load"]);
    expect(useStore.getState().watching).toBe(true);
  });

  it("checks again once a first load that a watch event came during ends", async () => {
    vi.mocked(api.openRepository).mockResolvedValue(opening("/e"));
    vi.mocked(api.savedReview).mockResolvedValue(keptReview([], []));
    answerLoads("/e");
    const load = vi.mocked(api.loadReview).getMockImplementation()!;
    let finish = () => {};
    vi.mocked(api.loadReview).mockImplementationOnce((...args) => new Promise((resolve) => (finish = () => resolve(load(...args)))));
    vi.mocked(api.loadReview).mockClear();
    const opened = useStore.getState().open("/e");
    await vi.waitFor(() => expect(api.loadReview).toHaveBeenCalledTimes(1));
    await useStore.getState().poll();
    expect(useStore.getState().recheck).toBe("changes");
    finish();
    await opened;
    await vi.waitFor(() => expect(api.loadReview).toHaveBeenCalledTimes(2));
  });

  it("names the files a review shown before holds, so a return is not sent them again", async () => {
    await openWith("/s", keptReview([], []));
    answerWithFiles("/s", [added("a.ts", 2)]);
    await useStore.getState().reload(true);
    await openWith("/t", keptReview([], []));
    await openWith("/s", keptReview([], []));
    expect(vi.mocked(api.loadReview).mock.lastCall?.[2]).toEqual([{ path: "a.ts", signature: "a.ts" }]);
  });
});
