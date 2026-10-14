import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef } from "react";
import type { Comment } from "../bindings/Comment";
import type { FileDiff } from "../bindings/FileDiff";
import type { Side } from "../bindings/Side";
import { useHighlights, type Highlights } from "../highlight";
import { type Cell, type Expanded, type HunkRow, lastLine, splitRows, unifiedRows, withinHunk } from "../rows";
import { orderedComments, type Selection, useStore } from "../store";
import { CommentCard } from "./CommentCard";
import { Composer } from "./Composer";

/** What each line on one side carries: its comment pin, range bar, open card, composer. */
type Marks = {
  pins: Map<string, { comment: Comment; n: number }>;
  bars: Set<string>;
  cardAt: Map<string, Comment>;
  composerAt: string | null;
};

const key = (side: Side, no: number) => `${side}:${no}`;

function useMarks(file: FileDiff): Marks {
  const all = useStore((s) => s.comments);
  const review = useStore((s) => s.review);
  const openComment = useStore((s) => s.openComment);
  // Only what places the composer: its text changes on every keystroke.
  const editing = useStore((s) => s.composer?.editing ?? null);
  const composerAt = useStore((s) =>
    s.composer?.path === file.path && s.composer.target.kind === "lines"
      ? key(s.composer.target.side, s.composer.target.start)
      : null,
  );
  return useMemo(() => {
    const marks: Marks = { pins: new Map(), bars: new Set(), cardAt: new Map(), composerAt };
    orderedComments(review, all)
      // An outdated comment's lines hold other code, or are not in the diff.
      .filter((c) => c.path === file.path && c.target.kind === "lines" && c.state === "current" && c.id !== editing)
      .forEach((c, i) => {
        if (c.target.kind !== "lines") return;
        const { side, start } = c.target;
        const end = lastLine(c.target);
        marks.pins.set(key(side, start), { comment: c, n: i + 1 });
        if (end > start) for (let no = start; no <= end; no++) marks.bars.add(key(side, no));
        if (c.id === openComment) marks.cardAt.set(key(side, end), c);
      });
    return marks;
  }, [all, review, openComment, editing, composerAt, file.path]);
}

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
      for (const cell of [row.old, row.new]) if (cell) index.set(key(cell.side, cell.no), i);
    });
    return index;
  }, [rows]);
  const scroller = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: (i) => (rows[i]?.kind === "hunk" ? 30 : 25),
    // Measured heights follow the row, not its position, when the diff changes.
    getItemKey: (i) => rows[i]!.key,
    overscan: 30,
  });

  useEffect(() => {
    const finish = () => {
      const s = useStore.getState();
      const sel = s.selection;
      if (!sel?.dragging) return;
      if (sel.anchor === sel.head) s.composeOnLines(sel.path, sel.side, sel.anchor, sel.anchor);
      else s.setSelection({ ...sel, dragging: false });
    };
    window.addEventListener("mouseup", finish);
    return () => window.removeEventListener("mouseup", finish);
  }, []);

  // Bring a comment opened from elsewhere (N / P, the comments list) into view.
  useEffect(() => {
    const c = useStore.getState().comments.find((x) => x.id === openComment);
    if (!c || c.path !== file.path || c.target.kind !== "lines") return;
    const { side, start } = c.target;
    const index = rowOf.get(key(side, start));
    if (index !== undefined) virtual.scrollToIndex(index, { align: "center" });
  }, [openComment, rowOf, file.path, virtual]);

  const pressNumber = (cell: Cell, shift: boolean) => {
    const s = useStore.getState();
    if (s.composer) return;
    const sel = s.selection;
    if (shift && sel && sel.path === file.path && sel.side === cell.side) {
      s.setSelection({ ...sel, head: withinHunk(file, cell.side, sel.anchor, cell.no), dragging: false });
      return;
    }
    s.setSelection({ path: file.path, side: cell.side, anchor: cell.no, head: cell.no, dragging: true });
    if (s.openComment) s.toggleComment(null);
  };
  const enterNumber = (cell: Cell) => {
    const s = useStore.getState();
    const sel = s.selection;
    if (sel?.dragging && sel.path === file.path && sel.side === cell.side) {
      const head = withinHunk(file, cell.side, sel.anchor, cell.no);
      if (head !== sel.head) s.setSelection({ ...sel, head });
    }
  };
  const gutter = { pressNumber, enterNumber };
  const pill =
    selection && !selection.dragging && !composer && selection.path === file.path && selection.anchor !== selection.head
      ? key(selection.side, Math.min(selection.anchor, selection.head))
      : null;

  return (
    <div ref={scroller} className="code relative min-h-0 flex-1 overflow-auto font-mono text-[13px] leading-[25px]">
      <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
        {virtual.getVirtualItems().map((item) => {
          const row = rows[item.index]!;
          const cells = row.kind === "hunk" ? [] : [row.old, row.new];
          const lifted = cells.some(
            (c) => c && (marks.cardAt.has(key(c.side, c.no)) || marks.composerAt === key(c.side, c.no) || pill === key(c.side, c.no)),
          );
          return (
            <div
              key={row.key}
              data-index={item.index}
              ref={virtual.measureElement}
              className="absolute left-0 w-full"
              style={{ transform: `translateY(${item.start}px)`, zIndex: lifted ? 10 : undefined }}
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
  const expandGap = useStore((s) => s.expandGap);
  const { count } = row.gap;
  const lines = count === null ? "the rest of the file" : `${count} unchanged ${count === 1 ? "line" : "lines"}`;
  return (
    <div
      className="flex h-[30px] items-center gap-4 border-y border-border bg-hunk pr-8 text-xs text-faint"
      style={{ paddingLeft: indent }}
    >
      {count !== 0 &&
        (state === "loading" ? (
          <span className="flex-none font-sans text-[12.5px] whitespace-nowrap text-muted2">Showing {lines}…</span>
        ) : (
          <button
            type="button"
            onClick={() => void expandGap(path, row.key, row.gap)}
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
  highlights: Highlights | null;
  selection: Selection | null;
  pill: string | null;
  pressNumber: (cell: Cell, shift: boolean) => void;
  enterNumber: (cell: Cell) => void;
};

const TONE = {
  added: { bg: "bg-add-bg", gutter: "bg-add-gutter", sign: "text-add", mark: "+" },
  removed: { bg: "bg-del-bg", gutter: "bg-del-gutter", sign: "text-del", mark: "−" },
  context: { bg: "bg-bg", gutter: "bg-bg", sign: "text-faint", mark: "" },
} as const;

function UnifiedLine(props: LineProps & { old: Cell | null; new: Cell | null }) {
  const { path, old, marks, highlights, selection } = props;
  const main = (props.new ?? old)!;
  const selected = inSelection(selection, path, props.new) || inSelection(selection, path, old);
  const tone = TONE[main.change];
  const commented = [old, props.new].some((c) => c && marks.pins.has(key(c.side, c.no)));
  return (
    <div className="relative">
      <div className={`relative flex ${selected ? "bg-sel" : tone.bg}`}>
        <Decorations {...props} cells={[old, props.new]} />
        <Number cell={old} props={props} gutter={selected ? "bg-sel-gutter" : tone.gutter} commented={false} />
        <Number cell={props.new} props={props} gutter={selected ? "bg-sel-gutter" : tone.gutter} commented={commented} />
        <span className={`w-6 flex-none text-center ${tone.sign}`}>{tone.mark}</span>
        <Code cell={main} highlights={highlights} />
      </div>
      <Overlays {...props} cells={[old, props.new]} left={112} />
    </div>
  );
}

function SplitHalf(props: LineProps & { cell: Cell | null }) {
  const { path, cell, selection, highlights } = props;
  if (!cell) return <div className="w-1/2 min-w-0 bg-hunk" />;
  const selected = inSelection(selection, path, cell);
  const tone = TONE[cell.change];
  return (
    <div className={`relative w-1/2 min-w-0 ${cell.side === "old" ? "border-r border-border" : ""}`}>
      <div className={`relative flex ${selected ? "bg-sel" : tone.bg}`}>
        <Decorations {...props} cells={[cell]} />
        <Number
          cell={cell}
          props={props}
          gutter={selected ? "bg-sel-gutter" : tone.gutter}
          commented={props.marks.pins.has(key(cell.side, cell.no))}
          wide
        />
        <span className={`w-6 flex-none text-center ${tone.sign}`}>{tone.mark}</span>
        <Code cell={cell} highlights={highlights} />
      </div>
      <Overlays {...props} cells={[cell]} left={80} />
    </div>
  );
}

function Number({
  cell,
  props,
  gutter,
  commented,
  wide = false,
}: {
  cell: Cell | null;
  props: LineProps;
  gutter: string;
  commented: boolean;
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
        props.pressNumber(cell, e.shiftKey);
      }}
      onMouseEnter={() => props.enterNumber(cell)}
      className={`${width} flex-none cursor-pointer pr-2.5 text-right select-none hover:text-fg ${gutter} ${commented ? "text-fg" : "text-faint"}`}
    >
      {cell.no}
    </span>
  );
}

function Code({ cell, highlights }: { cell: Cell; highlights: Highlights | null }) {
  const tokens = highlights?.[cell.side].get(cell.no);
  return (
    <span className="min-w-0 flex-1 pr-8 break-words whitespace-pre-wrap">
      {tokens
        ? tokens.map((t, i) => (
            <span key={i} style={{ color: t.color, fontStyle: t.italic ? "italic" : undefined }}>
              {t.content}
            </span>
          ))
        : cell.text}
      {cell.text === "" && "​"}
    </span>
  );
}

/** The pin, range bar and "Comment on lines" pill drawn over a line. */
function Decorations({ cells, marks, pill }: LineProps & { cells: (Cell | null)[] }) {
  const openComment = useStore((s) => s.openComment);
  const toggleComment = useStore((s) => s.toggleComment);
  const composeOnSelection = useStore((s) => s.composeOnSelection);
  const selection = useStore((s) => s.selection);
  const present = cells.filter((c): c is Cell => c !== null);
  const bar = present.some((c) => marks.bars.has(key(c.side, c.no)));
  const pin = present.map((c) => marks.pins.get(key(c.side, c.no))).find(Boolean);
  const showPill = present.some((c) => pill === key(c.side, c.no));
  const range = selection ? [Math.min(selection.anchor, selection.head), Math.max(selection.anchor, selection.head)] : [0, 0];
  return (
    <>
      {bar && <span className="absolute top-0 bottom-0 left-0 w-[3px] bg-ghost" />}
      {pin && (
        <button
          type="button"
          onClick={() => toggleComment(pin.comment.id)}
          aria-label={`Comment ${pin.n}`}
          className={`absolute top-[3px] left-2.5 z-[2] flex size-[18px] items-center justify-center rounded-full font-sans text-[11px] leading-none font-semibold ${
            openComment === pin.comment.id ? "bg-btn text-btn-fg" : "bg-line text-muted2"
          }`}
        >
          {pin.n}
        </button>
      )}
      {showPill && (
        <button
          type="button"
          onClick={composeOnSelection}
          className="absolute top-[-3px] right-8 z-[4] flex items-center gap-2.5 rounded-full bg-btn px-3.5 py-[7px] font-sans text-[12.5px] font-medium whitespace-nowrap text-btn-fg shadow-[0_8px_20px_rgba(0,0,0,0.16)]"
        >
          Comment on lines {range[0]}–{range[1]}
          <span className="font-mono text-[11px] text-faint">C</span>
        </button>
      )}
    </>
  );
}

/** The open comment card under a line, and the composer beside it. */
function Overlays({ cells, marks, left }: LineProps & { cells: (Cell | null)[]; left: number }) {
  const present = cells.filter((c): c is Cell => c !== null);
  const card = present.map((c) => marks.cardAt.get(key(c.side, c.no))).find(Boolean);
  const composing = present.some((c) => marks.composerAt === key(c.side, c.no));
  return (
    <>
      {card && (
        <div className="absolute top-full right-8 z-[5] pt-1.5 font-sans" style={{ left }}>
          <CommentCard comment={card} floating />
        </div>
      )}
      {composing && (
        <div className="absolute top-[-6px] right-8 z-[5] w-[min(520px,60%)] font-sans">
          <Composer floating />
        </div>
      )}
    </>
  );
}
