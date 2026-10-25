import * as Popover from "@radix-ui/react-popover";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { useDelayed } from "../delay";
import { idOf } from "../key";
import { nameOf, projectRoot } from "../path";
import { useStore } from "../store";
import { listing, type Row } from "../switcher";
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
 * The branch switcher (ADR 0035; the canvas's 6a, 6b), in the base picker's popover: the project's recent branches,
 * then its local branches and each remote's, opening in place; typing searches them all. `children` opens it.
 */
export function Switcher({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }) {
  const project = useStore((s) => s.opening?.checkout.project ?? null);
  const key = useStore((s) => s.key);
  const reviews = useStore((s) => s.reviews);
  const gone = useStore((s) => s.gone);
  const elsewhere = useStore((s) => s.elsewhere);
  const busy = useStore((s) => s.busy);
  const pickReview = useStore((s) => s.pickReview);
  const dismissGone = useStore((s) => s.dismissGone);
  const dismissElsewhere = useStore((s) => s.dismissElsewhere);
  const [query, setQuery] = useState("");
  /** The list opened in place, by key and title; null for the first view. */
  const [list, setList] = useState<{ key: string; title: string } | null>(null);
  const [active, setActive] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  const check = project === null ? undefined : reviews.checks.get(project);
  // Said only once the check has taken 200 ms (ADR 0010 §6).
  const checking = useDelayed(check === undefined);
  const shown = key?.branch ?? null;
  // Per answer and keystroke, not per render: a project can have thousands of branches.
  const sections = useMemo(
    () =>
      listing({
        query,
        list: list?.key ?? null,
        check,
        kept: (reviews.kept ?? []).filter((r) => r.key.project === project),
        shown,
        now: Date.now(),
      }),
    [query, list, check, reviews.kept, project, shown],
  );
  const rows = sections.flatMap((s) => s.rows);
  // Where each section's rows start among all of them, for the highlight.
  const starts = sections.map((_, i) => sections.slice(0, i).reduce((n, earlier) => n + earlier.rows.length, 0));
  // Each time it opens: the first view, the search empty, the branch shown highlighted at Recent's top, so Return keeps it.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setQuery("");
      setList(null);
      setActive(0);
    }
  }
  const at = Math.min(active, rows.length - 1);

  /** Opens `next`'s list in place, or with `null` goes back to the first view. */
  const enter = (next: { key: string; title: string } | null) => {
    setQuery("");
    setList(next);
    setActive(0);
  };
  const pick = (row: Row | undefined) => {
    if (!row || busy) return;
    if (row.kind === "list") return enter({ key: row.key, title: row.title });
    if (project !== null) void pickReview({ project, branch: row.name });
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
    if (row.kind === "list") {
      return (
        <button key={row.key} {...common} className={`li ${hi ? "hi" : ""}`}>
          <span className="w-3.5 flex-none" />
          <span className="truncate">{row.title}</span>
          <span className="r tabular-nums">
            <span>{row.trail}</span>
            <Sym name="right" />
          </span>
        </button>
      );
    }
    return (
      <button key={row.name} {...common} aria-current={row.current || undefined} className={`li ${hi ? "hi" : ""}`}>
        <span className="ck">{row.current && <Sym name="check" />}</span>
        <span className="truncate">{row.name}</span>
        <span className="r tabular-nums" title={row.title}>
          {row.open > 0 && <span className="badge b-draft">{row.open} open</span>}
          <span>{row.age}</span>
        </span>
      </button>
    );
  };

  const searching = query.trim() !== "";
  const search = list === null ? "Search Branches" : `Search ${list.title}`;
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={12}
          aria-label="Switch branch"
          className="pop-body z-40 flex max-h-[min(640px,calc(100vh-80px))] w-[400px] flex-col pb-1 text-[var(--label)] outline-none"
          // Esc in an opened list goes back to the first view; there, it closes.
          onEscapeKeyDown={(e) => {
            if (list === null) return;
            e.preventDefault();
            enter(null);
          }}
          onKeyDown={(e) => {
            const row = rows[at];
            if (e.key === "ArrowDown") step(1);
            else if (e.key === "ArrowUp") step(-1);
            else if (e.key === "Enter") pick(row);
            else if (e.key === "ArrowRight" && !query && row?.kind === "list") pick(row);
            else if (e.key === "ArrowLeft" && !query && list !== null) enter(null);
            else return;
            e.preventDefault();
          }}
        >
          <PopArrow />
          {list !== null && (
            <button type="button" onClick={() => enter(null)} aria-label={`Back from ${list.title}`} className="lihead mt-1.5 text-left">
              <Sym name="back" />
              <span className="truncate">{list.title}</span>
            </button>
          )}
          <label className={`search ${list !== null ? "mt-1" : ""}`}>
            <Sym name="search" />
            <input
              autoFocus
              // A new field per list, so focus lands in it on arrival.
              key={list?.key ?? "top"}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              placeholder={search}
              aria-label={search}
              className="placeholder:text-[var(--sec)]"
            />
          </label>
          {elsewhere && <Notice title={elsewhere.title} body={elsewhere.detail} onDismiss={dismissElsewhere} />}
          {/* Every project the refresh checked, so a review deleted with its branch is said once (ADR 0026 §6); another
              project's names it. */}
          {gone.map((g) => (
            <Notice
              key={idOf(g.key)}
              title={`${g.key.project === project ? "" : `${nameOf(projectRoot(g.key.project))} · `}${g.key.branch} was deleted`}
              body={deletedWith(g.comments)}
              onDismiss={dismissGone}
            />
          ))}
          <div role="listbox" aria-label="Branches" className="flex min-h-0 flex-col overflow-auto">
            {sections.map((s, si) => (
              <Fragment key={s.key}>
                {si > 0 && !s.title && <div className="lisep flex-none" />}
                {s.title && (
                  <div className={`lihead ${si > 0 ? "mt-1.5" : ""}`}>
                    <span>{s.title}</span>
                    {searching && <span className="font-medium tabular-nums">{s.rows.length}</span>}
                  </div>
                )}
                {s.rows.map((row, r) => rowView(row, starts[si]! + r))}
              </Fragment>
            ))}
            {searching && rows.length === 0 && <span className="px-[18px] py-2 text-[13px] text-[var(--sec)]">No matching branch</span>}
            {check === undefined && checking && <span className="px-[18px] py-1.5 text-[11px] text-[var(--sec)]">Checking…</span>}
            {check === "failed" && <span className="px-[18px] py-1.5 text-[11px] text-[var(--sec)]">Couldn’t read this project’s branches. Close and reopen this to try again.</span>}
          </div>
          <div className="foot mt-1 flex-none gap-4">
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
