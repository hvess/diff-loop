import * as Popover from "@radix-ui/react-popover";
import { useEffect } from "react";
import { notInDiff } from "../lifecycle";
import { bannerDetail, holdsReview, isLive, useStore } from "../store";
import { BasePicker } from "./BasePicker";
import { Dot } from "./Dot";
import { Switcher } from "./Switcher";
import { modKey } from "../platform";
import { FilePane } from "./FilePane";
import { ReviewActions } from "./ReviewActions";
import { Sidebar } from "./Sidebar";
import { TitleBar } from "./TitleBar";

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
    <div className="flex h-full flex-col">
      <Popover.Root open={commentList} onOpenChange={setCommentList}>
        <TitleBar>
          <div className="relative flex items-center gap-3.5">
            <ReviewChip />
            <BasePicker open={basePicker} onOpenChange={setBasePicker} />
          </div>
          <ReviewActions />
        </TitleBar>
        <Banner />
        <UndoBar />
        {/* Anchors the comments list (ReviewActions) below the banner and the undo bar; the banner's Show comments opens it too. */}
        <Popover.Anchor asChild>
          <div className="mx-6 flex-none" />
        </Popover.Anchor>
      </Popover.Root>
      <SaveProblem />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <FilePane />
      </div>
    </div>
  );
}

/** What the title bar's chip says after the branch: why the review is limited, or that there is none yet (the design's 6d, 6i, 6l). */
function chipTag(s: { worktree: string | null; detached: boolean; kept: boolean }): { tag: string; why?: string } | null {
  if (s.detached) return { tag: "Detached" };
  if (s.worktree === null) return { tag: "Committed only", why: "Not checked out in any worktree. Showing committed changes only." };
  return s.kept ? null : { tag: "No review yet" };
}

/** The project and branch the window shows, which opens the review switcher (ADR 0026 §7; the design's 6a). */
function ReviewChip() {
  const checkout = useStore((s) => s.review?.checkout ?? s.opening?.checkout);
  const kept = useStore(holdsReview);
  const live = useStore(isLive);
  const switcher = useStore((s) => s.switcher);
  const setSwitcher = useStore((s) => s.setSwitcher);
  if (!checkout) return null;
  const { head } = checkout;
  const tag = chipTag({ worktree: checkout.worktree, detached: head.kind === "detached", kept });
  return (
    <>
      <Switcher open={switcher} onOpenChange={setSwitcher}>
        <button type="button" className="flex items-center gap-2 rounded-full bg-chip py-1.5 pr-2.5 pl-3 text-[13px]">
          <Dot live={live} />
          <span className="font-medium">{checkout.name}</span>
          <span className="text-faint">/</span>
          <span className="font-mono text-[12.5px] text-muted2">{head.kind === "branch" ? head.name : `HEAD at ${head.commit}`}</span>
          {tag && (
            <span className="border-l border-line pl-2 text-xs text-muted" title={tag.why}>
              {tag.tag}
            </span>
          )}
          <span aria-hidden className="text-[10px] text-faint">
            ▾
          </span>
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
    <div
      role="status"
      className="absolute top-[calc(100%+8px)] left-0 z-30 flex w-[240px] flex-col gap-1 rounded-xl border border-line bg-bg px-3.5 py-3 text-[13px] leading-[1.5] shadow-pop"
    >
      <span className="flex items-baseline justify-between gap-3">
        <span className="text-[13.5px] font-semibold">Review saved</span>
        <button type="button" className="text-[12.5px] text-muted3" onClick={dismiss}>
          Dismiss
        </button>
      </span>
      <span className="text-muted3">
        {branch} is with your reviews now, under {modKey}K. Every comment is saved as you write it.
      </span>
    </div>
  );
}

/**
 * The context of the review changed, or is limited: a moved, rewritten or switched branch, a
 * branch moved while away, a detached `HEAD` (ADR 0015 §10, ADR 0026). Its dot is the title
 * bar's: solid while the diff is read live from a worktree, a detached `HEAD`'s included, hollow
 * from commits alone.
 */
function Banner() {
  const banner = useStore((s) => s.banner);
  const live = useStore(isLive);
  const takeAction = useStore((s) => s.takeBannerAction);
  const dismiss = useStore((s) => s.dismissBanner);
  const notInDiffCount = useStore((s) => (s.banner ? s.comments.filter(notInDiff).length : 0));
  const setCommentList = useStore((s) => s.setCommentList);
  if (!banner) return null;
  const detail = [banner.body, bannerDetail(notInDiffCount)].filter(Boolean).join(" ");
  return (
    // Aligned on the first line, so a detail that wraps leaves the title and actions beside its start.
    <div role="status" className="flex flex-none items-start gap-3 border-b border-border bg-side px-6 py-2.5 text-[13px]">
      <span className="flex h-[1lh] flex-none items-center">
        <Dot live={live} />
      </span>
      <span className="flex-none font-medium">{banner.title}</span>
      {detail && <span className="min-w-0 text-pretty text-muted3">{detail}</span>}
      <span className="ml-auto flex flex-none gap-3 whitespace-nowrap">
        {notInDiffCount > 0 && (
          <button type="button" className="font-medium" onClick={() => setCommentList(true)}>
            Show comments
          </button>
        )}
        {banner.action && (
          <button type="button" className="font-medium" onClick={() => void takeAction()}>
            {banner.action.label}
          </button>
        )}
        <button type="button" className="text-muted3" onClick={dismiss}>
          Dismiss
        </button>
      </span>
    </div>
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
    <div
      role="status"
      className="flex flex-none items-center gap-3 border-b border-border bg-side px-6 py-2 text-[13px]"
    >
      <span>{undo.label}</span>
      <button type="button" className="font-medium" onClick={undoLast}>
        Undo
      </button>
    </div>
  );
}

/** The open checkout's comments are not being kept between runs. */
function SaveProblem() {
  const problem = useStore((s) => s.saveProblem);
  const retrySave = useStore((s) => s.retrySave);
  if (!problem) return null;
  return (
    <div role="alert" className="flex flex-none items-center gap-3 border-b border-border bg-side px-6 py-2 text-[13px]">
      <span className="font-medium">{problem.title}</span>
      <span className="min-w-0 truncate text-muted" title={problem.detail}>
        {problem.detail}. Comments stay in this window until it closes.
      </span>
      <button type="button" className="ml-auto flex-none font-medium" onClick={() => void retrySave()}>
        Try again
      </button>
    </div>
  );
}
