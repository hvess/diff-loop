import { useEffect, useRef } from "react";
import { useStore } from "../store";

/**
 * Find in file, over the diff's top right while open: Return, ⌘/Ctrl-G and the
 * arrows step through the matches, Shift back, Esc closes.
 */
export function FindBar({
  count,
  current,
  searched,
}: {
  count: number;
  /** The current match's index; -1 with none. */
  current: number;
  /** The query `count` is for, which trails typing. */
  searched: string;
}) {
  const find = useStore((s) => s.find);
  const setFindQuery = useStore((s) => s.setFindQuery);
  const closeFind = useStore((s) => s.closeFind);
  const stepFind = useStore((s) => s.stepFind);
  const findFocused = useStore((s) => s.findFocused);
  const input = useRef<HTMLInputElement>(null);
  const pending = find?.focusPending === true;

  // Only when ⌘/Ctrl-F asked: the bar is drawn again for each file, and must not take the focus then.
  useEffect(() => {
    if (!pending) return;
    input.current?.focus();
    input.current?.select();
    findFocused();
  }, [pending, findFocused]);

  if (!find) return null;
  const status = searched === "" ? "" : count === 0 ? "No matches" : `${current + 1} of ${count}`;
  const arrow = (by: 1 | -1, label: string, glyph: string) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={count === 0}
      onClick={() => stepFind(by)}
      className="flex size-7 items-center justify-center rounded-full text-[13px] text-muted2 hover:bg-chip disabled:opacity-40"
    >
      {glyph}
    </button>
  );
  return (
    <div
      role="search"
      // The field draws no ring of its own inside the pill, so the pill shows its focus (HIG `focus-and-selection`).
      className="absolute top-3 right-6 z-[8] flex items-center gap-1 rounded-full border border-line bg-bg py-[5px] pr-[5px] pl-3.5 font-sans text-[13px] leading-none shadow-pop has-[input:focus]:outline-2 has-[input:focus]:outline-sel-fg"
    >
      <input
        ref={input}
        value={find.query}
        onChange={(e) => setFindQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") closeFind();
          else if (e.key === "Enter") stepFind(e.shiftKey ? -1 : 1);
          else return;
          e.preventDefault();
          e.stopPropagation();
        }}
        placeholder="Find in file"
        aria-label="Find in file"
        spellCheck={false}
        className="w-[168px] bg-transparent text-fg outline-none placeholder:text-muted3"
      />
      <span role="status" className="px-2 text-[12.5px] whitespace-nowrap text-muted3">
        {status}
      </span>
      <span className="h-4 w-px bg-border" />
      {arrow(-1, "Previous match", "↑")}
      {arrow(1, "Next match", "↓")}
      <button
        type="button"
        aria-label="Close"
        title="Close"
        onClick={closeFind}
        className="flex size-7 items-center justify-center rounded-full bg-chip text-[11px] text-muted2"
      >
        ✕
      </button>
    </div>
  );
}
