import { useEffect, useRef } from "react";
import type { Target } from "../bindings/Target";
import { hasMod, modKey } from "../platform";
import { lastLine } from "../rows";
import { useStore } from "../store";

export function targetLabel(target: Target): string {
  if (target.kind === "file") return "Whole file";
  const prefix = target.side === "old" ? "Removed line" : "Line";
  const end = lastLine(target);
  return target.start === end ? `${prefix} ${target.start}` : `${prefix}s ${target.start}–${end}`;
}

/** Writes or edits a comment; Return with the command key saves, Esc cancels. */
export function Composer({ floating = false }: { floating?: boolean }) {
  const composer = useStore((s) => s.composer);
  const update = useStore((s) => s.updateComposer);
  const save = useStore((s) => s.saveComposer);
  const cancel = useStore((s) => s.cancelComposer);
  const text = useRef<HTMLTextAreaElement>(null);
  const code = useRef<HTMLTextAreaElement>(null);
  const suggesting = composer?.suggestion !== null && composer?.suggestion !== undefined;

  useEffect(() => {
    if (suggesting) code.current?.focus();
  }, [suggesting]);

  if (!composer) return null;
  const { target } = composer;
  const canSuggest = target.kind === "lines" && target.side === "new";

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    } else if (e.key === "Enter" && hasMod(e)) {
      e.preventDefault();
      save();
    }
  };

  return (
    <div
      onKeyDown={onKeyDown}
      className={`overflow-hidden rounded-2xl border border-ghost bg-bg text-[13.5px] leading-[1.55] ${floating ? "shadow-pop" : ""}`}
    >
      <AutoTextarea
        inputRef={text}
        autoFocus
        value={composer.text}
        onChange={(value) => update({ text: value })}
        placeholder={composer.suggestion !== null ? "Why this change?" : "Leave a comment for the agent"}
        className="block w-full resize-none bg-transparent px-4 pt-3.5 pb-1.5 outline-none placeholder:text-faint"
      />
      {canSuggest && composer.suggestion !== null && (
        <div className="mx-3 mt-1.5 mb-0.5 overflow-hidden rounded-xl border border-line font-mono text-[11.5px] leading-[1.9]">
          <div className="flex justify-between border-b border-border bg-hunk px-3 py-1.5 font-sans text-xs text-muted">
            <span>Suggested change</span>
            <span>Edit the green lines</span>
          </div>
          {target.code.map((line, i) => (
            <div key={i} className="flex bg-del-bg pr-3">
              <span className="w-6 flex-none text-center text-del">−</span>
              <span className="whitespace-pre-wrap">{line}</span>
            </div>
          ))}
          <div className="flex bg-add-bg pr-3 shadow-[inset_0_0_0_1.5px_var(--ui-add-ring)]">
            <span className="w-6 flex-none text-center text-add">+</span>
            <AutoTextarea
              inputRef={code}
              value={composer.suggestion}
              onChange={(value) => update({ suggestion: value })}
              aria-label="Suggested code"
              spellCheck={false}
              className="block flex-1 resize-none bg-transparent break-all whitespace-pre-wrap outline-none"
            />
          </div>
        </div>
      )}
      <div className="flex items-center gap-2.5 px-4 pt-2 pb-3 text-[12.5px]">
        <span className="text-faint">{targetLabel(target)}</span>
        {canSuggest && (
          <button
            type="button"
            aria-pressed={composer.suggestion !== null}
            onClick={() => update({ suggestion: composer.suggestion === null ? target.code.join("\n") : null })}
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ${
              composer.suggestion !== null ? "bg-btn text-btn-fg" : "bg-chip text-muted2"
            }`}
          >
            <span className="font-mono text-[11.5px]">±</span>Suggest code
          </button>
        )}
        <button type="button" onClick={cancel} className="ml-auto text-muted3">
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={composer.text.trim() === ""}
          title={`${modKey}Return`}
          className="rounded-full bg-btn px-3.5 py-1.5 font-medium text-btn-fg disabled:opacity-50"
        >
          {composer.editing ? "Save" : "Comment"}
        </button>
      </div>
    </div>
  );
}

function AutoTextarea({
  inputRef,
  value,
  onChange,
  ...rest
}: {
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (value: string) => void;
} & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange">) {
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value, inputRef]);
  return <textarea ref={inputRef} rows={1} value={value} onChange={(e) => onChange(e.target.value)} {...rest} />;
}
