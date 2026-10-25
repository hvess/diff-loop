import * as Popover from "@radix-ui/react-popover";
import { useEffect, useMemo } from "react";
import { answered, awaitsReviewer, notInDiff as isNotInDiff, open as isOpen, toAccept } from "../lifecycle";
import { useNow } from "../now";
import { barLines, progressText } from "../progress";
import { roundStrip, type StripPart } from "../round";
import { changedLines } from "../rows";
import { keptEdit, orderedComments, requestOf, reviewKey, useStore, whyNotSent } from "../store";
import { CommentList } from "./CommentList";
import { Sym } from "./Icon";
import { PopArrow } from "./PopArrow";
import { PreviewDialog } from "./PreviewDialog";

/** The progress ring's circumference: radius 9. */
const RING = 2 * Math.PI * 9;

/**
 * The canvas's floating bottom bar (ADR 0027 §5; diff-loop-app.md Decision 35): how much is left and the
 * round, the comment count, which opens the list, and Copy Review. The list's `Popover.Root` is `ReviewScreen`'s.
 */
export function BottomBar() {
  const comments = useStore((s) => s.comments);
  const copyProblem = useStore((s) => s.copyProblem);
  const unsendable = useStore(whyNotSent);
  const switched = useStore((s) => s.banner?.action?.kind === "review");
  const copied = useStore((s) => s.copied);
  const open = comments.filter(isOpen).length;
  // Said where it is seen, not only on hover: open comments, and nowhere to send them (the design's 6i);
  // the switched banner, the one that opens another review, says it already.
  const note = copyProblem
    ? `Couldn’t copy to the clipboard: ${copyProblem.detail}`
    : !copied && !switched && open > 0 && unsendable
      ? unsendable
      : null;
  return (
    <div className="statusbar" role="toolbar" aria-label="Review status">
      {note && (
        <p role={copyProblem ? "alert" : undefined} className="pointer-events-auto absolute bottom-[62px] max-w-[440px] text-center text-xs text-pretty text-[var(--sec)]">
          {note}
        </p>
      )}
      <div className="cap">
        <Progress />
        <span className="vsep" aria-hidden />
        <CommentCount />
        <CopyButton />
      </div>
    </div>
  );
}

/** The ring for the lines reviewed, and the bar's two lines (`barLines`). */
function Progress() {
  const review = useStore((s) => s.review);
  const viewedCount = useStore((s) => s.viewed.size);
  const reviewed = useStore((s) => s.viewedLines);
  const rounds = useStore((s) => s.rounds);
  const comments = useStore((s) => s.comments);
  const autoResolved = useStore((s) => s.autoResolved);
  const now = useNow();
  // O(changed files) once per load: `counts`, under `changedLines`, is cached per file.
  const total = useMemo(
    () => (review?.changes.files ?? []).reduce((sum, f) => sum + changedLines(f), 0),
    [review],
  );
  const files = review?.changes.files.length ?? 0;
  const lines = barLines(progressText(files - viewedCount, reviewed, total), roundStrip(rounds, comments, autoResolved, now));
  const done = total > 0 ? reviewed / total : files > 0 ? viewedCount / files : 0;
  return (
    <>
      <svg
        width="22"
        height="22"
        viewBox="0 0 22 22"
        role="progressbar"
        aria-label="Reviewed"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(done * 100)}
        className="flex-none"
      >
        <circle cx="11" cy="11" r="9" fill="none" stroke="var(--track)" strokeWidth="3" />
        <circle
          cx="11"
          cy="11"
          r="9"
          fill="none"
          stroke="var(--accentfill)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${RING * done} ${RING}`}
          transform="rotate(-90 11 11)"
          // A round cap draws a dot at nothing done.
          visibility={done === 0 ? "hidden" : undefined}
        />
      </svg>
      <div className="two tabular-nums">
        <b>{lines.title}</b>
        <span>
          {lines.parts.map((part, i) => (
            <Part key={part.text} part={part} after={i < lines.parts.length - 1 || lines.detail.length > 0} />
          ))}
          {lines.detail.join(" · ")}
        </span>
      </div>
    </>
  );
}

/** One of a round's counts: one that can filter steps N / P through its comments when clicked. */
function Part({ part, after }: { part: StripPart; after: boolean }) {
  const filter = useStore((s) => s.commentFilter);
  const setFilter = useStore((s) => s.setCommentFilter);
  const dot = after ? " · " : "";
  if (part.filter === null) return <>{`${part.text}${dot}`}</>;
  const pressed = filter === part.filter;
  return (
    <>
      <button
        type="button"
        aria-pressed={pressed}
        title={`N / P through the ${part.filter} comments`}
        onClick={() => setFilter(pressed ? null : part.filter)}
        className={`rounded ${pressed ? "bg-[var(--field)] text-[var(--label)]" : "hover:text-[var(--label)]"}`}
      >
        {part.text}
      </button>
      {dot}
    </>
  );
}

/** The open comments' count, which opens their list above it (the canvas's 4a). */
function CommentCount() {
  const review = useStore((s) => s.review);
  const comments = useStore((s) => s.comments);
  const listOpen = useStore((s) => s.commentList);
  const list = orderedComments(review, comments);
  // Counted with the open ones: what the agent resolved waits on the reviewer to accept it, and a question it answered
  // to read it (ADR 0032 §2, ADR 0036 §2).
  const open = list.filter((c) => isOpen(c) || awaitsReviewer(c));
  const notInDiff = open.filter(isNotInDiff).length;
  const toRead = open.filter(answered).length;
  const accepting = open.filter(toAccept).length;
  const label = `${open.length} ${open.length === 1 ? "comment" : "comments"}${accepting > 0 ? `, ${accepting} to accept` : ""}${toRead > 0 ? `, ${toRead} to read` : ""}${notInDiff > 0 ? `, ${notInDiff} not in this diff` : ""}`;
  return (
    <>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={comments.length === 0}
          aria-label={label}
          title={label}
          className={`btnplain h-9 rounded-[18px] px-2.5 tabular-nums ${open.length > 0 ? "text-[var(--label)]" : "text-[var(--sec)]"} ${listOpen ? "bg-[var(--field)]" : ""}`}
        >
          <Sym name="comments" />
          <span>{open.length}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="center"
          sideOffset={12}
          // Closed into placing a draft, focus goes nowhere: Return then places it, not the count (HIG `focus-and-selection`).
          onCloseAutoFocus={(e) => {
            if (useStore.getState().replacing !== null) e.preventDefault();
          }}
          className="pop-body z-40 w-[440px]"
        >
          <CommentList list={list} />
          <PopArrow />
        </Popover.Content>
      </Popover.Portal>
    </>
  );
}

/** Copy Review, and once it has copied, what was sent and Not Sent (ADR 0015 §1; the canvas's rules note). */
function CopyButton() {
  const review = useStore((s) => s.review);
  const comments = useStore((s) => s.comments);
  const copied = useStore((s) => s.copied);
  const unsend = useStore((s) => s.unsend);
  const copyReview = useStore((s) => s.copyReview);
  const dismissCopied = useStore((s) => s.dismissCopied);
  const unsendRound = useStore((s) => s.unsendRound);
  const previewOpen = useStore((s) => s.preview);
  const setPreviewOpen = useStore((s) => s.setPreview);
  const unsendable = useStore(whyNotSent);
  const branch = useStore((s) => s.key?.branch);
  // The preview's edit outlasts closing it (HIG `modality`). The review's key is worked out only while an
  // edit is kept, once per change of the comments, the base or a load, O(the comments' text), so typing costs a compare.
  const base = useStore((s) => s.base);
  const previewEdit = useStore((s) => s.previewEdit);
  const editing = previewEdit !== null;
  const keyNow = () => reviewKey(requestOf({ review, comments, base }));
  const key = useMemo(() => (editing ? reviewKey(requestOf({ review, comments, base })) : null), [editing, review, comments, base]);
  const edited = key === null ? null : keptEdit(previewEdit, key);
  const setPreviewEdit = useStore((s) => s.setPreviewEdit);
  const count = comments.filter(isOpen).length;
  const sentCount = copied ? comments.filter((c) => c.sent?.round === copied.round).length : 0;

  // A copy that sent a round stays up, offering Not Sent, until a load changes something or it is dismissed (ADR 0015 §1).
  useEffect(() => {
    if (!copied || unsend) return;
    const timer = window.setTimeout(dismissCopied, 6000);
    return () => window.clearTimeout(timer);
  }, [copied, unsend, dismissCopied]);

  return (
    <Popover.Root open={copied !== null} onOpenChange={(open) => !open && dismissCopied()}>
      <Popover.Anchor asChild>
        {/* A disabled button takes no pointer: its reason is on what holds it. */}
        <span title={unsendable ?? undefined} className="flex">
          <button type="button" disabled={count === 0 || unsendable !== null} onClick={() => void copyReview()} className="btnp btnl">
            <Sym name="copy" />
            Copy Review
          </button>
        </span>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content side="top" align="center" sideOffset={12} className="pop-body z-40 flex w-[320px] flex-col gap-2 px-4 py-3.5">
          {copied && (
            <>
              <span role="status" className="text-[13px] font-semibold">
                Copied{copied.round !== null && ` · round ${copied.round} sent`}
              </span>
              <span className="text-xs leading-[1.45] text-[var(--sec)]">
                {copied.round === null
                  ? "Copied as instructions. Paste them into your agent session."
                  : `${sentCount} ${sentCount === 1 ? "comment" : "comments"}${branch ? ` for ${branch}` : ""} copied as instructions and marked Sent. Paste them into the agent working on that branch.`}
              </span>
              <div className="mt-1 flex items-center gap-2">
                {/* A copy that never reached the agent is taken back: the review is as before it (ADR 0015 §1). */}
                {unsend && (
                  <button type="button" className="btnplain" onClick={unsendRound}>
                    Not Sent
                  </button>
                )}
                <span className="grow" />
                <button type="button" className="btn" onClick={() => setPreviewOpen(true)}>
                  Preview Instructions…
                </button>
              </div>
            </>
          )}
          <PopArrow />
        </Popover.Content>
      </Popover.Portal>
      <PreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        edited={edited}
        onEdit={(text) => setPreviewEdit(text === null ? null : { key: key ?? keyNow(), text })}
      />
    </Popover.Root>
  );
}
