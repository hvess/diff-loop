// The window's state and everything that changes it.
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { create } from "zustand";
import { api, describe, isOpenElsewhere } from "./api";
import type { Base } from "./bindings/Base";
import type { BaseChoices } from "./bindings/BaseChoices";
import type { Comment } from "./bindings/Comment";
import type { FileDiff } from "./bindings/FileDiff";
import type { GoneReview } from "./bindings/GoneReview";
import type { Head } from "./bindings/Head";
import type { InstructionsRequest } from "./bindings/InstructionsRequest";
import type { KeptReview } from "./bindings/KeptReview";
import type { Opening } from "./bindings/Opening";
import type { Place } from "./bindings/Place";
import type { Resumed } from "./bindings/Resumed";
import type { Review } from "./bindings/Review";
import type { ReviewKey } from "./bindings/ReviewKey";
import type { Round } from "./bindings/Round";
import type { SavedReview } from "./bindings/SavedReview";
import type { Seen } from "./bindings/Seen";
import type { Snapshot } from "./bindings/Snapshot";
import type { Side } from "./bindings/Side";
import type { Target } from "./bindings/Target";
import { awaitsReviewer, changed, hasCard, open as isOpen, resolvable } from "./lifecycle";
import { dedent } from "./indent";
import { shortId } from "./format";
import { idOf, sameKey } from "./key";
import { whereIs } from "./path";
import { changedLines, type Expanded, type Gap, gapsOf, lastLine, linesOn, withinHunk } from "./rows";
import { loadRecent, type Recent, rememberOpened } from "./recent";
import { clampWidth, loadWidth, rememberWidth } from "./sidebar";
import type { Check } from "./switcher";
import { folderKeys, keptOrder, type TreeRow, treeRows } from "./tree";

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
  /** Files in sidebar order: as `tree` nests them. */
  order: FileDiff[];
  /** Path → index in `order`. */
  position: Map<string, number>;
};

export type Composer = {
  path: string;
  target: Target;
  text: string;
  /** Replacement code while "Suggest Change" is on. */
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

/** Lines as "Suggest Change" starts from them: without their shared indent (diff-loop-app.md Decision 26). */
export function suggestable(code: string[]): string {
  return dedent(code).join("\n");
}

/** A comment's text, or what it is when it is only suggested code. */
export function commentText(c: Comment): string {
  return c.text === "" && c.suggestion !== null ? "Suggested change" : c.text;
}

export type Selection = { path: string; side: Side; anchor: number; head: number; dragging: boolean };

/**
 * What a banner offers: a base to compare with instead (the commit before the branch
 * moved, or the uncommitted changes after a follow), or another review to open.
 */
export type BannerAction = { label: string } & ({ kind: "base"; base: Base } | { kind: "review"; key: ReviewKey });

/**
 * The context of the review changed, or says why it is limited: a moved, rewritten or
 * switched branch, a branch moved while away, a detached `HEAD` (ADR 0015 §10, ADR 0026).
 * `body` says more, where the title alone does not.
 */
export type Banner = { title: string; body: string | null; action: BannerAction | null };

/** A round the base follows: its number, and the full id of the commit it was sent on. */
export type Following = { round: number; since: string };

/** The comments N / P step through: every one with a card, or only those a round strip count names (sent ones judged changed or untouched, or any the agent resolved). */
export type CommentFilter = "changed" | "untouched" | "byAgent" | null;

type Undo = { label: string; comments: Comment[] };

type State = {
  opening: Opening | null;
  /** The review shown: the branch's, kept under this key; null on a detached `HEAD`, where none is (ADR 0026 §5). */
  key: ReviewKey | null;
  /** The base the reviewer chose for this review, kept with it; null until they choose one (ADR 0026 §2). */
  keptBase: Base | null;
  /** Where the branch was when the review was last shown, kept with it (ADR 0026 §4). */
  seen: Seen | null;
  /** Whether the branch switcher is open (ADR 0035). */
  switcher: boolean;
  /**
   * Every review kept, as last read (null before), and each project's last check, absent until
   * its first answers: what the switcher lists.
   */
  reviews: { kept: KeptReview[] | null; checks: Map<string, Check> };
  /** Reviews deleted with their branch since the switcher last said so (ADR 0026 §6). */
  gone: GoneReview[];
  /** The review just picked is open in another window, said at the top of the switcher (ADR 0026 §9). */
  elsewhere: Problem | null;
  /** The first comment just started this review: the title bar says where to find it again (the design's 6e). */
  reviewSaved: boolean;
  /** The user's home folder, which paths name as `~`; null until known. */
  home: string | null;
  /** The projects most recently opened, newest first, which the welcome screen lists (ADR 0033). */
  recentProjects: Recent[];
  openProblem: (Problem & { path: string }) | null;
  busy: boolean;
  /** Whether the checkout is watched; when not, App polls instead. */
  watching: boolean;
  choices: BaseChoices;
  base: Base;
  review: LoadedReview | null;
  /** The reviews last shown, by review and base (`recentKey`), oldest first, at most `RECENT`; nothing renders them. */
  recent: Map<string, LoadedReview>;
  loading: boolean;
  /** A check asked for while loading, run when the load ends: a full read once ⌘/Ctrl-R asked for one. */
  recheck: "changes" | "everything" | null;
  /** The next load is the one that opens the checkout: only it may follow a commit made while closed (ADR 0021 §1). */
  opensCheckout: boolean;
  /**
   * The round the base follows, compared with the commit it was sent on (ADR 0017 §2); reset when
   * a checkout opens, and null once another base is chosen, the branch is switched or rewritten,
   * or the core names the round no more (ADR 0022).
   */
  following: Following | null;
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
  /** What Filter Files holds: the sidebar's tree shows only the paths containing it (diff-loop-app.md Decision 35). */
  fileFilter: string;
  /** Whether the comments list is open. */
  commentList: boolean;
  /** Whether the base picker is open. */
  basePicker: boolean;
  /** Whether the preview of the instructions is open. */
  preview: boolean;
  banner: Banner | null;
  /** The last copy, with the round it sent; null once it is no longer shown. */
  copied: { round: number | null } | null;
  /** The review before the last copy, offered as "Not Sent" until the next load changes something. */
  unsend: SavedReview | null;
  /** Why the last Copy Review failed, if it did. */
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
  /** Shows the review kept under `key`, wherever its branch is (ADR 0026 §3); `switched` names the worktree it left, and what that has checked out now. */
  openReview: (key: ReviewKey, switched?: { worktree: string; head: Head; now: ReviewKey | null }) => Promise<void>;
  closeRepository: () => void;
  /** Shows the review picked in the switcher, or a branch to look at, and closes it unless another window has it. */
  pickReview: (key: ReviewKey) => Promise<void>;
  setSwitcher: (open: boolean) => void;
  /** Reads every review kept, then checks each project, the shown one first; finds deleted branches (ADR 0026 §6, §7). */
  refreshReviews: () => Promise<void>;
  dismissGone: () => void;
  dismissElsewhere: () => void;
  dismissReviewSaved: () => void;
  setHome: (home: string) => void;
  setBase: (base: Base) => Promise<void>;
  /** The reviewer chose `base`: it is compared with, and kept with the review (ADR 0026 §2). */
  chooseBase: (base: Base) => Promise<void>;
  /** Reads the branches, tags and default branch again. */
  refreshChoices: () => void;
  /** Loads the review again; `full` reads everything, even what a running watch saw untouched (ADR 0014 §1). */
  reload: (full?: boolean) => Promise<void>;
  poll: () => Promise<void>;
  /** Takes in the marks the agent left in the review's file (ADR 0032 §4). */
  takeAgentMarks: () => Promise<void>;
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
  setFileFilter: (filter: string) => void;
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

/** The banner's title for `HEAD` moved on by `count` commits (`ux` skill, "Settled wording"). */
function moved(count: number): string {
  return `The branch moved: ${count} new ${count === 1 ? "commit" : "commits"}`;
}

/** The banner while the base follows a round: `count` commits since its commit, and the way back (ADR 0017 §2). */
function followBanner(count: number, following: Following): Banner {
  return {
    title: `${moved(count)} · showing changes since round ${following.round} (${shortId(following.since)})`,
    body: null,
    action: { kind: "base", label: "Show Uncommitted Changes", base: { kind: "uncommitted" } },
  };
}

/** The banner's offer to compare with the commit before the branch moved. */
function whatChanged(previous: string): BannerAction {
  return { kind: "base", label: "Show What Changed", base: { kind: "ref", name: previous } };
}

/** "Round 1 was" / "Rounds 1 and 2 were" / "Rounds 1, 2 and 3 were". */
function roundsWere(rounds: number[]): string {
  if (rounds.length === 1) return `Round ${rounds[0]} was`;
  return `Rounds ${rounds.slice(0, -1).join(", ")} and ${rounds.at(-1)} were`;
}

/**
 * The banner on showing a review again: its branch moved, or was rewritten, while it was not
 * shown (ADR 0026 §4; the design's flow 6f and 6g). Null when it is where it was.
 */
export function resumedBanner(branch: string, resumed: Resumed, now: string | null): Banner | null {
  const { since, dropped, review } = resumed;
  const anchored = review.comments.length > 0;
  switch (since.kind) {
    case "unchanged":
      return null;
    case "moved":
      return {
        title: `${branch} moved since you last looked`,
        body: `${since.count} new ${since.count === 1 ? "commit" : "commits"}, ${shortId(since.from)} → ${shortId(now)}.${anchored ? " Comments follow their code." : ""}`,
        action: whatChanged(since.from),
      };
    case "rewritten": {
      const gone = dropped.length === 0 ? "" : ` ${roundsWere(dropped)} sent on commits that are gone and ${dropped.length === 1 ? "was" : "were"} deleted.`;
      return {
        title: `${branch} was rewritten while you were away`,
        body: `A rebase or force-push replaced its history.${gone}${anchored ? " Comments follow their code where it still exists." : ""}`,
        action: whatChanged(since.from),
      };
    }
  }
}

/**
 * The banner once the worktree a review was live in checks out another branch, and the review
 * falls back to its branch's commits (ADR 0026 §3; the design's flow 6j). `head` is what the
 * worktree has now, `now` the review that shows, as the core keys it, and `home` lets it name the
 * worktree as the switcher's rows do.
 */
export function switchedBanner(key: ReviewKey, worktree: string, head: Head, now: ReviewKey | null, home: string | null): Banner {
  const where = whereIs(worktree, key.project, home);
  return {
    title:
      head.kind === "branch" ? `${where} now has ${head.name} checked out` : `${where} now has HEAD detached at ${head.commit}`,
    body: `${key.branch} isn’t checked out in any worktree. This review shows its committed changes only. Check it out in one to send its comments.`,
    action: head.kind === "branch" && now ? { kind: "review", label: `Open ${head.name}`, key: now } : null,
  };
}

/** The banner on a detached `HEAD`: no branch to keep a review for, so no comments (ADR 0026 §5; the design's flow 6l). */
function detachedBanner(commit: string): Banner {
  return {
    title: `HEAD is detached at ${commit}`,
    body: "With no branch there is nowhere to keep comments, so none can be written here. Check out a branch to comment.",
    action: null,
  };
}

/**
 * Whether there is a review to keep: comments or rounds. The core's `SavedReview::is_empty`
 * again, the seam ADR 0026's build chose, since the window asks it on every comment (ADR 0026 §2).
 */
export const holdsReview = (r: Pick<SavedReview, "comments" | "rounds">) => r.comments.length > 0 || r.rounds.length > 0;

/** The window's title: the project and branch shown, as another window's notice names them (ADR 0026 §9). */
export function windowTitle(s: Pick<State, "opening">): string {
  const checkout = s.opening?.checkout;
  if (!checkout) return "Diff Loop";
  const { head } = checkout;
  return `${checkout.name} · ${head.kind === "branch" ? head.name : `HEAD at ${head.commit}`}`;
}

/** Whether comments can be written: only on a branch, which has a review to keep them (ADR 0026 §5). */
export const canComment = (s: Pick<State, "key">) => s.key !== null;

/** Whether the window reads its diff live from a worktree, a detached `HEAD`'s included: the dot is solid. */
export const isLive = (s: Pick<State, "opening" | "review">) => ((s.review?.checkout ?? s.opening?.checkout)?.worktree ?? null) !== null;

/** Whether a copy can send a round: only to a worktree that has the branch checked out (ADR 0026 §3). */
export const canSend = (s: Pick<State, "key" | "opening" | "review">) => s.key !== null && isLive(s);

/** Why a copy cannot send a round, said beside Copy (the design's flow 6i); null when it can. */
export function whyNotSent(s: Pick<State, "key" | "opening" | "review">): string | null {
  if (canSend(s)) return null;
  return s.key
    ? `${s.key.branch} isn’t checked out in any worktree. Check it out in one to send its comments.`
    : "A detached HEAD has no review to send. Check out a branch to review it.";
}

/** The banner's detail: how many open comments the diff shown no longer holds (`ux` skill, "Settled wording"). */
export function bannerDetail(notInDiff: number): string {
  if (notInDiff === 0) return "";
  return `${notInDiff} ${notInDiff === 1 ? "comment is" : "comments are"} not in this diff.`;
}

/** Whether `c` is one `filter` names: a sent comment judged changed, or untouched; or any comment the agent resolved, sent or not. */
export function inFilter(c: Comment, filter: CommentFilter): boolean {
  if (filter === null) return true;
  // What the agent resolved waits on the reviewer, sent or not (ADR 0032 §2).
  if (filter === "byAgent") return awaitsReviewer(c);
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

/** The files the arrows and J / K step through: those Filter Files keeps (diff-loop-app.md Decision 35). */
function steppable(review: LoadedReview, fileFilter: string): { files: FileDiff[]; position: Map<string, number> } {
  return fileFilter.trim() === "" ? { files: review.order, position: review.position } : keptOrder(review.order, fileFilter);
}

/** The preview's edit, if one is kept for the review `key` names; the one rule the preview and Copy Review share. */
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
  key: null,
  keptBase: null,
  seen: null,
  switcher: false,
  reviews: { kept: null, checks: new Map() },
  gone: [],
  elsewhere: null,
  reviewSaved: false,
  home: null,
  recentProjects: loadRecent(),
  openProblem: null,
  busy: false,
  watching: false,
  choices: { refs: [], defaultBranch: null },
  base: { kind: "uncommitted" },
  review: null,
  recent: new Map(),
  loading: false,
  recheck: null,
  opensCheckout: false,
  following: null,
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
  fileFilter: "",
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
      await show(await api.openRepository(path), null);
    } catch (error) {
      set({ openProblem: { ...describe(error), path } });
    } finally {
      set({ busy: false });
    }
  },

  async openReview(key, switched) {
    set({ busy: true, elsewhere: null });
    // A failure is this one's to say only while nothing was shown since it began.
    const began = shown;
    // Read while the checkout opens: the review shown is kept under `key`.
    const saved = readSaved(key);
    try {
      const opening = await api.openReview(key);
      // Live in another worktree, the review just moved there: only a fall back to its commits is said.
      const fellBack = switched && opening.checkout.worktree === null ? switchedBanner(key, switched.worktree, switched.head, switched.now, get().home) : null;
      await show(opening, fellBack, sameKey(opening.key, key) ? saved : null);
    } catch (error) {
      if (shown !== began) return;
      // The review on screen stays: its context failed to change, or another window shows the one asked
      // for, which the switcher says at its top when it was picked there (the design's 6m).
      if (isOpenElsewhere(error) && get().switcher) set({ elsewhere: describe(error) });
      else if (get().opening) set({ loadProblem: describe(error) });
      else set({ openProblem: { ...describe(error), path: key.project } });
    } finally {
      set({ busy: false });
    }
  },

  async pickReview(key) {
    if (!sameKey(key, get().key)) await get().openReview(key);
    if (!get().elsewhere) set({ switcher: false });
  },

  setSwitcher(open) {
    // What the switcher said once is said: deletions and another window's review go when it closes.
    set(open ? { switcher: true } : { switcher: false, gone: [], elsewhere: null });
    if (open) void get().refreshReviews();
  },

  refreshReviews() {
    // One at a time: a second would race the first, whose deletions it would then not see to say.
    refreshing ??= readReviews().finally(() => {
      refreshing = null;
    });
    return refreshing;

    async function readReviews() {
      const kept = await api.keptReviews().catch(() => null);
      if (kept === null) return;
      // The last checks stand until each project answers again, so a row keeps its place meanwhile.
      set({ reviews: { kept, checks: get().reviews.checks } });
      const here = get().opening?.checkout.project;
      const projects = new Set([...(here === undefined ? [] : [here]), ...kept.map((r) => r.key.project)]);
      await Promise.all(
        [...projects].map(async (project) => {
          const check: Check = await api.checkProject(project).catch(() => "failed" as const);
          const { reviews, gone, key } = get();
          const deleted = check === "failed" ? [] : check.gone;
          // The window's own review, its branch gone, is not saved again under it.
          if (key && deleted.some((g) => sameKey(g.key, key))) savings.delete(idOf(key));
          set({
            reviews: {
              kept: (reviews.kept ?? []).filter((r) => !deleted.some((g) => sameKey(g.key, r.key))),
              checks: new Map(reviews.checks).set(project, check),
            },
            gone: [...gone, ...deleted],
          });
        }),
      );
    }
  },

  dismissGone() {
    set({ gone: [] });
  },

  dismissElsewhere() {
    set({ elsewhere: null });
  },

  dismissReviewSaved() {
    set({ reviewSaved: false });
  },

  setHome(home) {
    set({ home });
  },

  closeRepository() {
    void api.closeRepository().catch(() => {});
    // The lists, dialogs and copy failure are the review screen's, which goes with the checkout.
    set({
      opening: null,
      key: null,
      keptBase: null,
      seen: null,
      review: null,
      comments: [],
      rounds: [],
      composer: null,
      selection: null,
      replacing: null,
      commentFilter: null,
      fileFilter: "",
      commentList: false,
      basePicker: false,
      preview: false,
      copied: null,
      unsend: null,
      copyProblem: null,
    });
  },

  async chooseBase(base) {
    set({ keptBase: base });
    await get().setBase(base);
  },

  async setBase(base) {
    const following = get().following;
    const stillFollowing = following !== null && sameBase(base, { kind: "ref", name: following.since });
    // Expanded lines were read from the old base's snapshot.
    set({ base, banner: null, expanded: new Map(), following: stillFollowing ? following : null });
    await get().reload();
  },

  refreshChoices() {
    const opening = get().opening;
    api.baseChoices().then(
      // The same refs keep the same object, so the picker groups them again only when they changed.
      (choices) => get().opening === opening && JSON.stringify(choices) !== JSON.stringify(get().choices) && set({ choices }),
      () => {},
    );
  },

  async reload(full = false) {
    const { base, review: before, opensCheckout, opening } = get();
    set({ loading: true, opensCheckout: false });
    try {
      const held = before && sameBase(before.base, base) ? before : null;
      const sent = get().comments;
      const key = get().key;
      // A review shown before against this base names the files it holds, so only what changed is sent.
      const review = await fetchReview(base, sent, held ?? recentOf(get().recent, key, base), full);
      if (!sameBase(get().base, base) || get().opening !== opening) return;
      const { worktree, head } = review.checkout;
      const shows = review.key;
      if (worktree !== null && !sameKey(shows, key)) {
        // The worktree checked out something else, which is another review: this one goes
        // where its branch is now, or to its commits (ADR 0026 §3).
        if (key) void get().openReview(key, { worktree, head, now: shows });
        else if (shows) void get().openReview(shows);
        return;
      }
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
      const recent = remembered(get().recent, key, review);
      set({ review, comments, autoResolved, viewed, viewedLines, expanded, selected, openComment, loadProblem: null, unsend: null, copied, closed, recent });
      // Where the branch was last seen goes with the review, so a return can say what moved (ADR 0026 §4).
      const commit = review.checkout.commit;
      const seen = get().seen;
      if (get().key && commit !== null && commit !== seen?.commit) set({ seen: { commit, at: seen?.at ?? Date.now() } });
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
      const stillHere = () => sameBase(get().base, base) && get().opening === opening;
      const now = after.checkout.commit;
      if (!before) {
        if (opensCheckout) await followSinceOpened(now, after.checkout.head, stillHere);
        return;
      }
      const previous = before.checkout.commit;
      if (!previous || !now || previous === now) return;
      // A branch switched in the worktree is another review (`reload`), so here the branch is the same.
      const headNow = after.checkout.head;
      const count = await api.commitsBetween(previous, now).catch(() => null);
      // The reviewer may have picked another base, or review, meanwhile.
      if (!stillHere()) return;
      // A rewritten branch ends any follow (ADR 0022 §2).
      if (count === null) {
        set({ banner: { title: "The branch was rewritten", body: null, action: whatChanged(previous) }, following: null });
        return;
      }
      const title = moved(count);
      const following = get().following;
      if (sameBaseBefore && following && sameBase(base, { kind: "ref", name: following.since })) {
        await keepFollowing(following, title, previous, now, headNow, stillHere);
        return;
      }
      // A follow starts only on the uncommitted changes, and not on a base the reviewer has just
      // chosen: they stay on it (ADR 0017 §2, ADR 0022 §3).
      const fromUncommitted = sameBaseBefore && base.kind === "uncommitted";
      if (fromUncommitted && (await followCommit(count, previous, headNow, stillHere))) return;
      if (stillHere()) set({ banner: { title, body: null, action: whatChanged(previous) } });
    }

    /**
     * A later commit while the base follows a round: the banner keeps saying so, counted from the
     * round's commit, while the core still names the round; otherwise the follow ends
     * (ADR 0022).
     */
    async function keepFollowing(following: Following, title: string, previous: string, now: string, head: Head, stillHere: () => boolean) {
      const since = await api.commitsBetween(following.since, now).catch(() => null);
      const round =
        since === null ? null : await api.roundToFollow(get().comments, { base, head }, following.since).catch(() => null);
      if (!stillHere()) return;
      if (since === null) {
        // The round's commit no longer under `HEAD`: rewritten away.
        set({ banner: { title: "The branch was rewritten", body: null, action: whatChanged(previous) }, following: null });
      } else if (round === null) {
        set({ banner: { title, body: null, action: whatChanged(previous) }, following: null });
      } else {
        const kept = { round, since: following.since };
        set({ banner: followBanner(since, kept), following: kept });
      }
    }

    /**
     * Opened after a commit made on top of the newest round while the window was closed: that round's
     * commit stands in for the load before, and it is followed as a move seen open would be
     * (ADR 0021 §1). Nothing is said otherwise: the first load has no context to have changed.
     */
    async function followSinceOpened(now: string | null, head: Head, stillHere: () => boolean) {
      const previous = get().rounds.at(-1)?.commit;
      if (!previous || !now || previous === now) return;
      const count = await api.commitsBetween(previous, now).catch(() => null);
      if (count === null || !stillHere()) return;
      await followCommit(count, previous, head, stillHere);
    }

    /**
     * A commit on top of a round sent against the uncommitted changes: compared with the commit it
     * was sent on, the round's comments are judged again (ADR 0017 §2). Whether the core named one to follow.
     */
    async function followCommit(count: number, previous: string, head: Head, stillHere: () => boolean): Promise<boolean> {
      const round = await api.roundToFollow(get().comments, { base, head }, previous).catch(() => null);
      if (round === null || !stillHere()) return false;
      const since: Base = { kind: "ref", name: previous };
      await get().setBase(since);
      // The reviewer may have picked another base while it loaded, or it may have failed.
      if (!sameBase(get().base, since) || get().loadProblem) return true;
      const following = { round, since: previous };
      set({ following, banner: followBanner(count, following) });
      return true;
    }
  },

  async takeAgentMarks() {
    const { key, opening } = get();
    if (!key || !opening) return;
    // An answer for a review no longer shown is not this one's.
    const stillShown = () => get().opening === opening && sameKey(get().key, key);
    const saved = await api.savedReview(key).catch(() => null);
    if (!saved || !stillShown()) return;
    // A loop, not a chain: comments changed while the core merged would be lost to its answer, so it merges again onto them.
    for (;;) {
      const before = get().comments;
      const marked = await api.keepAgentMarks(keptOf(get()), saved);
      if (!stillShown()) return;
      if (get().comments !== before) continue;
      if (JSON.stringify(marked.comments) !== JSON.stringify(before)) set({ comments: marked.comments });
      return;
    }
  },

  async poll() {
    const { review, loading, base, opening, watching, key } = get();
    if (!opening) return;
    // A watch event during the first load: what it touched waits in Rust for the next.
    if (!review) {
      if (loading && get().recheck === null) set({ recheck: "changes" });
      return;
    }
    // Shown from its commits, a branch checked out since is live there (ADR 0026 §3); a watch
    // sees the worktree's `HEAD` change, as polling the fingerprint would not.
    if (key && review.checkout.worktree === null) {
      const worktree = await api.worktreeOf(key).catch(() => null);
      if (worktree !== null && get().opening === opening) {
        await get().openReview(key);
        return;
      }
    }
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
    const { review, selected, fileFilter } = get();
    if (!review) return;
    const { files, position } = steppable(review, fileFilter);
    const at = selected === null ? -1 : (position.get(selected) ?? -1);
    const next = files[Math.min(files.length - 1, Math.max(0, at + step))];
    if (next && next.path !== selected) get().select(next.path);
  },

  stepUnviewed(step) {
    const { review, selected, viewed, fileFilter } = get();
    if (!review) return;
    const { files: order, position } = steppable(review, fileFilter);
    const at = selected === null ? -1 : (position.get(selected) ?? -1);
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
    if (!file || !canComment(get())) return;
    end = withinHunk(file, side, start, end);
    const code = linesOn(file, side, start, end);
    set({
      composer: { path, target: { kind: "lines", side, start, code }, text: "", suggestion: null, editing: null },
      selection: { path, side, anchor: start, head: end, dragging: false },
      openComment: null,
    });
  },

  composeOnFile(path) {
    if (!canComment(get())) return;
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
      ? get().comments.map((c) => (c.id === composer.editing ? { ...c, ...written, ...reopenedMark(c, written) } : c))
      : [
          ...get().comments,
          { id: crypto.randomUUID(), path: composer.path, ...written, state: "current" as const, place, sent: null, resolved: null, note: null },
        ];
    // The first comment starts the review (ADR 0026 §2): the title bar says where it is kept.
    const starts = !composer.editing && !holdsReview(get());
    // A comment written or edited moves the review on: the last copy's popover and its "Not Sent" go with it.
    set({ comments, composer: null, selection: null, copied: null, unsend: null, reviewSaved: starts || get().reviewSaved });
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
    // R accepts what the agent resolved (ADR 0032 §2); otherwise it toggles.
    const resolved = c.resolved === null || awaitsReviewer(c) ? "byReviewer" as const : null;
    set({
      // Unresolved, it is the reviewer's again: the agent's note no longer answers it.
      comments: get().comments.map((x) => (x.id === id ? { ...x, resolved, ...(resolved ? {} : { note: null }) } : x)),
      // Resolved, it has no card to stay open; R again unresolves it and opens the card (ADR 0015 §4).
      openComment: resolved && get().openComment === id ? null : get().openComment,
      lastResolved: resolved ? id : null,
      // A resolve moves the review on, as writing does: "Not Sent" would drop it (ADR 0015 §1).
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

  setFileFilter(filter) {
    set({ fileFilter: filter });
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
    if (!action) return;
    if (action.kind === "base") await get().setBase(action.base);
    else await get().openReview(action.key);
  },

  instructionsRequest() {
    return requestOf(get());
  },

  async copyReview() {
    const request = get().instructionsRequest();
    if (!request || !request.comments.some(isOpen) || !canSend(get())) return;
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
    if (!canSend(get())) return;
    await writeText(text);
    const { review, comments, opening } = get();
    const place = placeOf(get());
    const before = keptOf(get());
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
    const { opening, key } = get();
    if (!opening || !key) return;
    if (savings.get(idOf(key))?.last !== null) {
      await save(key, keptOf(get()));
      return;
    }
    const saved = await readSaved(key);
    if (get().opening !== opening || saved.problem) {
      if (get().opening === opening) set({ saveProblem: saved.problem });
      return;
    }
    // Rounds copied meanwhile counted from 1 again: the core counts them on from the saved ones.
    const merged = await api.mergeReviews(keptOf(get()), saved.review);
    if (get().opening !== opening) return;
    set({ comments: merged.comments, rounds: merged.rounds, keptBase: merged.base, seen: merged.seen, saveProblem: null });
    await get().reload();
  },
}));

/** What editing `c` into `written` does to a mark the agent left: a changed comment is open again (ADR 0032 §2). */
function reopenedMark(c: Comment, written: Pick<Comment, "text" | "suggestion">): Partial<Comment> {
  const edited = written.text !== c.text || written.suggestion !== c.suggestion;
  return awaitsReviewer(c) && edited ? { resolved: null, note: null } : {};
}

/** The review as kept: what the window holds of it. */
function keptOf(s: Pick<State, "comments" | "rounds" | "keptBase" | "seen">): SavedReview {
  return { comments: s.comments, rounds: s.rounds, base: s.keptBase, seen: s.seen };
}

const NOTHING_KEPT: SavedReview = { comments: [], rounds: [], base: null, seen: null };

/** Counts calls to `show`, so only the latest sets what it read. */
let shown = 0;

/** How many reviews `recent` keeps. */
const RECENT = 4;

const recentKey = (key: ReviewKey, base: Base) => `${idOf(key)}\u0000${JSON.stringify(base)}`;

/** The review last shown under `key` against `base`, whose files a load need not send again. */
function recentOf(recent: State["recent"], key: ReviewKey | null, base: Base): LoadedReview | null {
  return key ? (recent.get(recentKey(key, base)) ?? null) : null;
}

/** `recent` with `review` as the latest shown under `key`, the oldest dropped past `RECENT`. */
function remembered(recent: State["recent"], key: ReviewKey | null, review: LoadedReview): State["recent"] {
  if (!key) return recent;
  const at = recentKey(key, review.base);
  const kept = new Map([...recent].filter(([k]) => k !== at)).set(at, review);
  const oldest = kept.keys().next().value;
  if (kept.size > RECENT && oldest !== undefined) kept.delete(oldest);
  return kept;
}

/** The `refreshReviews` running, which another call joins. */
let refreshing: Promise<void> | null = null;

/**
 * Shows `opening`'s review: read, resumed where its branch went meanwhile (ADR 0026 §4), and set
 * with the checkout, so showing it is not a change to save; then watched and loaded. `banner`
 * says what changed under it, when something did; else resuming may say where the branch went.
 * `read` is its saved review, when reading it began already.
 */
async function show(opening: Opening, banner: Banner | null, read: ReturnType<typeof readSaved> | null = null): Promise<void> {
  const { getState: get, setState: set } = useStore;
  const at = ++shown;
  const { key } = opening;
  const { head, commit } = opening.checkout;
  let review = NOTHING_KEPT;
  let problem: Problem | null = null;
  let base = opening.base;
  let said = banner ?? (head.kind === "detached" ? detachedBanner(head.commit) : null);
  if (key) {
    // Read before the checkout shows, and set with it: loading is not a change
    // to save. Before the first load, so it moves the comments onto their code.
    const saved = await (read ?? readSaved(key));
    // Resuming reads git; if it cannot, the review shows as kept, and the load says what failed.
    const resumed = await api.resumeReview(saved.review, opening.checkout, opening.base, Date.now()).catch(() => null);
    review = resumed?.review ?? saved.review;
    problem = saved.problem;
    base = resumed?.base ?? opening.base;
    said ??= resumed && resumedBanner(key.branch, resumed, commit);
  }
  // Another checkout was opened meanwhile: the session holds it, and its show is the one to set.
  if (at !== shown) return;
  set({
    opening,
    key,
    reviewSaved: false,
    keptBase: review.base,
    seen: review.seen,
    // However it was opened, the switcher ⌘/Ctrl-K may have left on is not the new review's.
    switcher: false,
    choices: opening.choices,
    base,
    review: null,
    comments: review.comments,
    rounds: review.rounds,
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
    fileFilter: "",
    commentList: false,
    basePicker: false,
    preview: false,
    copyProblem: null,
    banner: said,
    copied: null,
    unsend: null,
    undo: null,
    find: null,
    previewEdit: null,
    saveProblem: problem,
    closed: new Set(),
    opensCheckout: true,
    following: null,
    recentProjects: rememberOpened(opening.checkout, Date.now()),
  });
  // What resuming changed is kept: where the branch is now, and the rounds a rewrite took with it.
  if (key) void save(key, keptOf(get()));
  // Watched first, so the first load is the one a watch event brings up to date: a watch
  // started after it drops it, and the next event reads everything again (ADR 0029 §1).
  const watching = await api.watchRepository().catch(() => false);
  if (key) void api.watchReview().catch(() => false);
  // Only the answer for the checkout still open counts: a slow answer
  // for one opened before must not stop the fallback polling.
  const stillOpen = () => get().opening === opening;
  if (!stillOpen()) return;
  set({ watching });
  await get().reload();
}

/** How saving stands for one review. */
type Saving = {
  /** JSON of the review last saved or read; null while it could not be read, which stops saving. */
  last: string | null;
  /** Whether the store holds the review: a review never kept, and still empty, is not written (ADR 0026 §2). */
  held: boolean;
  /** Saves run one after another, so an older one never lands after a newer. */
  queue: Promise<void>;
};

/** By review (`idOf`), for each one shown in this window. */
const savings = new Map<string, Saving>();


/** The review saved under `key`, recorded as its last; empty with the problem when it cannot be read. */
async function readSaved(key: ReviewKey): Promise<{ review: SavedReview; problem: Problem | null }> {
  const saving = savings.get(idOf(key)) ?? { last: null, held: false, queue: Promise.resolve() };
  savings.set(idOf(key), saving);
  try {
    const review = await api.savedReview(key);
    saving.last = JSON.stringify(review);
    saving.held = holdsReview(review);
    return { review, problem: null };
  } catch (error) {
    // Saving stays stopped: writing now would replace a review never read.
    saving.last = null;
    return { review: NOTHING_KEPT, problem: describe(error) };
  }
}

/** Keeps `review` under `key` unless it is what was last kept, reporting failure while it is shown. */
function save(key: ReviewKey, review: SavedReview): Promise<void> {
  const saving = savings.get(idOf(key));
  if (!saving || saving.last === null) return Promise.resolve();
  saving.queue = saving.queue.then(async () => {
    const json = JSON.stringify(review);
    if (json === saving.last) return;
    // A branch looked at and never commented on leaves nothing behind.
    if (!saving.held && !holdsReview(review)) {
      saving.last = json;
      return;
    }
    const stillShown = () => sameKey(useStore.getState().key, key);
    try {
      await api.saveReview(key, review);
      saving.last = json;
      saving.held = holdsReview(review);
      if (stillShown()) useStore.setState({ saveProblem: null });
    } catch (error) {
      if (stillShown()) useStore.setState({ saveProblem: describe(error) });
    }
  });
  return saving.queue;
}

// Saves the review shown when its comments, rounds, base or seen commit change (ADR 0004 §4,
// ADR 0026 §2); `show` sets the checkout and its saved review together, so showing
// one is never seen as a change.
useStore.subscribe((now, before) => {
  const { key, opening } = now;
  if (!key || !opening || opening !== before.opening) return;
  const same =
    now.comments === before.comments && now.rounds === before.rounds && now.keptBase === before.keptBase && now.seen === before.seen;
  if (!same) void save(key, keptOf(now));
});
