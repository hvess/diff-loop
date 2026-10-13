import type { Comment } from "../bindings/Comment";
import { useStore } from "../store";
import { targetLabel } from "./Composer";

/** A saved comment: its text, suggested code, and what to do once its code changed. */
export function CommentCard({ comment, floating = false }: { comment: Comment; floating?: boolean }) {
  const editComment = useStore((s) => s.editComment);
  const deleteComment = useStore((s) => s.deleteComment);
  const keepComment = useStore((s) => s.keepComment);
  const outdated = comment.state === "outdated";
  const code = comment.target.kind === "lines" ? comment.target.code : [];

  return (
    <div
      className={`flex max-w-[580px] flex-col gap-1 rounded-[14px] border border-line bg-bg px-4 py-3 text-[13.5px] leading-[1.55] ${floating ? "shadow-pop" : ""}`}
    >
      <div className="flex justify-between text-xs text-muted">
        <span className="flex items-center gap-2">
          {targetLabel(comment.target)}
          {outdated && <span className="rounded-full bg-chip px-2 py-px font-medium text-muted2">Outdated</span>}
        </span>
        <span className="flex gap-3">
          <button type="button" onClick={() => editComment(comment.id)}>
            Edit
          </button>
          <button type="button" onClick={() => deleteComment(comment.id)}>
            Delete
          </button>
        </span>
      </div>
      <span className="code text-pretty whitespace-pre-wrap">{comment.text}</span>
      {outdated && code.length > 0 && (
        <div className="mt-1.5 flex flex-col gap-1">
          <span className="text-xs text-muted">You commented on</span>
          <span className="code rounded-lg bg-chip px-2.5 py-1.5 font-mono text-xs whitespace-pre text-muted3">
            {code.join("\n")}
          </span>
          <div className="mt-1 flex gap-3.5 text-[12.5px]">
            <button type="button" className="font-medium" onClick={() => deleteComment(comment.id)}>
              Resolve
            </button>
            <button type="button" className="text-muted3" onClick={() => keepComment(comment.id)}>
              Keep in review
            </button>
          </div>
        </div>
      )}
      {!outdated && comment.suggestion !== null && (
        <div className="code mt-1.5 overflow-hidden rounded-[10px] border border-card-border font-mono text-xs leading-[1.85]">
          {code.map((line, i) => (
            <div key={`o${i}`} className="flex bg-del-bg pr-2.5">
              <span className="w-[22px] flex-none text-center text-del">−</span>
              <span className="whitespace-pre-wrap">{line}</span>
            </div>
          ))}
          {comment.suggestion.split("\n").map((line, i) => (
            <div key={`n${i}`} className="flex bg-add-bg pr-2.5">
              <span className="w-[22px] flex-none text-center text-add">+</span>
              <span className="whitespace-pre-wrap">{line}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
