import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { FileDiff } from "../bindings/FileDiff";
import { showMenu } from "../contextMenu";
import { idOf, sameKey } from "../key";
import { nameOf } from "../path";
import { isMac } from "../platform";
import { DEFAULT_WIDTH } from "../sidebar";
import { useStore } from "../store";
import { recentReviews, reviewRow } from "../switcher";
import { filterTree, fold, keptOrder, type TreeRow } from "../tree";
import { Sym } from "./Icon";
import { LiveDot } from "./LiveDot";

/** Each tree row's height, the canvas's `.tr`. */
const ROW_PX = 28;
/** Most reviews Other Reviews lists, the 8 most recently shown (diff-loop-app.md Decision 35). */
const OTHER_REVIEWS = 8;

/** The letter for a file's change and its class; meaning is also in its label, never colour alone. */
export function statusOf(file: FileDiff): { letter: string; label: string; tone: string } {
  if (file.content.kind === "binary" && file.status.kind === "modified") {
    return { letter: "B", label: "Binary, modified", tone: "n" };
  }
  switch (file.status.kind) {
    case "added":
      return { letter: "A", label: "Added", tone: "a" };
    case "deleted":
      return { letter: "D", label: "Deleted", tone: "d" };
    case "renamed":
      return { letter: "R", label: `Renamed from ${file.status.from}`, tone: "n" };
    case "modified":
      return { letter: "M", label: "Modified", tone: "" };
  }
}

/**
 * The canvas's sidebar (ADR 0027; diff-loop-app.md Decision 35): Filter Files, the changed files as a tree
 * under "Changes" with the files left, then the other reviews kept. Virtualized: the arrows and J / K are O(1)
 * in the number of files, the files a filter keeps found once per query (`keptOrder`), and V's step passes only
 * the viewed files in a row; a filter walks the tree once (`filterTree`, O(rows · d)) per settled keystroke.
 */
export function Sidebar() {
  const review = useStore((s) => s.review);
  const selected = useStore((s) => s.selected);
  const select = useStore((s) => s.select);
  const stepFile = useStore((s) => s.stepFile);
  const closed = useStore((s) => s.closed);
  const width = useStore((s) => s.sidebarWidth);
  const left = useStore((s) => (s.review?.changes.files.length ?? 0) - s.viewed.size);
  const filter = useDeferredValue(useStore((s) => s.fileFilter));
  const [changesOpen, setChangesOpen] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  // The files the filter matches, to tell the open file kept beside them apart (cached per query).
  const kept = review && filter.trim() ? keptOrder(review.order, filter) : null;
  // The open file only while it does not match, so stepping through the matches rebuilds nothing: the tree is
  // walked again only when a file the filter hides is opened.
  const apart = kept && selected !== null && !kept.position.has(selected) ? selected : null;
  // While filtering, the matching files' tree with every folder open; otherwise the tree as folded.
  const rows = useMemo(() => {
    if (!review) return [];
    return filter.trim() ? filterTree(review.tree, filter, apart) : fold(review.tree, closed);
  }, [review, closed, filter, apart]);
  const rowOf = useMemo(
    () => new Map(rows.flatMap((row, i) => (row.kind === "file" ? [[row.file.path, i] as const] : []))),
    [rows],
  );
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_PX,
    getItemKey: (i) => rows[i]!.key,
    overscan: 12,
  });
  // The file a key selected (arrows, J / K, N / P) comes into view; only when the selection
  // moves, not when the rows change under it, which would undo the reader's scrolling.
  const scrolledFor = useRef<string | null>(null);
  useEffect(() => {
    if (selected === null || scrolledFor.current === selected) return;
    scrolledFor.current = selected;
    const row = rowOf.get(selected);
    if (row !== undefined) virtual.scrollToIndex(row);
  }, [selected, rowOf, virtual]);

  const files = review?.changes.files.length ?? 0;
  return (
    <aside className="side relative min-h-0 flex-none" style={{ width }} aria-label="Changed files">
      {/* Room for the window's own controls over the card's corner, which drags the window (diff-loop-app.md Decision 34). */}
      {isMac && <div data-tauri-drag-region className="h-4 flex-none" />}
      <FilterField first={!isMac} />
      <button type="button" className="sechead" aria-expanded={changesOpen} onClick={() => setChangesOpen(!changesOpen)}>
        <span>Changes</span>
        <span className="grow" />
        {/* While filtering, how many files it shows, so a file it hides is not taken for gone. */}
        {review && <span className="d">{files === 0 ? "None" : kept ? `${kept.files.length} of ${files}` : `${left} left`}</span>}
        <Sym name={changesOpen ? "down" : "right"} />
      </button>
      {changesOpen && review && files === 0 && <p className="mx-2.5 mt-1.5 text-xs text-[var(--sec)]">No changed files</p>}
      {changesOpen && files > 0 && (
        <div
          ref={scroller}
          role="listbox"
          aria-label="Changed files"
          tabIndex={0}
          onKeyDown={(e) => {
            // With a modifier, the arrows are the diff's (Shift and Alt, keys.ts).
            if (e.altKey || e.shiftKey || e.ctrlKey || e.metaKey) return;
            if (e.key === "ArrowDown") stepFile(1);
            else if (e.key === "ArrowUp") stepFile(-1);
            else return;
            e.preventDefault();
          }}
          className="mt-0.5 min-h-0 shrink overflow-auto outline-none"
        >
          {rows.length === 0 ? (
            <p className="mx-2.5 mt-1 text-xs text-[var(--sec)]">No files match</p>
          ) : (
            <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
              {virtual.getVirtualItems().map((v) => {
                const row = rows[v.index]!;
                return (
                  <div key={row.key} className="absolute left-0 w-full" style={{ height: ROW_PX, transform: `translateY(${v.start}px)` }}>
                    {row.kind === "folder" ? (
                      <FolderRow row={row} open={filter.trim() !== "" || !closed.has(row.key)} fixed={filter.trim() !== ""} />
                    ) : (
                      <FileRow
                        file={row.file}
                        depth={row.depth}
                        selected={row.file.path === selected}
                        apart={kept !== null && !kept.position.has(row.file.path)}
                        onSelect={select}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      <OtherReviews />
      <ResizeEdge />
    </aside>
  );
}

/** Filter Files: the tree shows only the paths holding what is typed (diff-loop-app.md Decision 35). */
function FilterField({ first }: { first: boolean }) {
  const filter = useStore((s) => s.fileFilter);
  const setFilter = useStore((s) => s.setFileFilter);
  return (
    <label className="filter" style={{ marginTop: first ? 0 : 22 }}>
      <Sym name="search" />
      <input
        type="search"
        placeholder="Filter Files"
        aria-label="Filter Files"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && filter) {
            e.stopPropagation();
            setFilter("");
          }
        }}
      />
    </label>
  );
}

/** The canvas's indent: 4 px at the top level, 16 px more per folder. */
const indent = (depth: number) => ({ paddingLeft: 4 + depth * 16 });

/**
 * A folder's row: a click folds or opens it (ADR 0016 §1), its chevron saying which; `fixed` while filtering, when
 * every folder stays open (diff-loop-app.md Decision 35).
 */
function FolderRow({ row, open, fixed }: { row: Extract<TreeRow, { kind: "folder" }>; open: boolean; fixed: boolean }) {
  const toggleFolder = useStore((s) => s.toggleFolder);
  return (
    <div
      role="button"
      aria-expanded={open}
      aria-disabled={fixed || undefined}
      aria-label={row.name}
      onClick={fixed ? undefined : () => toggleFolder(row.key)}
      className="tr"
      style={indent(row.depth)}
    >
      <span className="dis">
        <Sym name={open ? "down" : "right"} />
      </span>
      <Sym name="folder" />
      <span>{row.name}</span>
    </div>
  );
}

const FileRow = memo(function FileRow({
  file,
  depth,
  selected,
  apart,
  onSelect,
}: {
  file: FileDiff;
  depth: number;
  selected: boolean;
  /** Shown while filtering only because it is open, not because it matches (`filterTree`). */
  apart: boolean;
  onSelect: (path: string) => void;
}) {
  const viewed = useStore((s) => s.viewed.has(file.path));
  const toggleViewed = useStore((s) => s.toggleViewed);
  const status = statusOf(file);
  const deleted = file.status.kind === "deleted";
  return (
    <div
      role="option"
      aria-selected={selected}
      aria-label={`${nameOf(file.path)}, ${status.label}${viewed ? ", viewed" : ""}${apart ? ", open, not a match" : ""}`}
      title={`${file.path}\n${status.label}${viewed ? " · Viewed" : ""}`}
      onClick={() => onSelect(file.path)}
      onContextMenu={(e) => showMenu(e, [{ text: "Viewed", checked: viewed, action: () => toggleViewed(file.path) }])}
      className={`tr ${selected ? "on" : ""} ${viewed || apart ? "viewed" : ""}`}
      style={indent(depth)}
    >
      <span className="dis" />
      <Sym name="doc" className={viewed || deleted ? "text-[var(--sec)]" : ""} />
      <span className={deleted ? "text-[var(--sec)] line-through" : ""}>{nameOf(file.path)}</span>
      {apart && <span className="min-w-0 truncate text-[11px]">not a match</span>}
      {viewed ? (
        <Sym name="check" className="ml-auto text-[var(--sec)]" />
      ) : (
        <span className={`st ${status.tone}`} aria-hidden>
          {status.letter}
        </span>
      )}
    </div>
  );
});

/** The other reviews kept, folded until opened; a click opens one, as the switcher's rows do. */
function OtherReviews() {
  const [open, setOpen] = useState(false);
  const reviews = useStore((s) => s.reviews);
  const home = useStore((s) => s.home);
  const key = useStore((s) => s.key);
  const refreshReviews = useStore((s) => s.refreshReviews);
  const pickReview = useStore((s) => s.pickReview);
  const busy = useStore((s) => s.busy);
  // Per answer while open, not per render: each row reads its project's check.
  const others = useMemo(
    () =>
      open
        ? recentReviews(
            (reviews.kept ?? []).filter((r) => !sameKey(r.key, key)),
            OTHER_REVIEWS,
          ).map((r) => ({ name: r.name, row: reviewRow(r, reviews.checks.get(r.key.project), home, Date.now()) }))
        : [],
    [open, reviews, key, home],
  );
  return (
    <>
      <button
        type="button"
        className="sechead"
        aria-expanded={open}
        onClick={() => {
          if (!open) void refreshReviews();
          setOpen(!open);
        }}
      >
        <span>Other Reviews</span>
        <span className="grow" />
        <Sym name={open ? "down" : "right"} />
      </button>
      {open &&
        (others.length === 0 ? (
          <p className="mx-2.5 mt-1.5 text-xs text-[var(--sec)]">No other reviews</p>
        ) : (
          others.map(({ name, row }) => (
            <button
              key={idOf(row.key)}
              type="button"
              disabled={busy}
              onClick={() => void pickReview(row.key)}
              className="tr"
              style={indent(0)}
              title={row.where}
            >
              <span className="dis">
                <LiveDot live={row.live} named />
              </span>
              <span className="truncate">{row.key.branch}</span>
              {row.key.project !== key?.project && <span className="truncate text-[var(--sec)]">{name}</span>}
            </button>
          ))
        ))}
    </>
  );
}

/** The sidebar's right edge: dragged, it sets the width; double-clicked, it goes back to the design's (ADR 0016 §2). */
function ResizeEdge() {
  const setWidth = useStore((s) => s.setSidebarWidth);
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = useStore.getState().sidebarWidth;
    const move = (ev: MouseEvent) => setWidth(w0 + ev.clientX - x0);
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Sidebar width"
      title="Drag to resize · Double-click to reset"
      onMouseDown={onMouseDown}
      onDoubleClick={() => setWidth(DEFAULT_WIDTH)}
      className="absolute top-0 -right-1.5 bottom-0 z-[5] w-[7px] cursor-col-resize"
    />
  );
}
