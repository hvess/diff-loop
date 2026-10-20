import * as Popover from "@radix-ui/react-popover";
import { useMemo, useState, type ReactNode } from "react";
import { chooseFolder } from "../choose";
import { idOf } from "../key";
import { modKey } from "../platform";
import { useStore } from "../store";
import { useDelayed } from "../delay";
import { CHECKING, listing, type Row } from "../switcher";
import { Dot } from "./Dot";

const HINTS: [string, string][] = [
  ["↑↓", "Move"],
  ["↩", "Open"],
  ["Esc", "Close"],
];

/** "Its review and 2 comments were deleted with it.", as the design's 6k says it. */
function deletedWith(comments: number): string {
  if (comments === 0) return "Its review was deleted with it. There is no copy to restore.";
  return `Its review and ${comments} ${comments === 1 ? "comment" : "comments"} were deleted with it. There is no copy to restore.`;
}

/** That a review's branch moved or was rewritten since it was last shown, as its row says it. */
export function Moved({ moved }: { moved: { label: string; rewritten: boolean } | null }) {
  if (!moved) return null;
  return (
    <span
      className={`flex-none rounded-full px-2 text-[11.5px] leading-[18px] font-medium ${moved.rewritten ? "shadow-[inset_0_0_0_1px_var(--color-ghost)]" : "bg-chip"}`}
    >
      {moved.label}
    </span>
  );
}

/** A notice in the switcher: a deleted branch's (6k), or a review another window shows (6m). */
function Notice({ title, body, onDismiss }: { title: string; body: string; onDismiss: () => void }) {
  return (
    <div role="status" className="mx-1.5 mb-1.5 flex items-start gap-3 rounded-[10px] bg-side px-3 py-2.5 text-[13px] leading-[1.5] shadow-[inset_0_0_0_1px_var(--color-border)]">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-medium">{title}</span>
        <span className="text-muted3">{body}</span>
      </div>
      <button type="button" className="flex-none text-muted3" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

/**
 * The review switcher (ADR 0026 §7; the design's 6a–6m): every kept review, this project's first,
 * branches to look at, and opening a folder. `children` is what opens it.
 */
export function Switcher({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }) {
  const opening = useStore((s) => s.opening);
  const key = useStore((s) => s.key);
  const reviews = useStore((s) => s.reviews);
  const home = useStore((s) => s.home);
  const gone = useStore((s) => s.gone);
  const elsewhere = useStore((s) => s.elsewhere);
  const busy = useStore((s) => s.busy);
  const pickReview = useStore((s) => s.pickReview);
  const dismissGone = useStore((s) => s.dismissGone);
  const dismissElsewhere = useStore((s) => s.dismissElsewhere);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  // A project not checked yet says so only once the check has taken 200 ms (ADR 0010 §6).
  const pending = (reviews.kept ?? []).some((r) => !reviews.checks.has(r.key.project));
  const checking = useDelayed(pending) ? CHECKING : "";
  const project = opening?.checkout.project ?? null;
  const name = opening?.checkout.name ?? "";
  // Per answer and keystroke, not per render: a project can have thousands of branches.
  const { empty, groups } = useMemo(
    () =>
      listing({
        query,
        shown: project === null ? null : { key, project, name },
        kept: reviews.kept ?? [],
        checks: reviews.checks,
        home,
        now: Date.now(),
        checking,
      }),
    [query, key, project, name, reviews, home, checking],
  );
  const rows = groups.flatMap((g) => g.rows);
  // Where each group's rows start among all of them, for the highlight.
  const starts = groups.map((_, g) => groups.slice(0, g).reduce((n, earlier) => n + earlier.rows.length, 0));
  const current = rows.findIndex((r) => r.kind !== "openFolder" && r.current);

  // Each time it opens, the search is empty and the review shown is highlighted, so Return keeps it.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setQuery("");
      setActive(Math.max(0, current));
    }
  }
  const at = Math.min(active, rows.length - 1);

  const pick = (row: Row | undefined) => {
    if (!row || busy) return;
    if (row.kind === "openFolder") {
      onOpenChange(false);
      void chooseFolder();
      return;
    }
    void pickReview(row.key);
  };

  const step = (by: 1 | -1) => setActive(Math.min(rows.length - 1, Math.max(0, at + by)));

  const rowView = (row: Row, i: number) => {
    const common = {
      type: "button" as const,
      role: "option",
      "aria-selected": i === at,
      onMouseEnter: () => setActive(i),
      onClick: () => pick(row),
    };
    const highlight = i === at ? "bg-chip" : "";
    if (row.kind === "openFolder") {
      return (
        <button key="open" {...common} className={`grid grid-cols-[16px_10px_minmax(0,1fr)_auto] items-center gap-x-2 rounded-lg px-2.5 py-[7px] text-left ${highlight}`}>
          <span />
          <span />
          <span>Open folder…</span>
          <span className="font-mono text-[11.5px] text-muted">{modKey}O</span>
        </button>
      );
    }
    return (
      <button key={idOf(row.key)} {...common} className={`grid grid-cols-[16px_10px_minmax(0,1fr)_auto] items-center gap-x-2 rounded-lg px-2.5 py-[7px] text-left ${highlight}`}>
        <span className="flex justify-center">
          <Dot live={row.live} />
        </span>
        {/* The review on screen, marked in a column of its own as the base picker marks its base. */}
        <span aria-label={row.current ? "Shown" : undefined} className="text-xs font-semibold">
          {row.current && "✓"}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-mono text-[12.5px]">{row.key.branch}</span>
            {row.kind === "review" && <Moved moved={row.moved} />}
          </span>
          <span className="truncate text-xs text-muted">{row.where}</span>
        </span>
        <span className="flex flex-col items-end gap-0.5 tabular-nums">
          {row.kind === "review" ? (
            <>
              <span className={`text-[12.5px] ${row.open ? "font-medium" : "text-muted"}`}>{row.comments}</span>
              <span className="text-xs text-muted">{row.round}</span>
            </>
          ) : (
            !row.current && <span className="text-xs text-muted">Open without saving</span>
          )}
        </span>
      </button>
    );
  };

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={8}
          aria-label="Reviews"
          className="z-40 flex max-h-[min(640px,calc(100vh-80px))] w-[600px] flex-col overflow-hidden rounded-[14px] border border-line bg-bg text-[13.5px] shadow-pop"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") step(1);
            else if (e.key === "ArrowUp") step(-1);
            else if (e.key === "Enter") pick(rows[at]);
            else return;
            e.preventDefault();
          }}
        >
          <div className="p-1.5">
            {/* Drawn flat, as the base picker's field is: the highlighted row shows where Return goes (`ux` skill). */}
            <div className="flex h-9 items-center gap-2.5 rounded-lg bg-chip px-3">
              <input
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                placeholder="Search reviews and branches"
                aria-label="Search reviews and branches"
                className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-faint"
              />
              <span className="font-mono text-[11.5px] text-muted">{modKey}K</span>
            </div>
          </div>
          {elsewhere && <Notice title={elsewhere.title} body={elsewhere.detail} onDismiss={dismissElsewhere} />}
          {gone.map((g) => (
            <Notice
              key={idOf(g.key)}
              title={`${g.key.branch} was deleted`}
              body={deletedWith(g.comments)}
              onDismiss={dismissGone}
            />
          ))}
          {empty && (
            <div className="mx-1.5 flex flex-col gap-1 border-b border-border px-2.5 pt-3.5 pb-4">
              <span className="text-[15px] font-semibold">{empty.title}</span>
              <span className="text-[13px] leading-[1.5] text-muted3">{empty.body}</span>
            </div>
          )}
          <div role="listbox" aria-label="Reviews and branches" className="flex min-h-0 flex-col overflow-auto pb-1.5">
            {groups.map((g, gi) => (
              <div key={g.key} className="flex flex-col">
                {g.name && (
                  <div className="flex justify-between gap-3 px-4 pt-2.5 pb-1 text-xs">
                    <span className="font-medium text-muted3">{g.name}</span>
                    <span className={`truncate text-muted ${g.metaIsPath ? "font-mono text-[11.5px]" : "text-xs"}`}>{g.meta}</span>
                  </div>
                )}
                {!g.name && <div className="mx-4 my-1.5 h-px bg-border" />}
                <div className="flex flex-col gap-px px-1.5">{g.rows.map((row, r) => rowView(row, starts[gi]! + r))}</div>
              </div>
            ))}
          </div>
          <div className="flex gap-[18px] border-t border-border px-4 py-[9px] text-xs text-muted">
            {HINTS.map(([keys, label]) => (
              <span key={label} className="flex items-center gap-1.5">
                <span className="font-mono text-[11.5px] text-muted2">{keys}</span>
                {label}
              </span>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
