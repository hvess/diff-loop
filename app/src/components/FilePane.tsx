import { useDeferredValue, useEffect, useState } from "react";
import { api } from "../api";
import type { FileDiff } from "../bindings/FileDiff";
import type { Side } from "../bindings/Side";
import type { Snapshot } from "../bindings/Snapshot";
import { useDelayed } from "../delay";
import { nameOf } from "../path";
import { counts, hunksOf } from "../rows";
import { canComment, commentText, useStore } from "../store";
import { baseLabel } from "./BasePicker";
import { CommentCard } from "./CommentCard";
import { Composer } from "./Composer";
import { DiffView } from "./DiffView";
import { Sym, type Symbol } from "./Icon";
import { LineTotals } from "./LineTotals";
import { statusOf } from "./Sidebar";

/** The selected file: its header, then its diff or a card for what a diff can't show (ADR 0027). */
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
      <Message symbol="warning" title={problem.title} detail={problem.detail} action="Choose Another Base…" onAction={onCompareWithAnother} />
    );
  }
  if (!review) {
    return (
      <Centered>
        {slow && (
          <span
            role="status"
            aria-label="Loading changes…"
            className="size-5 animate-spin rounded-full border-2 border-[var(--popbd)] border-t-[var(--sec)]"
          />
        )}
      </Centered>
    );
  }
  if (review.changes.files.length === 0) {
    const head = review.checkout.head;
    const name = head.kind === "branch" ? head.name : head.commit;
    return (
      <Message
        symbol="empty"
        title="Nothing to Review Yet"
        detail={`${name} ${base.kind === "ref" ? `matches ${baseLabel(base)}.` : `has no ${baseLabel(base)}.`} When the agent edits or commits files, they appear here on their own.`}
        action="Compare with Another Branch…"
        onAction={onCompareWithAnother}
      />
    );
  }
  const file = selected === null ? undefined : review.byPath.get(selected);
  if (!file) return <Centered />;
  return <FileView key={file.path} file={file} snapshot={review.changes.snapshot} />;
}

function Centered({ children }: { children?: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-1 flex-col items-center justify-center pb-[60px] text-center">{children}</section>
  );
}

/** The canvas's empty state (screen 1c), which the load problem shares: symbol, title, one-line detail, one button. */
function Message({
  symbol,
  title,
  detail,
  action,
  onAction,
}: {
  symbol: Symbol;
  title: string;
  detail: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <Centered>
      <Sym name={symbol} className="size-12 text-[var(--sec)]" />
      <h1 className="mt-[18px] text-[20px] font-bold">{title}</h1>
      <p className="mt-2 max-w-[380px] text-[13px] leading-normal text-pretty text-[var(--sec)]">{detail}</p>
      <button type="button" className="btn mt-5" onClick={onAction}>
        {action}
      </button>
    </Centered>
  );
}

function FileView({ file, snapshot }: { file: FileDiff; snapshot: Snapshot }) {
  const [showDeleted, setShowDeleted] = useState(false);
  const diff = file.content.kind === "text" && hunksOf(file).length > 0 && (file.status.kind !== "deleted" || showDeleted);
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
      <FileHeader file={file} onFile={!diff} />
      <ReplaceBar />
      {diff ? <DiffView file={file} /> : <FileCard file={file} snapshot={snapshot} onShowDeleted={() => setShowDeleted(true)} />}
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
    <div role="status" className="banner flex-none">
      <div className="txt">
        <b className="truncate">Re-place “{text.length > 40 ? `${text.slice(0, 40)}…` : text}”</b>
        <span>{chosen ? "↑ ↓ to move · Return to place · Esc" : "Click a line number · Esc"}</span>
      </div>
      <button type="button" className="btn" onClick={cancelReplace}>
        Cancel
      </button>
    </div>
  );
}

function FileHeader({ file, onFile }: { file: FileDiff; onFile: boolean }) {
  const viewed = useStore((s) => s.viewed.has(file.path));
  const toggleViewed = useStore((s) => s.toggleViewed);
  const composeOnFile = useStore((s) => s.composeOnFile);
  const commentable = useStore(canComment);
  const at = file.path.lastIndexOf("/");
  const folder = file.path.slice(0, Math.max(at, 0));
  return (
    <div className="head flex-none">
      <div className="min-w-0 flex-1">
        <h1 className="truncate">{file.path.slice(at + 1)}</h1>
        <div className="sub">
          {folder && (
            <>
              <span className="truncate">{folder}</span>
              <span aria-hidden="true">·</span>
            </>
          )}
          <Summary file={file} />
        </div>
      </div>
      {onFile && commentable && (
        <button type="button" className="btn" onClick={() => composeOnFile(file.path)}>
          <Sym name="comments" />
          Comment on File
        </button>
      )}
      <label className={`sw${viewed ? " on" : ""}`} title="V">
        <span>Viewed</span>
        <input type="checkbox" role="switch" checked={viewed} onChange={() => toggleViewed(file.path)} className="peer sr-only" />
        <span
          className="track peer-focus-visible:ring-[3px] peer-focus-visible:ring-[var(--ring)]"
          aria-hidden="true"
        >
          <span className="knob" />
        </span>
      </label>
    </div>
  );
}

/** The header's line after the folder: the line counts, or for a binary file its sizes (screen 2c). */
function Summary({ file }: { file: FileDiff }) {
  if (file.content.kind === "binary") {
    const { oldSize, newSize } = file.content;
    const sizes = [oldSize, newSize].filter((s) => s !== null).map(size);
    return (
      <>
        <span>Binary</span>
        {sizes.length > 0 && (
          <>
            <span aria-hidden="true">·</span>
            <span>{sizes.join(" → ")}</span>
          </>
        )}
      </>
    );
  }
  if (hunksOf(file).length === 0) return <span>{statusOf(file).label}</span>;
  return <LineTotals counts={counts(file)} />;
}

const IMAGE = /\.(png|jpe?g|gif|webp|avif|bmp|ico|svg)$/i;

/** What a diff can't show, as screen 2c draws it: an image's two sides, or a row naming the change. */
function FileCard({ file, snapshot, onShowDeleted }: { file: FileDiff; snapshot: Snapshot; onShowDeleted: () => void }) {
  let card: React.ReactNode;
  if (file.content.kind === "binary" && IMAGE.test(file.path)) {
    const oldPath = file.status.kind === "renamed" ? file.status.from : file.path;
    card = (
      <section className="diff-card flex gap-4 p-4" aria-label="Image comparison">
        {file.status.kind !== "added" && (
          <Preview label="Before" bytes={file.content.oldSize} snapshot={snapshot} side="old" path={oldPath} />
        )}
        {file.status.kind !== "deleted" && (
          <Preview label="After" bytes={file.content.newSize} snapshot={snapshot} side="new" path={file.path} />
        )}
      </section>
    );
  } else if (file.content.kind === "binary") {
    const { oldSize, newSize } = file.content;
    const summary = [oldSize !== null && `before ${size(oldSize)}`, newSize !== null && `after ${size(newSize)}`]
      .filter(Boolean)
      .join(" · ");
    card = <Row file={file} badge="Binary" tone="b-sent" detail={summary} />;
  } else if (file.status.kind === "deleted") {
    const lines = counts(file).removed;
    card = (
      <Row file={file} badge="Deleted" tone="b-gone" detail={`${lines} ${lines === 1 ? "line" : "lines"} removed`}>
        <button type="button" className="btnplain ml-auto" onClick={onShowDeleted}>
          Show Contents
        </button>
      </Row>
    );
  } else if (file.status.kind === "renamed") {
    card = <Row file={file} badge="Renamed" tone="b-sent" detail={`from ${file.status.from} · no content changes`} />;
  } else if (file.status.kind === "added") {
    card = <Row file={file} badge="Added" tone="b-ok" detail="Empty file" />;
  } else {
    card = <Row file={file} badge="Modified" tone="b-sent" detail="Only the file mode changed" />;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto pb-4">
      <FileComments file={file}>{card}</FileComments>
    </div>
  );
}

function Row({
  file,
  badge,
  tone,
  detail,
  children,
}: {
  file: FileDiff;
  badge: string;
  tone: string;
  detail: string;
  children?: React.ReactNode;
}) {
  const deleted = file.status.kind === "deleted";
  return (
    <section className="diff-card flex h-11 items-center gap-2.5 px-4" aria-label={file.path}>
      <Sym name={deleted ? "trash" : "doc"} className="text-[var(--sec)]" />
      <span className="truncate text-[13px] font-semibold">{nameOf(file.path)}</span>
      <span className={`badge ${tone}`}>{badge}</span>
      <span className="truncate text-xs text-[var(--sec)]">{detail}</span>
      {children}
    </section>
  );
}

/** A card, then the comments on the whole file under it. */
function FileComments({ file, children }: { file: FileDiff; children: React.ReactNode }) {
  const composer = useStore((s) => s.composer);
  const all = useStore((s) => s.comments);
  const comments = all.filter((c) => c.path === file.path && c.target.kind === "file");
  const composing = composer?.path === file.path && composer.target.kind === "file";
  return (
    <div className="flex flex-col gap-3">
      {children}
      {comments.map((c) => (
        <div key={c.id} className="pop-body p-4">
          <CommentCard comment={c} />
        </div>
      ))}
      {composing && (
        <div className="pop-body p-4">
          <Composer />
        </div>
      )}
    </div>
  );
}

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function Preview({
  label,
  bytes,
  snapshot,
  side,
  path,
}: {
  label: string;
  bytes: number | null;
  snapshot: Snapshot;
  side: Side;
  path: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const slow = useDelayed(!url && !failed);
  useEffect(() => {
    let live = true;
    let made: string | null = null;
    const type = path.toLowerCase().endsWith(".svg") ? "image/svg+xml" : "";
    api.blob(snapshot, side, path).then(
      (data) => {
        if (!live) return;
        made = URL.createObjectURL(new Blob([data], { type }));
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
    <div className="flex min-w-0 flex-1 flex-col gap-2.5">
      <div className="flex justify-between text-xs text-[var(--sec)]">
        <span>{label}</span>
        {bytes !== null && <span>{size(bytes)}</span>}
      </div>
      <div className="flex h-[300px] flex-col items-center justify-center gap-2.5 overflow-hidden rounded-[10px] bg-[var(--inset)] text-xs text-[var(--sec)] shadow-[inset_0_0_0_0.5px_var(--sidebd)]">
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
            <>
              <Sym name="photo" />
              <span>{failed ? "Can’t show this image" : "Loading…"}</span>
            </>
          )
        )}
      </div>
    </div>
  );
}
