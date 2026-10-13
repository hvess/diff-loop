// The window's state and everything that changes it.
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { create } from "zustand";
import { api, describe } from "./api";
import type { Base } from "./bindings/Base";
import type { BaseRef } from "./bindings/BaseRef";
import type { Comment } from "./bindings/Comment";
import type { FileDiff } from "./bindings/FileDiff";
import type { Format } from "./bindings/Format";
import type { InstructionsRequest } from "./bindings/InstructionsRequest";
import type { Opening } from "./bindings/Opening";
import type { Review } from "./bindings/Review";
import type { SavedReview } from "./bindings/SavedReview";
import type { Snapshot } from "./bindings/Snapshot";
import type { Side } from "./bindings/Side";
import type { Target } from "./bindings/Target";
import { rememberRecent } from "./recent";
import { type Expanded, type Gap, lastLine, linesOn, withinHunk } from "./rows";

export type Problem = { title: string; detail: string };

/** A loaded review with every file in full: files load_review only named are carried over from the last load. */
export type LoadedReview = Omit<Review, "files" | "snapshot"> & {
  changes: { snapshot: Snapshot; files: FileDiff[] };
  /** Path → the signature load_review returned for that file. */
  signatures: Record<string, string>;
  /** Built once per load, so a key press never scans the file list. */
  byPath: Map<string, FileDiff>;
  /** Files in sidebar order: by role group, then path. */
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

export type Selection = { path: string; side: Side; anchor: number; head: number; dragging: boolean };

export type Banner = { title: string; detail: string; previous: string };

export type Prefs = { format: Format; includeCode: boolean; includeNote: boolean };

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
  loadProblem: Problem | null;
  comments: Comment[];
  selected: string | null;
  /**
   * Path → signature of the file's diff when marked viewed. V changes it in
   * place, so it costs O(1), then `set`s it again so selectors re-run;
   * opening and reloading replace it whole.
   */
  viewed: Map<string, string>;
  /**
   * Path → the gaps expanded in that file, kept while its signature holds.
   * Replaced, never mutated: DiffView selects one file's entry.
   */
  expanded: Map<string, { signature: string; gaps: Expanded }>;
  mode: "unified" | "split";
  composer: Composer | null;
  selection: Selection | null;
  openComment: string | null;
  banner: Banner | null;
  copied: boolean;
  undo: Undo | null;
  note: string;
  prefs: Prefs;
  /** Why the open checkout's comments and note are not being kept, if they are not. */
  saveProblem: Problem | null;
};

type Actions = {
  open(path: string): Promise<void>;
  closeRepository(): void;
  setBase(base: Base): Promise<void>;
  reload(): Promise<void>;
  poll(): Promise<void>;
  select(path: string): void;
  toggleViewed(path?: string): void;
  /** Reads and shows the unchanged lines of `gap`, expanded under `key` (`gapKey`, or `REST`). */
  expandGap(path: string, key: string, gap: Gap): Promise<void>;
  setMode(mode: State["mode"]): void;
  setSelection(selection: Selection | null): void;
  composeOnSelection(): void;
  composeOnLines(path: string, side: Side, start: number, end: number): void;
  composeOnFile(path: string): void;
  editComment(id: string): void;
  updateComposer(patch: Partial<Composer>): void;
  cancelComposer(): void;
  saveComposer(): void;
  deleteComment(id: string): void;
  keepComment(id: string): void;
  toggleComment(id: string | null): void;
  jumpComment(step: 1 | -1): void;
  /** Selects the comment's file and opens its card. */
  showComment(id: string): void;
  clearUndo(): void;
  clearComments(): void;
  undoLast(): void;
  dismissBanner(): void;
  showWhatChanged(): Promise<void>;
  setNote(note: string): void;
  setPrefs(prefs: Partial<Prefs>): void;
  instructionsRequest(prefs?: Prefs): InstructionsRequest | null;
  copyReview(): Promise<void>;
  copyText(text: string): Promise<void>;
  setCopied(copied: boolean): void;
  /**
   * Saves the open checkout's comments and note now. When its saved review
   * could not be read, reads it again first and merges it into the window.
   */
  retrySave(): Promise<void>;
};

const PREFS_KEY = "diff-loop.prefs";

/** Stored preferences, each field checked; anything invalid takes its default. */
function loadPrefs(): Prefs {
  const prefs: Prefs = { format: "markdown", includeCode: true, includeNote: true };
  let stored: unknown;
  try {
    stored = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
  } catch {
    return prefs;
  }
  if (typeof stored !== "object" || stored === null) return prefs;
  const s = stored as Record<string, unknown>;
  if (s.format === "plain" || s.format === "markdown") prefs.format = s.format;
  if (typeof s.includeCode === "boolean") prefs.includeCode = s.includeCode;
  if (typeof s.includeNote === "boolean") prefs.includeNote = s.includeNote;
  return prefs;
}

/** Comments in sidebar file order, then by line. */
export function orderedComments(review: LoadedReview | null, comments: Comment[]): Comment[] {
  const at = (c: Comment) => review?.position.get(c.path) ?? Number.MAX_SAFE_INTEGER;
  const line = (c: Comment) => (c.target.kind === "lines" ? c.target.start : 0);
  return [...comments].sort((a, b) => at(a) - at(b) || line(a) - line(b));
}

/**
 * load_review for `base`, sending only the versions `held` already has, and
 * filling the files it names back in from `held`.
 */
async function fetchReview(base: Base, comments: Comment[], held: LoadedReview | null): Promise<LoadedReview> {
  const known = held ? Object.entries(held.signatures).map(([path, signature]) => ({ path, signature })) : [];
  const { files: entries, snapshot, ...rest } = await api.loadReview(base, comments, known);
  const previous = new Map(held?.changes.files.map((f) => [f.path, f]));
  const files: FileDiff[] = [];
  const signatures: Record<string, string> = {};
  for (const entry of entries) {
    const file = entry.kind === "changed" ? entry.diff : previous.get(entry.path);
    // Unreachable while `known` comes from `held`; a full load repairs it if not.
    if (!file) return fetchReview(base, comments, null);
    files.push(file);
    signatures[file.path] = entry.signature;
  }
  const order = rest.groups.flatMap((g) => g.files.map((i) => files[i]!));
  return {
    ...rest,
    changes: { snapshot, files },
    signatures,
    byPath: new Map(files.map((f) => [f.path, f])),
    order,
    position: new Map(order.map((f, i) => [f.path, i])),
  };
}

export const sameBase = (a: Base, b: Base) => JSON.stringify(a) === JSON.stringify(b);

export const useStore = create<State & Actions>()((set, get) => ({
  opening: null,
  openProblem: null,
  busy: false,
  watching: false,
  refs: [],
  base: { kind: "uncommitted" },
  review: null,
  loading: false,
  loadProblem: null,
  comments: [],
  selected: null,
  viewed: new Map(),
  expanded: new Map(),
  mode: "unified",
  composer: null,
  selection: null,
  openComment: null,
  banner: null,
  copied: false,
  undo: null,
  note: "",
  prefs: loadPrefs(),
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
        expanded: new Map(),
        watching: false,
        selected: null,
        composer: null,
        selection: null,
        openComment: null,
        banner: null,
        undo: null,
        note: saved.review.note,
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
    set({ opening: null, review: null, comments: [], composer: null, selection: null });
  },

  async setBase(base) {
    // Expanded lines were read from the old base's snapshot.
    set({ base, banner: null, expanded: new Map() });
    api.refs().then((refs) => set({ refs }), () => {});
    await get().reload();
  },

  async reload() {
    const { base, review: before } = get();
    set({ loading: true });
    try {
      const held = before && sameBase(before.base, base) ? before : null;
      const review = await fetchReview(base, get().comments, held);
      if (!sameBase(get().base, base)) return;
      const moved = new Map(review.comments.map((c) => [c.id, c]));
      // Comments written while loading are kept as they are.
      const comments = get().comments.map((c) => {
        const m = moved.get(c.id);
        return m ? { ...m, text: c.text, suggestion: c.suggestion } : c;
      });
      const viewed = new Map([...get().viewed].filter(([path, was]) => review.signatures[path] === was));
      const expanded = new Map([...get().expanded].filter(([path, e]) => review.signatures[path] === e.signature));
      const current = get().selected;
      const selected = current !== null && review.byPath.has(current) ? current : (review.order[0]?.path ?? null);
      set({ review, comments, viewed, expanded, selected, loadProblem: null });
      await announceMove(before, review, comments);
    } catch (error) {
      set({ loadProblem: describe(error) });
    } finally {
      set({ loading: false });
    }

    async function announceMove(before: LoadedReview | null, after: LoadedReview, comments: Comment[]) {
      const previous = before?.checkout.commit;
      const now = after.checkout.commit;
      if (!previous || !now || previous === now) return;
      const outdated = comments.filter((c) => c.state === "outdated").length;
      const current = comments.length - outdated;
      const detail =
        comments.length === 0
          ? ""
          : `${outdated} ${outdated === 1 ? "comment is" : "comments are"} outdated, ${current} still ${current === 1 ? "applies" : "apply"}.`;
      const headBefore = before.checkout.head;
      const headNow = after.checkout.head;
      if (headBefore.kind === "branch" && headNow.kind === "branch" && headBefore.name !== headNow.name) {
        set({ banner: { title: `Switched to ${headNow.name}`, detail, previous } });
        return;
      }
      const count = await api.commitsBetween(previous, now).catch(() => null);
      const title =
        count === null
          ? "The branch was rewritten"
          : `The branch moved: ${count} new ${count === 1 ? "commit" : "commits"}`;
      set({ banner: { title, detail, previous } });
    }
  },

  async poll() {
    const { review, loading, base, opening } = get();
    if (!opening || !review || loading) return;
    try {
      const fingerprint = await api.fingerprint(base);
      if (fingerprint !== get().review?.fingerprint && !get().loading) await get().reload();
    } catch {
      // The next reload reports it; polling stays quiet.
    }
  },

  select(path) {
    set({ selected: path, selection: null, openComment: null });
  },

  toggleViewed(path) {
    const { review, viewed, selected } = get();
    const target = path ?? selected;
    const signature = target === null ? undefined : review?.signatures[target];
    if (target === null || signature === undefined) return;
    if (viewed.has(target)) viewed.delete(target);
    else viewed.set(target, signature);
    // Same Map: `set` still notifies, and selectors read it afresh.
    set({ viewed });
  },

  async expandGap(path, key, gap) {
    const review = get().review;
    const signature = review?.signatures[path];
    if (!review || signature === undefined || gap.count === 0) return;
    // After the last hunk the file's length is unknown: `lines` stops at its end.
    const last = gap.count === null ? 0xffffffff : gap.newFirst + gap.count - 1;
    const mark = (state: Expanded[string]) => {
      const now = get().review;
      // A reload since asking may have changed the file: its lines no longer fit.
      if (now?.signatures[path] !== signature) return;
      const before = get().expanded.get(path);
      const gaps = before?.signature === signature ? before.gaps : {};
      set({ expanded: new Map(get().expanded).set(path, { signature, gaps: { ...gaps, [key]: state } }) });
    };
    mark("loading");
    try {
      mark(await api.fileLines(review.changes.snapshot, "new", path, gap.newFirst, last));
    } catch {
      mark("failed");
    }
  },

  setMode(mode) {
    set({ mode });
  },

  setSelection(selection) {
    set({ selection });
  },

  composeOnSelection() {
    const s = get().selection;
    if (!s) return;
    const [start, end] = s.anchor <= s.head ? [s.anchor, s.head] : [s.head, s.anchor];
    get().composeOnLines(s.path, s.side, start, end);
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
      composer: { path: c.path, target: c.target, text: c.text, suggestion: c.suggestion, editing: id },
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
    if (!composer || composer.text.trim() === "") return;
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

  keepComment(id) {
    const review = get().review;
    set({
      comments: get().comments.map((c) => {
        if (c.id !== id || c.target.kind !== "lines") return c.id === id ? { ...c, state: "current" } : c;
        const file = review?.byPath.get(c.path);
        if (!file) return { ...c, state: "current" };
        const { side, start } = c.target;
        const end = withinHunk(file, side, start, lastLine(c.target));
        return { ...c, state: "current", target: { kind: "lines", side, start, code: linesOn(file, side, start, end) } };
      }),
    });
  },

  toggleComment(id) {
    set({ openComment: get().openComment === id ? null : id });
  },

  jumpComment(step) {
    const { review, comments, openComment } = get();
    const list = orderedComments(review, comments);
    if (list.length === 0) return;
    const at = list.findIndex((c) => c.id === openComment);
    const next = list[(at + step + list.length) % list.length]!;
    get().showComment(next.id);
  },

  showComment(id) {
    const c = get().comments.find((x) => x.id === id);
    if (c) set({ selected: c.path, openComment: id, selection: null, composer: null });
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

  async showWhatChanged() {
    const banner = get().banner;
    if (!banner) return;
    await get().setBase({ kind: "ref", name: banner.previous });
  },

  setNote(note) {
    set({ note });
  },

  setPrefs(prefs) {
    const next = { ...get().prefs, ...prefs };
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable: preferences last for this session.
    }
    set({ prefs: next });
  },

  instructionsRequest(prefs = get().prefs) {
    const { review, comments, base, note } = get();
    if (!review) return null;
    return {
      head: review.checkout.head,
      base,
      comments: orderedComments(review, comments),
      note: prefs.includeNote ? note : null,
      format: prefs.format,
      includeCode: prefs.includeCode,
    };
  },

  async copyReview() {
    const request = get().instructionsRequest();
    if (!request || request.comments.length === 0) return;
    await get().copyText(await api.instructions(request));
  },

  async copyText(text) {
    await writeText(text);
    set({ copied: true });
  },

  setCopied(copied) {
    set({ copied });
  },

  async retrySave() {
    const opening = get().opening;
    if (!opening) return;
    const root = opening.checkout.root;
    if (savings.get(root)?.last !== null) {
      await save(root, { comments: get().comments, note: get().note });
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
    set({ comments, note: get().note || saved.review.note, saveProblem: null });
    await get().reload();
  },
}));

/** Typing pauses this long before the note is saved; comments save at once. */
const NOTE_SAVE_DELAY_MS = 300;

/** How saving stands for one working tree. */
type Saving = {
  /** JSON of the review last saved or read; null while it could not be read, which stops saving. */
  last: string | null;
  /** Saves run one after another, so an older one never lands after a newer. */
  queue: Promise<void>;
  /** A note save waiting for typing to pause. */
  note?: ReturnType<typeof setTimeout>;
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
    return { review: { comments: [], note: "" }, problem: describe(error) };
  }
}

/** Keeps `review` for `root` unless it is what was last kept, reporting failure while `root` is open. */
function save(root: string, review: SavedReview): Promise<void> {
  const saving = savings.get(root);
  if (!saving || saving.last === null) return Promise.resolve();
  clearTimeout(saving.note);
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

// Saves the open checkout's review when its comments or note change (ADR
// 0004 §4); `open` sets the checkout and its saved review together, so
// opening is never seen as a change.
useStore.subscribe((now, before) => {
  const opening = now.opening;
  if (!opening || opening !== before.opening) return;
  if (now.comments === before.comments && now.note === before.note) return;
  const root = opening.checkout.root;
  const review = { comments: now.comments, note: now.note };
  if (now.comments !== before.comments) {
    void save(root, review);
    return;
  }
  const saving = savings.get(root);
  if (!saving) return;
  clearTimeout(saving.note);
  saving.note = setTimeout(() => void save(root, review), NOTE_SAVE_DELAY_MS);
});
