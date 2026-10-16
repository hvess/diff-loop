import * as Popover from "@radix-ui/react-popover";
import { useEffect } from "react";
import { notInDiff } from "../lifecycle";
import { bannerDetail, useStore } from "../store";
import { BasePicker } from "./BasePicker";
import { FilePane } from "./FilePane";
import { ReviewActions } from "./ReviewActions";
import { Sidebar } from "./Sidebar";
import { TitleBar } from "./TitleBar";

export function ReviewScreen() {
  const opening = useStore((s) => s.opening);
  const review = useStore((s) => s.review);
  const closeRepository = useStore((s) => s.closeRepository);
  const basePicker = useStore((s) => s.basePicker);
  const setBasePicker = useStore((s) => s.setBasePicker);
  const commentList = useStore((s) => s.commentList);
  const setCommentList = useStore((s) => s.setCommentList);
  const checkout = review?.checkout ?? opening?.checkout;
  if (!checkout) return null;
  const head = checkout.head;

  return (
    <div className="flex h-full flex-col">
      <Popover.Root open={commentList} onOpenChange={setCommentList}>
        <TitleBar>
          <div className="flex items-center gap-3.5">
            <button
              type="button"
              onClick={closeRepository}
              title="Open another repository"
              className="flex items-center gap-2 rounded-full bg-chip px-3 py-1.5 text-[13px]"
            >
              <span className="font-medium">{checkout.name}</span>
              <span className="text-faint">/</span>
              <span className="font-mono text-[12.5px] text-muted2">
                {head.kind === "branch" ? head.name : `HEAD detached at ${head.commit}`}
              </span>
            </button>
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

/** The checkout changed under the review: a switched, moved or rewritten branch (ADR 0015 §10). */
function Banner() {
  const banner = useStore((s) => s.banner);
  const showWhatChanged = useStore((s) => s.showWhatChanged);
  const dismiss = useStore((s) => s.dismissBanner);
  const notInDiffCount = useStore((s) => (s.banner ? s.comments.filter(notInDiff).length : 0));
  const setCommentList = useStore((s) => s.setCommentList);
  if (!banner) return null;
  const detail = bannerDetail(notInDiffCount);
  return (
    <div role="status" className="flex flex-none items-center gap-3 border-b border-border bg-side px-6 py-2.5 text-[13px]">
      <span className="size-[7px] flex-none rounded-full bg-live" />
      <span className="flex-none font-medium">{banner.title}</span>
      {detail && (
        <span className="min-w-0 truncate text-muted3" title={detail}>
          {detail}
        </span>
      )}
      <span className="ml-auto flex flex-none gap-3 whitespace-nowrap">
        {notInDiffCount > 0 && (
          <button type="button" className="font-medium" onClick={() => setCommentList(true)}>
            Show comments
          </button>
        )}
        {banner.previous !== null && (
          <button type="button" className="font-medium" onClick={() => void showWhatChanged()}>
            Show what changed
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
