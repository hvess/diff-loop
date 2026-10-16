import * as Popover from "@radix-ui/react-popover";
import { useEffect, useMemo, useState } from "react";
import type { Comment } from "../bindings/Comment";
import { hasCard, kindOf, markOf, notInDiff as isNotInDiff, open as isOpen } from "../lifecycle";
import { nameOf } from "../path";
import { lastLine } from "../rows";
import { commentText, keptEdit, orderedComments, requestOf, reviewKey, useStore } from "../store";
import { Glyph } from "./Pin";
import { PreviewDialog } from "./PreviewDialog";

function location(c: Comment): string {
  const name = nameOf(c.path);
  if (c.target.kind === "file" || c.state === "lost") return name;
  const { side, start } = c.target;
  const end = lastLine(c.target);
  const lines = start === end ? `${start}` : `${start}–${end}`;
  return `${name}:${side === "old" ? "removed " : ""}${lines}`;
}

/** Top-right: the comment count with its list, and Copy review. The list's `Popover.Root` and anchor are `ReviewScreen`'s. */
export function ReviewActions() {
  const review = useStore((s) => s.review);
  const comments = useStore((s) => s.comments);
  const copied = useStore((s) => s.copied);
  const unsend = useStore((s) => s.unsend);
  const copyReview = useStore((s) => s.copyReview);
  const dismissCopied = useStore((s) => s.dismissCopied);
  const unsendRound = useStore((s) => s.unsendRound);
  const previewOpen = useStore((s) => s.preview);
  const setPreviewOpen = useStore((s) => s.setPreview);
  const list = orderedComments(review, comments);
  // The preview's edit outlasts closing it (HIG `modality`). The review's key is worked out once per
  // change of the comments, the base or a load, O(the comments' text), so typing costs a compare.
  const base = useStore((s) => s.base);
  const previewEdit = useStore((s) => s.previewEdit);
  const key = useMemo(() => reviewKey(requestOf({ review, comments, base })), [review, comments, base]);
  const edited = keptEdit(previewEdit, key);
  const setPreviewEdit = useStore((s) => s.setPreviewEdit);
  const copyProblem = useStore((s) => s.copyProblem);
  const open = list.filter(isOpen);
  const count = open.length;
  const notInDiff = open.filter(isNotInDiff).length;
  const sentCount = copied ? comments.filter((c) => c.sent?.round === copied.round).length : 0;

  // A copy that sent a round stays up, offering Not sent, until a load changes something or it is dismissed (ADR 0015 §1).
  useEffect(() => {
    if (!copied || unsend) return;
    const timer = window.setTimeout(dismissCopied, 6000);
    return () => window.clearTimeout(timer);
  }, [copied, unsend, dismissCopied]);

  return (
    <div className="relative flex items-center gap-4">
      {copied ? (
        <Popover.Root open onOpenChange={(open) => !open && dismissCopied()}>
          <Popover.Anchor asChild>
            <span role="status" className="flex items-center gap-2 rounded-full bg-ok-bg px-4 py-2 text-[13px] font-medium text-ok">
              ✓ Copied{copied.round !== null && ` · round ${copied.round} sent`}
            </span>
          </Popover.Anchor>
          <Popover.Portal>
            <Popover.Content
              align="end"
              sideOffset={10}
              className="z-40 flex w-[300px] flex-col gap-2.5 rounded-[14px] border border-line bg-bg px-4 py-3.5 shadow-pop"
            >
              <span className="text-[13.5px] leading-[1.5]">
                {copied.round === null
                  ? "Copied as instructions. Paste them into your agent session."
                  : `${sentCount} ${sentCount === 1 ? "comment" : "comments"} copied as instructions and marked Sent. Paste them into your agent session.`}
              </span>
              <div className="flex gap-4 text-[12.5px] text-muted3">
                <button type="button" className="-mx-1 rounded-md px-1 font-medium text-fg" onClick={() => setPreviewOpen(true)}>
                  Preview instructions…
                </button>
                {/* A copy that never reached the agent is taken back: the review is as before it (ADR 0015 §1). */}
                {unsend && (
                  <button type="button" className="-mx-1 rounded-md px-1 font-medium text-fg" onClick={unsendRound}>
                    Not sent
                  </button>
                )}
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      ) : (
        <div className="flex items-center rounded-full bg-btn text-[13px] font-medium text-btn-fg">
          <Popover.Trigger asChild>
            <button
              type="button"
              disabled={comments.length === 0}
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
              // Closed into placing a draft, focus goes nowhere: Return then places it, not the count (HIG `focus-and-selection`).
              onCloseAutoFocus={(e) => {
                if (useStore.getState().replacing !== null) e.preventDefault();
              }}
              className="z-40 w-[400px] overflow-hidden rounded-[14px] border border-line bg-bg shadow-pop"
            >
              <CommentList list={list} />
            </Popover.Content>
          </Popover.Portal>
          <button type="button" disabled={count === 0} onClick={() => void copyReview()} className="py-2 pr-4 pl-3 disabled:opacity-60">
            Copy review
          </button>
        </div>
      )}
      {copyProblem && (
        <span role="alert" className="absolute top-full right-0 mt-2 w-[300px] rounded-[14px] border border-line bg-bg px-4 py-3 text-[13px] shadow-pop">
          Couldn’t copy to the clipboard: {copyProblem.detail}
        </span>
      )}
      <PreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        edited={edited}
        onEdit={(text) => setPreviewEdit(text === null ? null : { key, text })}
      />
    </div>
  );
}

/** The comments, open ones first, then the resolved ones folded away at the bottom (ADR 0015 §4). */
function CommentList({ list }: { list: Comment[] }) {
  const setListOpen = useStore((s) => s.setCommentList);
  const setPreviewOpen = useStore((s) => s.setPreview);
  const deleteDrafts = useStore((s) => s.deleteDrafts);
  const [resolvedOpen, setResolvedOpen] = useState(false);
  const live = list.filter(isOpen);
  const resolved = list.filter((c) => !isOpen(c));
  const notInDiff = live.some(isNotInDiff);
  const drafts = list.filter((c) => c.sent === null).length;
  return (
    <>
      <div className="flex items-baseline justify-between px-4 pt-3.5 pb-2.5">
        <span className="font-semibold">Comments</span>
        <span className="text-[12.5px] text-muted">{notInDiff ? "N / P to jump between comments in this diff" : "N / P to jump"}</span>
      </div>
      <div className="flex max-h-[420px] flex-col overflow-auto">
        <div className="flex flex-col gap-0.5 px-2 pb-2">
          {live.map((c, i) => (
            <Entry key={c.id} comment={c} index={i} />
          ))}
        </div>
        {resolved.length > 0 && (
          <div className="flex flex-col gap-0.5 border-t border-border px-2 pt-1 pb-2">
            <button
              type="button"
              aria-expanded={resolvedOpen}
              onClick={() => setResolvedOpen(!resolvedOpen)}
              className="flex items-center gap-2 px-2.5 pt-2 pb-1.5 text-left text-[13px] font-medium text-muted2"
            >
              <span aria-hidden className="w-2.5 text-[10px]">
                {resolvedOpen ? "▾" : "▸"}
              </span>
              Resolved ({resolved.length})
            </button>
            {resolvedOpen && resolved.map((c, i) => <Entry key={c.id} comment={c} index={live.length + i} />)}
          </div>
        )}
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
          Preview instructions…
        </button>
        {/* Sent comments are the rounds' record; only drafts can be cleared (ADR 0015 §6). */}
        {drafts > 0 && (
          <button
            type="button"
            onClick={() => {
              deleteDrafts();
              setListOpen(false);
            }}
          >
            Delete drafts
          </button>
        )}
      </div>
    </>
  );
}

/** One comment in the list: its place, its mark, its text; a lost draft keeps its code, with Re-place. */
function Entry({ comment: c, index }: { comment: Comment; index: number }) {
  const openComment = useStore((s) => s.openComment);
  const showComment = useStore((s) => s.showComment);
  const deleteComment = useStore((s) => s.deleteComment);
  const resolveComment = useStore((s) => s.resolveComment);
  const startReplace = useStore((s) => s.startReplace);
  const setListOpen = useStore((s) => s.setCommentList);
  const kind = kindOf(c);
  const mark = markOf(c);
  const muted = !hasCard(c);
  const selected = c.id === openComment;
  const head = (
    <div className="flex items-center justify-between gap-2.5">
      <span className="font-mono text-[11.5px] text-muted">{location(c)}</span>
      {mark && (
        <span className={`flex items-center gap-1.5 text-[11.5px] ${kind === "changed" ? "font-semibold text-fg" : muted ? "font-medium text-muted3" : "font-medium text-muted2"}`}>
          {c.resolved === null && <Glyph kind={kind} on={selected ? "chip" : "bg"} />}
          {mark}
        </span>
      )}
    </div>
  );
  const text = <span className={`truncate text-[13px] leading-[1.45] ${muted ? "text-muted3" : ""}`}>{commentText(c)}</span>;
  const style = { "--i": index } as React.CSSProperties;
  if (hasCard(c)) {
    return (
      <button
        type="button"
        style={style}
        onClick={() => {
          showComment(c.id);
          setListOpen(false);
        }}
        // Focus is a highlight with an inset ring, as in a list (HIG `focus-and-selection`), not a ring the list's edge would cut.
        className={`flex w-full flex-col gap-[3px] rounded-[10px] px-2.5 py-2 text-left hover:bg-chip focus-visible:bg-chip focus-visible:-outline-offset-2 ${selected ? "bg-chip" : ""}`}
      >
        {head}
        {text}
      </button>
    );
  }
  // No card to show or act from: what can be done is done here.
  return (
    <div style={style} className="flex flex-col gap-[3px] rounded-[10px] px-2.5 py-2">
      {head}
      {text}
      {kind === "lost" && c.target.kind === "lines" && (
        <span className="code mt-0.5 truncate rounded-md bg-chip px-2 py-1 font-mono text-[11.5px] whitespace-pre text-muted3">
          {c.target.code.find((l) => l.trim() !== "") ?? ""}
        </span>
      )}
      <div className="mt-0.5 flex gap-3.5 text-[12.5px]">
        {kind === "lost" && (
          <button type="button" className="font-medium text-fg" onClick={() => startReplace(c.id)}>
            Re-place
          </button>
        )}
        {c.resolved !== null ? (
          <button type="button" className="font-medium text-fg" onClick={() => resolveComment(c.id)}>
            Unresolve
          </button>
        ) : (
          // Sent but on no line here (its file left the diff, or another base or branch is shown): no card to resolve
          // it from. Only a draft is deleted from the list: a sent comment is the rounds' record (diff-loop-app.md Decision 31).
          c.sent !== null ? (
            <button type="button" className="font-medium text-fg" onClick={() => resolveComment(c.id)}>
              Resolve
            </button>
          ) : (
            <button type="button" className="text-muted3" onClick={() => deleteComment(c.id)}>
              Delete
            </button>
          )
        )}
      </div>
    </div>
  );
}
