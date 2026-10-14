import * as Popover from "@radix-ui/react-popover";
import { useEffect, useState } from "react";
import type { Comment } from "../bindings/Comment";
import { lastLine } from "../rows";
import { orderedComments, useStore } from "../store";
import { PreviewDialog } from "./PreviewDialog";

export function location(c: Comment): string {
  const name = c.path.split("/").pop() ?? c.path;
  if (c.target.kind === "file") return name;
  const { side, start } = c.target;
  const end = lastLine(c.target);
  const lines = start === end ? `${start}` : `${start}–${end}`;
  return `${name}:${side === "old" ? "removed " : ""}${lines}`;
}

/** Top-right: the comment count with its list, and Copy review. The list's `Popover.Root` and anchor are `ReviewScreen`'s. */
export function ReviewActions() {
  const review = useStore((s) => s.review);
  const comments = useStore((s) => s.comments);
  const openComment = useStore((s) => s.openComment);
  const copied = useStore((s) => s.copied);
  const copyReview = useStore((s) => s.copyReview);
  const setCopied = useStore((s) => s.setCopied);
  const clearComments = useStore((s) => s.clearComments);
  const showComment = useStore((s) => s.showComment);
  const deleteComment = useStore((s) => s.deleteComment);
  const setListOpen = useStore((s) => s.setCommentList);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const list = orderedComments(review, comments);
  const count = comments.length;
  const notInDiff = comments.filter((c) => c.state === "outdated").length;

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 6000);
    return () => window.clearTimeout(timer);
  }, [copied, setCopied]);

  const copy = () => {
    setCopyError(null);
    copyReview().catch((e: unknown) => setCopyError(String(e)));
  };

  return (
    <div className="relative flex items-center gap-4">
      {copied ? (
        <Popover.Root open onOpenChange={(open) => !open && setCopied(false)}>
          <Popover.Anchor asChild>
            <span role="status" className="flex items-center gap-2 rounded-full bg-ok-bg px-4 py-2 text-[13px] font-medium text-ok">
              ✓ Copied
            </span>
          </Popover.Anchor>
          <Popover.Portal>
            <Popover.Content
              align="end"
              sideOffset={10}
              className="z-40 flex w-[300px] flex-col gap-2.5 rounded-[14px] border border-line bg-bg px-4 py-3.5 shadow-pop"
            >
              <span className="text-[13.5px] leading-[1.5]">
                {count} {count === 1 ? "comment" : "comments"} copied as instructions. Paste them into your agent
                session.
              </span>
              <div className="flex gap-4 text-[12.5px] text-muted3">
                <button type="button" className="font-medium text-fg" onClick={() => setPreviewOpen(true)}>
                  Preview text
                </button>
                <button type="button" onClick={clearComments}>
                  Clear comments
                </button>
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      ) : (
        <div className="flex items-center rounded-full bg-btn text-[13px] font-medium text-btn-fg">
          <Popover.Trigger asChild>
            <button
              type="button"
              disabled={count === 0}
              className="flex items-center gap-1.5 border-r border-[rgba(128,128,128,0.4)] py-2 pr-3 pl-4 disabled:opacity-60"
            >
              <span>
                {count} {count === 1 ? "comment" : "comments"}
                {notInDiff > 0 && <span className="opacity-60"> ({notInDiff} not in this diff)</span>}
              </span>
              <span aria-hidden className="text-[9px] opacity-60">▾</span>
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="end"
              sideOffset={8}
              className="z-40 w-[400px] overflow-hidden rounded-[14px] border border-line bg-bg shadow-pop"
            >
              <div className="flex items-baseline justify-between px-4 pt-3.5 pb-2.5">
                <span className="font-semibold">Comments</span>
                <span className="text-[12.5px] text-muted">{notInDiff > 0 ? "N / P to jump between comments in this diff" : "N / P to jump"}</span>
              </div>
              <div className="flex max-h-[420px] flex-col gap-0.5 overflow-auto px-2 pb-2">
                {list.map((c) => (
                  <div
                    key={c.id}
                    className={`flex items-start gap-2 rounded-[10px] ${c.state === "current" ? "hover:bg-chip" : ""} ${c.id === openComment ? "bg-chip" : ""}`}
                  >
                    {c.state === "current" ? (
                      <button
                        type="button"
                        onClick={() => {
                          showComment(c.id);
                          setListOpen(false);
                        }}
                        className="flex min-w-0 flex-1 flex-col gap-0.5 px-2.5 py-2 text-left"
                      >
                        <span className="font-mono text-[11.5px] text-muted">{location(c)}</span>
                        <span className="truncate text-[13px] leading-[1.45]">{c.text}</span>
                      </button>
                    ) : (
                      // A comment not in this diff has no card to show or delete it from.
                      <>
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5 px-2.5 py-2">
                          <span className="flex items-center gap-2 font-mono text-[11.5px] text-muted">
                            {location(c)}
                            <span className="rounded-full bg-chip px-2 font-sans text-[11px] font-medium text-muted2">
                              Not in this diff
                            </span>
                          </span>
                          <span className="truncate text-[13px] leading-[1.45] text-muted3">{c.text}</span>
                        </div>
                        <button
                          type="button"
                          className="flex-none px-2.5 py-2 text-[12.5px] text-muted3"
                          onClick={() => deleteComment(c.id)}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex justify-between border-t border-border px-4 py-2.5 text-[12.5px] text-muted3">
                <button
                  type="button"
                  className="font-medium text-fg"
                  onClick={() => {
                    setListOpen(false);
                    setPreviewOpen(true);
                  }}
                >
                  Preview instructions
                </button>
                <button
                  type="button"
                  onClick={() => {
                    clearComments();
                    setListOpen(false);
                  }}
                >
                  Clear all
                </button>
              </div>
            </Popover.Content>
          </Popover.Portal>
          <button type="button" disabled={count === 0} onClick={copy} className="py-2 pr-4 pl-3 disabled:opacity-60">
            Copy review
          </button>
        </div>
      )}
      {copyError && (
        <span role="alert" className="absolute top-full right-0 mt-2 w-[300px] rounded-[14px] border border-line bg-bg px-4 py-3 text-[13px] shadow-pop">
          Couldn’t copy to the clipboard: {copyError}
        </span>
      )}
      <PreviewDialog open={previewOpen} onOpenChange={setPreviewOpen} />
    </div>
  );
}
