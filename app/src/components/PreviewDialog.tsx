import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";
import { api } from "../api";
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
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex h-[min(720px,90vh)] w-[min(760px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[18px] border border-line bg-bg shadow-[0_24px_64px_rgba(0,0,0,0.25)]">
          <Instructions
            edited={edited}
            onEdit={onEdit}
            onCopied={() => onOpenChange(false)}
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
}: {
  edited: string | null;
  onEdit: (text: string | null) => void;
  onCopied: () => void;
}) {
  const comments = useStore((s) => s.comments);
  const instructionsRequest = useStore((s) => s.instructionsRequest);
  const copyText = useStore((s) => s.copyText);
  const [generated, setGenerated] = useState("");
  const files = new Set(comments.map((c) => c.path)).size;

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

  return (
    <>
      <div className="flex flex-col gap-0.5 px-6 pt-5 pb-4">
        <Dialog.Title className="m-0 text-base font-semibold">Review instructions</Dialog.Title>
        <Dialog.Description className="m-0 text-[13px] text-muted3">
          {comments.length} {comments.length === 1 ? "comment" : "comments"} across {files}{" "}
          {files === 1 ? "file" : "files"}
        </Dialog.Description>
      </div>
      <textarea
        value={edited ?? generated}
        onChange={(e) => onEdit(e.target.value)}
        // Until the text arrives, typing would start a copy of nothing.
        readOnly={edited === null && generated === ""}
        aria-label="Instructions"
        spellCheck={false}
        className="code mx-6 min-h-0 flex-1 resize-none rounded-xl border border-border bg-side px-[18px] py-4 font-mono text-[12.5px] leading-[1.65] outline-none focus:bg-bg focus:outline-2 focus:outline-sel-fg focus:outline-solid"
      />
      <div className="flex items-center justify-between gap-4 px-6 py-4 text-[13px]">
        {edited === null ? (
          <span className="text-muted3">You can edit the text before copying.</span>
        ) : (
          <span className="flex items-center gap-3">
            <span className="rounded-full bg-chip px-2.5 py-0.5 text-xs font-medium text-muted2">Edited</span>
            <span className="text-muted3">Edits change this text, not your comments.</span>
            <button
              type="button"
              className="rounded-full border border-line px-3 py-1 font-medium whitespace-nowrap text-fg"
              onClick={() => onEdit(null)}
            >
              Reset to original
            </button>
          </span>
        )}
        <div className="flex flex-none items-center gap-2.5">
          <Dialog.Close asChild>
            <button type="button" className="px-3.5 py-2 text-muted3">
              Cancel
            </button>
          </Dialog.Close>
          <button
            type="button"
            disabled={comments.length === 0}
            onClick={() => void copyText(edited ?? generated).then(onCopied)}
            className="rounded-full bg-btn px-[18px] py-[9px] font-medium text-btn-fg disabled:opacity-60"
          >
            Copy to clipboard
          </button>
        </div>
      </div>
    </>
  );
}
