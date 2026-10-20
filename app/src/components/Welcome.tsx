import { useEffect } from "react";
import { chooseFolder } from "../choose";
import { idOf } from "../key";
import { useDelayed } from "../delay";
import { modKey } from "../platform";
import { useStore } from "../store";
import { CHECKING, recentReviews, reviewRow } from "../switcher";
import { Dot } from "./Dot";
import { Moved, Switcher } from "./Switcher";
import { TitleBar } from "./TitleBar";

/** How many reviews the welcome screen lists; the switcher lists them all. */
const LISTED = 8;

export function Welcome() {
  const problem = useStore((s) => s.openProblem);
  const busy = useStore((s) => s.busy);
  const slow = useDelayed(busy);
  const reviews = useStore((s) => s.reviews);
  const home = useStore((s) => s.home);
  const switcher = useStore((s) => s.switcher);
  const setSwitcher = useStore((s) => s.setSwitcher);
  const pickReview = useStore((s) => s.pickReview);
  const refreshReviews = useStore((s) => s.refreshReviews);
  // As the app starts, and each time it comes back here: reviews of deleted branches go (ADR 0026 §6).
  useEffect(() => void refreshReviews(), [refreshReviews]);
  const recent = recentReviews(reviews.kept ?? [], LISTED);
  // A project not checked yet says so only once the check has taken 200 ms (ADR 0010 §6).
  const checking = useDelayed(recent.some((r) => !reviews.checks.has(r.key.project))) ? CHECKING : "";
  const now = Date.now();

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="flex flex-1 justify-center overflow-auto pt-[120px]">
        <div className="flex w-[560px] flex-col gap-7">
          <div className="flex flex-col gap-2">
            <h1 className="m-0 text-[28px] font-semibold tracking-[-0.025em]">Open a project</h1>
            <p className="m-0 text-[15px] leading-[1.55] text-muted3">
              Choose a git folder. Each branch you comment on becomes its own review, saved as you write, and opens
              live from whichever worktree has it checked out.
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => void chooseFolder()}
              title={`${modKey}O`}
              className="rounded-full bg-btn px-5 py-2.5 font-medium text-btn-fg disabled:opacity-60"
            >
              {slow ? "Opening…" : "Open folder…"}
            </button>
            <span className="ml-2 text-[13px] text-muted">or drop a folder onto this window</span>
          </div>
          {problem && (
            <div role="alert" className="flex flex-col gap-1 rounded-[14px] bg-del-bg px-4 py-3.5 text-[13.5px] leading-[1.5]">
              <span className="font-semibold text-del">{problem.title}</span>
              <span>{problem.detail}</span>
            </div>
          )}
          {/* With no review kept, ⌘/Ctrl-K still opens the switcher, which offers Open folder… (diff-loop-app.md Decision 29). */}
          {recent.length === 0 && (
            <Switcher open={switcher} onOpenChange={setSwitcher}>
              <span aria-hidden className="h-0" />
            </Switcher>
          )}
          {recent.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between px-3.5 text-xs font-medium text-muted">
                <span>Reviews</span>
                <Switcher open={switcher} onOpenChange={setSwitcher}>
                  <button type="button" className="-my-0.5 flex gap-1.5 rounded-full bg-chip px-2.5 py-0.5 text-muted3">
                    Show all reviews<span className="font-mono text-[11.5px] text-muted2">{modKey}K</span>
                  </button>
                </Switcher>
              </div>
              {recent.map((review) => {
                const row = reviewRow(review, reviews.checks.get(review.key.project), home, now, null, checking);
                return (
                  <button
                    type="button"
                    key={idOf(review.key)}
                    disabled={busy}
                    onClick={() => void pickReview(review.key)}
                    className="grid grid-cols-[8px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 rounded-xl px-3.5 py-[11px] text-left hover:bg-chip focus-visible:bg-chip"
                  >
                    {/* Centred on both lines, as the switcher's rows place it. */}
                    <span className="row-span-2 flex self-center">
                      <Dot live={row.live} />
                    </span>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="font-medium">{review.name}</span>
                      <span className="truncate font-mono text-xs text-muted2">{review.key.branch}</span>
                      <Moved moved={row.moved} />
                    </span>
                    <span className={`text-right text-[12.5px] ${row.open ? "font-medium" : "text-muted"}`}>{row.comments}</span>
                    <span className="truncate text-xs text-muted">{row.where}</span>
                    <span className="text-right text-[12.5px] text-muted">{row.round}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
