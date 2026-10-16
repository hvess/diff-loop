import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { open as isOpen } from "../lifecycle";
import { hasMod, modKey } from "../platform";
import { previewSubtitle } from "../round";
import { useStore } from "../store";

/**
 * What Copy review puts on the clipboard, editable for this copy only. An
 * edit is the caller's, so closing the dialog keeps it; copying drops it
 * (`copyText`).
 */
export function PreviewDialog({
  open,
  onOpenChange,
  edited,
  onEdit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The text as typed over the generated one; null until it is edited. */
  edited: string | null;
  onEdit: (text: string | null) => void;
}) {
  const text = useRef<HTMLTextAreaElement>(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay" />
        <Dialog.Content
          // The text takes focus on opening, not the ✕ before it in the order.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            text.current?.focus();
          }}
          className="fixed top-1/2 left-1/2 z-50 flex h-[min(700px,90vh)] w-[min(720px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-bg shadow-dialog"
        >
          <Instructions
            edited={edited}
            onEdit={onEdit}
            onCopied={() => onOpenChange(false)}
            text={text}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** The dialog's body: the generated text, or the edit over it. */
function Instructions({
  edited,
  onEdit,
  onCopied,
  text,
}: {
  edited: string | null;
  onEdit: (text: string | null) => void;
  onCopied: () => void;
  text: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const comments = useStore((s) => s.comments);
  const rounds = useStore((s) => s.rounds.length);
  const instructionsRequest = useStore((s) => s.instructionsRequest);
  const copyText = useStore((s) => s.copyText);
  const [generated, setGenerated] = useState("");
  const nothing = !comments.some(isOpen);

  useEffect(() => {
    const request = instructionsRequest();
    if (!request) return;
    let live = true;
    api.instructions(request).then(
      (t) => live && setGenerated(t),
      (e: unknown) => live && setGenerated(String(e)),
    );
    return () => {
      live = false;
    };
  }, [comments, instructionsRequest]);

  const copy = () => void copyText(edited ?? generated).then(onCopied);

  return (
    <>
      <div className="flex h-14 flex-none items-center justify-between gap-4 pr-3 pl-[22px]">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <Dialog.Title className="m-0 text-[15px] font-semibold tracking-[-0.01em]">Review instructions</Dialog.Title>
          <Dialog.Description className="m-0 truncate text-[13px] text-muted3">
            {previewSubtitle(comments, rounds)}
          </Dialog.Description>
        </div>
        <div className="flex items-center gap-1">
          {edited !== null && (
            <span className="flex h-7 items-center gap-1.5 px-2.5 text-[12.5px] text-muted3">
              <span aria-hidden className="size-1.5 rounded-full bg-fg" />
              Edited
            </span>
          )}
          <Dialog.Close asChild>
            <button type="button" aria-label="Close" title="Esc" className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-chip">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
                <path d="M3 3l8 8M11 3l-8 8" />
              </svg>
            </button>
          </Dialog.Close>
        </div>
      </div>
      <textarea
        ref={text}
        value={edited ?? generated}
        onChange={(e) => onEdit(e.target.value)}
        onKeyDown={(e) => {
          // ⌘/Ctrl-Return copies from inside the text, as the Copy button says.
          if (e.key === "Enter" && hasMod(e) && !nothing) {
            e.preventDefault();
            copy();
          }
        }}
        // Until the text arrives, typing would start a copy of nothing.
        readOnly={edited === null && generated === ""}
        aria-label="Instructions"
        spellCheck={false}
        className="code min-h-0 flex-1 resize-none border-y border-border bg-side px-[22px] py-5 font-mono text-[12.5px] leading-[1.7] outline-none focus:bg-bg focus:outline-2 focus:-outline-offset-2 focus:outline-sel-fg focus:outline-solid"
      />
      <div className="flex h-[60px] flex-none items-center justify-between gap-4 pr-3 pl-[22px] text-[13px]">
        {edited === null ? (
          <span className="text-muted3">You can edit the text before copying.</span>
        ) : (
          <span className="flex items-center gap-1.5 text-muted3">
            Edits change this text, not your comments.
            <button
              type="button"
              className="rounded-full border border-line px-3 py-1 font-medium whitespace-nowrap text-fg"
              onClick={() => onEdit(null)}
            >
              Reset to original
            </button>
          </span>
        )}
        <div className="flex flex-none items-center gap-1.5">
          <Dialog.Close asChild>
            <button type="button" className="flex h-[34px] items-center rounded-[9px] px-3.5 font-medium text-muted3">
              Cancel
            </button>
          </Dialog.Close>
          <button
            type="button"
            disabled={nothing}
            onClick={copy}
            className="flex h-[34px] items-center gap-2 rounded-[9px] bg-btn px-4 font-medium text-btn-fg disabled:opacity-60"
          >
            Copy to clipboard
            {/* 65 %: the hint keeps 4.5:1 on the button in both appearances (HIG accessibility). */}
            <span className="text-xs opacity-65">{modKey}↵</span>
          </button>
        </div>
      </div>
    </>
  );
}
