import { useEffect, useState } from "react";
import { useStore } from "../store";
import { BasePicker } from "./BasePicker";
import { FilePane } from "./FilePane";
import { ReviewActions } from "./ReviewActions";
import { Sidebar } from "./Sidebar";
import { TitleBar } from "./TitleBar";

export function ReviewScreen() {
  const opening = useStore((s) => s.opening);
  const review = useStore((s) => s.review);
  const closeRepository = useStore((s) => s.closeRepository);
  const [pickerOpen, setPickerOpen] = useState(false);
  const checkout = review?.checkout ?? opening?.checkout;
  if (!checkout) return null;
  const head = checkout.head;

  return (
    <div className="flex h-full flex-col">
      <TitleBar>
        <div className="flex items-center gap-3.5">
          <button
            type="button"
            onClick={closeRepository}
            title="Open another repository"
            className="flex items-center gap-2 rounded-full bg-chip px-3 py-1.5 text-[13px]"
          >
            <span className="font-medium">{checkout.name}</span>
            <span className="text-faint">/</span>
            <span className="font-mono text-[12.5px] text-muted2">
              {head.kind === "branch" ? head.name : `HEAD detached at ${head.commit}`}
            </span>
          </button>
          <BasePicker open={pickerOpen} onOpenChange={setPickerOpen} />
        </div>
        <ReviewActions />
      </TitleBar>
      <Banner />
      <UndoBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <FilePane onCompareWithAnother={() => setPickerOpen(true)} />
      </div>
    </div>
  );
}

/** The checkout moved under the review. */
function Banner() {
  const banner = useStore((s) => s.banner);
  const showWhatChanged = useStore((s) => s.showWhatChanged);
  const dismiss = useStore((s) => s.dismissBanner);
  if (!banner) return null;
  return (
    <div role="status" className="flex flex-none items-center gap-3 border-b border-border bg-side px-6 py-2.5 text-[13px]">
      <span className="size-[7px] rounded-full bg-live" />
      <span className="font-medium">{banner.title}</span>
      {banner.detail && <span className="text-muted">{banner.detail}</span>}
      <button type="button" className="ml-auto font-medium" onClick={() => void showWhatChanged()}>
        Show what changed
      </button>
      <button type="button" className="text-muted3" onClick={dismiss}>
        Dismiss
      </button>
    </div>
  );
}

/** Undo for deleting or clearing comments, offered for 10 s or until the next one replaces it. */
function UndoBar() {
  const undo = useStore((s) => s.undo);
  const undoLast = useStore((s) => s.undoLast);
  const clearUndo = useStore((s) => s.clearUndo);
  useEffect(() => {
    if (!undo) return;
    const timer = window.setTimeout(clearUndo, 10000);
    return () => window.clearTimeout(timer);
  }, [undo, clearUndo]);
  if (!undo) return null;
  return (
    <div role="status" className="flex flex-none items-center gap-3 border-b border-border bg-side px-6 py-2 text-[13px]">
      <span>{undo.label}</span>
      <button type="button" className="font-medium" onClick={undoLast}>
        Undo
      </button>
    </div>
  );
}
