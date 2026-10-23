import * as Popover from "@radix-ui/react-popover";
import { useMemo, useState, type ReactNode } from "react";
import { chooseFolder } from "../choose";
import { idOf } from "../key";
import { modKey } from "../platform";
import { useStore } from "../store";
import { useDelayed } from "../delay";
import { CHECKING, listing, type Row } from "../switcher";
import { LiveDot } from "./LiveDot";
import { PopArrow } from "./PopArrow";
import { Sym } from "./Icon";

const HINTS: [string[], string][] = [
  [["↑", "↓"], "Move"],
  [["↩"], "Open"],
];

/** "Its review and 2 comments were deleted with it.", as the design's 6k says it. */
function deletedWith(comments: number): string {
  if (comments === 0) return "Its review was deleted with it. There is no copy to restore.";
  return `Its review and ${comments} ${comments === 1 ? "comment" : "comments"} were deleted with it. There is no copy to restore.`;
}

/** That a review's branch moved or was rewritten since it was last shown, as the canvas's badge. */
export function Moved({ moved }: { moved: string | null }) {
  if (!moved) return null;
  return <span className="badge b-changed flex-none">{moved}</span>;
}

/** A notice in the switcher: a deleted branch's (6k), or a review another window shows (6m). */
function Notice({ title, body, onDismiss }: { title: string; body: string; onDismiss: () => void }) {
  return (
    <div role="status" className="mx-1.5 mb-1.5 flex items-start gap-3 rounded-[10px] bg-[var(--side)] px-3 py-2.5 text-[13px] leading-[1.5] shadow-[inset_0_0_0_1px_var(--sep)]">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-medium">{title}</span>
        <span className="text-[var(--sec)]">{body}</span>
      </div>
      <button type="button" className="flex-none text-[var(--sec)]" onClick={onDismiss}>
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
    const hi = i === at;
    const common = {
      type: "button" as const,
      role: "option",
      "aria-selected": hi,
      onMouseEnter: () => setActive(i),
      onClick: () => pick(row),
    };
    // The canvas's `.rv`, whose sizes are its screen's own rules (ADR 0027).
    const look = `rv mx-1.5 px-3 py-[7px] text-left ${hi ? "hi" : ""}`;
    if (row.kind === "openFolder") {
      return (
        <button key="open" {...common} className={look}>
          <span className="w-2 flex-none" />
          <span className="min-w-0 flex-1 text-[13px]">Open Folder…</span>
          <span className="kbd">
            <b>{modKey}O</b>
          </span>
        </button>
      );
    }
    return (
      <button key={idOf(row.key)} {...common} aria-current={row.current || undefined} className={look}>
        <LiveDot live={row.live} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5 text-[13px]">
            <span className="truncate">{row.key.branch}</span>
            {row.current && (
              <span role="img" aria-label="Current review" className={`flex ${hi ? "" : "text-[var(--accent)]"}`}>
                <Sym name="check" />
              </span>
            )}
            {row.kind === "review" && <Moved moved={row.moved} />}
          </span>
          <span className="k2 truncate text-[11px]" title={row.where}>
            {row.where}
          </span>
        </span>
        <span className="k2 flex flex-none flex-col items-end gap-0.5 text-[11px] whitespace-nowrap tabular-nums">
          {row.kind === "review" ? (
            <>
              <b className={`font-semibold ${!row.open && row.comments && !hi ? "text-[var(--addtx)]" : ""}`}>{row.comments}</b>
              <span>{row.round}</span>
            </>
          ) : (
            !row.current && <span>Open without saving</span>
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
          sideOffset={12}
          aria-label="Switch review"
          className="pop-body z-40 flex max-h-[min(640px,calc(100vh-80px))] w-[560px] flex-col text-[var(--label)] outline-none"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") step(1);
            else if (e.key === "ArrowUp") step(-1);
            else if (e.key === "Enter") pick(rows[at]);
            else return;
            e.preventDefault();
          }}
        >
          <PopArrow />
          {/* Drawn flat, as the base picker's field is: the highlighted row shows where Return goes (`ux` skill). */}
          <label className="search mt-3 flex-none">
            <Sym name="search" />
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              placeholder="Search Reviews and Branches"
              aria-label="Search reviews and branches"
              className="placeholder:text-[var(--sec)]"
            />
            <span className="kbd">
              <b>{modKey}K</b>
            </span>
          </label>
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
            <div className="mx-1.5 flex flex-none flex-col gap-1 px-3 pt-2.5 pb-3">
              <span className="text-[15px] font-semibold">{empty.title}</span>
              <span className="text-[13px] leading-[1.5] text-[var(--sec)]">{empty.body}</span>
            </div>
          )}
          <div role="listbox" aria-label="Reviews and branches" className="flex min-h-0 flex-col overflow-auto">
            {groups.map((g, gi) => (
              <div key={g.key} className="flex flex-col">
                {gi > 0 && <div className="lisep" />}
                {g.name && (
                  <div className="grp">
                    {g.name}
                    <span className="min-w-0 truncate">{g.meta}</span>
                  </div>
                )}
                {g.rows.map((row, r) => rowView(row, starts[gi]! + r))}
              </div>
            ))}
          </div>
          <div className="foot mt-2 flex-none gap-4">
            {HINTS.map(([keys, label]) => (
              <span key={label} className="kbd">
                {keys.map((k) => (
                  <b key={k}>{k}</b>
                ))}
                {label}
              </span>
            ))}
            <span className="grow" />
            <span className="kbd">
              <b>esc</b>
              Close
            </span>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
