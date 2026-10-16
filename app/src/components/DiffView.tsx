import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef } from "react";
import type { Comment } from "../bindings/Comment";
import type { FileDiff } from "../bindings/FileDiff";
import type { Side } from "../bindings/Side";
import { showMenu } from "../contextMenu";
import { changeStarts, lineAfter, lineRows, nextIn, startRow } from "../cursor";
import { useDelayed } from "../delay";
import { findTyped, type Mark, type Match, marked } from "../find";
import { useHighlights, type Highlights, type Token } from "../highlight";
import { isLineCommand, type LineCommand } from "../keys";
import { hasCard, kindOf } from "../lifecycle";
import { bindingFor } from "../platform";
import {
  type Cell,
  type Expanded,
  gutterLine,
  type HunkRow,
  lastLine,
  lineKey,
  splitRows,
  unifiedRows,
  withinHunk,
} from "../rows";
import { orderedComments, type Selection, useStore } from "../store";
import { CommentCard } from "./CommentCard";
import { Composer } from "./Composer";
import { FindBar } from "./FindBar";
import { Pin, type Surface } from "./Pin";

/** The diff's own keys (keys.ts `LINE_COMMANDS`): what each moves, and which way. */
const LINE_KEYS: Record<LineCommand, { move: "line" | "extend" | "change"; step: 1 | -1 }> = {
  lineDown: { move: "line", step: 1 },
  lineUp: { move: "line", step: -1 },
  extendDown: { move: "extend", step: 1 },
  extendUp: { move: "extend", step: -1 },
  nextChange: { move: "change", step: 1 },
  previousChange: { move: "change", step: -1 },
};

/** What each line on one side carries: its comment pin, range bar, open card, composer. */
type Marks = {
  /** `n` is the pin's number, and `i` its place among this file's pins (`n` − 1), which times its turn to paper. */
  pins: Map<string, { comment: Comment; n: number; i: number }>;
  bars: Set<string>;
  cardAt: Map<string, Comment>;
  composerAt: string | null;
};

function useMarks(file: FileDiff): Marks {
  const all = useStore((s) => s.comments);
  const review = useStore((s) => s.review);
  const openComment = useStore((s) => s.openComment);
  // Only what places the composer: its text changes on every keystroke.
  const editing = useStore((s) => s.composer?.editing ?? null);
  const composerAt = useStore((s) =>
    s.composer?.path === file.path && s.composer.target.kind === "lines"
      ? lineKey(s.composer.target.side, s.composer.target.start)
      : null,
  );
  return useMemo(() => {
    const marks: Marks = { pins: new Map(), bars: new Set(), cardAt: new Map(), composerAt };
    orderedComments(review, all)
      // Only a comment with a card: a lost, outdated or resolved one has no pin (ADR 0015).
      .filter((c) => c.path === file.path && c.target.kind === "lines" && hasCard(c) && c.id !== editing)
      .forEach((c, i) => {
        if (c.target.kind !== "lines") return;
        const { side, start } = c.target;
        const end = lastLine(c.target);
        marks.pins.set(lineKey(side, start), { comment: c, n: i + 1, i });
        if (end > start) for (let no = start; no <= end; no++) marks.bars.add(lineKey(side, no));
        if (c.id === openComment) marks.cardAt.set(lineKey(side, end), c);
      });
    return marks;
  }, [all, review, openComment, editing, composerAt, file.path]);
}

/** The composer's range while it is open on lines here: its handles drag either end. */
type Handles = { side: Side; top: number; bottom: number } | null;

function inSelection(selection: Selection | null, path: string, cell: Cell | null): boolean {
  if (!selection || !cell || selection.path !== path || selection.side !== cell.side) return false;
  const [lo, hi] = selection.anchor <= selection.head ? [selection.anchor, selection.head] : [selection.head, selection.anchor];
  return cell.no >= lo && cell.no <= hi;
}

export function DiffView({ file }: { file: FileDiff }) {
  const mode = useStore((s) => s.mode);
  const selection = useStore((s) => s.selection);
  const composer = useStore((s) => s.composer);
  const openComment = useStore((s) => s.openComment);
  const expanded = useStore((s) => s.expanded.get(file.path)?.gaps);
  const highlights = useHighlights(file, expanded);
  const marks = useMarks(file);
  const rows = useMemo(
    () => (mode === "unified" ? unifiedRows(file, expanded) : splitRows(file, expanded)),
    [file, mode, expanded],
  );
  // Side and line number → row, so N / P find a comment's row without a scan.
  const rowOf = useMemo(() => {
    const index = new Map<string, number>();
    rows.forEach((row, i) => {
      if (row.kind === "hunk") return;
      for (const cell of [row.old, row.new]) if (cell) index.set(lineKey(cell.side, cell.no), i);
    });
    return index;
  }, [rows]);
  const scroller = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: (i) => (rows[i]?.kind === "hunk" ? 30 : 24),
    // Measured heights follow the row, not its position, when the diff changes.
    getItemKey: (i) => rows[i]!.key,
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
   * Whether a handle is being dragged: the selection follows the pointer down
   * the gutter, and the composer takes its lines once, on release.
   */
  const resizing = useRef(false);
  /** Ends a drag-selection or a handle drag; it reads only the store and `resizing`, so it never changes. */
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
      // A comment being written moves only by its handles, and a drag is the pointer's.
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
    // A drag-selection, or a handle dragged: either way the head follows the pointer.
    if ((sel?.dragging || resizing.current) && sel?.path === file.path && sel.side === cell.side) {
      const head = withinHunk(file, cell.side, sel.anchor, cell.no);
      if (head !== sel.head) s.setSelection({ ...sel, head });
    }
  };
  const handles: Handles =
    composer?.path === file.path && composer.target.kind === "lines" && selection && !selection.dragging
      ? {
          side: selection.side,
          top: Math.min(selection.anchor, selection.head),
          bottom: Math.max(selection.anchor, selection.head),
        }
      : null;
  const pressHandle = (edge: "top" | "bottom") => {
    if (!handles) return;
    resizing.current = true;
    // The other end stays put: it is the anchor while this one moves.
    const [anchor, head] = edge === "top" ? [handles.bottom, handles.top] : [handles.top, handles.bottom];
    useStore.getState().setSelection({ path: file.path, side: handles.side, anchor, head, dragging: false });
  };
  const gutter = { pressNumber, enterNumber, handles, pressHandle, found, currentMatch };
  const replacing = useStore((s) => s.replacing !== null);
  // While a draft is being placed, the selection is where it would land, not a range to comment on.
  const pill =
    selection && !selection.dragging && !composer && selection.path === file.path
      ? lineKey(selection.side, replacing ? selection.head : Math.min(selection.anchor, selection.head))
      : null;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <FindBar
        count={matches.length}
        current={current}
        searched={query}
      />
      <div ref={scroller} className="code relative min-h-0 flex-1 overflow-auto font-mono text-[13px] leading-[24px]">
        <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
          {virtual.getVirtualItems().map((item) => {
            const row = rows[item.index]!;
            const cells = row.kind === "hunk" ? [] : [row.old, row.new];
            // Above its neighbours: an overlay over the rows below it, and above those a
            // handle, which reaches over the edge into the next or previous row.
            const overlaid = cells.some(
              (c) =>
                c &&
                (marks.cardAt.has(lineKey(c.side, c.no)) || marks.composerAt === lineKey(c.side, c.no) || pill === lineKey(c.side, c.no)),
            );
            const handled = cells.some(
              (c) => c && handles?.side === c.side && (c.no === handles.top || c.no === handles.bottom),
            );
            return (
              <div
                key={row.key}
                data-index={item.index}
                ref={virtual.measureElement}
                className="absolute left-0 w-full"
                style={{ transform: `translateY(${item.start}px)`, zIndex: overlaid ? 20 : handled ? 10 : undefined }}
              >
                {row.kind === "hunk" ? (
                  <HunkHeader
                    row={row}
                    path={file.path}
                    state={expanded?.[row.key]}
                    indent={mode === "unified" ? 120 : 88}
                  />
                ) : mode === "unified" ? (
                  <UnifiedLine
                    path={file.path}
                    old={row.old}
                    new={row.new}
                    marks={marks}
                    replacing={replacing}
                    highlights={highlights}
                    selection={selection}
                    pill={pill}
                    {...gutter}
                  />
                ) : (
                  <div className="flex">
                    {(["old", "new"] as const).map((side) => (
                      <SplitHalf
                        key={side}
                        path={file.path}
                        cell={row[side]}
                        marks={marks}
                        replacing={replacing}
                        highlights={highlights}
                        selection={selection}
                        pill={pill}
                        {...gutter}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function HunkHeader({
  row,
  path,
  state,
  indent,
}: {
  row: HunkRow;
  path: string;
  state: Expanded[string] | undefined;
  indent: number;
}) {
  const expandGaps = useStore((s) => s.expandGaps);
  const slow = useDelayed(state === "loading");
  const { count } = row.gap;
  const lines = count === null ? "the rest of the file" : `${count} unchanged ${count === 1 ? "line" : "lines"}`;
  return (
    <div
      className="flex h-[30px] items-center gap-4 border-y border-border bg-hunk pr-8 text-xs text-faint"
      style={{ paddingLeft: indent }}
    >
      {count !== 0 &&
        (slow ? (
          <span className="flex-none font-sans text-[12.5px] whitespace-nowrap text-muted2">Showing {lines}…</span>
        ) : (
          <button
            type="button"
            disabled={state === "loading"}
            onClick={() => void expandGaps(path, [{ key: row.key, gap: row.gap }])}
            className="flex-none font-sans text-[12.5px] whitespace-nowrap text-muted2 hover:text-fg"
          >
            {state === "failed" ? `Couldn’t read ${lines}. Try again` : `Show ${lines}`}
          </button>
        ))}
      {row.section && <span className="truncate">{row.section}</span>}
    </div>
  );
}

type LineProps = {
  path: string;
  marks: Marks;
  /** Whether a lost draft is being placed: the pill then offers "Place here". */
  replacing: boolean;
  highlights: Highlights | null;
  selection: Selection | null;
  pill: string | null;
  pressNumber: (cell: Cell, shift: boolean) => void;
  /** `pressed`: the primary button is still down. */
  enterNumber: (cell: Cell, pressed: boolean) => void;
  handles: Handles;
  pressHandle: (edge: "top" | "bottom") => void;
  /** Find's marks, by `side:no`, and the current match. */
  found: Map<string, Mark[]>;
  currentMatch: Match | null;
};

/** How each kind of line is drawn; `on` names the gutter's colour, which a pin's rings cut out of. */
const TONE: Record<Cell["change"], { bg: string; gutter: string; on: Surface; sign: string; mark: string }> = {
  added: { bg: "bg-add-bg", gutter: "bg-add-gutter", on: "add-gutter", sign: "text-add", mark: "+" },
  removed: { bg: "bg-del-bg", gutter: "bg-del-gutter", on: "del-gutter", sign: "text-del", mark: "−" },
  context: { bg: "bg-bg", gutter: "bg-bg", on: "bg", sign: "text-faint", mark: "" },
};

/** The menu for a commentable line: comment on it, or on the selected range it is in. */
function commentMenu(e: React.MouseEvent, path: string, cell: Cell) {
  const s = useStore.getState();
  if (cell.shown || s.composer) return;
  const sel = s.selection;
  const range = sel && !sel.dragging && sel.anchor !== sel.head && inSelection(sel, path, cell) ? sel : null;
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
  const { path, old, marks, highlights, selection } = props;
  const main = (props.new ?? old)!;
  const selected = inSelection(selection, path, props.new) || inSelection(selection, path, old);
  const tone = TONE[main.change];
  const commented = [old, props.new].some((c) => c && marks.pins.has(lineKey(c.side, c.no)));
  return (
    <div className="relative" onContextMenu={(e) => commentMenu(e, path, main)}>
      <div className={`relative flex ${selected ? "bg-sel" : tone.bg}`}>
        <Decorations {...props} cells={[old, props.new]} handleLeft={48} on={selected ? "sel-gutter" : tone.on} />
        <Gutter cells={[old, props.new]} props={props}>
          <Number cell={old} props={props} gutter={selected ? "bg-sel-gutter" : tone.gutter} commented={false} selected={selected} />
          <Number
            cell={props.new}
            props={props}
            gutter={selected ? "bg-sel-gutter" : tone.gutter}
            commented={commented}
            selected={selected}
          />
          <span className={`w-6 flex-none text-center ${tone.sign}`}>{tone.mark}</span>
        </Gutter>
        <Code cell={main} highlights={highlights} marks={props.found.get(lineKey(main.side, main.no))} current={props.currentMatch} />
      </div>
      <Overlays {...props} cells={[old, props.new]} left={120} />
    </div>
  );
}

function SplitHalf(props: LineProps & { cell: Cell | null }) {
  const { path, cell, selection, highlights } = props;
  if (!cell) return <div className="w-1/2 min-w-0 bg-hunk" />;
  const selected = inSelection(selection, path, cell);
  const tone = TONE[cell.change];
  return (
    <div
      className={`relative w-1/2 min-w-0 ${cell.side === "old" ? "border-r border-border" : ""}`}
      onContextMenu={(e) => commentMenu(e, path, cell)}
    >
      <div className={`relative flex ${selected ? "bg-sel" : tone.bg}`}>
        <Decorations {...props} cells={[cell]} handleLeft={18} on={selected ? "sel-gutter" : tone.on} />
        <Gutter cells={[cell]} props={props}>
          <Number
            cell={cell}
            props={props}
            gutter={selected ? "bg-sel-gutter" : tone.gutter}
            commented={props.marks.pins.has(lineKey(cell.side, cell.no))}
            selected={selected}
            wide
          />
          <span className={`w-6 flex-none text-center ${tone.sign}`}>{tone.mark}</span>
        </Gutter>
        <Code cell={cell} highlights={highlights} marks={props.found.get(lineKey(cell.side, cell.no))} current={props.currentMatch} />
      </div>
      <Overlays {...props} cells={[cell]} left={80} />
    </div>
  );
}

/** A row's numbers and sign as one target: a drag over it keeps the side it started on. */
function Gutter({ cells, props, children }: { cells: (Cell | null)[]; props: LineProps; children: React.ReactNode }) {
  const line = gutterLine(cells);
  if (!line) return <>{children}</>;
  return (
    <span
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        props.pressNumber(line, e.shiftKey);
      }}
      onMouseEnter={(e) => cells.forEach((c) => c && !c.shown && props.enterNumber(c, (e.buttons & 1) === 1))}
      className="group flex flex-none select-none"
    >
      {children}
    </span>
  );
}

function Number({
  cell,
  props,
  gutter,
  commented,
  selected = false,
  wide = false,
}: {
  cell: Cell | null;
  props: LineProps;
  gutter: string;
  commented: boolean;
  /** In the selected range: drawn in the selection's colour, which reads on its fill. */
  selected?: boolean;
  wide?: boolean;
}) {
  const width = wide ? "w-16" : "w-12";
  if (!cell) return <span className={`${width} flex-none ${gutter}`} />;
  if (cell.shown) {
    return <span className={`${width} flex-none pr-2.5 text-right text-faint select-none ${gutter}`}>{cell.no}</span>;
  }
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
      className={`${width} flex-none pr-2.5 text-right select-none group-hover:text-fg ${gutter} ${selected ? "text-sel-fg" : commented ? "text-fg" : "text-faint"}`}
    >
      {cell.no}
    </span>
  );
}

// The current match is outlined too, so it stands out by more than its colour.
const MARK = {
  match: "rounded-sm bg-find",
  current: "rounded-sm bg-find-current text-find-current-fg outline-1 outline-fg",
} as const;

function Code({
  cell,
  highlights,
  marks,
  current,
}: {
  cell: Cell;
  highlights: Highlights | null;
  marks: Mark[] | undefined;
  current: Match | null;
}) {
  const tokens: Token[] = highlights?.[cell.side].get(cell.no) ?? [{ content: cell.text, color: undefined, italic: false }];
  const here = current?.cell === lineKey(cell.side, cell.no) ? current : null;
  // O(matches in this line): the current one is told apart here, not in `found`.
  const spans = here ? (marks ?? []).map((m) => ({ ...m, current: m.from === here.from })) : (marks ?? []);
  return (
    <span className="min-w-0 flex-1 pr-8 break-words whitespace-pre-wrap">
      {marked(tokens, spans).map((p, i) => (
        <span
          key={i}
          // The current match's own colour reads on its fill; the token's would not.
          style={{ color: p.mark === "current" ? undefined : p.token.color, fontStyle: p.token.italic ? "italic" : undefined }}
          className={p.mark ? MARK[p.mark] : undefined}
        >
          {p.content}
        </span>
      ))}
      {cell.text === "" && "​"}
    </span>
  );
}

/** The pin, range bar, "Comment on lines" pill and range handles drawn over a line. */
function Decorations({ cells, marks, pill, handles, pressHandle, handleLeft, replacing, on }: LineProps & { cells: (Cell | null)[]; handleLeft: number; on: Surface }) {
  const openComment = useStore((s) => s.openComment);
  const toggleComment = useStore((s) => s.toggleComment);
  const composeOnSelection = useStore((s) => s.composeOnSelection);
  const placeComment = useStore((s) => s.placeComment);
  const selection = useStore((s) => s.selection);
  const present = cells.filter((c): c is Cell => c !== null);
  const bar = present.some((c) => marks.bars.has(lineKey(c.side, c.no)));
  const pin = present.map((c) => marks.pins.get(lineKey(c.side, c.no))).find(Boolean);
  const showPill = present.some((c) => pill === lineKey(c.side, c.no));
  const range = selection ? [Math.min(selection.anchor, selection.head), Math.max(selection.anchor, selection.head)] : [0, 0];
  const onHandles = handles ? present.find((c) => c.side === handles.side) : undefined;
  // A 4 px bar on the row's edge, in a 28 × 20 px target centred on it (HIG `accessibility`, minimum control size).
  const handle = (edge: "top" | "bottom") => (
    <span
      title="Drag to change the lines"
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        pressHandle(edge);
      }}
      className={`absolute z-[6] flex h-5 w-7 cursor-ns-resize items-center ${edge === "top" ? "-top-2.5" : "-bottom-2.5"}`}
      style={{ left: handleLeft }}
    >
      <span className="h-1 w-7 rounded-sm bg-handle shadow-[0_0_0_1.5px_var(--ui-bg)]" />
    </span>
  );
  return (
    <>
      {bar && <span className="absolute top-0 bottom-0 left-0 w-[3px] bg-ghost" />}
      {pin && (
        <span style={{ "--i": pin.i } as React.CSSProperties}>
          <Pin
            kind={kindOf(pin.comment)}
            n={String(pin.n)}
            open={openComment === pin.comment.id}
            on={on}
            onClick={() => toggleComment(pin.comment.id)}
            label={`Comment ${pin.n}`}
          />
        </span>
      )}
      {/* Where a re-placed draft would land: a dashed pin, and Return places it (ADR 0015 §2). */}
      {showPill && replacing && selection && <Pin kind="ghost" n="" on={on} />}
      {showPill && (
        <button
          type="button"
          onClick={() => (replacing && selection ? placeComment(selection.side, selection.head) : composeOnSelection())}
          className="absolute top-[-3px] right-8 z-[4] flex items-center gap-2.5 rounded-full bg-btn px-3.5 py-[7px] font-sans text-[12.5px] font-medium whitespace-nowrap text-btn-fg shadow-[0_8px_20px_rgba(0,0,0,0.16)]"
        >
          {replacing ? "Place here" : range[0] === range[1] ? `Comment on line ${range[0]}` : `Comment on lines ${range[0]}–${range[1]}`}
          <span className="font-mono text-[11px] text-faint">{replacing ? "↩" : "C"}</span>
        </button>
      )}
      {onHandles && onHandles.no === handles?.top && handle("top")}
      {onHandles && onHandles.no === handles?.bottom && handle("bottom")}
    </>
  );
}

/** The open comment card under a line, and the composer beside it. */
function Overlays({ cells, marks, left }: LineProps & { cells: (Cell | null)[]; left: number }) {
  const present = cells.filter((c): c is Cell => c !== null);
  const card = present.map((c) => marks.cardAt.get(lineKey(c.side, c.no))).find(Boolean);
  const composing = present.some((c) => marks.composerAt === lineKey(c.side, c.no));
  return (
    <>
      {card && (
        <div className="absolute top-full right-8 z-[5] pt-1.5 font-sans" style={{ left }}>
          <CommentCard comment={card} floating />
        </div>
      )}
      {composing && (
        <div className="absolute top-[-6px] right-8 z-[5] w-[min(512px,60%)] font-sans">
          <Composer floating />
        </div>
      )}
    </>
  );
}
