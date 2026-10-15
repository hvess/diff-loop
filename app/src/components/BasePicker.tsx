import * as Popover from "@radix-ui/react-popover";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { Base } from "../bindings/Base";
import type { BaseRef } from "../bindings/BaseRef";
import { sameBase, useStore } from "../store";

type Choice = { key: string; base: Base; label: string; mono: boolean; hint: string; monoHint?: boolean };

/** Most refs listed at once; typing narrows to the rest. */
const SHOWN = 50;

/** "Show only" choices, with the open checkout's uncommitted file count and last commit. */
export function showOnly(uncommitted: number | null, commit: string | null | undefined): Choice[] {
  return [
    {
      key: "uncommitted",
      base: { kind: "uncommitted" },
      label: "Uncommitted changes",
      mono: false,
      hint: uncommitted === null ? "" : `${uncommitted} ${uncommitted === 1 ? "file" : "files"}`,
    },
    {
      key: "lastCommit",
      base: { kind: "lastCommit" },
      label: "Last commit",
      mono: false,
      hint: commit?.slice(0, 7) ?? "",
      monoHint: true,
    },
  ];
}

/** A ref's note: a tag says so; a branch says how far behind it the checkout is (`git status`'s sense). */
export function refHint(ref: BaseRef): string {
  if (ref.kind === "tag") return "Tag";
  return ref.behind ? `${ref.behind} behind` : "";
}

export function baseLabel(base: Base): string {
  switch (base.kind) {
    case "ref":
      return base.name;
    case "uncommitted":
      return "uncommitted changes";
    case "lastCommit":
      return "last commit";
  }
}

/** The "vs main ▾" control: choose what the checkout is compared with. */
export function BasePicker({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const base = useStore((s) => s.base);
  const refs = useStore((s) => s.refs);
  const setBase = useStore((s) => s.setBase);
  const commit = useStore((s) => s.review?.checkout.commit);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [uncommitted, setUncommitted] = useState<number | null>(null);
  // Each time it opens, by its button, Compare with another branch or ⌘/Ctrl-Shift-B, the base is highlighted, so Return keeps it.
  const [wasOpen, setWasOpen] = useState(open);

  // Counted when the picker opens, not kept fresh: each reads the whole
  // working tree or every ref.
  useEffect(() => {
    if (!open) return;
    useStore.getState().refreshRefs();
    let live = true;
    api.uncommittedFiles().then(
      (count) => live && setUncommitted(count),
      () => live && setUncommitted(null),
    );
    return () => {
      live = false;
    };
  }, [open]);

  const byName = useMemo(() => new Map(refs.map((r) => [r.name, r])), [refs]);
  const { compare, only, more } = useMemo(() => {
    const q = query.trim().toLowerCase();
    // A ref named exactly comes first, whatever else matches: typing more
    // cannot narrow past a full name.
    const exact = byName.get(query.trim());
    // A search reads every name it has to, but stops at SHOWN matches, and
    // only those render: a repository can have thousands of refs.
    const matches: BaseRef[] = exact ? [exact] : [];
    let more = false;
    for (const r of refs) {
      if (r === exact || !r.name.toLowerCase().includes(q)) continue;
      if (matches.length === SHOWN) {
        more = true;
        break;
      }
      matches.push(r);
    }
    const compare: Choice[] = matches.map((r) => ({
        key: `ref:${r.name}`,
        base: { kind: "ref", name: r.name },
        label: r.name,
        mono: true,
        hint: refHint(r),
      }));
    if (q && !exact) {
      compare.push({ key: "typed", base: { kind: "ref", name: query.trim() }, label: query.trim(), mono: true, hint: "Commit" });
    }
    return { compare, only: q ? [] : showOnly(uncommitted, commit), more };
  }, [refs, byName, query, uncommitted, commit]);
  const all = [...compare, ...only];
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setActive(Math.max(0, all.findIndex((c) => sameBase(c.base, base))));
  }

  const choose = (choice: Choice | undefined) => {
    if (!choice) return;
    onOpenChange(false);
    setQuery("");
    if (!sameBase(choice.base, base)) void setBase(choice.base);
  };

  const row = (choice: Choice, index: number) => (
    <button
      type="button"
      role="option"
      aria-selected={index === active}
      key={choice.key}
      onMouseEnter={() => setActive(index)}
      onClick={() => choose(choice)}
      className={`flex items-center justify-between rounded-lg px-2.5 py-2 text-left ${index === active ? "bg-chip" : ""}`}
    >
      <span className={choice.mono ? "font-mono text-[12.5px]" : ""}>{choice.label}</span>
      <span className={`text-muted ${choice.monoHint ? "font-mono text-[11.5px]" : "text-xs"}`}>
        {sameBase(choice.base, base) ? "✓" : choice.hint}
      </span>
    </button>
  );

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[13px] text-muted3"
        >
          vs <span className="font-mono text-[12.5px] text-fg">{baseLabel(base)}</span>
          <span aria-hidden className="text-[10px] text-faint">▾</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={8}
          className="z-40 w-[320px] overflow-hidden rounded-[14px] border border-line bg-bg text-[13.5px] shadow-pop"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setActive((a) => Math.min(all.length - 1, a + 1));
            else if (e.key === "ArrowUp") setActive((a) => Math.max(0, a - 1));
            else if (e.key === "Enter") choose(all[active]);
            else return;
            e.preventDefault();
          }}
        >
          <div className="border-b border-border px-3 py-2.5">
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              placeholder="Branch, tag or commit"
              aria-label="Branch, tag or commit"
              className="w-full rounded-[10px] bg-chip px-3 py-2 outline-none placeholder:text-muted3"
            />
          </div>
          <div role="listbox" className="flex max-h-[360px] flex-col gap-px overflow-auto p-1.5">
            {compare.length > 0 && <span className="px-2.5 py-1 text-[11.5px] font-medium text-muted">Compare with</span>}
            {compare.map((c, i) => row(c, i))}
            {more && <span className="px-2.5 py-1.5 text-xs text-muted">More branches and tags — type to narrow</span>}
            {compare.length === 0 && only.length === 0 && (
              <span className="px-2.5 py-2 text-muted">No matching branch or tag</span>
            )}
            {only.length > 0 && (
              <>
                {compare.length > 0 && <div className="mx-1 my-1.5 h-px bg-border" />}
                <span className="px-2.5 py-1 text-[11.5px] font-medium text-muted">Show only</span>
                {only.map((c, i) => row(c, compare.length + i))}
              </>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
