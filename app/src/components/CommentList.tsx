import { useState } from "react";
import type { Comment } from "../bindings/Comment";
import { awaitsReviewer, hasCard, kindOf, markOf, open as isOpen, toneOf } from "../lifecycle";
import { shownNote } from "../note";
import { nameOf } from "../path";
import { lastLine } from "../rows";
import { commentText, useStore } from "../store";
import { Sym } from "./Icon";
import { AgentNote } from "./AgentNote";

function location(c: Comment): string {
  const name = nameOf(c.path);
  if (c.target.kind === "file" || c.state === "lost") return name;
  const { side, start } = c.target;
  const end = lastLine(c.target);
  const lines = start === end ? `${start}` : `${start}–${end}`;
  return `${name}:${side === "old" ? "removed " : ""}${lines}`;
}

/**
 * The comments list's content, inside the caller's `.pop-body` (ADR 0027, screen 4a): open ones first, then the
 * resolved ones folded away at the bottom (ADR 0015 §4).
 */
export function CommentList({ list }: { list: Comment[] }) {
  const setListOpen = useStore((s) => s.setCommentList);
  const setPreviewOpen = useStore((s) => s.setPreview);
  const deleteDrafts = useStore((s) => s.deleteDrafts);
  const [resolvedOpen, setResolvedOpen] = useState(false);
  const live = list.filter(isOpen);
  const resolved = list.filter((c) => !isOpen(c));
  const drafts = list.filter((c) => c.sent === null).length;
  return (
    <div className="pt-3">
      <div className="flex items-center px-[18px] pt-0.5 pb-2">
        <span className="text-[13px] font-semibold">Comments</span>
        <span className="flex-1" />
        {drafts > 0 && <span className="text-[11px] text-[var(--sec)]">{drafts === 1 ? "1 draft" : `${drafts} drafts`}</span>}
      </div>
      <div className="flex max-h-[420px] flex-col overflow-auto">
        <div className="flex flex-col">
          {live.map((c) => (
            <Entry key={c.id} comment={c} />
          ))}
        </div>
        {resolved.length > 0 && (
          <div className="mt-1 flex flex-col border-t-[0.5px] border-[var(--sep)] pt-1">
            <button
              type="button"
              aria-expanded={resolvedOpen}
              onClick={() => setResolvedOpen(!resolvedOpen)}
              className="flex items-center gap-1.5 px-[18px] pt-2 pb-1.5 text-left text-[11px] font-semibold text-[var(--sec)]"
            >
              <Sym name={resolvedOpen ? "down" : "right"} />
              Resolved ({resolved.length})
            </button>
            {resolvedOpen && resolved.map((c) => <Entry key={c.id} comment={c} />)}
          </div>
        )}
      </div>
      <div className="foot mt-2">
        {/* Sent comments are the rounds' record; only drafts can be cleared (ADR 0015 §6). */}
        {drafts > 0 && (
          <button
            type="button"
            className="btnplain text-[var(--deltx)]"
            onClick={() => {
              deleteDrafts();
              setListOpen(false);
            }}
          >
            <Sym name="trash" />
            Delete Drafts
          </button>
        )}
        <span className="flex-1" />
        <button
          type="button"
          className="btn"
          onClick={() => {
            setListOpen(false);
            setPreviewOpen(true);
          }}
        >
          Preview Instructions…
        </button>
      </div>
    </div>
  );
}

/** One comment in the list: its place, its mark, its text; a lost draft keeps its code, with Re-place. */
function Entry({ comment: c }: { comment: Comment }) {
  const cardOpen = useStore((s) => s.openComment === c.id);
  const showComment = useStore((s) => s.showComment);
  const deleteComment = useStore((s) => s.deleteComment);
  const resolveComment = useStore((s) => s.resolveComment);
  const editComment = useStore((s) => s.editComment);
  const startReplace = useStore((s) => s.startReplace);
  const setListOpen = useStore((s) => s.setCommentList);
  const kind = kindOf(c);
  const notes = [c.suggestion !== null && c.text !== "" ? "Suggested change" : "", markOf(c)].filter((n) => n !== "");
  const dot = <span aria-hidden className={`dot ${toneOf(c)}`} />;
  const loc = (
    <span className="loc block truncate">
      {location(c)}
      {/* The canvas sets the words after the place in the text face. */}
      {notes.length > 0 && <span className="font-sans"> · {notes.join(" · ")}</span>}
    </span>
  );
  if (hasCard(c)) {
    return (
      <button
        type="button"
        onClick={() => {
          showComment(c.id);
          setListOpen(false);
        }}
        // The entry the keys are on is the accent row, as in the base picker (`.cm:focus-visible`), not a ring the list's edge would cut.
        className={`cm hover:bg-[var(--rowsel)] ${cardOpen ? "hi" : ""}`}
      >
        {dot}
        <span className="flex min-w-0 flex-col">
          {loc}
          <span className="tx">{commentText(c)}</span>
        </span>
      </button>
    );
  }
  // No card to show or act from: what can be done is done here.
  return (
    <div className="cm">
      {dot}
      <div className="flex min-w-0 flex-1 flex-col">
        {loc}
        <div className="tx text-[var(--sec)]">{commentText(c)}</div>
        {shownNote(c.note) !== null && (
          <div className="tx">
            Agent: <AgentNote note={c.note ?? ""} />
          </div>
        )}
        {kind === "lost" && c.target.kind === "lines" && (
          <span className="code mt-1 truncate rounded-md bg-[var(--field)] px-2 py-1 font-mono text-[11px] whitespace-pre text-[var(--sec)]">
            {c.target.code.find((l) => l.trim() !== "") ?? ""}
          </span>
        )}
        <div className="mt-0.5 flex gap-3.5">
          {kind === "lost" && (
            <button type="button" className="btnplain" onClick={() => startReplace(c.id)}>
              Re-place
            </button>
          )}
          {awaitsReviewer(c) ? (
            // The agent's word stands until the reviewer accepts it, or edits the comment, which reopens it (ADR 0032 §2).
            <>
              <button type="button" className="btnplain" onClick={() => resolveComment(c.id)}>
                Accept
              </button>
              <button type="button" className="btnplain" onClick={() => editComment(c.id)}>
                Edit
              </button>
            </>
          ) : c.resolved !== null ? (
            <button type="button" className="btnplain" onClick={() => resolveComment(c.id)}>
              Unresolve
            </button>
          ) : // Sent but on no line here (its file left the diff, or another base or branch is shown): no card to resolve
          // it from. Only a draft is deleted from the list: a sent comment is the rounds' record (diff-loop-app.md Decision 31).
          c.sent !== null ? (
            <button type="button" className="btnplain" onClick={() => resolveComment(c.id)}>
              Resolve
            </button>
          ) : (
            <button type="button" className="btnplain text-[var(--deltx)]" onClick={() => deleteComment(c.id)}>
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
