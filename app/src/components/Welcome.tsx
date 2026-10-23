import { useEffect } from "react";
import appIcon from "../../src-tauri/icons/128x128@2x.png";
import { chooseFolder } from "../choose";
import { idOf } from "../key";
import { useDelayed } from "../delay";
import { isMac, modKey } from "../platform";
import { useStore } from "../store";
import { CHECKING, recentReviews, reviewRow } from "../switcher";
import { Sym } from "./Icon";
import { LiveDot } from "./LiveDot";
import { Moved, Switcher } from "./Switcher";
import { TitleBar } from "./TitleBar";

/** How many reviews the welcome screen lists; the switcher lists them all. */
const LISTED = 8;

/** The window with no project open (ADR 0027, screen 1a): open one on the left, the recent reviews on the right. */
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
  const listed = recent.length > 0;

  return (
    <div className="relative flex h-full">
      <TitleBar className={listed ? "w-[380px]" : "w-full"} />
      <section
        aria-label="Open a project"
        className={`box-border flex flex-col items-center overflow-auto px-10 pt-[18px] pb-8 text-center ${listed ? "w-[380px] flex-none" : "flex-1"}`}
      >
        {/* Room for the window's controls, where the canvas draws them (macOS); the same height elsewhere keeps the layout. */}
        <div aria-hidden className="mt-1 h-4 flex-none" />
        <img src={appIcon} alt="" width={128} height={128} draggable={false} className="mt-[42px] flex-none" />
        <h1 className="m-0 mt-[18px] text-[28px] font-bold tracking-[-0.01em]">Diff Loop</h1>
        <p className="m-0 mt-1.5 text-[13px] leading-[1.45] text-[var(--sec)]">Review what your agent wrote, then hand it back.</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void chooseFolder()}
          title={`${modKey}O`}
          className="btnp btnl mt-8"
        >
          <Sym name="folderplus" />
          {slow ? "Opening…" : "Open Folder…"}
        </button>
        <p className="m-0 mt-2.5 text-[11px] text-[var(--sec)]">or drop a folder onto this window</p>
        {problem && (
          <div role="alert" className="mt-5 flex flex-col gap-0.5 rounded-[10px] bg-[var(--redbg)] px-3 py-2.5 text-left text-xs leading-[1.45]">
            <span className="font-semibold text-[var(--deltx)]">{problem.title}</span>
            <span>{problem.detail}</span>
          </div>
        )}
        <p className="m-0 mt-auto pt-6 text-[11px] leading-normal text-[var(--sec)]">
          Each branch you comment on becomes its own review, saved as you write.
        </p>
      </section>
      {/* With no review kept, ⌘/Ctrl-K still opens the switcher, which offers Open Folder… (diff-loop-app.md Decision 29). */}
      {!listed && (
        <Switcher open={switcher} onOpenChange={setSwitcher}>
          <span aria-hidden className="h-0" />
        </Switcher>
      )}
      {listed && (
        <section
          aria-label="Recent Reviews"
          className="side m-2 ml-0 min-w-0 flex-1"
        >
          <div data-tauri-drag-region={isMac ? "deep" : undefined} className="flex items-center px-3 pt-1.5 pb-2.5">
            <span className="text-[13px] font-semibold">Recent Reviews</span>
            <span className="flex-1" />
            <Switcher open={switcher} onOpenChange={setSwitcher}>
              {/* The cap on the card's colour: the field's is the sidebar card's own in light. */}
              <button type="button" className="kbd rounded-[5px] [&_b]:bg-[var(--card)]">
                All Reviews <b>{modKey}K</b>
              </button>
            </Switcher>
          </div>
          <div className="flex min-h-0 flex-col overflow-auto">
            {recent.map((review) => {
              const row = reviewRow(review, reviews.checks.get(review.key.project), home, now, null, checking);
              return (
                <button
                  type="button"
                  key={idOf(review.key)}
                  disabled={busy}
                  onClick={() => void pickReview(review.key)}
                  // Focus is a highlight with an inset ring, as in a list (HIG `focus-and-selection`).
                  className="rv flex-none px-3 py-[9px] text-left hover:bg-[var(--rowsel)] focus-visible:bg-[var(--rowsel)] focus-visible:-outline-offset-2"
                >
                  <LiveDot live={row.live} />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex min-w-0 gap-1.5 text-[13px]">
                      <span className="flex-none text-[var(--sec)]">{review.name}</span>
                      <span className="truncate">{review.key.branch}</span>
                    </span>
                    <span className="truncate text-[11px] text-[var(--sec)]" title={row.where}>
                      {row.where}
                    </span>
                  </span>
                  <span className="flex flex-none flex-col items-end gap-[3px] text-[11px] whitespace-nowrap text-[var(--sec)]">
                    <span className="flex gap-1">
                      {row.comments && <span className={`badge ${row.open ? "b-draft" : "b-ok"}`}>{row.comments}</span>}
                      <Moved moved={row.moved} />
                    </span>
                    <span>{row.round}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
