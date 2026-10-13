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

/** Top-right: the comment count with its list, and Copy review. */
export function ReviewActions() {
  const review = useStore((s) => s.review);
  const comments = useStore((s) => s.comments);
  const openComment = useStore((s) => s.openComment);
  const copied = useStore((s) => s.copied);
  const copyReview = useStore((s) => s.copyReview);
  const setCopied = useStore((s) => s.setCopied);
  const clearComments = useStore((s) => s.clearComments);
  const showComment = useStore((s) => s.showComment);
  const [listOpen, setListOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const list = orderedComments(review, comments);
  const count = comments.length;

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
          <Popover.Root open={listOpen} onOpenChange={setListOpen}>
            <Popover.Trigger asChild>
              <button
                type="button"
                disabled={count === 0}
                className="flex items-center gap-1.5 border-r border-[rgba(128,128,128,0.4)] py-2 pr-3 pl-4 disabled:opacity-60"
              >
                {count} {count === 1 ? "comment" : "comments"}
                <span aria-hidden className="text-[9px] opacity-60">▾</span>
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                align="end"
                sideOffset={10}
                className="z-40 w-[400px] overflow-hidden rounded-[14px] border border-line bg-bg shadow-pop"
              >
                <div className="flex items-baseline justify-between px-4 pt-3.5 pb-2.5">
                  <span className="font-semibold">Comments</span>
                  <span className="text-[12.5px] text-muted">N / P to jump</span>
                </div>
                <div className="flex max-h-[420px] flex-col gap-0.5 overflow-auto px-2 pb-2">
                  {list.map((c) => (
                    <button
                      type="button"
                      key={c.id}
                      onClick={() => {
                        showComment(c.id);
                        setListOpen(false);
                      }}
                      className={`flex flex-col gap-0.5 rounded-[10px] px-2.5 py-2 text-left hover:bg-chip ${c.id === openComment ? "bg-chip" : ""}`}
                    >
                      <span className="flex items-center gap-2 font-mono text-[11.5px] text-muted">
                        {location(c)}
                        {c.state === "outdated" && (
                          <span className="rounded-full bg-chip px-2 font-sans text-[11px] font-medium text-muted2">Outdated</span>
                        )}
                      </span>
                      <span className="truncate text-[13px] leading-[1.45]">{c.text}</span>
                    </button>
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
          </Popover.Root>
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
