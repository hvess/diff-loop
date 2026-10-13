import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useMemo, useRef } from "react";
import type { Comment } from "../bindings/Comment";
import type { FileDiff } from "../bindings/FileDiff";
import type { Role } from "../bindings/Role";
import { captionOf, type Links, linksOf } from "../links";
import { counts } from "../rows";
import { type LoadedReview, useStore } from "../store";

const ROLE_NAMES: Record<Role, string> = {
  source: "Source",
  tests: "Tests",
  config: "Config",
  docs: "Docs",
  assets: "Assets",
};

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

function dirOf(path: string): string {
  const at = path.lastIndexOf("/");
  return at < 0 ? "" : path.slice(0, at);
}

type Item = { kind: "group"; role: Role } | { kind: "file"; file: FileDiff };

/** The list's rows, group headings included; once per review. */
function itemsOf(review: LoadedReview): Item[] {
  return review.groups.flatMap((g) => [
    { kind: "group" as const, role: g.role },
    ...g.files.map((i) => ({ kind: "file" as const, file: review.changes.files[i]! })),
  ]);
}

function itemKey(item: Item): string {
  return item.kind === "group" ? `g:${item.role}` : `f:${item.file.path}`;
}

/** The paths the review groups as tests. */
function testsOf(review: LoadedReview): Set<string> {
  const tests = review.groups.find((g) => g.role === "tests")?.files ?? [];
  return new Set(tests.map((i) => review.changes.files[i]!.path));
}

function commentCounts(comments: Comment[]): Map<string, number> {
  const perFile = new Map<string, number>();
  for (const c of comments) perFile.set(c.path, (perFile.get(c.path) ?? 0) + 1);
  return perFile;
}

/**
 * Changed files by role. Virtualized, and every per-key path (arrows, V) is
 * O(1) in the number of files: indexes come from the review, counts are memos.
 */
export function Sidebar() {
  const review = useStore((s) => s.review);
  const selected = useStore((s) => s.selected);
  const viewedCount = useStore((s) => s.viewed.size);
  const comments = useStore((s) => s.comments);
  const select = useStore((s) => s.select);
  const scroller = useRef<HTMLDivElement>(null);
  const items = useMemo(() => (review ? itemsOf(review) : []), [review]);
  const rowOf = useMemo(
    () => new Map(items.flatMap((item, row) => (item.kind === "file" ? [[item.file.path, row] as const] : []))),
    [items],
  );
  const perFile = useMemo(() => commentCounts(comments), [comments]);
  // Once per load: O(files + import words), each file's words read once.
  const links = useMemo(() => (review ? linksOf(review.changes.files, testsOf(review)) : null), [review]);
  // O(changed files) per load: `counts` is cached per file.
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
  const virtual = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroller.current,
    estimateSize: (i) => (items[i]?.kind === "group" ? 34 : 49),
    // Measured heights follow the item, not its position, when files come and go.
    getItemKey: (i) => itemKey(items[i]!),
    overscan: 12,
  });
  if (!review) return <aside className="w-[272px] flex-none border-r border-border bg-side" />;

  const fileCount = review.changes.files.length;
  if (fileCount === 0) {
    return (
      <aside className="w-[272px] flex-none border-r border-border bg-side px-6 py-5 text-[12.5px] text-muted">
        No changed files
      </aside>
    );
  }

  const move = (step: number) => {
    const at = selected === null ? -1 : (review.position.get(selected) ?? -1);
    const next = review.order[Math.min(review.order.length - 1, Math.max(0, at + step))];
    if (!next) return;
    select(next.path);
    const row = rowOf.get(next.path);
    if (row !== undefined) virtual.scrollToIndex(row);
  };

  return (
    <aside className="flex w-[272px] flex-none flex-col border-r border-border bg-side">
      <div className="flex flex-col gap-2 px-6 pt-5 pb-2">
        <div className="flex justify-between text-[12.5px] text-muted">
          <span>
            {viewedCount} of {fileCount} {fileCount === 1 ? "file" : "files"} viewed
          </span>
          <span>
            <span className="text-add">+{total.added}</span> <span className="text-del">−{total.removed}</span>
          </span>
        </div>
        <div className="h-[3px] rounded-sm bg-line">
          <div className="h-[3px] rounded-sm bg-fg" style={{ width: `${(viewedCount / fileCount) * 100}%` }} />
        </div>
      </div>
      <div
        ref={scroller}
        role="listbox"
        aria-label="Changed files"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") move(1);
          else if (e.key === "ArrowUp") move(-1);
          else return;
          e.preventDefault();
        }}
        className="min-h-0 flex-1 overflow-auto px-3 pb-4 outline-none"
      >
        <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
          {virtual.getVirtualItems().map((v) => {
            const item = items[v.index]!;
            return (
              <div
                key={itemKey(item)}
                data-index={v.index}
                ref={virtual.measureElement}
                className="absolute left-0 w-full pb-px"
                style={{ transform: `translateY(${v.start}px)` }}
              >
                {item.kind === "group" ? (
                  <div className="px-3 pt-3.5 pb-1.5 text-[11.5px] font-medium text-muted">{ROLE_NAMES[item.role]}</div>
                ) : (
                  <FileRow
                    file={item.file}
                    selected={item.file.path === selected}
                    comments={perFile.get(item.file.path) ?? 0}
                    links={links}
                    onSelect={select}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

const FileRow = memo(function FileRow({
  file,
  selected,
  comments,
  links,
  onSelect,
}: {
  file: FileDiff;
  selected: boolean;
  comments: number;
  links: Links | null;
  onSelect: (path: string) => void;
}) {
  const viewed = useStore((s) => s.viewed.has(file.path));
  const status = statusOf(file);
  const sub = [
    dirOf(file.path),
    file.status.kind === "renamed" ? `renamed from ${file.status.from}` : "",
    ...(links ? captionOf(links, file.path) : []),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div
      role="option"
      aria-selected={selected}
      onClick={() => onSelect(file.path)}
      className={`flex flex-col gap-[3px] rounded-[10px] px-3 py-[7px] ${selected ? "bg-row-sel" : "hover:bg-chip"}`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`min-w-0 flex-1 truncate text-[13.5px] ${selected ? "font-semibold" : ""} ${viewed && !selected ? "text-faint" : "text-fg"}`}
        >
          {file.path.split("/").pop()}
        </span>
        {comments > 0 && (
          <span className="text-xs text-muted" title={`${comments} ${comments === 1 ? "comment" : "comments"}`}>
            {comments}
          </span>
        )}
        <span title={status.label} className={`w-3 text-center font-mono text-[11.5px] font-medium ${status.tone}`}>
          {status.letter}
        </span>
        <span title={viewed ? "Viewed" : undefined} className="w-3 text-center text-[11px] text-muted">
          {viewed ? "✓" : ""}
        </span>
      </div>
      {sub && <span className="truncate text-xs leading-[1.4] text-muted">{sub}</span>}
    </div>
  );
});
