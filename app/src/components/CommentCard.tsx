import type { Comment } from "../bindings/Comment";
import { shortId, when } from "../format";
import { dedent } from "../indent";
import { answered, awaitsReviewer, changed, footOf, kindOf, markOf, resolvable, verdictOf } from "../lifecycle";
import { shownNote } from "../note";
import { useNow } from "../now";
import { useStore } from "../store";
import { SentBefore, targetLabel } from "./Composer";
import { type Symbol, Sym } from "./Icon";
import { AgentNote } from "./AgentNote";

/** A comment's badge as the canvas draws its states (5a; the rules note's Reopened chip). */
const BADGE: Record<ReturnType<typeof kindOf>, { cls: string; sym: Symbol | null }> = {
  draft: { cls: "b-draft", sym: null },
  sent: { cls: "b-sent", sym: "sent" },
  changed: { cls: "b-changed", sym: "changed" },
  reopened: { cls: "b-reopened", sym: null },
  lost: { cls: "b-gone", sym: null },
  outdated: { cls: "b-sent", sym: null },
};

/**
 * The comment popover's body for a saved comment (the canvas's 5a): its text and suggested code, and for a sent
 * one what became of its code (ADR 0015); its caller draws the popover.
 */
export function CommentCard({ comment }: { comment: Comment }) {
  const editComment = useStore((s) => s.editComment);
  const deleteComment = useStore((s) => s.deleteComment);
  const resolveComment = useStore((s) => s.resolveComment);
  const commit = useStore((s) => s.review?.checkout.commit ?? null);
  const workingTree = useStore((s) => s.review?.changes.snapshot.new.kind === "workingTree");
  const round = useStore((s) => s.rounds.find((r) => r.number === comment.sent?.round));
  const now = useNow();
  const kind = kindOf(comment);
  const sent = comment.sent;
  // Shown as Suggest Change started from them (diff-loop-app.md Decision 26).
  const code = comment.target.kind === "lines" ? dedent(comment.target.code) : [];
  const sentCode = sent?.target.kind === "lines" ? sent.target.code : [];
  const nowCode = comment.target.kind === "lines" ? comment.target.code : [];
  const compare = sent !== null && changed(comment);
  const badge = BADGE[kind];
  const mark = markOf(comment);

  return (
    <div>
      <div className="flex items-center gap-2">
        {mark ? (
          <span className={`badge ${badge.cls}`}>
            {badge.sym && <Sym name={badge.sym} />}
            {mark}
          </span>
        ) : (
          <span className="text-[13px] font-semibold">Comment</span>
        )}
        <span className="text-xs text-[var(--sec)]">{lineLabel(comment)}</span>
        <span className="grow" />
        {sent && (
          <span className="text-[11px] text-[var(--sec)]">
            Sent in round {sent.round}
            {round && ` · ${when(round.at, now)}`}
          </span>
        )}
      </div>
      {kind === "reopened" && sent && (
        <div className="mt-2.5">
          <SentBefore round={sent.round} text={sent.text} />
        </div>
      )}
      {comment.text !== "" && <p className="code mt-2.5 text-[13px] leading-[1.4] text-pretty whitespace-pre-wrap">{comment.text}</p>}
      {shownNote(comment.note) !== null && (
        <p className="mt-2 text-[13px] leading-[1.4] text-pretty whitespace-pre-wrap text-[var(--sec)]">
          Agent: <AgentNote note={comment.note ?? ""} />
        </p>
      )}
      {comment.suggestion !== null && !compare && (
        <>
          <div className="mt-3.5 mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-[var(--sec)]">
            <Sym name="suggest" />
            <span>Suggested Change</span>
          </div>
          <div className="sug code" role="group" aria-label="Suggested change">
            {code.map((line, i) => (
              <div key={`o${i}`} className="m">
                <span className="sg">−</span>
                <span>{line}</span>
              </div>
            ))}
            {/* A suggestion saved before diff-loop-app.md Decision 26 still has its indent; shown without it, as the − lines are. */}
            {dedent(comment.suggestion.split("\n")).map((line, i) => (
              <div key={`n${i}`} className="p">
                <span className="sg">+</span>
                <span>{line}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {compare && sent && (
        <>
          <div className="mt-3.5 mb-1.5 flex items-center text-[11px] font-semibold text-[var(--sec)]">
            <span>{nowCode.length === 0 ? "What you sent, and nothing in its place now" : "What you sent, and the code now"}</span>
            <span className="grow" />
            <span className="font-mono font-medium">
              {/* With no commit since, the change is in the files on disk. */}
              {shortId(sent.commit)} → {commit === sent.commit && workingTree ? "uncommitted" : shortId(commit)}
            </span>
          </div>
          <div className="sug code" role="group" aria-label="Code when sent and code now">
            {sentCode.map((line, i) => (
              <div key={`s${i}`} className="m">
                <span className="sg">−</span>
                <span>{line}</span>
              </div>
            ))}
            {nowCode.map((line, i) => (
              <div key={`w${i}`} className="p">
                <span className="sg">+</span>
                <span>{line}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {/* One footer for every comment, so Edit is in one place whether it is a draft or sent (ux gate 7). */}
      <div className="mt-3.5 flex items-center gap-2">
        {(sent !== null || answered(comment)) && (
          <span className="text-[11px] text-[var(--sec)]">
            {answered(comment) ? "Reply to ask again; it reopens the question." : kind === "reopened" ? "Copies as “Still: …”" : footOf(comment)}
          </span>
        )}
        <span className="grow" />
        {sent === null && (
          <button type="button" className="btn text-[var(--deltx)]" onClick={() => deleteComment(comment.id)}>
            Delete
          </button>
        )}
        <button type="button" className="btn" onClick={() => editComment(comment.id)}>
          {answered(comment) ? "Reply" : "Edit"}
        </button>
        {resolvable(comment) && (
          <button
            type="button"
            className={kind === "changed" || awaitsReviewer(comment) ? "btnp" : "btn"}
            title="R"
            onClick={() => resolveComment(comment.id)}
          >
            <Sym name="resolved" />
            {answered(comment) ? "Mark Answered" : awaitsReviewer(comment) ? "Accept" : "Resolve"}
          </button>
        )}
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
