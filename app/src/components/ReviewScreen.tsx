import * as Popover from "@radix-ui/react-popover";
import { useEffect, useState } from "react";
import type { Comment } from "../bindings/Comment";
import { commentText, moveDetail, useStore } from "../store";
import { BasePicker } from "./BasePicker";
import { FilePane } from "./FilePane";
import { location, ReviewActions } from "./ReviewActions";
import { Sidebar } from "./Sidebar";
import { TitleBar } from "./TitleBar";

export function ReviewScreen() {
  const opening = useStore((s) => s.opening);
  const review = useStore((s) => s.review);
  const closeRepository = useStore((s) => s.closeRepository);
  const [pickerOpen, setPickerOpen] = useState(false);
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
            <BasePicker open={pickerOpen} onOpenChange={setPickerOpen} />
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
        <FilePane onCompareWithAnother={() => setPickerOpen(true)} />
      </div>
    </div>
  );
}

/** A deleted comment as the banner names it: where it was, and the start of what it said. */
function described(c: Comment): string {
  // Without its closing stop, which the banner's sentence supplies.
  const text = (commentText(c).split("\n")[0] ?? "").replace(/[.!?]+$/, "");
  return `${location(c)} “${text.length > 40 ? `${text.slice(0, 40)}…` : text}”`;
}

/** The checkout moved under the review. */
function Banner() {
  const banner = useStore((s) => s.banner);
  const showWhatChanged = useStore((s) => s.showWhatChanged);
  const dismiss = useStore((s) => s.dismissBanner);
  const notInDiff = useStore((s) => (s.banner ? s.comments.filter((c) => c.state === "outdated").length : 0));
  const total = useStore((s) => (s.banner ? s.comments.length : 0));
  const setCommentList = useStore((s) => s.setCommentList);
  if (!banner) return null;
  const detail = moveDetail(banner.deleted.map(described), notInDiff, total);
  return (
    <div role="status" className="flex flex-none flex-col gap-0.5 border-b border-border bg-side px-6 py-2.5 text-[13px]">
      <div className="flex items-center gap-3">
        <span className="size-[7px] flex-none rounded-full bg-live" />
        <span className="font-medium">{banner.title}</span>
        <span className="ml-auto flex flex-none gap-3 whitespace-nowrap">
          {notInDiff > 0 && (
            <button type="button" className="font-medium" onClick={() => setCommentList(true)}>
              Show comments
            </button>
          )}
          <button type="button" className="font-medium" onClick={() => void showWhatChanged()}>
            Show what changed
          </button>
          <button type="button" className="text-muted3" onClick={dismiss}>
            Dismiss
          </button>
        </span>
      </div>
      {/* Under the title: past the dot (7 px) and its gap (12 px). */}
      {detail && <span className="pl-[19px] text-muted">{detail}</span>}
    </div>
  );
}

/** Undo for deleting or clearing comments, offered for 10 s or until the next one replaces it. */
function UndoBar() {
  const undo = useStore((s) => s.undo);
  const undoLast = useStore((s) => s.undoLast);
  const clearUndo = useStore((s) => s.clearUndo);
  useEffect(() => {
    if (!undo) return;
    const timer = window.setTimeout(clearUndo, 10000);
    return () => window.clearTimeout(timer);
  }, [undo, clearUndo]);
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
