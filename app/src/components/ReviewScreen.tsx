import * as Popover from "@radix-ui/react-popover";
import { useEffect } from "react";
import { notInDiff } from "../lifecycle";
import { isMac, modKey } from "../platform";
import { hunksOf } from "../rows";
import { bannerDetail, holdsReview, isLive, useStore } from "../store";
import { BasePicker } from "./BasePicker";
import { BottomBar } from "./BottomBar";
import { FilePane } from "./FilePane";
import { Sym } from "./Icon";
import { LiveDot } from "./LiveDot";
import { Sidebar } from "./Sidebar";
import { Switcher } from "./Switcher";

/** The canvas's window (ADR 0027 §5; diff-loop-app.md Decision 35): the sidebar card, and the main column under its toolbar. */
export function ReviewScreen() {
  const opening = useStore((s) => s.opening);
  const review = useStore((s) => s.review);
  const basePicker = useStore((s) => s.basePicker);
  const setBasePicker = useStore((s) => s.setBasePicker);
  const commentList = useStore((s) => s.commentList);
  const setCommentList = useStore((s) => s.setCommentList);
  const checkout = review?.checkout ?? opening?.checkout;
  if (!checkout) return null;

  return (
    <div className="flex h-full gap-2 p-2">
      <Sidebar />
      <main className="relative flex min-w-0 flex-1 flex-col px-4">
        <Popover.Root open={commentList} onOpenChange={setCommentList}>
          {/* The title bar on macOS, which drags the window (diff-loop-app.md Decision 34); a capsule takes its own clicks. */}
          <div role="toolbar" aria-label="Review" data-tauri-drag-region={isMac || undefined} className="tb">
            <div className="relative flex items-center gap-2">
              <ReviewChip />
              <BasePicker open={basePicker} onOpenChange={setBasePicker} />
            </div>
            <span data-tauri-drag-region={isMac || undefined} className="h-full grow" />
            <LayoutToggle />
          </div>
          <Banner />
          <UndoBar />
          <SaveProblem />
          <FilePane />
          <BottomBar />
        </Popover.Root>
      </main>
    </div>
  );
}

/** Unified or Split, for a file with lines to show: the canvas's segmented capsule. */
function LayoutToggle() {
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const hasDiff = useStore((s) => {
    const file = s.selected === null ? undefined : s.review?.byPath.get(s.selected);
    return file !== undefined && hunksOf(file).length > 0;
  });
  if (!hasDiff) return null;
  const option = (m: typeof mode, label: string) => (
    <button type="button" role="radio" aria-checked={mode === m} aria-label={label} title={label} onClick={() => setMode(m)}>
      <Sym name={m} />
    </button>
  );
  return (
    <div role="radiogroup" aria-label="Diff layout" className="cap seg">
      {option("unified", "Unified")}
      {option("split", "Split")}
    </div>
  );
}

/** Why a review is limited, or that there is none yet: said on hover, as the canvas draws the capsule without it. */
function chipNote(s: { worktree: string | null; detached: boolean; kept: boolean }): string | undefined {
  if (s.detached) return "Detached HEAD";
  if (s.worktree === null) return "Committed only. Not checked out in any worktree; showing committed changes only.";
  return s.kept ? undefined : "No review yet";
}

/** The project and branch the window shows, which opens the review switcher (ADR 0026 §7; the canvas's 6a). */
function ReviewChip() {
  const checkout = useStore((s) => s.review?.checkout ?? s.opening?.checkout);
  const kept = useStore(holdsReview);
  const live = useStore(isLive);
  const switcher = useStore((s) => s.switcher);
  const setSwitcher = useStore((s) => s.setSwitcher);
  if (!checkout) return null;
  const { head } = checkout;
  const note = chipNote({ worktree: checkout.worktree, detached: head.kind === "detached", kept });
  const branch = head.kind === "branch" ? head.name : `HEAD at ${head.commit}`;
  return (
    <>
      <Switcher open={switcher} onOpenChange={setSwitcher}>
        <button type="button" className="cap" title={note} aria-label={`${checkout.name} ${branch}${note ? `, ${note}` : ""}. Switch review, ${modKey}K`}>
          {/* Read from commits alone, the hollow dot stands in for the branch symbol (the canvas's rules note). */}
          {live ? <Sym name="branch" /> : <LiveDot live={false} />}
          <span className="k">{checkout.name}</span>
          <span>{branch}</span>
        </button>
      </Switcher>
      <ReviewSaved />
    </>
  );
}

/** Once, as the first comment starts a review: where to find it again (the design's 6e). */
function ReviewSaved() {
  const saved = useStore((s) => s.reviewSaved);
  const branch = useStore((s) => s.key?.branch);
  const dismiss = useStore((s) => s.dismissReviewSaved);
  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(dismiss, 6000);
    return () => window.clearTimeout(timer);
  }, [saved, dismiss]);
  if (!saved || !branch) return null;
  return (
    <div role="status" className="pop-body absolute top-[calc(100%+10px)] left-0 z-30 flex w-[260px] flex-col gap-1 px-4 py-3.5 text-[13px] leading-[1.45]">
      <span className="flex items-center justify-between gap-3">
        <b className="font-semibold">Review Saved</b>
        <button type="button" className="btnplain h-auto text-xs" onClick={dismiss}>
          Dismiss
        </button>
      </span>
      <span className="text-xs text-[var(--sec)]">
        {branch} is with your reviews now, under {modKey}K. Every comment is saved as you write it.
      </span>
    </div>
  );
}

/** The canvas's banner (6g; its rules note lists the variants): symbol, title over detail, actions, and close. */
function BannerCard({
  role = "status",
  title,
  detail,
  label,
  onClose,
  children,
}: {
  role?: "status" | "alert";
  title: string;
  detail?: string;
  label: string;
  onClose?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div role={role} aria-label={label} className="banner mb-2 flex-none">
      <Sym name="warning" className="text-[var(--amber)]" />
      <div className="txt">
        <b>{title}</b>
        {detail && <span className="text-pretty">{detail}</span>}
      </div>
      {children}
      {onClose && (
        <button type="button" className="x" aria-label="Dismiss" title="Dismiss" onClick={onClose}>
          <Sym name="xmark" />
        </button>
      )}
    </div>
  );
}

/**
 * The context of the review changed, or is limited: a moved, rewritten or switched branch, a
 * branch moved while away, a detached `HEAD` (ADR 0015 §10, ADR 0026).
 */
function Banner() {
  const banner = useStore((s) => s.banner);
  const takeAction = useStore((s) => s.takeBannerAction);
  const dismiss = useStore((s) => s.dismissBanner);
  const notInDiffCount = useStore((s) => (s.banner ? s.comments.filter(notInDiff).length : 0));
  const setCommentList = useStore((s) => s.setCommentList);
  if (!banner) return null;
  const detail = [banner.body, bannerDetail(notInDiffCount)].filter(Boolean).join(" ");
  return (
    <BannerCard title={banner.title} detail={detail} label={banner.title} onClose={dismiss}>
      {notInDiffCount > 0 && (
        <button type="button" className="btn" onClick={() => setCommentList(true)}>
          Show Comments
        </button>
      )}
      {banner.action && (
        <button type="button" className="btn" onClick={() => void takeAction()}>
          {banner.action.label}
        </button>
      )}
    </BannerCard>
  );
}

/**
 * Undo for deleting comments, or placing a lost one, offered for 10 s or until
 * the next one replaces it. The 10 s wait while the preview covers the bar
 * (HIG undo-and-redo: no needless limit on undoing), and start over once it closes.
 */
function UndoBar() {
  const undo = useStore((s) => s.undo);
  const covered = useStore((s) => s.preview);
  const undoLast = useStore((s) => s.undoLast);
  const clearUndo = useStore((s) => s.clearUndo);
  useEffect(() => {
    if (!undo || covered) return;
    const timer = window.setTimeout(clearUndo, 10000);
    return () => window.clearTimeout(timer);
  }, [undo, covered, clearUndo]);
  if (!undo) return null;
  return (
    <BannerCard title={undo.label} label={undo.label} onClose={clearUndo}>
      <button type="button" className="btn" onClick={undoLast}>
        Undo
      </button>
    </BannerCard>
  );
}

/** The open checkout's comments are not being kept between runs. */
function SaveProblem() {
  const problem = useStore((s) => s.saveProblem);
  const retrySave = useStore((s) => s.retrySave);
  if (!problem) return null;
  return (
    <BannerCard role="alert" title={problem.title} detail={`${problem.detail}. Comments stay in this window until it closes.`} label={problem.title}>
      <button type="button" className="btn" onClick={() => void retrySave()}>
        Try Again
      </button>
    </BannerCard>
  );
}
