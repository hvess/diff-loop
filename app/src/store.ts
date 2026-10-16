// The window's state and everything that changes it.
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { create } from "zustand";
import { api, describe } from "./api";
import type { Base } from "./bindings/Base";
import type { BaseRef } from "./bindings/BaseRef";
import type { Comment } from "./bindings/Comment";
import type { FileDiff } from "./bindings/FileDiff";
import type { Head } from "./bindings/Head";
import type { InstructionsRequest } from "./bindings/InstructionsRequest";
import type { Opening } from "./bindings/Opening";
import type { Place } from "./bindings/Place";
import type { Review } from "./bindings/Review";
import type { Round } from "./bindings/Round";
import type { SavedReview } from "./bindings/SavedReview";
import type { Snapshot } from "./bindings/Snapshot";
import type { Side } from "./bindings/Side";
import type { Target } from "./bindings/Target";
import { changed, hasCard, open as isOpen, resolvable } from "./lifecycle";
import { rememberRecent } from "./recent";
import { dedent } from "./indent";
import { shortId } from "./format";
import { changedLines, type Expanded, type Gap, gapsOf, lastLine, linesOn, withinHunk } from "./rows";
import { clampWidth, loadWidth, rememberWidth } from "./sidebar";
import { folderCounts, folderKeys, type TreeRow, treeRows } from "./tree";

export type Problem = { title: string; detail: string };

/** A loaded review with every file in full: files load_review only named are carried over from the last load. */
export type LoadedReview = Omit<Review, "files" | "snapshot"> & {
  changes: { snapshot: Snapshot; files: FileDiff[] };
  /** Path → the signature load_review returned for that file. */
  signatures: Record<string, string>;
  /** Built once per load, so a key press never scans the file list. */
  byPath: Map<string, FileDiff>;
  /** The sidebar's rows, built once per load; `closed` folds some away (`fold`). */
  tree: TreeRow[];
  /** Path → the keys of the folder rows it is under, which selecting it opens. */
  folders: Map<string, string[]>;
  /** Folder row key → how many changed files it holds, which a folded folder shows. */
  folderFiles: Map<string, number>;
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
 * The checkout changed under the review; `action` is the base it offers to compare with
 * instead: the commit before `HEAD` moved, or the uncommitted changes after a follow.
 */
export type Banner = { title: string; action: { label: string; base: Base } | null };

/** The comments N / P step through: every one with a card, or only the sent ones a round strip count names. */
export type CommentFilter = "changed" | "untouched" | null;

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
  /** The rounds sent for the open checkout, the latest last (ADR 0015 §9). */
  rounds: Round[];
  /** How many comments the last load resolved itself, said once in the round strip (ADR 0015 §4). */
  autoResolved: number;
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
  /** The lost draft being placed again, while a line is being chosen (ADR 0015 §2). */
  replacing: string | null;
  /** The comment R last resolved, which R unresolves while no card is open; null once another is shown. */
  lastResolved: string | null;
  commentFilter: CommentFilter;
  /** Whether the comments list is open. */
  commentList: boolean;
  /** Whether the base picker is open. */
  basePicker: boolean;
  /** Whether the preview of the instructions is open. */
  preview: boolean;
  banner: Banner | null;
  /** The last copy, with the round it sent; null once it is no longer shown. */
  copied: { round: number | null } | null;
  /** The review before the last copy, offered as "Not sent" until the next load changes something. */
  unsend: SavedReview | null;
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
  /** The sidebar's folded folders, by row key; open unless here. */
  closed: Set<string>;
  /** The sidebar's width in pixels (ADR 0016 §2). */
  sidebarWidth: number;
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
  /** Resolves a sent comment, or unresolves it; a draft never sent is left alone (ADR 0015 §4). */
  resolveComment: (id: string) => void;
  /** Deletes every draft not yet sent, with Undo; sent comments are the rounds' record. */
  deleteDrafts: () => void;
  toggleComment: (id: string | null) => void;
  setCommentList: (open: boolean) => void;
  setBasePicker: (open: boolean) => void;
  setPreview: (open: boolean) => void;
  jumpComment: (step: 1 | -1) => void;
  /** Selects the comment's file and opens its card. */
  showComment: (id: string) => void;
  /** Steps N / P through the sent comments `filter` names, from the first; null steps through all again. */
  setCommentFilter: (filter: CommentFilter) => void;
  /** Starts placing the lost draft `id` again: the selected file's gutter takes the next click or Return. */
  startReplace: (id: string) => void;
  /** Places the draft being placed on line `no` of `side` in the selected file; it is a current draft again. */
  placeComment: (side: Side, no: number) => void;
  cancelReplace: () => void;
  clearUndo: () => void;
  undoLast: () => void;
  dismissBanner: () => void;
  takeBannerAction: () => Promise<void>;
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
  /** Copies `text` and ends a round: every open comment is sent (ADR 0015 §1). */
  copyText: (text: string) => Promise<void>;
  /** Closes the Copied popover, and with it the offer to take the round back. */
  dismissCopied: () => void;
  /** Takes back the last copy's round: the review is as it was before the copy (ADR 0015 §1). */
  unsendRound: () => void;
  toggleFolder: (key: string) => void;
  setSidebarWidth: (width: number) => void;
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

/** The banner's offer to compare with the commit before `HEAD` moved. */
function whatChanged(previous: string): Banner["action"] {
  return { label: "Show what changed", base: { kind: "ref", name: previous } };
}

/** The banner's detail: how many open comments the diff shown no longer holds (`ux` skill, "Settled wording"). */
export function bannerDetail(notInDiff: number): string {
  if (notInDiff === 0) return "";
  return `${notInDiff} ${notInDiff === 1 ? "comment is" : "comments are"} not in this diff.`;
}

/** Whether a sent comment is one `filter` names: judged changed, or untouched. */
export function inFilter(c: Comment, filter: CommentFilter): boolean {
  if (filter === null) return true;
  if (c.sent === null || c.resolved !== null) return false;
  return filter === "changed" ? changed(c) : c.sent.verdict === "untouched" || c.sent.verdict === "nearbyChanged";
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

/** Where the review stands: the base and the branch checked out, as a comment or a round records it. */
export function placeOf(s: Pick<State, "review" | "opening" | "base">): Place | null {
  const checkout = s.review?.checkout ?? s.opening?.checkout;
  return checkout ? { base: s.base, head: checkout.head } : null;
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
  const folders = folderKeys(tree);
  const order = tree.flatMap((row) => (row.kind === "file" ? [row.file] : []));
  return {
    ...rest,
    changes: { snapshot, files },
    signatures,
    byPath: new Map(files.map((f) => [f.path, f])),
    tree,
    folders,
    folderFiles: folderCounts(folders),
    order,
    position: new Map(order.map((f, i) => [f.path, i])),
  };
}

export const sameBase = (a: Base, b: Base) => JSON.stringify(a) === JSON.stringify(b);

/** `closed` without the folders `path` is under: a selected file is shown, however it was selected (ADR 0016 §1). */
function openedFor(review: LoadedReview | null, path: string | null, closed: Set<string>): Set<string> {
  const under = path === null ? [] : (review?.folders.get(path) ?? []).filter((key) => closed.has(key));
  return under.length === 0 ? closed : new Set([...closed].filter((key) => !under.includes(key)));
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
  rounds: [],
  autoResolved: 0,
  selected: null,
  viewed: new Map(),
  viewedLines: 0,
  expanded: new Map(),
  mode: "unified",
  composer: null,
  selection: null,
  openComment: null,
  replacing: null,
  lastResolved: null,
  commentFilter: null,
  commentList: false,
  basePicker: false,
  preview: false,
  banner: null,
  copied: null,
  unsend: null,
  copyProblem: null,
  undo: null,
  find: null,
  previewEdit: null,
  saveProblem: null,
  closed: new Set(),
  sidebarWidth: loadWidth(),

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
        rounds: saved.review.rounds,
        autoResolved: 0,
        viewed: new Map(),
        viewedLines: 0,
        expanded: new Map(),
        watching: false,
        selected: null,
        composer: null,
        selection: null,
        openComment: null,
        replacing: null,
        lastResolved: null,
        commentFilter: null,
        commentList: false,
        basePicker: false,
        preview: false,
        copyProblem: null,
        banner: null,
        copied: null,
        unsend: null,
        undo: null,
        find: null,
        previewEdit: null,
        saveProblem: saved.problem,
        closed: new Set(),
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
      rounds: [],
      composer: null,
      selection: null,
      replacing: null,
      commentFilter: null,
      commentList: false,
      basePicker: false,
      preview: false,
      copied: null,
      unsend: null,
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
      // Comments written or changed while loading are kept as they are: a comment is
      // replaced, never mutated, so one not among those sent changed since.
      const unchanged = new Set(sent);
      let autoResolved = 0;
      const comments = get().comments.map((c) => {
        const m = moved.get(c.id);
        if (!m || !unchanged.has(c)) return c;
        if (c.resolved === null && m.resolved === "suggestionApplied") autoResolved++;
        return { ...m, text: c.text, suggestion: c.suggestion };
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
      // A comment without a card has none to stay open.
      const openComment = comments.some((c) => c.id === open && hasCard(c)) ? open : null;
      let viewedLines = 0;
      // Kept marks are for files in this load: their signatures matched.
      for (const path of viewed.keys()) viewedLines += changedLines(review.byPath.get(path)!);
      // What changed is now on the record: the last copy can no longer be taken back, and its popover goes.
      const copied = get().unsend ? null : get().copied;
      const closed = openedFor(review, selected, get().closed);
      set({ review, comments, autoResolved, viewed, viewedLines, expanded, selected, openComment, loadProblem: null, unsend: null, copied, closed });
      await announceMove(before, review, held !== null);
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

    // Only a change of context gets a banner (ADR 0015 §10): the agent's work shows in the round strip.
    async function announceMove(before: LoadedReview | null, after: LoadedReview, sameBaseBefore: boolean) {
      const stillHere = () => sameBase(get().base, base) && get().review?.checkout.root === after.checkout.root;
      const previous = before?.checkout.commit;
      const now = after.checkout.commit;
      if (!previous || !now || previous === now) return;
      const headBefore = before.checkout.head;
      const headNow = after.checkout.head;
      if (headBefore.kind === "branch" && headNow.kind === "branch" && headBefore.name !== headNow.name) {
        set({ banner: { title: `Switched to ${headNow.name}`, action: whatChanged(previous) } });
        return;
      }
      const count = await api.commitsBetween(previous, now).catch(() => null);
      // The reviewer may have picked another base, or repository, meanwhile.
      if (!stillHere()) return;
      if (count === null) {
        set({ banner: { title: "The branch was rewritten", action: whatChanged(previous) } });
        return;
      }
      const title = `The branch moved: ${count} new ${count === 1 ? "commit" : "commits"}`;
      // Not on a base the reviewer has just chosen: they stay on it.
      if (sameBaseBefore && (await followCommit(title, previous, headNow, stillHere))) return;
      if (stillHere()) set({ banner: { title, action: whatChanged(previous) } });
    }

    /**
     * A commit on top of a round sent against the uncommitted changes: compared with the commit it
     * was sent on, the round's comments are judged again (ADR 0017 §2). Whether the core named one to follow.
     */
    async function followCommit(title: string, previous: string, head: Head, stillHere: () => boolean): Promise<boolean> {
      const round = await api.roundToFollow(get().comments, { base, head }, previous).catch(() => null);
      if (round === null || !stillHere()) return false;
      const since: Base = { kind: "ref", name: previous };
      await get().setBase(since);
      // The reviewer may have picked another base while it loaded, or it may have failed.
      if (!sameBase(get().base, since) || get().loadProblem) return true;
      const back = { label: "Show uncommitted changes", base: { kind: "uncommitted" } as const };
      set({ banner: { title: `${title} · showing changes since round ${round} (${shortId(previous)})`, action: back } });
      return true;
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
    // the check (ADR 0005 §4).
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
    const { review, closed } = get();
    const find = path === get().selected ? get().find : firstMatch(get().find);
    set({ selected: path, selection: null, openComment: null, find, closed: openedFor(review, path, closed) });
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
    if (!s || get().composer || get().replacing) return;
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
    const place = placeOf(get());
    if (!composer || !canSave(composer) || !place) return;
    const written = { target: composer.target, text: composer.text.trim(), suggestion: composer.suggestion };
    // An edited sent comment keeps its round, and is reopened by its text differing from what was sent.
    const comments = composer.editing
      ? get().comments.map((c) => (c.id === composer.editing ? { ...c, ...written } : c))
      : [
          ...get().comments,
          { id: crypto.randomUUID(), path: composer.path, ...written, state: "current" as const, place, sent: null, resolved: null },
        ];
    // A comment written or edited moves the review on: the last copy's popover and its "Not sent" go with it.
    set({ comments, composer: null, selection: null, copied: null, unsend: null });
  },

  deleteComment(id) {
    const comments = get().comments;
    // A delete moves the review on, as writing does: the last copy can no longer be taken back.
    set({
      comments: comments.filter((c) => c.id !== id),
      openComment: null,
      undo: { label: "Comment deleted", comments },
      copied: null,
      unsend: null,
    });
  },

  resolveComment(id) {
    const c = get().comments.find((x) => x.id === id);
    if (!c || !resolvable(c)) return;
    const resolved = c.resolved === null ? "byReviewer" as const : null;
    set({
      comments: get().comments.map((x) => (x.id === id ? { ...x, resolved } : x)),
      // Resolved, it has no card to stay open; R again unresolves it and opens the card (ADR 0015 §4).
      openComment: resolved && get().openComment === id ? null : get().openComment,
      lastResolved: resolved ? id : null,
      // A resolve moves the review on, as writing does: "Not sent" would drop it (ADR 0015 §1).
      copied: null,
      unsend: null,
    });
    // Only a comment with a card is shown: one outdated stays in the list, as it was.
    const now = get().comments.find((x) => x.id === id);
    if (!resolved && now && hasCard(now)) get().showComment(id);
  },

  deleteDrafts() {
    const comments = get().comments;
    const drafts = comments.filter((c) => c.sent === null).length;
    if (drafts === 0) return;
    const open = get().openComment;
    set({
      comments: comments.filter((c) => c.sent !== null),
      openComment: comments.some((c) => c.id === open && c.sent !== null) ? open : null,
      undo: { label: `${drafts} ${drafts === 1 ? "draft" : "drafts"} deleted`, comments },
      copied: null,
      unsend: null,
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
    const open = get().openComment === id ? null : id;
    // Another card shown: R no longer unresolves the comment it last resolved.
    set({ openComment: open, lastResolved: open === null ? get().lastResolved : null });
  },

  jumpComment(step) {
    const { review, comments, openComment, commentFilter } = get();
    // Only a comment with a card: lost and not-in-this-diff comments are skipped, resolved ones too.
    const list = orderedComments(review, comments).filter((c) => hasCard(c) && inFilter(c, commentFilter));
    if (list.length === 0) return;
    const at = list.findIndex((c) => c.id === openComment);
    const next = list[(at + step + list.length) % list.length]!;
    get().showComment(next.id);
  },

  showComment(id) {
    const c = get().comments.find((x) => x.id === id);
    if (c) {
      const find = c.path === get().selected ? get().find : firstMatch(get().find);
      get().select(c.path);
      set({ openComment: id, selection: null, composer: null, find, lastResolved: null });
    }
  },

  setCommentFilter(filter) {
    set({ commentFilter: filter });
    if (filter !== null) {
      const first = orderedComments(get().review, get().comments).find((c) => hasCard(c) && inFilter(c, filter));
      // None on a line (their files left the diff): the list shows them.
      if (first) get().showComment(first.id);
      else set({ commentList: true });
    }
  },

  startReplace(id) {
    const { comments, review } = get();
    const c = comments.find((x) => x.id === id);
    if (!c || c.state !== "lost") return;
    // Its file first, when the diff still has it: the code was near there.
    if (review?.byPath.has(c.path)) get().select(c.path);
    set({ replacing: id, commentList: false, openComment: null, composer: null, selection: null });
  },

  placeComment(side, no) {
    const { replacing, selected, review, comments } = get();
    const file = selected === null ? undefined : review?.byPath.get(selected);
    const place = placeOf(get());
    if (replacing === null || !file || !place || !comments.some((c) => c.id === replacing)) return;
    const target: Target = { kind: "lines", side, start: no, code: linesOn(file, side, no, no) };
    set({
      comments: comments.map((c) => (c.id === replacing ? { ...c, path: file.path, target, state: "current" as const, place } : c)),
      replacing: null,
      selection: null,
      openComment: replacing,
      undo: { label: `Placed on line ${no}. It is a draft again.`, comments },
    });
  },

  cancelReplace() {
    set({ replacing: null, selection: null });
  },

  clearUndo() {
    set({ undo: null });
  },

  undoLast() {
    const undo = get().undo;
    if (undo) set({ comments: undo.comments, undo: null });
  },

  dismissBanner() {
    set({ banner: null });
  },

  async takeBannerAction() {
    const action = get().banner?.action;
    if (action) await get().setBase(action.base);
  },

  instructionsRequest() {
    return requestOf(get());
  },

  async copyReview() {
    const request = get().instructionsRequest();
    if (!request || !request.comments.some(isOpen)) return;
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
    const { review, comments, rounds, opening } = get();
    const place = placeOf(get());
    const before: SavedReview = { comments, rounds };
    // Copied, the edit has done its job (diff-loop-app.md Decision 25).
    if (!review || !place || !comments.some(isOpen)) {
      set({ copied: { round: null }, previewEdit: null });
      return;
    }
    // Only the files the open comments are in: the core reads their context from them.
    const paths = new Set(comments.filter(isOpen).map((c) => c.path));
    const files = [...paths].flatMap((path) => review.byPath.get(path) ?? []);
    const after = await api.endRound({
      review: before,
      files,
      place,
      commit: review.checkout.commit,
      at: Date.now(),
      markdown: text,
    });
    // Another checkout opened meanwhile: the round was that one's, and goes with it (frontend skill, State).
    if (get().opening !== opening) return;
    // Comments changed while the round was recorded (a load, an edit) keep their change and take what was sent;
    // one written meanwhile was not in the copy, and one pruned with its round goes.
    const sentNow = new Map(after.comments.map((c) => [c.id, c]));
    const copiedIds = new Set(comments.map((c) => c.id));
    // A load or an edit meanwhile is on the record: nothing before it can be put back.
    const untouched = get().review === review && get().comments === comments;
    const merged = get().comments.flatMap((c) => {
      const a = sentNow.get(c.id);
      if (!copiedIds.has(c.id)) return [c];
      if (!a) return [];
      const was = comments.find((x) => x.id === c.id);
      // The core's state, unless a load moved the comment meanwhile.
      return [c === was ? a : { ...c, sent: a.sent, state: c.state === was?.state ? a.state : c.state }];
    });
    set({
      comments: merged,
      rounds: after.rounds,
      copied: { round: after.rounds.at(-1)?.number ?? null },
      unsend: untouched ? before : null,
      previewEdit: null,
      commentFilter: null,
    });
  },

  setPreviewEdit(edit) {
    set({ previewEdit: edit });
  },

  dismissCopied() {
    set({ copied: null, unsend: null });
  },

  unsendRound() {
    const unsend = get().unsend;
    if (!unsend) return;
    set({ comments: unsend.comments, rounds: unsend.rounds, unsend: null, copied: null });
  },

  toggleFolder(key) {
    const closed = new Set(get().closed);
    if (!closed.delete(key)) closed.add(key);
    set({ closed });
  },

  setSidebarWidth(width) {
    const sidebarWidth = clampWidth(width);
    rememberWidth(sidebarWidth);
    set({ sidebarWidth });
  },

  async retrySave() {
    const opening = get().opening;
    if (!opening) return;
    const root = opening.checkout.root;
    if (savings.get(root)?.last !== null) {
      await save(root, { comments: get().comments, rounds: get().rounds });
      return;
    }
    const saved = await readSaved(root);
    if (get().opening !== opening || saved.problem) {
      if (get().opening === opening) set({ saveProblem: saved.problem });
      return;
    }
    // Rounds copied meanwhile counted from 1 again: the core counts them on from the saved ones.
    const { comments, rounds } = await api.mergeReviews({ comments: get().comments, rounds: get().rounds }, saved.review);
    if (get().opening !== opening) return;
    set({ comments, rounds, saveProblem: null });
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
    return { review: { comments: [], rounds: [] }, problem: describe(error) };
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

// Saves the open checkout's review when its comments or rounds change (ADR 0004 §4);
// `open` sets the checkout and its saved review together, so opening is
// never seen as a change.
useStore.subscribe((now, before) => {
  const opening = now.opening;
  if (!opening || opening !== before.opening || (now.comments === before.comments && now.rounds === before.rounds)) return;
  void save(opening.checkout.root, { comments: now.comments, rounds: now.rounds });
});
