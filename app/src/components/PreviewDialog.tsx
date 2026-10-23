import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { open as isOpen } from "../lifecycle";
import { hasMod, modKey } from "../platform";
import { previewSubtitle } from "../round";
import { useStore, whyNotSent } from "../store";
import { baseLabel } from "./BasePicker";
import { Sym } from "./Icon";

/**
 * What Copy Review puts on the clipboard, editable for this copy only, as the canvas's sheet (ADR 0027, screen 4c).
 * An edit is the caller's, so closing the sheet keeps it; copying drops it (`copyText`).
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
        <Dialog.Overlay className="scrim fixed" />
        <Dialog.Content
          // The text takes focus on opening, not the first button.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            text.current?.focus();
          }}
          className="sheet fixed box-border w-[680px] max-w-[calc(100vw-32px)] px-6 pt-[22px] pb-5"
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

/** The sheet's body: the generated text, or the edit over it. */
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
  const branch = useStore((s) => s.key?.branch);
  const base = useStore((s) => s.base);
  const instructionsRequest = useStore((s) => s.instructionsRequest);
  const copyText = useStore((s) => s.copyText);
  const [generated, setGenerated] = useState("");
  const unsendable = useStore(whyNotSent);
  const open = comments.filter(isOpen).length;
  const nothing = open === 0 || unsendable !== null;
  const counts = previewSubtitle(comments, rounds);
  const subtitle = branch === undefined ? counts : `${branch} compared with ${baseLabel(base)} · ${counts}`;

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
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <Dialog.Title className="m-0 text-[15px] font-bold">Review Instructions</Dialog.Title>
          <Dialog.Description className="m-0 mt-1 truncate text-xs text-[var(--sec)]">{subtitle}</Dialog.Description>
        </div>
        {edited !== null && <span className="badge b-changed mt-0.5">Edited</span>}
      </div>
      <textarea
        ref={text}
        value={edited ?? generated}
        onChange={(e) => onEdit(e.target.value)}
        onKeyDown={(e) => {
          // ⌘/Ctrl-Return copies from inside the text, as the hint beside Copy says.
          if (e.key === "Enter" && hasMod(e) && !nothing) {
            e.preventDefault();
            copy();
          }
        }}
        // Until the text arrives, typing would start a copy of nothing.
        readOnly={edited === null && generated === ""}
        aria-label="Instructions"
        spellCheck={false}
        className="mt-4 box-border block h-[min(420px,calc(100vh-220px))] w-full resize-none rounded-[10px] border-none bg-[var(--inset)] px-4 py-3.5 font-mono text-xs leading-[1.6] whitespace-pre-wrap text-[var(--label)] shadow-[inset_0_0_0_0.5px_var(--sidebd)] outline-none focus:shadow-[inset_0_0_0_0.5px_var(--sidebd),0_0_0_3.5px_var(--ring)]"
      />
      <p className="m-0 mt-3 text-[11px] text-[var(--sec)]">
        Edits change this text, not your comments.
        {!nothing &&
          ` Copying ends round ${rounds + 1} and marks ${open === 1 ? "this comment" : `these ${open} comments`} Sent.`}
      </p>
      <div className="mt-3 flex items-center gap-2 whitespace-nowrap">
        {edited !== null && (
          <button type="button" className="btnplain" onClick={() => onEdit(null)}>
            <Sym name="reset" />
            Reset to Original
          </button>
        )}
        <span className="flex-1" />
        <Dialog.Close asChild>
          <button type="button" className="btn">
            Cancel
          </button>
        </Dialog.Close>
        {/* A disabled button takes no pointer: its reason is on what holds it. */}
        <span title={unsendable ?? undefined}>
          <button type="button" disabled={nothing} onClick={copy} className="btnp">
            <Sym name="copy" />
            Copy to Clipboard
            {/* On the button it presses (HIG `offering-help`), not before Cancel, where the canvas sets it. */}
            <span className="kbd" aria-hidden>
              <b>{modKey}↩</b>
            </span>
          </button>
        </span>
      </div>
    </>
  );
}
