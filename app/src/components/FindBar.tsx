import { useEffect, useRef } from "react";
import { useStore } from "../store";
import { Sym } from "./Icon";

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
  const arrow = (by: 1 | -1, label: string, name: "up" | "down") => (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={count === 0}
      onClick={() => stepFind(by)}
      className="flex size-7 items-center justify-center rounded-full text-[13px] text-[var(--sec)] hover:bg-[var(--field)] disabled:opacity-40"
    >
      <Sym name={name} />
    </button>
  );
  return (
    <div
      role="search"
      // The field draws no ring of its own inside the pill, so the pill shows its focus (HIG `focus-and-selection`).
      className="pop-body findbar absolute top-3 right-6 z-[8] flex items-center gap-1 py-[5px] pr-[5px] pl-3.5 font-sans text-[13px] leading-none"
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
        placeholder="Find in File"
        aria-label="Find in File"
        spellCheck={false}
        className="w-[168px] bg-transparent text-[var(--label)] outline-none placeholder:text-[var(--sec)]"
      />
      <span role="status" className="px-2 text-xs whitespace-nowrap text-[var(--sec)] tabular-nums">
        {status}
      </span>
      <span className="vsep" aria-hidden />
      {arrow(-1, "Previous match", "up")}
      {arrow(1, "Next match", "down")}
      <button
        type="button"
        aria-label="Close"
        title="Close"
        onClick={closeFind}
        className="flex size-7 items-center justify-center rounded-full bg-[var(--field)] text-[var(--sec)]"
      >
        <Sym name="xmark" />
      </button>
    </div>
  );
}
