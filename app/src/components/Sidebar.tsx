import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useEffect, useMemo, useRef } from "react";
import type { FileDiff } from "../bindings/FileDiff";
import { showMenu } from "../contextMenu";
import { nameOf } from "../path";
import { counts } from "../rows";
import { useStore } from "../store";
import { type Guide, type TreeRow } from "../tree";

/** Each tree row's height, from the design. */
const ROW_PX = 28;
/** The progress ring's circumference: radius 9. */
const RING = 2 * Math.PI * 9;

/** The letter for a file's change; meaning is also in its tooltip, never colour alone. */
export function statusOf(file: FileDiff): { letter: string; label: string; tone: string } {
  if (file.content.kind === "binary" && file.status.kind === "modified") {
    return { letter: "B", label: "Binary, modified", tone: "text-muted2" };
  }
  switch (file.status.kind) {
    case "added":
      return { letter: "A", label: "Added", tone: "text-add" };
    case "deleted":
      return { letter: "D", label: "Deleted", tone: "text-del" };
    case "renamed":
      return { letter: "R", label: `Renamed from ${file.status.from}`, tone: "text-muted2" };
    case "modified":
      return { letter: "M", label: "Modified", tone: "text-modified" };
  }
}

/**
 * The header's two lines: files not yet viewed, then the changed lines in
 * viewed files out of all; no second line when no file has a changed line.
 */
export function progressText(left: number, reviewed: number, total: number): [string, string] {
  const title = left === 0 ? "All files viewed" : `${left} ${left === 1 ? "file" : "files"} left`;
  if (total === 0) return [title, ""];
  const lines = `${total} ${total === 1 ? "line" : "lines"}`;
  if (reviewed === 0) return [title, `${lines} to review`];
  // Counted up, as the ring fills.
  return [title, `${reviewed === total ? lines : `${reviewed} of ${lines}`} reviewed`];
}

/**
 * The changed files as a tree, under how much is left to review. Virtualized,
 * and every per-key path (arrows, J / K, V) is O(1) in the number of files: rows and
 * indexes come from the review, counts are cached per file.
 */
export function Sidebar() {
  const review = useStore((s) => s.review);
  const selected = useStore((s) => s.selected);
  const select = useStore((s) => s.select);
  const stepFile = useStore((s) => s.stepFile);
  const scroller = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => review?.tree ?? [], [review]);
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
  if (!review) return <aside className="w-[272px] flex-none border-r border-border bg-side" />;

  if (review.changes.files.length === 0) {
    return (
      <aside className="flex w-[272px] flex-none flex-col border-r border-border bg-side">
        <div className="flex h-[52px] flex-none items-center border-b border-border px-4 text-[12.5px] text-muted3">
          No changed files
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex w-[272px] flex-none flex-col border-r border-border bg-side">
      <Progress />
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
        className="min-h-0 flex-1 overflow-auto px-2 pt-2.5 pb-1 outline-none"
      >
        <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
          {virtual.getVirtualItems().map((v) => {
            const row = rows[v.index]!;
            return (
              <div
                key={row.key}
                className="absolute left-0 w-full"
                style={{ height: ROW_PX, transform: `translateY(${v.start}px)` }}
              >
                {row.kind === "folder" ? (
                  <FolderRow row={row} />
                ) : (
                  <FileRow file={row.file} guides={row.guides} selected={row.file.path === selected} onSelect={select} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

/** How much is left: a ring for the lines reviewed, files left, and the lines added and removed. */
function Progress() {
  const review = useStore((s) => s.review);
  const viewedCount = useStore((s) => s.viewed.size);
  const reviewed = useStore((s) => s.viewedLines);
  // O(changed files) once per load: `counts` is cached per file.
  const total = useMemo(
    () =>
      (review?.changes.files ?? []).reduce(
        (sum, f) => {
          const c = counts(f);
          return { added: sum.added + c.added, removed: sum.removed + c.removed };
        },
        { added: 0, removed: 0 },
      ),
    [review],
  );
  const files = review?.changes.files.length ?? 0;
  const lines = total.added + total.removed;
  const [title, detail] = progressText(files - viewedCount, reviewed, lines);
  const done = lines > 0 ? reviewed / lines : files > 0 ? viewedCount / files : 0;
  return (
    <div className="flex h-[52px] flex-none items-center gap-2.5 border-b border-border px-4 tabular-nums">
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        role="progressbar"
        aria-label="Reviewed"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(done * 100)}
        className="flex-none -rotate-90"
      >
        <circle cx="12" cy="12" r="9" fill="none" strokeWidth="2.5" className="stroke-line" />
        <circle
          cx="12"
          cy="12"
          r="9"
          fill="none"
          className="stroke-fg"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={RING}
          strokeDashoffset={RING * (1 - done)}
          // A round cap draws a dot at nothing done.
          visibility={done === 0 ? "hidden" : undefined}
        />
      </svg>
      <div className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="truncate text-[13.5px] font-semibold">{title}</span>
        {detail && <span className="truncate text-xs text-muted3">{detail}</span>}
      </div>
      <span className="flex-none font-mono text-xs">
        {total.added > 0 && <span className="text-add">+{total.added}</span>}
        {total.added > 0 && total.removed > 0 && " "}
        {total.removed > 0 && <span className="text-del">−{total.removed}</span>}
      </span>
    </div>
  );
}

/** The vertical lines that show which folder a row is in. */
function Guides({ guides }: { guides: Guide[] }) {
  if (guides.length === 0) return null;
  return (
    <span className="-mr-1.5 flex flex-none self-stretch">
      {guides.map((g, i) => (
        <span key={i} className="relative w-4">
          <span
            className={`absolute left-[7px] w-px bg-line ${g.start ? "-top-[5px]" : "top-0"} ${g.end ? "bottom-[7px]" : "bottom-0"}`}
          />
        </span>
      ))}
    </span>
  );
}

function FolderRow({ row }: { row: Extract<TreeRow, { kind: "folder" }> }) {
  return (
    <div className="flex h-full items-center gap-1.5 rounded-lg px-2 text-muted3">
      <Guides guides={row.guides} />
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.15" strokeLinejoin="round" strokeLinecap="round" className="flex-none" aria-hidden>
        <path
          d="M1.9 4.6c0-.94.76-1.7 1.7-1.7h2.16c.42 0 .82.15 1.13.43l.98.87h4.53c.94 0 1.7.76 1.7 1.7v5.5c0 .94-.76 1.7-1.7 1.7H3.6c-.94 0-1.7-.76-1.7-1.7z"
          fill="currentColor"
          fillOpacity="0.16"
        />
        <path d="M1.9 6.4h12.2" />
      </svg>
      <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{row.name}</span>
    </div>
  );
}

const FileRow = memo(function FileRow({
  file,
  guides,
  selected,
  onSelect,
}: {
  file: FileDiff;
  guides: Guide[];
  selected: boolean;
  onSelect: (path: string) => void;
}) {
  const viewed = useStore((s) => s.viewed.has(file.path));
  const toggleViewed = useStore((s) => s.toggleViewed);
  const status = statusOf(file);
  return (
    <div
      role="option"
      aria-selected={selected}
      aria-label={`${nameOf(file.path)}, ${status.label}${viewed ? ", viewed" : ""}`}
      title={`${file.path}\n${status.label}${viewed ? " · Viewed" : ""}`}
      onClick={() => onSelect(file.path)}
      onContextMenu={(e) => showMenu(e, [{ text: "Viewed", checked: viewed, action: () => toggleViewed(file.path) }])}
      className={`flex h-full items-center gap-1.5 rounded-lg px-2 ${selected ? "bg-row-sel" : "hover:bg-chip"}`}
    >
      <Guides guides={guides} />
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinejoin="round"
        strokeLinecap="round"
        className={`flex-none ${viewed ? "text-faint" : "text-muted2"}`}
        aria-hidden
      >
        <path d="M5 1.9h3.6c.4 0 .78.16 1.06.44l2.5 2.5c.28.28.44.66.44 1.06v6.2c0 .94-.76 1.7-1.7 1.7H5c-.94 0-1.7-.76-1.7-1.7V3.6c0-.94.76-1.7 1.7-1.7z" />
        <path d="M8.6 2.1v2.4c0 .5.4.9.9.9h2.4" />
        {/* Viewed is marked by more than the dimming: a tick inside the page. */}
        {viewed && <path d="M5.7 9.7l1.5 1.5 2.9-3" />}
      </svg>
      <span
        className={`min-w-0 flex-1 truncate text-[13.5px] ${selected ? "font-semibold" : ""} ${viewed ? "text-faint" : "text-fg"}`}
      >
        {nameOf(file.path)}
      </span>
      <span className={`w-3 flex-none text-center font-mono text-[11.5px] font-medium ${status.tone}`} aria-hidden>
        {status.letter}
      </span>
    </div>
  );
});
