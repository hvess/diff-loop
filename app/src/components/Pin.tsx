import type { Kind } from "../lifecycle";

/**
 * A comment's mark, as the design draws it: ink for what is the reviewer's and
 * not sent, paper (a white disc on a hairline) for what the agent has; a badge
 * says what happened next, an ink badge on paper for changed code, a paper
 * badge on ink for a reopened comment. Lost and not-in-this-diff comments get
 * a dashed outline, and `ghost` is the pin a re-placed draft would get.
 */
export type PinKind = Kind | "ghost";

/** The colours behind a pin, named by token, so its rings cut out of the right surface. */
export type Surface = "bg" | "chip" | "side" | "add-gutter" | "del-gutter" | "sel-gutter";

const ink = (kind: PinKind) => kind === "draft" || kind === "reopened";
const dashed = (kind: PinKind) => kind === "lost" || kind === "outdated" || kind === "ghost";

/** What the pin and the glyph share: fill, outline and the badge. */
function look(kind: PinKind, gap: string, open: boolean, badgeRing: number) {
  const hair = "0 0 0 1px var(--ui-pin-hair)";
  const shadow = dashed(kind)
    ? "none"
    : open
      ? `${ink(kind) ? "" : `${hair}, `}0 0 0 4px var(--ui-pin-focus), 0 2px 6px var(--ui-pin-drop)`
      : ink(kind)
        ? "0 1px 2px var(--ui-pin-drop)"
        : `${hair}, 0 1px 3px var(--ui-pin-drop)`;
  const badge =
    kind === "changed"
      ? { background: "var(--ui-pin-ink)", boxShadow: `0 0 0 ${badgeRing}px ${gap}` }
      : kind === "reopened"
        ? { background: "var(--ui-pin-paper)", boxShadow: `${hair}, 0 0 0 ${badgeRing + 1}px ${gap}` }
        : null;
  return {
    background: dashed(kind) ? "transparent" : ink(kind) ? "var(--ui-pin-ink)" : "var(--ui-pin-paper)",
    color: ink(kind) ? "var(--ui-pin-ink-fg)" : "var(--ui-pin-paper-fg)",
    boxShadow: shadow,
    border: kind === "ghost" ? "1.5px dashed var(--ui-pin-ghost)" : kind === "lost" ? "1.5px dashed var(--ui-muted)" : kind === "outdated" ? "1.5px dashed var(--ui-faint)" : "none",
    badge,
  };
}

/** The 20 px pin in the gutter: a continuous-corner square holding the comment's number. */
export function Pin({
  kind,
  n,
  open = false,
  on,
  onClick,
  label,
}: {
  kind: PinKind;
  n: string;
  open?: boolean;
  /** The gutter colour behind it. */
  on: Surface;
  onClick?: () => void;
  label?: string;
}) {
  const gap = `var(--ui-${on})`;
  const { badge, ...style } = look(kind, gap, open, 1.5);
  const body = (
    <>
      {n}
      {badge && <span aria-hidden className="absolute -top-[3px] -right-[3px] size-2 rounded-full" style={badge} />}
    </>
  );
  const className =
    "pin absolute top-0.5 left-[9px] z-[2] box-border flex size-5 items-center justify-center rounded-[6.5px] font-sans text-[11px] leading-none font-medium tracking-[-0.01em] tabular-nums";
  if (!onClick) {
    return (
      <span aria-hidden className={className} style={style}>
        {body}
      </span>
    );
  }
  return (
    <button type="button" onClick={onClick} aria-label={label} aria-expanded={open} className={className} style={style}>
      {body}
    </button>
  );
}

/** The 10 px glyph beside a mark in a list, a card's chip or the round strip. */
export function Glyph({ kind, on }: { kind: PinKind; on: Surface }) {
  const { badge, ...style } = look(kind, `var(--ui-${on})`, false, 1);
  return (
    // A disc, not the pin's squircle: a small rounded square reads as a checkbox beside Viewed (diff-loop-app.md Decision 31).
    <span aria-hidden className="pin relative box-border size-2.5 flex-none rounded-full" style={style}>
      {badge && <span className="absolute -top-0.5 -right-0.5 size-[5px] rounded-full" style={badge} />}
    </span>
  );
}
