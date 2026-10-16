import type { Comment } from "../bindings/Comment";
import { dedent } from "../indent";
import { shortId, when } from "../format";
import { changed, footOf, kindOf, markOf, verdictOf } from "../lifecycle";
import { useNow } from "../now";
import { useStore } from "../store";
import { targetLabel } from "./Composer";
import { Glyph } from "./Pin";

/** A saved comment: its text and suggested code, and for a sent one what became of its code (ADR 0015). */
export function CommentCard({ comment, floating = false }: { comment: Comment; floating?: boolean }) {
  const editComment = useStore((s) => s.editComment);
  const deleteComment = useStore((s) => s.deleteComment);
  const resolveComment = useStore((s) => s.resolveComment);
  const commit = useStore((s) => s.review?.checkout.commit ?? null);
  const workingTree = useStore((s) => s.review?.changes.snapshot.new.kind === "workingTree");
  const round = useStore((s) => s.rounds.find((r) => r.number === comment.sent?.round));
  const now = useNow();
  const kind = kindOf(comment);
  const sent = comment.sent;
  // Shown as "Suggest code" started from them (diff-loop-app.md Decision 26).
  const code = comment.target.kind === "lines" ? dedent(comment.target.code) : [];
  const sentCode = sent?.target.kind === "lines" ? sent.target.code : [];
  const nowCode = comment.target.kind === "lines" ? comment.target.code : [];
  const compare = sent !== null && changed(comment);
  const meta = sent && `Sent in round ${sent.round}${round ? ` · ${when(round.at, now)}` : ""}`;

  return (
    <div
      className={`flex max-w-[580px] flex-col gap-1.5 rounded-[14px] border bg-bg px-4 pt-3 pb-3.5 text-[13.5px] leading-[1.55] ${kind === "reopened" ? "border-ghost" : "border-line"} ${floating ? "shadow-pop" : ""}`}
    >
      <div className="flex items-center justify-between gap-3 text-xs text-muted">
        <span className="flex items-center gap-2">
          {lineLabel(comment)}
          {kind !== "draft" && (
            <span className={`flex items-center gap-1.5 rounded-full bg-chip py-px pr-[9px] pl-2 font-medium ${kind === "changed" ? "text-fg" : "text-muted2"}`}>
              <Glyph kind={kind} on="chip" />
              {markOf(comment)}
            </span>
          )}
        </span>
        {sent !== null && <span className="text-muted3">{meta}</span>}
      </div>
      {kind === "reopened" && sent && (
        <div className="my-0.5 flex flex-col gap-0.5 rounded-lg bg-chip px-2.5 py-2 text-[12.5px] leading-[1.5]">
          <span className="text-[11.5px] text-muted3">You sent in round {sent.round}</span>
          <span className="code whitespace-pre-wrap text-muted3">{sent.text === "" ? "Suggested change" : sent.text}</span>
        </div>
      )}
      {comment.text !== "" && <span className="code text-pretty whitespace-pre-wrap">{comment.text}</span>}
      {comment.suggestion !== null && !compare && (
        <div className="code mt-1.5 overflow-hidden rounded-[10px] border border-card-border font-mono text-xs leading-[1.85]">
          {code.map((line, i) => (
            <div key={`o${i}`} className="flex bg-del-bg pr-2.5">
              <span className="w-[22px] flex-none text-center text-del">−</span>
              <span className="whitespace-pre-wrap">{line}</span>
            </div>
          ))}
          {/* A suggestion saved before diff-loop-app.md Decision 26 still has its indent; shown without it, as the − lines are. */}
          {dedent(comment.suggestion.split("\n")).map((line, i) => (
            <div key={`n${i}`} className="flex bg-add-bg pr-2.5">
              <span className="w-[22px] flex-none text-center text-add">+</span>
              <span className="whitespace-pre-wrap">{line}</span>
            </div>
          ))}
        </div>
      )}
      {compare && sent && (
        <div className="code mt-1.5 overflow-hidden rounded-[10px] border border-card-border font-mono text-xs leading-[1.85]">
          <div className="flex justify-between gap-3 border-b border-border bg-hunk px-2.5 py-1 font-sans text-muted3">
            <span>{nowCode.length === 0 ? "Sent (−), nothing in its place now" : "Sent (−) and now (+)"}</span>
            <span className="font-mono text-[11.5px]">
              {/* With no commit since, the change is in the files on disk. */}
              {shortId(sent.commit)} → {commit === sent.commit && workingTree ? "uncommitted" : shortId(commit)}
            </span>
          </div>
          {sentCode.map((line, i) => (
            <div key={`s${i}`} className="flex bg-del-bg pr-2.5">
              <span className="w-[22px] flex-none text-center text-del">−</span>
              <span className="whitespace-pre-wrap">{line}</span>
            </div>
          ))}
          {nowCode.map((line, i) => (
            <div key={`w${i}`} className="flex bg-add-bg pr-2.5">
              <span className="w-[22px] flex-none text-center text-add">+</span>
              <span className="whitespace-pre-wrap">{line}</span>
            </div>
          ))}
        </div>
      )}
      {/* One footer for every card, so Edit is in one place whether the comment is a draft or sent (ux gate 7). */}
      <div className="mt-1.5 flex items-center gap-2.5 text-[12.5px]">
        {sent !== null && (
          <span className={`font-medium ${kind === "changed" ? "text-fg" : "text-muted3"}`}>
            {kind === "reopened" ? "Copies as “Still: …”" : footOf(comment)}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => editComment(comment.id)} className="rounded-full px-1 py-[5px] font-medium text-muted3">
            Edit
          </button>
          {sent === null ? (
            <button type="button" onClick={() => deleteComment(comment.id)} className="rounded-full px-1 py-[5px] font-medium text-muted3">
              Delete
            </button>
          ) : (
            <button
              type="button"
              title="R"
              onClick={() => resolveComment(comment.id)}
              className={`flex items-center gap-2 rounded-full px-3 py-[5px] font-medium ${
                kind === "changed" ? "bg-btn text-btn-fg" : "text-fg shadow-[inset_0_0_0_1px_var(--ui-ghost)]"
              }`}
            >
              Resolve
              <span className="font-mono text-[11px] opacity-60">R</span>
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

/** "Line 19"; for a changed comment where it was and where its code went, "Lines 21–24 → line 23" or "Line 31 · code removed". */
function lineLabel(comment: Comment): string {
  const sent = comment.sent;
  const verdict = verdictOf(comment);
  if (!sent || sent.target.kind !== "lines" || comment.target.kind !== "lines") return targetLabel(comment.target);
  const was = targetLabel(sent.target);
  if (verdict === "removed") return `${was} · code removed`;
  const now = targetLabel(comment.target);
  if ((verdict === "changed" || verdict === "applied") && was !== now) return `${was} → ${now.toLowerCase()}`;
  return now;
}
