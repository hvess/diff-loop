import type { Comment } from "../bindings/Comment";
import { useStore } from "../store";
import { targetLabel } from "./Composer";

/** A saved comment: its text and suggested code. */
export function CommentCard({ comment, floating = false }: { comment: Comment; floating?: boolean }) {
  const editComment = useStore((s) => s.editComment);
  const deleteComment = useStore((s) => s.deleteComment);
  const code = comment.target.kind === "lines" ? comment.target.code : [];

  return (
    <div
      className={`flex max-w-[580px] flex-col gap-1 rounded-[14px] border border-line bg-bg px-4 py-3 text-[13.5px] leading-[1.55] ${floating ? "shadow-pop" : ""}`}
    >
      <div className="flex justify-between text-xs text-muted">
        <span>{targetLabel(comment.target)}</span>
        <span className="flex gap-3">
          <button type="button" onClick={() => editComment(comment.id)}>
            Edit
          </button>
          <button type="button" onClick={() => deleteComment(comment.id)}>
            Delete
          </button>
        </span>
      </div>
      {comment.text !== "" && <span className="code text-pretty whitespace-pre-wrap">{comment.text}</span>}
      {comment.suggestion !== null && (
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
