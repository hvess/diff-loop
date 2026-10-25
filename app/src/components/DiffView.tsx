import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { Comment } from "../bindings/Comment";
import type { FileDiff } from "../bindings/FileDiff";
import type { Side } from "../bindings/Side";
import { showMenu } from "../contextMenu";
import { changeStarts, lineAfter, lineRows, nextIn, startRow } from "../cursor";
import { useDelayed } from "../delay";
import { findTyped, type Mark, type Match, marked } from "../find";
import { useHighlights, type Highlights, type Token } from "../highlight";
import { isLineCommand, type LineCommand } from "../keys";
import { awaitsReviewer, changed, hasCard, markOf, toneOf } from "../lifecycle";
import { shownNote } from "../note";
import { nameOf } from "../path";
import { bindingFor } from "../platform";
import { type Cell, type Expanded, gutterLine, type HunkRow, lastLine, lineKey, splitRows, unifiedRows, withinHunk } from "../rows";
import { canComment, orderedComments, type Selection, useStore } from "../store";
import { baseLabel } from "./BasePicker";
import { CommentCard } from "./CommentCard";
import { Composer, targetLabel } from "./Composer";
import { FindBar } from "./FindBar";
import { Sym } from "./Icon";
import { AgentNote } from "./AgentNote";

/** The diff's own keys (keys.ts `LINE_COMMANDS`): what each moves, and which way. */
const LINE_KEYS: Record<LineCommand, { move: "line" | "extend" | "change"; step: 1 | -1 }> = {
  lineDown: { move: "line", step: 1 },
  lineUp: { move: "line", step: -1 },
  extendDown: { move: "extend", step: 1 },
  extendUp: { move: "extend", step: -1 },
  nextChange: { move: "change", step: 1 },
  previousChange: { move: "change", step: -1 },
};

/**
 * The canvas's measures (ADR 0027): a row, a fold, the rows' padding under a fold and above the next, Split's
 * column heads. Each is whole, so rows never land between pixels; a fold's hairlines are inset shadows.
 */
const ROW = 18;
const FOLD = 32;
const PAD_TOP = 6;
const PAD_BOTTOM = 8;
const COLHEAD = 26;
/** A line number's width, `.row .o` and `.n`. */
const GUTTER_PX = 40;
/** A margin note's height, and the gap kept between two that would overlap. */
const NOTE = 24;
const NOTE_GAP = 4;
/** Split's collapsed note. */
const MARK = 20;
/** How far the popover hangs under its range: its arrow's height, so the tip meets the range's last line. */
const ARROW = 7;
/** The scroller's room under the last row for the floating bottom bar. */
const BAR_ROOM = 88;

/** A comment shown on its lines: a rail beside them, a note in the margin (the canvas's 3a). */
type Note = { comment: Comment; tone: "" | "sent" | "changed"; side: Side; start: number; end: number };

function useNotes(file: FileDiff): Note[] {
  const all = useStore((s) => s.comments);
  const review = useStore((s) => s.review);
  // The comment being edited is shown by its selection and the composer.
  const editing = useStore((s) => s.composer?.editing ?? null);
  return useMemo(
    () =>
      orderedComments(review, all)
        // Only a comment with a card: a lost, outdated or resolved one is not on its lines (ADR 0015).
        .filter((c) => c.path === file.path && c.target.kind === "lines" && hasCard(c) && c.id !== editing)
        .flatMap((c) => {
          if (c.target.kind !== "lines") return [];
          return [{ comment: c, tone: toneOf(c), side: c.target.side, start: c.target.start, end: lastLine(c.target) } satisfies Note];
        }),
    [all, review, editing, file.path],
  );
}

/** The composer's range while it is open on lines here: the first and last gutter rows drag either end. */
type Handles = { side: Side; top: number; bottom: number } | null;

function inRange(range: { side: Side; lo: number; hi: number } | null, cell: Cell | null): boolean {
  return range !== null && cell !== null && cell.side === range.side && cell.no >= range.lo && cell.no <= range.hi;
}

function selected(selection: Selection | null, path: string) {
  if (!selection || selection.path !== path) return null;
  return { side: selection.side, lo: Math.min(selection.anchor, selection.head), hi: Math.max(selection.anchor, selection.head) };
}

export function DiffView({ file }: { file: FileDiff }) {
  const mode = useStore((s) => s.mode);
  const selection = useStore((s) => s.selection);
  const composer = useStore((s) => s.composer);
  const openComment = useStore((s) => s.openComment);
  const expanded = useStore((s) => s.expanded.get(file.path)?.gaps);
  const highlights = useHighlights(file, expanded);
  const notes = useNotes(file);
  const [hovered, setHovered] = useState<string | null>(null);
  const rows = useMemo(() => (mode === "unified" ? unifiedRows(file, expanded) : splitRows(file, expanded)), [file, mode, expanded]);
  // Side and line number → row, so N / P, notes and the popover find a line's row without a scan.
  const rowOf = useMemo(() => {
    const index = new Map<string, number>();
    rows.forEach((row, i) => {
      if (row.kind === "hunk") return;
      for (const cell of [row.old, row.new]) if (cell) index.set(lineKey(cell.side, cell.no), i);
    });
    return index;
  }, [rows]);
  /** What a row draws above its line or fold: the padding, hairlines and Split's column heads around folds. */
  const lead = useCallback(
    (i: number) => {
      const row = rows[i]!;
      const heads = mode === "split" && i === 0 ? COLHEAD : 0;
      if (row.kind === "hunk") return i === 0 ? 0 : PAD_BOTTOM;
      return i === 0 ? heads + PAD_TOP : 0;
    },
    [rows, mode],
  );
  const scroller = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: (i) => {
      const row = rows[i]!;
      if (row.kind !== "hunk") return lead(i) + ROW;
      const heads = mode === "split" && i === 0 ? COLHEAD : 0;
      return lead(i) + FOLD + (i === rows.length - 1 ? 0 : heads + PAD_TOP);
    },
    // Measured heights follow the row, not its position, when the diff changes.
    getItemKey: (i) => rows[i]!.key,
    paddingEnd: rows.at(-1)?.kind === "hunk" ? 0 : PAD_BOTTOM,
    overscan: 30,
  });

  // Find in file: matches in what the rows show, and which is current.
  const query = useDeferredValue(useStore((s) => s.find?.query ?? ""));
  // A whole read only for a new query: typing on narrows, Backspace reads nothing (`findTyped`).
  const matches = useMemo(() => findTyped(rows, query), [rows, query]);
  const step = useStore((s) => s.find?.step ?? 0);
  const current = matches.length === 0 ? -1 : ((step % matches.length) + matches.length) % matches.length;
  // Once per query: stepping only moves `currentMatch`, so it costs nothing per match.
  const found = useMemo(() => {
    const byCell = new Map<string, Mark[]>();
    for (const m of matches) {
      const list = byCell.get(m.cell) ?? [];
      list.push({ from: m.from, to: m.to, current: false });
      byCell.set(m.cell, list);
    }
    return byCell;
  }, [matches]);
  const currentMatch = current < 0 ? null : matches[current]!;
  const currentRow = currentMatch?.row ?? -1;
  // Scrolled to only when the reader steps or types; not when the rows change under find
  // (expanded lines, Unified and Split, a refresh), which would undo their scrolling.
  const asked = `${step}\u0000${query}`;
  const scrolledFor = useRef<string | null>(null);
  useEffect(() => {
    if (scrolledFor.current === asked) return;
    scrolledFor.current = asked;
    if (currentRow >= 0) virtual.scrollToIndex(currentRow, { align: "center" });
  }, [asked, currentRow, virtual]);

  /**
   * Whether an end of the range is being dragged: the selection follows the pointer down
   * the gutter, and the composer takes its lines once, on release.
   */
  const resizing = useRef(false);
  /** Ends a drag-selection or a range's drag; it reads only the store and `resizing`, so it never changes. */
  const finish = useCallback(() => {
    const s = useStore.getState();
    const sel = s.selection;
    if (resizing.current) {
      resizing.current = false;
      if (sel) s.resizeComposer(sel.anchor, sel.head);
      return;
    }
    if (!sel?.dragging) return;
    // Released, a drag opens the composer at once (diff-loop-app.md Decision 30).
    s.composeOnLines(sel.path, sel.side, Math.min(sel.anchor, sel.head), Math.max(sel.anchor, sel.head));
  }, []);
  useEffect(() => {
    window.addEventListener("mouseup", finish);
    return () => window.removeEventListener("mouseup", finish);
  }, [finish]);

  // Once per layout, so ↓ / ↑ and Alt-↓ / Alt-↑ find the next line or change in O(log rows).
  const lines = useMemo(() => lineRows(rows), [rows]);
  const changes = useMemo(() => changeStarts(rows), [rows]);

  // The diff's own keys (keys.ts): the line cursor and the next change, which need its rows and what is on screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // App.tsx's handler, which runs first, leaves these keys alone.
      const bound = bindingFor(e);
      if (!bound || !isLineCommand(bound.command)) return;
      const { move, step } = LINE_KEYS[bound.command];
      const s = useStore.getState();
      // A comment being written moves only by dragging its range, and a drag is the pointer's.
      if (s.composer || s.selection?.dragging) return;
      e.preventDefault();
      const sel = s.selection?.path === file.path ? s.selection : null;
      const open = s.comments.find((c) => c.id === s.openComment);
      // The cursor: the selection's moving end, else the open comment's last line.
      const cursor = sel
        ? { side: sel.side, no: sel.head }
        : open?.path === file.path && open.target.kind === "lines"
          ? { side: open.target.side, no: lastLine(open.target) }
          : null;
      const at = cursor ? rowOf.get(lineKey(cursor.side, cursor.no)) : undefined;
      const from = startRow(at, virtual.range, step, rows.length);
      const place = (target: ReturnType<typeof lineAfter>, align: "auto" | "center") => {
        if (!target) return;
        const { line } = target;
        s.setSelection({ path: file.path, side: line.side, anchor: line.no, head: line.no, dragging: false });
        if (s.openComment) s.toggleComment(null);
        virtual.scrollToIndex(target.row, { align });
      };
      if (move === "extend" && sel) {
        // Along the selection's side, inside its hunk (diff-loop-app.md Decision 6).
        const head = withinHunk(file, sel.side, sel.anchor, sel.head + step);
        const row = rowOf.get(lineKey(sel.side, head));
        if (head === sel.head || row === undefined) return;
        s.setSelection({ ...sel, head });
        virtual.scrollToIndex(row, { align: "auto" });
      } else if (move === "change") {
        const start = nextIn(changes, from, step);
        if (start !== null) place(lineAfter(rows, lines, start - 1, 1), "center");
      } else {
        place(lineAfter(rows, lines, from, step, cursor?.side), "auto");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [file, rows, rowOf, lines, changes, virtual]);

  // Bring a comment opened from elsewhere (N / P, the comments list) into view.
  useEffect(() => {
    const c = useStore.getState().comments.find((x) => x.id === openComment);
    if (!c || c.path !== file.path || c.target.kind !== "lines") return;
    const { side, start } = c.target;
    const index = rowOf.get(lineKey(side, start));
    if (index !== undefined) virtual.scrollToIndex(index, { align: "center" });
  }, [openComment, rowOf, file.path, virtual]);

  const pressNumber = (cell: Cell, shift: boolean) => {
    const s = useStore.getState();
    if (s.composer) return;
    // A lost draft being placed again takes the line pressed (ADR 0015 §2).
    if (s.replacing !== null) {
      s.placeComment(cell.side, cell.no);
      return;
    }
    // The keys go to the diff now: a focused button would take Return, the file list the arrows.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    const sel = s.selection;
    if (shift && sel && sel.path === file.path && sel.side === cell.side) {
      s.setSelection({ ...sel, head: withinHunk(file, cell.side, sel.anchor, cell.no), dragging: false });
      return;
    }
    s.setSelection({ path: file.path, side: cell.side, anchor: cell.no, head: cell.no, dragging: true });
    if (s.openComment) s.toggleComment(null);
  };
  const enterNumber = (cell: Cell, pressed: boolean) => {
    const s = useStore.getState();
    const sel = s.selection;
    // Placing a lost draft: the pointer shows where it would land.
    if (s.replacing !== null && !pressed) {
      if (sel?.head !== cell.no || sel.side !== cell.side) {
        s.setSelection({ path: file.path, side: cell.side, anchor: cell.no, head: cell.no, dragging: false });
      }
      return;
    }
    // Released outside the window, where no mouseup reaches it: the drag ends here.
    if (!pressed) {
      if (resizing.current || sel?.dragging) finish();
      return;
    }
    // A drag-selection, or an end of the range dragged: either way the head follows the pointer.
    if ((sel?.dragging || resizing.current) && sel?.path === file.path && sel.side === cell.side) {
      const head = withinHunk(file, cell.side, sel.anchor, cell.no);
      if (head !== sel.head) s.setSelection({ ...sel, head });
    }
  };
  const handles: Handles =
    composer?.path === file.path && composer.target.kind === "lines" && selection && !selection.dragging
      ? { side: selection.side, top: Math.min(selection.anchor, selection.head), bottom: Math.max(selection.anchor, selection.head) }
      : null;
  const pressHandle = (edge: "top" | "bottom") => {
    if (!handles) return;
    resizing.current = true;
    // The other end stays put: it is the anchor while this one moves.
    const [anchor, head] = edge === "top" ? [handles.bottom, handles.top] : [handles.top, handles.bottom];
    useStore.getState().setSelection({ path: file.path, side: handles.side, anchor, head, dragging: false });
  };
  // On a detached `HEAD` no line takes a comment: there is no review to keep it (ADR 0026 §5).
  const commentable = useStore(canComment);
  const sel = selected(selection, file.path);
  const hoveredNote = notes.find((n) => n.comment.id === hovered);
  const hl = hoveredNote ? { side: hoveredNote.side, lo: hoveredNote.start, hi: hoveredNote.end } : null;
  const gutter = { path: file.path, highlights, sel, hl, pressNumber, enterNumber, handles, pressHandle, found, currentMatch, commentable };

  // Where a line's row is drawn, from the virtualizer's measures (estimated until a row is drawn).
  const measures = virtual.measurementsCache;
  const top = (index: number) => (measures[index]?.start ?? 0) + lead(index);
  const bottom = (index: number) => measures[index]?.end ?? 0;
  const span = (side: Side, start: number, end: number) => {
    const first = rowOf.get(lineKey(side, start));
    const last = rowOf.get(lineKey(side, end));
    return first === undefined || last === undefined ? null : { top: top(first), bottom: bottom(last) };
  };
  const placed = placeNotes(notes, span, mode === "split" ? MARK : NOTE);

  const open = notes.find((n) => n.comment.id === openComment);
  const target = composer?.path === file.path && composer.target.kind === "lines" ? composer.target : null;
  const anchor = target ? span(target.side, target.start, lastLine(target)) : open ? span(open.side, open.start, open.end) : null;
  const total = virtual.getTotalSize();

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <FindBar count={matches.length} current={current} searched={query} />
      <div ref={scroller} className="code relative min-h-0 flex-1 overflow-auto" style={{ paddingBottom: BAR_ROOM }}>
        <section className="diff-card" aria-label={`Changes in ${nameOf(file.path)}`} style={{ height: total }}>
          <div className="relative h-full overflow-hidden rounded-[12px]">
            {virtual.getVirtualItems().map((item) => {
              const row = rows[item.index]!;
              const first = item.index === 0;
              const heads = mode === "split" && first ? <ColumnHeads /> : null;
              return (
                <div
                  key={row.key}
                  data-index={item.index}
                  ref={virtual.measureElement}
                  className="absolute left-0 w-full"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  {row.kind === "hunk" ? (
                    <>
                      {!first && <div style={{ height: PAD_BOTTOM }} />}
                      <Fold
                        row={row}
                        path={file.path}
                        state={expanded?.[row.key]}
                        above={!first}
                        below={item.index < rows.length - 1 && heads === null}
                      />
                      {item.index < rows.length - 1 && heads}
                      {item.index < rows.length - 1 && <div style={{ height: PAD_TOP }} />}
                    </>
                  ) : (
                    <>
                      {heads}
                      {first && <div style={{ height: PAD_TOP }} />}
                      {mode === "unified" ? (
                        <UnifiedLine old={row.old} new={row.new} {...gutter} />
                      ) : (
                        <div className={`srow ${inRange(hl, row.new) || inRange(hl, row.old) ? "hl" : ""}`}>
                          <SplitHalf cell={row.old} {...gutter} />
                          <SplitHalf cell={row.new} {...gutter} />
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
          {placed.map(({ note, rail }) => (
            <span
              key={`r${note.comment.id}`}
              aria-hidden
              className={`rail ${note.tone} ${hovered === note.comment.id ? "hov" : ""}`}
              style={{ top: rail.top + 2, height: rail.bottom - rail.top - 4, left: mode === "split" && note.side === "new" ? "calc(50% + 6px)" : undefined }}
            />
          ))}
          {placed.map(({ note, top: at }) => (
            <MarginNote
              key={`n${note.comment.id}`}
              note={note}
              top={at}
              collapsed={mode === "split"}
              hovered={hovered === note.comment.id}
              onHover={(on) => setHovered(on ? note.comment.id : null)}
            />
          ))}
          {anchor && (composer || open) && (
            <CommentPopover top={anchor.bottom + ARROW} left={mode === "split" && (target ?? open)?.side === "new" ? "calc(50% + 56px)" : 160} comment={target ? null : open!.comment} />
          )}
        </section>
      </div>
      {placed.length > 0 && total > 0 && (
        // As tall as the card while it fits, as the canvas's track is; else the pane above the bar.
        <div aria-hidden className="pointer-events-none absolute top-1.5 right-1 w-2" style={{ height: `min(${total - 12}px, 100% - ${BAR_ROOM + 12}px)` }}>
          <span className="track-y" style={{ top: 0, right: 0, bottom: 0 }} />
          {placed.map(({ note, rail }) => (
            <span key={note.comment.id} className={`tick ${note.tone}`} style={{ right: 0, top: `calc(${(rail.top / total) * 100}% - 1.5px)` }} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Each note beside the first of its lines, centred on it; one that would overlap the note above sits 4 px under
 * it (diff-loop-app.md Decision 35). Placed top to bottom by where their rows are, not by line number, which in
 * Unified puts a hunk's added lines before the removed ones above them: O(notes log notes), a file's comments.
 */
function placeNotes(
  notes: Note[],
  span: (side: Side, start: number, end: number) => { top: number; bottom: number } | null,
  height: number,
): { note: Note; top: number; rail: { top: number; bottom: number } }[] {
  const onScreen = notes
    .flatMap((note) => {
      const rail = span(note.side, note.start, note.end);
      return rail ? [{ note, rail }] : [];
    })
    .sort((a, b) => a.rail.top - b.rail.top);
  let below = -Infinity;
  return onScreen.map(({ note, rail }) => {
    const top = Math.max(rail.top + (ROW - height) / 2, below);
    below = top + height + NOTE_GAP;
    return { note, top, rail };
  });
}

/** Split's heads over each column: the base, and the branch (the canvas's 3e). */
function ColumnHeads() {
  const base = useStore((s) => s.base);
  const head = useStore((s) => s.review?.checkout.head);
  return (
    <div className="colhead box-border" aria-hidden style={{ height: COLHEAD }}>
      <span>{baseLabel(base)}</span>
      <span>{head?.kind === "branch" ? head.name : "HEAD"}</span>
    </div>
  );
}

/** The canvas's fold: the unchanged lines between hunks, shown on a click, with the hunk's section; its hairlines part it from the rows. */
function Fold({
  row,
  path,
  state,
  above,
  below,
}: {
  row: HunkRow;
  path: string;
  state: Expanded[string] | undefined;
  above: boolean;
  below: boolean;
}) {
  const expandGaps = useStore((s) => s.expandGaps);
  const slow = useDelayed(state === "loading");
  const { count } = row.gap;
  const lines = count === null ? "the rest of the file" : `${count} unchanged ${count === 1 ? "line" : "lines"}`;
  const section = row.section && <span className="ctx">{row.section}</span>;
  const edges = [above && "inset 0 0.5px 0 var(--sep)", below && "inset 0 -0.5px 0 var(--sep)"].filter(Boolean).join(", ");
  const style = edges === "" ? undefined : { boxShadow: edges };
  if (count === 0)
    return (
      <div className="fold" style={style}>
        {section}
      </div>
    );
  const label = slow ? `Showing ${lines}…` : state === "failed" ? `Couldn’t read ${lines}. Try Again` : count === null ? "Rest of the file" : lines;
  return (
    <button
      type="button"
      className="fold"
      style={style}
      aria-label={state === "failed" ? `Try showing ${lines} again` : `Show ${lines}`}
      disabled={state === "loading"}
      onClick={() => void expandGaps(path, [{ key: row.key, gap: row.gap }])}
    >
      <Sym name="right" />
      <span className="flex-none">{label}</span>
      {section}
    </button>
  );
}

type LineProps = {
  path: string;
  highlights: Highlights | null;
  /** The selected range, and the hovered comment's lines. */
  sel: { side: Side; lo: number; hi: number } | null;
  hl: { side: Side; lo: number; hi: number } | null;
  pressNumber: (cell: Cell, shift: boolean) => void;
  /** `pressed`: the primary button is still down. */
  enterNumber: (cell: Cell, pressed: boolean) => void;
  handles: Handles;
  pressHandle: (edge: "top" | "bottom") => void;
  /** Find's marks, by `side:no`, and the current match. */
  found: Map<string, Mark[]>;
  currentMatch: Match | null;
  /** Whether a line can take a comment; its numbers are buttons only then. */
  commentable: boolean;
};

const TONE: Record<Cell["change"], string> = { added: "add", removed: "del", context: "" };

/** The menu for a commentable line: comment on it, or on the selected range it is in. */
function commentMenu(e: React.MouseEvent, path: string, cell: Cell) {
  const s = useStore.getState();
  if (cell.shown || s.composer || !canComment(s)) return;
  const sel = s.selection;
  const range = sel && !sel.dragging && sel.anchor !== sel.head && inRange(selected(sel, path), cell) ? sel : null;
  const removed = cell.side === "old" ? "Removed " : "";
  showMenu(e, [
    range
      ? {
          text: `Comment on ${removed}Lines ${Math.min(range.anchor, range.head)}–${Math.max(range.anchor, range.head)}…`,
          action: () => s.composeOnSelection(),
        }
      : { text: `Comment on ${removed}Line ${cell.no}…`, action: () => s.composeOnLines(path, cell.side, cell.no, cell.no) },
  ]);
}

function UnifiedLine(props: LineProps & { old: Cell | null; new: Cell | null }) {
  const { path, old, sel, hl } = props;
  const main = (props.new ?? old)!;
  const cells = [old, props.new];
  const isSel = cells.some((c) => inRange(sel, c));
  const isHl = cells.some((c) => inRange(hl, c));
  return (
    <div className={`row ${TONE[main.change]} ${isSel ? "sel" : ""} ${isHl ? "hl" : ""}`} onContextMenu={(e) => commentMenu(e, path, main)}>
      <Gutter cells={cells} props={props}>
        <Number cell={old} props={props} className="o" />
        <Number cell={props.new} props={props} className="n" />
      </Gutter>
      <span className="bar" />
      {/* Long lines wrap rather than run past the card (diff-loop-app.md Decision 35). */}
      <Code
        cell={main}
        highlights={props.highlights}
        found={props.found}
        currentMatch={props.currentMatch}
        className="min-w-0 flex-1 pr-4 break-words whitespace-pre-wrap"
      />
    </div>
  );
}

function SplitHalf(props: LineProps & { cell: Cell | null }) {
  const { path, cell, sel } = props;
  if (!cell) return <div className="half gap" />;
  return (
    <div className={`half ${TONE[cell.change]} ${inRange(sel, cell) ? "sel" : ""}`} onContextMenu={(e) => commentMenu(e, path, cell)}>
      <Gutter cells={[cell]} props={props}>
        <Number cell={cell} props={props} className="n" />
      </Gutter>
      <span className="bar" />
      <Code cell={cell} highlights={props.highlights} found={props.found} currentMatch={props.currentMatch} className="min-w-0 flex-1" />
    </div>
  );
}

/**
 * A row's numbers as one target: a drag over it keeps the side it started on. Under an open composer, the
 * range's first and last rows drag its ends, each marked by a mini handle on its number (the canvas's 3c).
 */
function Gutter({ cells, props, children }: { cells: (Cell | null)[]; props: LineProps; children: React.ReactNode }) {
  const line = gutterLine(cells);
  if (!line || !props.commentable) return <>{children}</>;
  const { handles } = props;
  const end = handles ? cells.find((c) => c?.side === handles.side) : undefined;
  const top = end !== undefined && end?.no === handles?.top;
  const bottom = end !== undefined && end?.no === handles?.bottom;
  const edge = bottom ? "bottom" : top ? "top" : null;
  // Centred on the end's own number: each number is 40 px wide, the old side's first in a unified row.
  const left = cells.indexOf(end ?? null) * GUTTER_PX + GUTTER_PX / 2;
  const handle = (at: "top" | "bottom") => (
    <span
      aria-hidden
      className={`hdl ${at === "top" ? "top" : "bot"}`}
      style={{ left }}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        // A one-line range has both handles on one row: each moves its own end.
        e.stopPropagation();
        props.pressHandle(at);
      }}
    />
  );
  return (
    <span
      title={edge ? "Drag to change the lines" : undefined}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        if (edge) props.pressHandle(edge);
        else props.pressNumber(line, e.shiftKey);
      }}
      onMouseEnter={(e) => cells.forEach((c) => c && !c.shown && props.enterNumber(c, (e.buttons & 1) === 1))}
      className={`relative flex flex-none select-none ${edge ? "cursor-ns-resize" : ""}`}
    >
      {children}
      {top && handle("top")}
      {bottom && handle("bottom")}
    </span>
  );
}

function Number({ cell, props, className }: { cell: Cell | null; props: LineProps; className: string }) {
  if (!cell) return <span className={className} />;
  if (cell.shown || !props.commentable || props.handles) return <span className={className}>{cell.no}</span>;
  return (
    <span
      role="button"
      aria-label={`Comment on ${cell.side === "old" ? "removed " : ""}line ${cell.no}`}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        // This number's own side, not the line's.
        e.stopPropagation();
        props.pressNumber(cell, e.shiftKey);
      }}
      className={`${className} hover:text-[var(--label)]`}
    >
      {cell.no}
    </span>
  );
}

// The current match is outlined too, so it stands out by more than its colour.
const FIND = {
  match: "rounded-sm bg-[var(--find)]",
  current: "rounded-sm bg-[var(--findcur)] text-[var(--findcurfg)] outline-1 outline-[var(--label)]",
} as const;

/**
 * A line's code. It takes the diff's highlights and find's marks whole, not `LineProps`: those stay the same
 * objects while a drag or hover re-renders the rows, so the compiler skips drawing their code again.
 */
function Code({
  cell,
  highlights,
  found,
  currentMatch,
  className,
}: Pick<LineProps, "highlights" | "found" | "currentMatch"> & { cell: Cell; className: string }) {
  const at = lineKey(cell.side, cell.no);
  const marks = found.get(at);
  const here = currentMatch?.cell === at ? currentMatch : null;
  const tokens: Token[] = highlights?.[cell.side].get(cell.no) ?? [{ content: cell.text, color: undefined, italic: false }];
  // O(matches in this line): the current one is told apart here, not in `found`.
  const spans = here ? (marks ?? []).map((m) => ({ ...m, current: m.from === here.from })) : (marks ?? []);
  return (
    <code className={className}>
      {marked(tokens, spans).map((p, i) => (
        <span
          key={i}
          // The current match's own colour reads on its fill; the token's would not.
          style={{ color: p.mark === "current" ? undefined : p.token.color, fontStyle: p.token.italic ? "italic" : undefined }}
          className={p.mark ? FIND[p.mark] : undefined}
        >
          {p.content}
        </span>
      ))}
      {cell.text === "" && "​"}
    </code>
  );
}

/** "Draft comment on line 18 with a suggested change: …", as the canvas labels a note. */
function noteLabel(note: Note): string {
  const c = note.comment;
  const kind = markOf(note.comment) || "Draft";
  const where = c.target.kind === "lines" ? targetLabel(c.target).toLowerCase() : "file";
  // The kind said in words, as the note draws every kind with the same dot (ADR 0036 §2).
  return `${kind} ${c.ask.kind} on ${where}${c.text === "" ? "" : `: ${c.text}`}`;
}

/** A comment's note in the margin, which opens it; in Split, a mark that shows the note on hover (the canvas's 3a and 3e). */
function MarginNote({
  note,
  top,
  collapsed,
  hovered,
  onHover,
}: {
  note: Note;
  top: number;
  collapsed: boolean;
  hovered: boolean;
  onHover: (on: boolean) => void;
}) {
  const toggleComment = useStore((s) => s.toggleComment);
  const c = note.comment;
  // The agent's check, until the reviewer accepts it (ADR 0032 §2).
  const lead = awaitsReviewer(c) ? (
    <Sym name="resolved" className="text-[var(--amber)]" />
  ) : note.tone === "sent" ? (
    <Sym name="sent" />
  ) : note.tone === "changed" ? (
    <Sym name="changed" className="text-[var(--amber)]" />
  ) : (
    <span className="dot" />
  );
  const hover = {
    onMouseEnter: () => onHover(true),
    onMouseLeave: () => onHover(false),
    onFocus: () => onHover(true),
    onBlur: () => onHover(false),
    onClick: () => toggleComment(c.id),
    "aria-label": noteLabel(note),
  };
  if (collapsed && !hovered) {
    return (
      <button type="button" className="cmark" style={{ top }} {...hover}>
        <Sym name="chip" />
      </button>
    );
  }
  return (
    <button type="button" className={`mnote ${hovered ? "hov" : ""}`} style={{ top: collapsed ? top - (NOTE - MARK) / 2 : top }} {...hover}>
      {lead}
      {/* While it waits on the reviewer, what the agent says it did; the reviewer's comment is on the card (ADR 0032 §2). */}
      <span className="t">
        {awaitsReviewer(c) ? (
          <>
            <span className="text-[var(--amber)]">Agent: </span>
            {shownNote(c.note) === null ? "Resolved" : <AgentNote note={c.note ?? ""} />}
          </>
        ) : c.text === "" ? (
          "Suggested change"
        ) : (
          c.text
        )}
      </span>
      {c.ask.kind === "suggestion" && c.text !== "" && <Sym name="suggest" className="text-[var(--accent)]" />}
    </button>
  );
}

/**
 * The open comment, or the composer, as the canvas's popover under the range's last line: 400 px wide, 520 with
 * suggested code, 560 for a sent comment whose code changed (3c, 3f, 5a).
 */
function CommentPopover({ top, left, comment }: { top: number; left: number | string; comment: Comment | null }) {
  const suggesting = useStore((s) => s.composer?.ask.kind === "suggestion");
  const width = comment ? (comment.sent !== null && changed(comment) ? 560 : comment.ask.kind === "suggestion" ? 520 : 400) : suggesting ? 520 : 400;
  const label = comment ? `Comment on ${comment.target.kind === "lines" ? targetLabel(comment.target).toLowerCase() : "file"}` : "New comment";
  return (
    <div className="pop" role="dialog" aria-label={label} style={{ top, left, width, maxWidth: "calc(100% - 180px)" }}>
      <span className="arrow" aria-hidden style={{ left: 40 }} />
      <div className="body p-4">{comment ? <CommentCard comment={comment} /> : <Composer />}</div>
    </div>
  );
}
