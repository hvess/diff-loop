import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";
import { api } from "../api";
import type { Format } from "../bindings/Format";
import { useStore } from "../store";

/** Pause after the last change before the preview is rebuilt. */
const PREVIEW_DELAY_MS = 150;

function Toggle({ on, label, onChange }: { on: boolean; label: string; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className="flex items-center gap-2">
      <span className={`relative h-[18px] w-8 flex-none rounded-full ${on ? "bg-btn" : "bg-line"}`}>
        <span
          className={`absolute top-0.5 size-3.5 rounded-full ${on ? "right-0.5 bg-btn-fg" : "left-0.5 bg-bg"}`}
        />
      </span>
      {label}
    </button>
  );
}

/** What Copy review puts on the clipboard, with its format and what it includes. */
export function PreviewDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const prefs = useStore((s) => s.prefs);
  const setPrefs = useStore((s) => s.setPrefs);
  const note = useStore((s) => s.note);
  const setNote = useStore((s) => s.setNote);
  const comments = useStore((s) => s.comments);
  const instructionsRequest = useStore((s) => s.instructionsRequest);
  const copyText = useStore((s) => s.copyText);
  const [text, setText] = useState("");
  const files = new Set(comments.map((c) => c.path)).size;

  useEffect(() => {
    if (!open) return;
    const request = instructionsRequest(prefs);
    if (!request) return;
    let live = true;
    // Typing in the note sends the whole review; wait for a pause first.
    const timer = window.setTimeout(() => {
      api.instructions(request).then(
        (t) => live && setText(t),
        (e: unknown) => live && setText(String(e)),
      );
    }, PREVIEW_DELAY_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [open, prefs, note, comments, instructionsRequest]);

  const format = (f: Format, label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={prefs.format === f}
      onClick={() => setPrefs({ format: f })}
      className={`rounded-full px-3.5 py-[5px] ${prefs.format === f ? "bg-bg text-fg shadow-[0_1px_2px_rgba(0,0,0,0.10)]" : "text-muted3"}`}
    >
      {label}
    </button>
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex h-[min(720px,90vh)] w-[min(760px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[18px] border border-line bg-bg shadow-[0_24px_64px_rgba(0,0,0,0.25)]">
          <div className="flex items-center justify-between px-6 pt-5 pb-4">
            <div className="flex flex-col gap-0.5">
              <Dialog.Title className="m-0 text-base font-semibold">Review instructions</Dialog.Title>
              <Dialog.Description className="m-0 text-[13px] text-muted">
                {comments.length} {comments.length === 1 ? "comment" : "comments"} across {files}{" "}
                {files === 1 ? "file" : "files"}
              </Dialog.Description>
            </div>
            <div role="radiogroup" aria-label="Format" className="flex rounded-full bg-chip p-[3px] text-[13px] font-medium">
              {format("plain", "Plain text")}
              {format("markdown", "Markdown")}
            </div>
          </div>
          <div className="flex gap-6 px-6 pb-3.5 text-[13px] text-muted2">
            <Toggle on={prefs.includeCode} label="Include referenced code" onChange={(on) => setPrefs({ includeCode: on })} />
            <Toggle on={prefs.includeNote} label="Include general note" onChange={(on) => setPrefs({ includeNote: on })} />
          </div>
          {prefs.includeNote && (
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="General note for the agent, e.g. keep the change scoped to the share endpoint"
              rows={2}
              className="mx-6 mb-3 resize-none rounded-xl border border-line bg-bg px-3.5 py-2.5 text-[13.5px] leading-[1.5] outline-none placeholder:text-muted3 focus:border-ghost"
            />
          )}
          <pre className="mx-6 my-0 min-h-0 flex-1 overflow-auto rounded-xl border border-border bg-side px-[18px] py-4 font-mono text-[12.5px] leading-[1.65] whitespace-pre-wrap">
            {text}
          </pre>
          <div className="flex items-center justify-end gap-2.5 px-6 py-4">
            <Dialog.Close asChild>
              <button type="button" className="px-3.5 py-2 text-[13px] text-muted3">
                Cancel
              </button>
            </Dialog.Close>
            <button
              type="button"
              disabled={comments.length === 0}
              onClick={() => void copyText(text).then(() => onOpenChange(false))}
              className="rounded-full bg-btn px-[18px] py-[9px] text-[13px] font-medium text-btn-fg disabled:opacity-60"
            >
              Copy to clipboard
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
