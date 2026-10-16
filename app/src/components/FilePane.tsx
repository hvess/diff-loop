import { useDeferredValue, useEffect, useState } from "react";
import { api } from "../api";
import type { FileDiff } from "../bindings/FileDiff";
import type { Side } from "../bindings/Side";
import type { Snapshot } from "../bindings/Snapshot";
import { useDelayed } from "../delay";
import { counts, hunksOf } from "../rows";
import { commentText, useStore } from "../store";
import { baseLabel } from "./BasePicker";
import { CommentCard } from "./CommentCard";
import { Composer } from "./Composer";
import { DiffView } from "./DiffView";

/** The selected file: its header, then its diff or a card for what a diff can't show. */
export function FilePane() {
  const review = useStore((s) => s.review);
  const setBasePicker = useStore((s) => s.setBasePicker);
  const onCompareWithAnother = () => setBasePicker(true);
  const loading = useStore((s) => s.loading);
  const problem = useStore((s) => s.loadProblem);
  const base = useStore((s) => s.base);
  // The sidebar marks a new selection at once; its diff renders after, without holding up the next key.
  const selected = useDeferredValue(useStore((s) => s.selected));
  const slow = useDelayed(loading);

  if (problem) {
    return (
      <Centered>
        <span className="text-xl font-semibold tracking-[-0.015em]">{problem.title}</span>
        <span className="text-sm leading-[1.55] text-muted3">{problem.detail}</span>
        <button type="button" onClick={onCompareWithAnother} className="mt-2 rounded-full border border-line px-4 py-2 text-[13px] font-medium">
          Choose another base
        </button>
      </Centered>
    );
  }
  if (!review) {
    return <Centered>{slow && <span className="text-sm text-muted3">Loading changes…</span>}</Centered>;
  }
  if (review.changes.files.length === 0) {
    const head = review.checkout.head;
    return (
      <Centered>
        <span className="text-xl font-semibold tracking-[-0.015em]">Nothing to review yet</span>
        <span className="text-sm leading-[1.55] text-pretty text-muted3">
          <span className="font-mono text-[13px] text-fg">{head.kind === "branch" ? head.name : head.commit}</span>{" "}
          {base.kind === "ref" ? `matches ${baseLabel(base)}.` : `has no ${baseLabel(base)}.`} When the agent edits or
          commits files, they appear here on their own.
        </span>
        <button type="button" onClick={onCompareWithAnother} className="mt-2 rounded-full border border-line px-4 py-2 text-[13px] font-medium">
          Compare with another branch
        </button>
      </Centered>
    );
  }
  const file = selected === null ? undefined : review.byPath.get(selected);
  if (!file) return <Centered />;
  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <FileHeader file={file} />
      <ReplaceBar />
      <FileBody key={file.path} file={file} snapshot={review.changes.snapshot} />
    </section>
  );
}

/** While a lost draft is being placed: which, and how to choose its line (ADR 0015 §2). */
function ReplaceBar() {
  const comment = useStore((s) => s.comments.find((c) => c.id === s.replacing) ?? null);
  const chosen = useStore((s) => s.replacing !== null && s.selection !== null);
  const cancelReplace = useStore((s) => s.cancelReplace);
  if (!comment) return null;
  const text = commentText(comment);
  return (
    <div role="status" className="flex flex-none items-center gap-2.5 border-b border-border bg-chip px-8 py-2 text-[12.5px]">
      <span className="truncate font-medium">Re-place “{text.length > 40 ? `${text.slice(0, 40)}…` : text}”</span>
      <span className="ml-auto flex-none text-muted3">{chosen ? "↑ ↓ to move · Return to place · Esc" : "Click a line number · Esc"}</span>
      <button type="button" className="flex-none font-medium" onClick={cancelReplace}>
        Cancel
      </button>
    </div>
  );
}

function Centered({ children }: { children?: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-1 items-center justify-center">
      <div className="flex w-[440px] flex-col items-center gap-3 text-center">{children}</div>
    </section>
  );
}

function FileHeader({ file }: { file: FileDiff }) {
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const viewed = useStore((s) => s.viewed.has(file.path));
  const toggleViewed = useStore((s) => s.toggleViewed);
  const at = file.path.lastIndexOf("/");
  const hasDiff = hunksOf(file).length > 0;
  const modeButton = (m: typeof mode, label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={mode === m}
      onClick={() => setMode(m)}
      className={`rounded-full px-2.5 py-1 ${mode === m ? "bg-bg text-fg shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : ""}`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex h-[52px] flex-none items-center justify-between border-b border-border px-8">
      <span className="code truncate font-mono text-[13px]">
        <span className="text-faint">{file.path.slice(0, at + 1)}</span>
        <span className="font-medium">{file.path.slice(at + 1)}</span>
      </span>
      <div className="flex items-center gap-4 text-[12.5px] text-muted3">
        {hasDiff && (
          <div role="radiogroup" aria-label="Layout" className="flex rounded-full bg-chip p-0.5 font-medium">
            {modeButton("unified", "Unified")}
            {modeButton("split", "Split")}
          </div>
        )}
        <label className="flex items-center gap-2" title="V">
          <input
            type="checkbox"
            checked={viewed}
            onChange={() => toggleViewed(file.path)}
            className="size-3.5 accent-[var(--ui-btn-bg)]"
          />
          Viewed
        </label>
      </div>
    </div>
  );
}

const IMAGE = /\.(png|jpe?g|gif|webp|avif|bmp|ico|svg)$/i;

function FileBody({ file, snapshot }: { file: FileDiff; snapshot: Snapshot }) {
  const [showDeleted, setShowDeleted] = useState(false);
  const hunks = hunksOf(file);
  if (file.content.kind === "text" && hunks.length > 0 && (file.status.kind !== "deleted" || showDeleted)) {
    return <DiffView file={file} />;
  }
  const lines = counts(file).removed;
  let card: React.ReactNode;
  if (file.content.kind === "binary") {
    card = <BinaryCard file={file} snapshot={snapshot} />;
  } else if (file.status.kind === "deleted") {
    card = (
      <Card file={file} badge="Deleted">
        {lines} {lines === 1 ? "line" : "lines"} removed ·{" "}
        <button type="button" className="font-medium text-fg" onClick={() => setShowDeleted(true)}>
          Show contents
        </button>
      </Card>
    );
  } else if (file.status.kind === "renamed") {
    card = <Card file={file} badge="Renamed">from {file.status.from} · no content changes</Card>;
  } else if (file.status.kind === "added") {
    card = <Card file={file} badge="Added">Empty file</Card>;
  } else {
    card = <Card file={file} badge="Modified">Only the file mode changed</Card>;
  }
  return <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-8 py-6">{card}</div>;
}

function Card({ file, badge, children, body }: { file: FileDiff; badge: string; children?: React.ReactNode; body?: React.ReactNode }) {
  const composeOnFile = useStore((s) => s.composeOnFile);
  const composer = useStore((s) => s.composer);
  const all = useStore((s) => s.comments);
  const comments = all.filter((c) => c.path === file.path && c.target.kind === "file");
  const composing = composer?.path === file.path && composer.target.kind === "file";
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-[14px] border border-border">
        <div className="flex items-center gap-3 bg-side px-4 py-3">
          <span className="code truncate font-mono text-[13px] font-medium">{file.path}</span>
          <span className="flex-none rounded-full bg-chip px-2.5 py-0.5 text-xs text-muted2">{badge}</span>
          <span className="ml-auto truncate text-[12.5px] text-muted3">{children}</span>
          <button
            type="button"
            className="flex-none text-[12.5px] whitespace-nowrap text-muted3"
            onClick={() => composeOnFile(file.path)}
          >
            Comment on file
          </button>
        </div>
        {body}
      </div>
      {comments.map((c) => (
        <CommentCard key={c.id} comment={c} />
      ))}
      {composing && <Composer />}
    </div>
  );
}

function size(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function BinaryCard({ file, snapshot }: { file: FileDiff; snapshot: Snapshot }) {
  if (file.content.kind !== "binary") return null;
  const { oldSize, newSize } = file.content;
  const image = IMAGE.test(file.path);
  const oldPath = file.status.kind === "renamed" ? file.status.from : file.path;
  const body = image ? (
    <div className="flex gap-4 p-4">
      {file.status.kind !== "added" && <Preview label={`Before · ${size(oldSize)}`} snapshot={snapshot} side="old" path={oldPath} />}
      {file.status.kind !== "deleted" && <Preview label={`After · ${size(newSize)}`} snapshot={snapshot} side="new" path={file.path} />}
    </div>
  ) : undefined;
  const summary = [oldSize !== null && `before ${size(oldSize)}`, newSize !== null && `after ${size(newSize)}`]
    .filter(Boolean)
    .join(" · ");
  return (
    <Card file={file} badge="Binary" body={body}>
      {image ? "" : summary}
    </Card>
  );
}

function Preview({ label, snapshot, side, path }: { label: string; snapshot: Snapshot; side: Side; path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const slow = useDelayed(!url && !failed);
  useEffect(() => {
    let live = true;
    let made: string | null = null;
    const type = path.toLowerCase().endsWith(".svg") ? "image/svg+xml" : "";
    api.blob(snapshot, side, path).then(
      (bytes) => {
        if (!live) return;
        made = URL.createObjectURL(new Blob([bytes], { type }));
        setUrl(made);
      },
      () => live && setFailed(true),
    );
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [snapshot, side, path]);
  return (
    <div className="flex flex-1 flex-col gap-2">
      <span className="text-xs text-muted">{label}</span>
      <div className="flex h-[200px] items-center justify-center rounded-[10px] border border-border bg-[repeating-linear-gradient(135deg,var(--ui-chip)_0px,var(--ui-chip)_8px,var(--ui-side)_8px,var(--ui-side)_16px)]">
        {url ? (
          <img
            src={url}
            alt={label}
            onError={() => {
              setUrl(null);
              setFailed(true);
            }}
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          (failed || slow) && (
            <span className="rounded-md bg-bg px-2 py-0.5 font-mono text-[11.5px] text-muted">
              {failed ? "Can’t show this image" : "Loading…"}
            </span>
          )
        )}
      </div>
    </div>
  );
}
