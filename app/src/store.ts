// The window's state and everything that changes it.
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { create } from "zustand";
import { api, describe } from "./api";
import type { Base } from "./bindings/Base";
import type { BaseRef } from "./bindings/BaseRef";
import type { Comment } from "./bindings/Comment";
import type { FileDiff } from "./bindings/FileDiff";
import type { InstructionsRequest } from "./bindings/InstructionsRequest";
import type { Opening } from "./bindings/Opening";
import type { Review } from "./bindings/Review";
import type { SavedReview } from "./bindings/SavedReview";
import type { Snapshot } from "./bindings/Snapshot";
import type { Side } from "./bindings/Side";
import type { Target } from "./bindings/Target";
import { rememberRecent } from "./recent";
import { dedent } from "./indent";
import { changedLines, type Expanded, type Gap, gapsOf, lastLine, linesOn, withinHunk } from "./rows";
import { type TreeRow, treeRows } from "./tree";

export type Problem = { title: string; detail: string };

/** A loaded review with every file in full: files load_review only named are carried over from the last load. */
export type LoadedReview = Omit<Review, "files" | "snapshot"> & {
  changes: { snapshot: Snapshot; files: FileDiff[] };
  /** Path → the signature load_review returned for that file. */
  signatures: Record<string, string>;
  /** Built once per load, so a key press never scans the file list. */
  byPath: Map<string, FileDiff>;
  /** The sidebar's rows, built once per load. */
  tree: TreeRow[];
  /** Files in sidebar order: as `tree` nests them. */
  order: FileDiff[];
  /** Path → index in `order`. */
  position: Map<string, number>;
};

export type Composer = {
  path: string;
  target: Target;
  text: string;
  /** Replacement code while "Suggest code" is on. */
  suggestion: string | null;
  /** The comment being edited, if any. */
  editing: string | null;
};

/**
 * Whether the composer holds something to save: a comment, or suggested code
 * that changes the lines, whose reason is optional.
 */
export function canSave(composer: Composer): boolean {
  if (composer.text.trim() !== "") return true;
  const { suggestion, target } = composer;
  return suggestion !== null && target.kind === "lines" && suggestion !== suggestable(target.code);
}

/** Lines as "Suggest code" starts from them: without their shared indent (diff-loop-app.md Decision 26). */
export function suggestable(code: string[]): string {
  return dedent(code).join("\n");
}

/** A comment's text, or what it is when it is only suggested code. */
export function commentText(c: Comment): string {
  return c.text === "" && c.suggestion !== null ? "Suggested change" : c.text;
}

export type Selection = { path: string; side: Side; anchor: number; head: number; dragging: boolean };

/**
 * What the last loads changed under the review. `removed` are the comments
 * they removed, which Undo removal brings back; the rest are described as they are
 * now (`bannerDetail`). `previous` is the commit before `HEAD` moved, if it did.
 */
export type Banner = { title: string; removed: Comment[]; previous: string | null };

/** The banner's title when the code changed and `HEAD` did not move. */
export const CODE_UPDATED = "The agent updated the code";

type Undo = { label: string; comments: Comment[] };

type State = {
  opening: Opening | null;
  openProblem: (Problem & { path: string }) | null;
  busy: boolean;
  /** Whether the checkout is watched; when not, App polls instead. */
  watching: boolean;
  refs: BaseRef[];
  base: Base;
  review: LoadedReview | null;
  loading: boolean;
  /** A check asked for while loading, run when the load ends: a full read once ⌘/Ctrl-R asked for one. */
  recheck: "changes" | "everything" | null;
  loadProblem: Problem | null;
  comments: Comment[];
  selected: string | null;
  /**
   * Path → signature of the file's diff when marked viewed. V changes it in
   * place, so it costs O(1), then `set`s it again so selectors re-run;
   * opening and reloading replace it whole.
   */
  viewed: Map<string, string>;
  /** Changed lines in the files `viewed` holds, kept with it so the sidebar never sums them. */
  viewedLines: number;
  /**
   * Path → the gaps expanded in that file, kept while its signature holds.
   * Replaced, never mutated: DiffView selects one file's entry.
   */
  expanded: Map<string, { signature: string; gaps: Expanded }>;
  mode: "unified" | "split";
  composer: Composer | null;
  selection: Selection | null;
  openComment: string | null;
  /** Whether the comments list is open. */
  commentList: boolean;
  /** Whether the base picker is open. */
  basePicker: boolean;
  /** Whether the preview of the instructions is open. */
  preview: boolean;
  banner: Banner | null;
  copied: boolean;
  /** Why the last Copy review failed, if it did. */
  copyProblem: Problem | null;
  undo: Undo | null;
  /**
   * Find in file: what is searched for, whether ⌘/Ctrl-F asked for the field
   * and it has not taken focus yet, and steps taken from the open file's first
   * match, which DiffView wraps to the matches it has.
   */
  find: { query: string; focusPending: boolean; step: number } | null;
  /**
   * Text typed over the preview's generated instructions, kept while the dialog
   * is closed, for the review it was written over (`reviewKey`).
   */
  previewEdit: { key: string; text: string } | null;
  /** Why the open checkout's comments are not being kept, if they are not. */
  saveProblem: Problem | null;
};

type Actions = {
  open: (path: string) => Promise<void>;
  closeRepository: () => void;
  setBase: (base: Base) => Promise<void>;
  /** Reads the branches and tags again, with their behind counts. */
  refreshRefs: () => void;
  /** Loads the review again; `full` reads everything, even what a running watch saw untouched (ADR 0014 §1). */
  reload: (full?: boolean) => Promise<void>;
  poll: () => Promise<void>;
  /** Checks for changes now, reading the whole checkout again (⌘/Ctrl-R). */
  refresh: () => Promise<void>;
  select: (path: string) => void;
  /** Selects the file `step` away in sidebar order, stopping at either end. */
  stepFile: (step: 1 | -1) => void;
  /** Selects the next file not viewed in sidebar order, or with -1 the previous, wrapping; with none, nothing changes. */
  stepUnviewed: (step: 1 | -1) => void;
  toggleViewed: (path?: string) => void;
  /** Marks the selected file viewed, then selects the next one not viewed. */
  viewedAndNext: () => void;
  /** Reads and shows the unchanged lines of each gap, expanded under its key (`gapKey`, or `REST`), in one read. */
  expandGaps: (path: string, gaps: { key: string; gap: Gap }[]) => Promise<void>;
  /** Shows every unchanged line `path`'s diff leaves out that is not shown yet. */
  showAllLines: (path: string) => Promise<void>;
  setMode: (mode: State["mode"]) => void;
  setSelection: (selection: Selection | null) => void;
  composeOnSelection: () => void;
  /** Moves the composer's range so `head` is the line dragged to and `anchor` the other end. */
  resizeComposer: (anchor: number, head: number) => void;
  composeOnLines: (path: string, side: Side, start: number, end: number) => void;
  composeOnFile: (path: string) => void;
  editComment: (id: string) => void;
  updateComposer: (patch: Partial<Composer>) => void;
  cancelComposer: () => void;
  saveComposer: () => void;
  deleteComment: (id: string) => void;
  toggleComment: (id: string | null) => void;
  setCommentList: (open: boolean) => void;
  setBasePicker: (open: boolean) => void;
  setPreview: (open: boolean) => void;
  jumpComment: (step: 1 | -1) => void;
  /** Selects the comment's file and opens its card. */
  showComment: (id: string) => void;
  clearUndo: () => void;
  clearComments: () => void;
  undoLast: () => void;
  dismissBanner: () => void;
  /** Brings back the comments the banner says were removed, as not in this diff. */
  undoRemoved: () => void;
  showWhatChanged: () => Promise<void>;
  openFind: () => void;
  /** The find field took the focus ⌘/Ctrl-F asked for. */
  findFocused: () => void;
  setFindQuery: (query: string) => void;
  /** To the next match, or with -1 the previous: Return, ⌘/Ctrl-G and the bar's arrows. */
  stepFind: (by: 1 | -1) => void;
  closeFind: () => void;
  instructionsRequest: () => InstructionsRequest | null;
  /** Keeps an edit of the preview, for the review `key` names (`reviewKey`), or drops it with null. */
  setPreviewEdit: (edit: { key: string; text: string } | null) => void;
  copyReview: () => Promise<void>;
  copyText: (text: string) => Promise<void>;
  setCopied: (copied: boolean) => void;
  /**
   * Saves the open checkout's comments now. When its saved review
   * could not be read, reads it again first and merges it into the window.
   */
  retrySave: () => Promise<void>;
};

/** Comments in sidebar file order, then by line. */
export function orderedComments(review: LoadedReview | null, comments: Comment[]): Comment[] {
  const at = (c: Comment) => review?.position.get(c.path) ?? Number.MAX_SAFE_INTEGER;
  const line = (c: Comment) => (c.target.kind === "lines" ? c.target.start : 0);
  return [...comments].sort((a, b) => at(a) - at(b) || line(a) - line(b));
}

/** Find opened afresh on another file: its count of steps starts again at the first match. */
function firstMatch(find: State["find"]): State["find"] {
  return find && find.step !== 0 ? { ...find, step: 0 } : find;
}

/**
 * The key of a request the instructions are written from (`requestOf`): the
 * comments in their order, the base and what is checked out. O(the comments'
 * text and code) per call.
 */
export function reviewKey(request: InstructionsRequest | null): string {
  return JSON.stringify(request);
}

/** What the instructions are written from; the one place it is put together. */
export function requestOf(s: Pick<State, "review" | "comments" | "base">): InstructionsRequest | null {
  if (!s.review) return null;
  return { head: s.review.checkout.head, base: s.base, comments: orderedComments(s.review, s.comments) };
}

/** The preview's edit, if one is kept for the review `key` names; the one rule the preview and Copy review share. */
export function keptEdit(edit: State["previewEdit"], key: string): string | null {
  return edit?.key === key ? edit.text : null;
}

/**
 * load_review for `base`, sending only the versions `held` already has, and
 * filling the files it names back in from `held`; `full` reads everything again.
 */
async function fetchReview(base: Base, comments: Comment[], held: LoadedReview | null, full: boolean): Promise<LoadedReview> {
  const known = held ? Object.entries(held.signatures).map(([path, signature]) => ({ path, signature })) : [];
  const { files: entries, snapshot, ...rest } = await api.loadReview(base, comments, known, full);
  const previous = new Map(held?.changes.files.map((f) => [f.path, f]));
  const files: FileDiff[] = [];
  const signatures: Record<string, string> = {};
  for (const entry of entries) {
    const file = entry.kind === "changed" ? entry.diff : previous.get(entry.path);
    // Unreachable while `known` comes from `held`; a load that names nothing known repairs it if not.
    if (!file) return fetchReview(base, comments, null, full);
    files.push(file);
    signatures[file.path] = entry.signature;
  }
  const tree = treeRows(files);
  const order = tree.flatMap((row) => (row.kind === "file" ? [row.file] : []));
  return {
    ...rest,
    changes: { snapshot, files },
    signatures,
    byPath: new Map(files.map((f) => [f.path, f])),
    tree,
    order,
    position: new Map(order.map((f, i) => [f.path, i])),
  };
}

export const sameBase = (a: Base, b: Base) => JSON.stringify(a) === JSON.stringify(b);

/** Whether `after` has the branch `before` had checked out; a detached `HEAD` counts as one branch. */
function sameBranch(before: LoadedReview, after: LoadedReview): boolean {
  const [was, now] = [before.checkout.head, after.checkout.head];
  return was.kind === "detached" ? now.kind === "detached" : now.kind === "branch" && now.name === was.name;
}

/**
 * The banner's detail: how many comments loads removed, and how many of the `total` left are not
 * in this diff or still open. Its wording is settled (`ux` skill, "Settled wording"): only the
 * first sentence names comments.
 */
export function bannerDetail(removed: number, notInDiff: number, total: number): string {
  const open = total - notInDiff;
  const parts: [number, string, string][] = [
    [removed, "was addressed and removed", "were addressed and removed"],
    [notInDiff, "is not in this diff", "are not in this diff"],
    [open, "is still open", "are still open"],
  ];
  return parts
    .filter(([n]) => n > 0)
    .map(([n, one, many], i) => `${n}${i === 0 ? (n === 1 ? " comment" : " comments") : ""} ${n === 1 ? one : many}.`)
    .join(" ");
}

/**
 * Whether `after` shows what `before` did: the same checkout, snapshot,
 * files and fingerprint, which a poll compares against. O(files): a file
 * `fetchReview` carried over is the same object.
 */
function showsTheSame(before: LoadedReview, after: LoadedReview): boolean {
  const [was, now] = [before.changes, after.changes];
  return (
    before.fingerprint === after.fingerprint &&
    JSON.stringify(before.checkout) === JSON.stringify(after.checkout) &&
    JSON.stringify(was.snapshot) === JSON.stringify(now.snapshot) &&
    was.files.length === now.files.length &&
    now.files.every((file, i) => file === was.files[i])
  );
}

export const useStore = create<State & Actions>()((set, get) => ({
  opening: null,
  openProblem: null,
  busy: false,
  watching: false,
  refs: [],
  base: { kind: "uncommitted" },
  review: null,
  loading: false,
  recheck: null,
  loadProblem: null,
  comments: [],
  selected: null,
  viewed: new Map(),
  viewedLines: 0,
  expanded: new Map(),
  mode: "unified",
  composer: null,
  selection: null,
  openComment: null,
  commentList: false,
  basePicker: false,
  preview: false,
  banner: null,
  copied: false,
  copyProblem: null,
  undo: null,
  find: null,
  previewEdit: null,
  saveProblem: null,

  async open(path) {
    set({ busy: true, openProblem: null });
    try {
      const opening = await api.openRepository(path);
      const head = opening.checkout.head;
      rememberRecent({
        path: opening.checkout.root,
        name: opening.checkout.name,
        branch: head.kind === "branch" ? head.name : `HEAD detached at ${head.commit}`,
        openedAt: Date.now(),
      });
      // Read before the checkout shows, and set with it: loading is not a change
      // to save. Before the first load, so it moves the comments onto their code.
      const root = opening.checkout.root;
      const saved = await readSaved(root);
      set({
        opening,
        refs: opening.refs,
        base: opening.base,
        review: null,
        comments: saved.review.comments,
        viewed: new Map(),
        viewedLines: 0,
        expanded: new Map(),
        watching: false,
        selected: null,
        composer: null,
        selection: null,
        openComment: null,
        commentList: false,
        basePicker: false,
        preview: false,
        copyProblem: null,
        banner: null,
        undo: null,
        find: null,
        previewEdit: null,
        saveProblem: saved.problem,
      });
      await get().reload();
      // Only the answer for the repository still open counts: a slow answer
      // for one opened before must not stop the fallback polling.
      const stillOpen = () => get().opening?.checkout.root === root;
      api.watchRepository().then(
        (kept) => kept && stillOpen() && set({ watching: true }),
        () => stillOpen() && set({ watching: false }),
      );
    } catch (error) {
      set({ openProblem: { ...describe(error), path } });
    } finally {
      set({ busy: false });
    }
  },

  closeRepository() {
    // The lists, dialogs and copy failure are the review screen's, which goes with the checkout.
    set({
      opening: null,
      review: null,
      comments: [],
      composer: null,
      selection: null,
      commentList: false,
      basePicker: false,
      preview: false,
      copyProblem: null,
    });
  },

  async setBase(base) {
    // Expanded lines were read from the old base's snapshot.
    set({ base, banner: null, expanded: new Map() });
    get().refreshRefs();
    await get().reload();
  },

  refreshRefs() {
    api.refs().then((refs) => set({ refs }), () => {});
  },

  async reload(full = false) {
    const { base, review: before } = get();
    set({ loading: true });
    try {
      const held = before && sameBase(before.base, base) ? before : null;
      const sent = get().comments;
      const review = await fetchReview(base, sent, held, full);
      if (!sameBase(get().base, base)) return;
      const moved = new Map(review.comments.map((c) => [c.id, c]));
      const deletes = held !== null && sameBranch(held, review);
      const editing = get().composer?.editing;
      const deleted: Comment[] = [];
      // Comments written or changed while loading are kept as they are: a comment is
      // replaced, never mutated, so one not among those sent changed since.
      const unchanged = new Set(sent);
      const comments = get().comments.flatMap((c) => {
        const m = moved.get(c.id);
        if (!m || !unchanged.has(c)) return [c];
        // Its code is gone under the same base and branch (diff-loop-app.md Decision 16).
        if (deletes && c.state === "current" && m.state === "outdated" && c.id !== editing) {
          deleted.push(c);
          return [];
        }
        return [{ ...m, text: c.text, suggestion: c.suggestion }];
      });
      // A watch event often changes nothing reviewed (a build writing ignored
      // files): then the window keeps its state, and nothing re-renders.
      if (held && showsTheSame(held, review) && JSON.stringify(comments) === JSON.stringify(get().comments)) {
        if (get().loadProblem) set({ loadProblem: null });
        return;
      }
      const viewed = new Map([...get().viewed].filter(([path, was]) => review.signatures[path] === was));
      const expanded = new Map([...get().expanded].filter(([path, e]) => review.signatures[path] === e.signature));
      const current = get().selected;
      const selected = current !== null && review.byPath.has(current) ? current : (review.order[0]?.path ?? null);
      const open = get().openComment;
      // A comment not in this diff has no card to stay open.
      const openComment = comments.some((c) => c.id === open && c.state === "current") ? open : null;
      let viewedLines = 0;
      // Kept marks are for files in this load: their signatures matched.
      for (const path of viewed.keys()) viewedLines += changedLines(review.byPath.get(path)!);
      set({ review, comments, viewed, viewedLines, expanded, selected, openComment, loadProblem: null });
      await announceMove(before, review, deleted);
    } catch (error) {
      set({ loadProblem: describe(error) });
    } finally {
      set({ loading: false });
      // A watch event during the load: its touched paths wait in Rust.
      const again = get().recheck;
      if (again) {
        set({ recheck: null });
        void (again === "everything" ? get().reload(true) : get().poll());
      }
    }

    async function announceMove(before: LoadedReview | null, after: LoadedReview, deleted: Comment[]) {
      const previous = before?.checkout.commit;
      const now = after.checkout.commit;
      if (!previous || !now || previous === now) {
        // The code changed under the same commit; a banner already up keeps its title and adds these.
        if (deleted.length === 0) return;
        const shown = get().banner;
        set({
          banner: {
            title: shown?.title ?? CODE_UPDATED,
            removed: [...(shown?.removed ?? []), ...deleted],
            previous: shown?.previous ?? null,
          },
        });
        return;
      }
      const headBefore = before.checkout.head;
      const headNow = after.checkout.head;
      // A new title, but Undo still brings back what a banner already up had removed.
      const removed = [...(get().banner?.removed ?? []), ...deleted];
      if (headBefore.kind === "branch" && headNow.kind === "branch" && headBefore.name !== headNow.name) {
        set({ banner: { title: `Switched to ${headNow.name}`, removed, previous } });
        return;
      }
      const count = await api.commitsBetween(previous, now).catch(() => null);
      const title =
        count === null
          ? "The branch was rewritten"
          : `The branch moved: ${count} new ${count === 1 ? "commit" : "commits"}`;
      set({ banner: { title, removed, previous } });
    }
  },

  async poll() {
    const { review, loading, base, opening, watching } = get();
    if (!opening || !review) return;
    if (loading) {
      if (get().recheck === null) set({ recheck: "changes" });
      return;
    }
    // While watching, a load reads only what the watch saw touched, so it is
    // the check; a fingerprint would be a full diff.
    if (watching) {
      await get().reload();
      return;
    }
    try {
      const fingerprint = await api.fingerprint(base);
      if (fingerprint !== get().review?.fingerprint && !get().loading) await get().reload();
    } catch {
      // The next reload reports it; polling stays quiet.
    }
  },

  async refresh() {
    const { review, loading, opening } = get();
    if (!opening || !review) return;
    if (loading) set({ recheck: "everything" });
    else await get().reload(true);
  },

  select(path) {
    const find = path === get().selected ? get().find : firstMatch(get().find);
    set({ selected: path, selection: null, openComment: null, find });
  },

  openFind() {
    const find = get().find;
    set({ find: { query: find?.query ?? "", focusPending: true, step: find?.step ?? 0 } });
  },

  findFocused() {
    const find = get().find;
    if (find?.focusPending) set({ find: { ...find, focusPending: false } });
  },

  setFindQuery(query) {
    const find = get().find;
    if (find) set({ find: { ...find, query, step: 0 } });
  },

  stepFind(by) {
    const find = get().find;
    if (find) set({ find: { ...find, step: find.step + by } });
  },

  closeFind() {
    set({ find: null });
  },

  stepFile(step) {
    const { review, selected } = get();
    if (!review) return;
    const at = selected === null ? -1 : (review.position.get(selected) ?? -1);
    const next = review.order[Math.min(review.order.length - 1, Math.max(0, at + step))];
    if (next && next.path !== selected) get().select(next.path);
  },

  stepUnviewed(step) {
    const { review, selected, viewed } = get();
    if (!review) return;
    const { order } = review;
    const at = selected === null ? -1 : (review.position.get(selected) ?? -1);
    // O(files viewed in a row from `at`): it stops at the first not viewed, and at `at` itself.
    for (let i = 1; i <= order.length; i++) {
      const file = order[(((at + step * i) % order.length) + order.length) % order.length]!;
      if (file.path === selected) return;
      if (!viewed.has(file.path)) {
        get().select(file.path);
        return;
      }
    }
  },

  viewedAndNext() {
    const { selected, viewed } = get();
    if (selected !== null && !viewed.has(selected)) get().toggleViewed(selected);
    get().stepUnviewed(1);
  },

  toggleViewed(path) {
    const { review, viewed, selected } = get();
    const target = path ?? selected;
    const signature = target === null ? undefined : review?.signatures[target];
    const file = target === null ? undefined : review?.byPath.get(target);
    if (target === null || signature === undefined || !file) return;
    const lines = changedLines(file);
    const was = viewed.delete(target);
    if (!was) viewed.set(target, signature);
    // Same Map: `set` still notifies, and selectors read it afresh.
    set({ viewed, viewedLines: get().viewedLines + (was ? -lines : lines) });
  },

  async expandGaps(path, gaps) {
    const review = get().review;
    const signature = review?.signatures[path];
    const wanted = gaps.filter(({ gap }) => gap.count !== 0);
    if (!review || signature === undefined || wanted.length === 0) return;
    // After the last hunk the file's length is unknown: `lines` stops at its end.
    const end = (gap: Gap) => (gap.count === null ? 0xffffffff : gap.newFirst + gap.count - 1);
    // One read spanning every gap: each read reads the file again, so one per gap would cost gaps × file.
    const first = wanted.reduce((lo, { gap }) => Math.min(lo, gap.newFirst), Infinity);
    const last = wanted.reduce((hi, { gap }) => Math.max(hi, end(gap)), 0);
    const mark = (state: (gap: Gap) => Expanded[string]) => {
      const now = get().review;
      // A reload since asking may have changed the file: its lines no longer fit.
      if (now?.signatures[path] !== signature) return;
      const before = get().expanded.get(path);
      const shown = { ...(before?.signature === signature ? before.gaps : {}) };
      for (const { key, gap } of wanted) shown[key] = state(gap);
      set({ expanded: new Map(get().expanded).set(path, { signature, gaps: shown }) });
    };
    mark(() => "loading");
    try {
      const lines = await api.fileLines(review.changes.snapshot, "new", path, first, last);
      mark((gap) => lines.slice(gap.newFirst - first, end(gap) - first + 1));
    } catch {
      mark(() => "failed");
    }
  },

  async showAllLines(path) {
    const file = get().review?.byPath.get(path);
    if (!file) return;
    const gaps = get().expanded.get(path)?.gaps;
    // Shown or being read already: only the rest are asked for.
    await get().expandGaps(path, gapsOf(file).filter(({ key }) => gaps?.[key] === undefined || gaps[key] === "failed"));
  },

  setMode(mode) {
    set({ mode });
  },

  setSelection(selection) {
    set({ selection });
  },

  composeOnSelection() {
    const s = get().selection;
    // A comment being written keeps its draft: its lines move only by its handles.
    if (!s || get().composer) return;
    const [start, end] = s.anchor <= s.head ? [s.anchor, s.head] : [s.head, s.anchor];
    get().composeOnLines(s.path, s.side, start, end);
  },

  resizeComposer(anchor, head) {
    const { composer, review } = get();
    const file = composer && review?.byPath.get(composer.path);
    if (!composer || !file || composer.target.kind !== "lines") return;
    const { side } = composer.target;
    head = withinHunk(file, side, anchor, head);
    const [start, end] = anchor <= head ? [anchor, head] : [head, anchor];
    const code = linesOn(file, side, start, end);
    const was = composer.target.code;
    // Untouched suggested code follows the lines; code the user changed stays theirs.
    const suggestion = composer.suggestion === suggestable(was) ? suggestable(code) : composer.suggestion;
    set({
      composer: { ...composer, target: { kind: "lines", side, start, code }, suggestion },
      selection: { path: composer.path, side, anchor, head, dragging: false },
    });
  },

  composeOnLines(path, side, start, end) {
    const file = get().review?.byPath.get(path);
    if (!file) return;
    end = withinHunk(file, side, start, end);
    const code = linesOn(file, side, start, end);
    set({
      composer: { path, target: { kind: "lines", side, start, code }, text: "", suggestion: null, editing: null },
      selection: { path, side, anchor: start, head: end, dragging: false },
      openComment: null,
    });
  },

  composeOnFile(path) {
    set({ composer: { path, target: { kind: "file" }, text: "", suggestion: null, editing: null }, openComment: null });
  },

  editComment(id) {
    const c = get().comments.find((x) => x.id === id);
    if (!c) return;
    const selection =
      c.target.kind === "lines"
        ? { path: c.path, side: c.target.side, anchor: c.target.start, head: lastLine(c.target), dragging: false }
        : null;
    set({
      // A suggestion saved before diff-loop-app.md Decision 26 still has its indent: shown and compared without it.
      composer: {
        path: c.path,
        target: c.target,
        text: c.text,
        suggestion: c.suggestion === null ? null : dedent(c.suggestion.split("\n")).join("\n"),
        editing: id,
      },
      selection,
      openComment: null,
    });
  },

  updateComposer(patch) {
    const composer = get().composer;
    if (composer) set({ composer: { ...composer, ...patch } });
  },

  cancelComposer() {
    set({ composer: null, selection: null });
  },

  saveComposer() {
    const composer = get().composer;
    if (!composer || !canSave(composer)) return;
    const comment: Comment = {
      id: composer.editing ?? crypto.randomUUID(),
      path: composer.path,
      target: composer.target,
      text: composer.text.trim(),
      suggestion: composer.suggestion,
      state: "current",
    };
    const comments = composer.editing
      ? get().comments.map((c) => (c.id === composer.editing ? { ...comment, state: c.state } : c))
      : [...get().comments, comment];
    set({ comments, composer: null, selection: null, copied: false });
  },

  deleteComment(id) {
    const comments = get().comments;
    set({
      comments: comments.filter((c) => c.id !== id),
      openComment: null,
      undo: { label: "Comment deleted", comments },
    });
  },

  setCommentList(open) {
    set({ commentList: open });
  },

  setBasePicker(open) {
    set({ basePicker: open });
  },

  setPreview(open) {
    set({ preview: open });
  },

  toggleComment(id) {
    set({ openComment: get().openComment === id ? null : id });
  },

  jumpComment(step) {
    const { review, comments, openComment } = get();
    // A comment not in this diff has no card to open (diff-loop-app.md Decision 16).
    const list = orderedComments(review, comments).filter((c) => c.state === "current");
    if (list.length === 0) return;
    const at = list.findIndex((c) => c.id === openComment);
    const next = list[(at + step + list.length) % list.length]!;
    get().showComment(next.id);
  },

  showComment(id) {
    const c = get().comments.find((x) => x.id === id);
    if (c) {
      const find = c.path === get().selected ? get().find : firstMatch(get().find);
      set({ selected: c.path, openComment: id, selection: null, composer: null, find });
    }
  },

  clearUndo() {
    set({ undo: null });
  },

  clearComments() {
    const comments = get().comments;
    if (comments.length === 0) return;
    set({
      comments: [],
      openComment: null,
      copied: false,
      undo: { label: `${comments.length} ${comments.length === 1 ? "comment" : "comments"} cleared`, comments },
    });
  },

  undoLast() {
    const undo = get().undo;
    if (undo) set({ comments: undo.comments, undo: null });
  },

  dismissBanner() {
    set({ banner: null });
  },

  undoRemoved() {
    const banner = get().banner;
    if (!banner || banner.removed.length === 0) return;
    // As not in this diff: their code is gone, so as current the next load would remove them again.
    const back = banner.removed.map((c) => ({ ...c, state: "outdated" as const }));
    set({
      comments: [...get().comments, ...back],
      banner: banner.previous === null ? null : { ...banner, removed: [] },
    });
  },

  async showWhatChanged() {
    const banner = get().banner;
    if (banner?.previous == null) return;
    await get().setBase({ kind: "ref", name: banner.previous });
  },

  instructionsRequest() {
    return requestOf(get());
  },

  async copyReview() {
    const request = get().instructionsRequest();
    if (!request || request.comments.length === 0) return;
    const opening = get().opening;
    set({ copyProblem: null });
    try {
      // What the preview shows is what is copied: its edit, when one is kept for this review.
      const edit = keptEdit(get().previewEdit, reviewKey(request));
      await get().copyText(edit ?? (await api.instructions(request)));
    } catch (error) {
      // A failure that settles after the checkout closed is not the next one's to show.
      if (get().opening === opening) set({ copyProblem: describe(error) });
    }
  },

  async copyText(text) {
    await writeText(text);
    // Copied, the edit has done its job (diff-loop-app.md Decision 25).
    set({ copied: true, previewEdit: null });
  },

  setPreviewEdit(edit) {
    set({ previewEdit: edit });
  },

  setCopied(copied) {
    set({ copied });
  },

  async retrySave() {
    const opening = get().opening;
    if (!opening) return;
    const root = opening.checkout.root;
    if (savings.get(root)?.last !== null) {
      await save(root, { comments: get().comments });
      return;
    }
    const saved = await readSaved(root);
    if (get().opening !== opening || saved.problem) {
      if (get().opening === opening) set({ saveProblem: saved.problem });
      return;
    }
    // Comment ids are unique, so the saved ones the window lacks are added.
    const ids = new Set(get().comments.map((c) => c.id));
    const comments = [...saved.review.comments.filter((c) => !ids.has(c.id)), ...get().comments];
    set({ comments, saveProblem: null });
    await get().reload();
  },
}));

/** How saving stands for one working tree. */
type Saving = {
  /** JSON of the review last saved or read; null while it could not be read, which stops saving. */
  last: string | null;
  /** Saves run one after another, so an older one never lands after a newer. */
  queue: Promise<void>;
};

/** By working-tree root, for each checkout opened in this window. */
const savings = new Map<string, Saving>();

/** The review saved for `root`, recorded as its last; empty with the problem when it cannot be read. */
async function readSaved(root: string): Promise<{ review: SavedReview; problem: Problem | null }> {
  const saving = savings.get(root) ?? { last: null, queue: Promise.resolve() };
  savings.set(root, saving);
  try {
    const review = await api.savedReview(root);
    saving.last = JSON.stringify(review);
    return { review, problem: null };
  } catch (error) {
    // Saving stays stopped: writing now would replace a review never read.
    saving.last = null;
    return { review: { comments: [] }, problem: describe(error) };
  }
}

/** Keeps `review` for `root` unless it is what was last kept, reporting failure while `root` is open. */
function save(root: string, review: SavedReview): Promise<void> {
  const saving = savings.get(root);
  if (!saving || saving.last === null) return Promise.resolve();
  saving.queue = saving.queue.then(async () => {
    const json = JSON.stringify(review);
    if (json === saving.last) return;
    const stillOpen = () => useStore.getState().opening?.checkout.root === root;
    try {
      await api.saveReview(root, review);
      saving.last = json;
      if (stillOpen()) useStore.setState({ saveProblem: null });
    } catch (error) {
      if (stillOpen()) useStore.setState({ saveProblem: describe(error) });
    }
  });
  return saving.queue;
}

// Saves the open checkout's review when its comments change (ADR 0004 §4);
// `open` sets the checkout and its saved review together, so opening is
// never seen as a change.
useStore.subscribe((now, before) => {
  const opening = now.opening;
  if (!opening || opening !== before.opening || now.comments === before.comments) return;
  void save(opening.checkout.root, { comments: now.comments });
});
