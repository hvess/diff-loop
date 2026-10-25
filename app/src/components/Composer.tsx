import { useEffect, useRef } from "react";
import type { Target } from "../bindings/Target";
import { dedent } from "../indent";
import { hasMod, modKey } from "../platform";
import { lastLine } from "../rows";
import type { Ask } from "../bindings/Ask";
import { codeOf, KINDS } from "../lifecycle";
import { canSave, suggestable, useStore } from "../store";
import { Sym } from "./Icon";

export function targetLabel(target: Target): string {
  if (target.kind === "file") return "Whole file";
  const prefix = target.side === "old" ? "Removed line" : "Line";
  const end = lastLine(target);
  return target.start === end ? `${prefix} ${target.start}` : `${prefix}s ${target.start}–${end}`;
}

/**
 * The comment popover's body, writing or editing a comment, a question or a suggestion (the canvas's 3c, 3d and 3f);
 * its caller draws the popover. Return with the command key saves, with Alt (Option) turns Suggestion on or off, Esc
 * cancels.
 */
export function Composer() {
  const composer = useStore((s) => s.composer);
  const update = useStore((s) => s.updateComposer);
  const save = useStore((s) => s.saveComposer);
  const cancel = useStore((s) => s.cancelComposer);
  // Editing a sent comment reopens it: the popover says what was sent, and that it copies as "Still: …" (ADR 0015 §5).
  const sent = useStore((s) => s.comments.find((c) => c.id === s.composer?.editing)?.sent ?? null);
  const text = useRef<HTMLTextAreaElement>(null);
  const code = useRef<HTMLTextAreaElement>(null);
  const suggesting = composer?.ask.kind === "suggestion";

  // Typing goes on in the field left: the code once Suggest Change is on, the text once it is off.
  useEffect(() => {
    (suggesting ? code : text).current?.focus();
  }, [suggesting]);

  if (!composer) return null;
  const { target } = composer;
  const canSuggest = target.kind === "lines" && target.side === "new";
  // Code that changes the lines saves without a reason (diff-loop-app.md Decision 22).
  const suggestion = codeOf(composer.ask);
  const reasonOptional = suggestion !== null && canSave({ ...composer, text: "" });
  const asks = composer.ask.kind;
  const toggleSuggestion = () => {
    if (target.kind === "lines") update({ ask: suggestion === null ? { kind: "suggestion", code: suggestable(target.code) } : { kind: "comment" } });
  };
  const choose = (kind: Ask["kind"]) => {
    if (kind === "suggestion") {
      if (target.kind === "lines") update({ ask: { kind: "suggestion", code: suggestion ?? suggestable(target.code) } });
    } else {
      update({ ask: { kind } });
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    } else if (e.key === "Enter" && hasMod(e)) {
      e.preventDefault();
      save();
    } else if (e.key === "Enter" && e.altKey && canSuggest && sent === null) {
      e.preventDefault();
      toggleSuggestion();
    }
  };

  return (
    <div onKeyDown={onKeyDown}>
      <div className="mb-2.5 flex items-center gap-2">
        {/* A sent comment keeps its kind: what was sent is what it is judged against (ADR 0036 §1). */}
        <div className="tseg" role="radiogroup" aria-label="Kind">
          {KINDS.map(({ kind, label }) => (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={asks === kind}
              disabled={sent !== null || (kind === "suggestion" && !canSuggest)}
              title={sent !== null ? "A sent comment keeps its kind" : kind === "suggestion" && !canSuggest ? "Suggested code goes on new lines" : undefined}
              onClick={() => choose(kind)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="grow" />
        <span className="text-xs text-[var(--sec)]">{targetLabel(target)}</span>
      </div>
      {sent && <SentBefore round={sent.round} text={sent.text} />}
      <AutoTextarea
        inputRef={text}
        autoFocus
        minRows={suggestion === null ? 3 : 2}
        value={composer.text}
        onChange={(value) => update({ text: value })}
        aria-label={asks === "question" ? "Question" : "Comment"}
        placeholder={
          asks === "question"
            ? "Ask the agent a question"
            : reasonOptional
              ? "Why this change? (optional)"
              : suggestion !== null
                ? "Change the code, or say why"
                : "Leave a comment for the agent"
        }
        className="block w-full resize-none rounded-[7px] bg-[var(--card)] px-2 py-1.5 text-[13px] leading-[1.4] text-[var(--label)] shadow-[0_0_0_0.5px_var(--popbd)] outline-none placeholder:text-[var(--sec)] focus:shadow-[0_0_0_0.5px_var(--popbd),0_0_0_3.5px_var(--ring)]"
      />
      {asks === "question" && <p className="m-0 mt-2 text-[11px] text-[var(--sec)]">The agent answers, without changing code.</p>}
      {canSuggest && suggestion !== null && (
        <>
          <div className="mt-3.5 mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-[var(--sec)]">
            <Sym name="suggest" />
            <span>Suggested Change</span>
            <span className="grow" />
            {/* By its mark, not its colour (ux gate 8), where the canvas says "Edit the green line". */}
            <span className="font-medium">Edit the + {suggestion.includes("\n") ? "lines" : "line"}</span>
          </div>
          <div className="sug" role="group" aria-label="Suggested change">
            {dedent(target.code).map((line, i) => (
              <div key={i} className="m">
                <span className="sg" aria-label="Current">
                  −
                </span>
                <span>{line}</span>
              </div>
            ))}
            <div className="p edit">
              <span className="sg" aria-label="Replacement">
                +
              </span>
              <AutoTextarea
                inputRef={code}
                value={suggestion}
                onChange={(value) => update({ ask: { kind: "suggestion", code: value } })}
                aria-label="Suggested code"
                spellCheck={false}
                className="block flex-1 resize-none bg-transparent font-[inherit] break-all whitespace-pre-wrap text-[var(--label)] outline-none"
              />
            </div>
          </div>
        </>
      )}
      <div className="mt-3.5 flex items-center gap-2">
        {sent && <span className="text-[11px] text-[var(--sec)]">Copies as “Still: …”</span>}
        <span className="grow" />
        <button type="button" className="btn" onClick={cancel}>
          Cancel
        </button>
        <button type="button" className="btnp" onClick={save} disabled={!canSave(composer)} title={`${modKey}Return`}>
          {composer.editing ? "Save" : KINDS.find((k) => k.kind === asks)?.save}
        </button>
      </div>
    </div>
  );
}

/** What a reopened comment said when it was sent (ADR 0015 §5). */
export function SentBefore({ round, text }: { round: number; text: string }) {
  return (
    <div className="mb-2.5 flex flex-col gap-0.5 rounded-lg bg-[var(--field)] px-2.5 py-2 text-xs leading-[1.45]">
      <span className="text-[11px] text-[var(--sec)]">You sent in round {round}</span>
      <span className="whitespace-pre-wrap text-[var(--sec)]">{text === "" ? "Suggested change" : text}</span>
    </div>
  );
}

function AutoTextarea({
  inputRef,
  value,
  onChange,
  minRows = 1,
  ...rest
}: {
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (value: string) => void;
  minRows?: number;
} & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange">) {
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value, inputRef]);
  return <textarea ref={inputRef} rows={minRows} value={value} onChange={(e) => onChange(e.target.value)} {...rest} />;
}
