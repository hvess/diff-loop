import * as Popover from "@radix-ui/react-popover";
import { age, shortId } from "../format";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../api";
import type { Base } from "../bindings/Base";
import type { BaseRef } from "../bindings/BaseRef";
import type { LineCounts } from "../bindings/LineCounts";
import { sameBase, useStore } from "../store";
import { LineTotals } from "./LineTotals";

/** A row that compares with `base`; one without a base is shown and cannot be picked. */
type Choice = {
  key: string;
  base: Base | null;
  label: ReactNode;
  mono: boolean;
  trail: ReactNode;
  /** The trail's full meaning, where it is abbreviated. */
  title?: string;
};

/** A row that opens a list of refs in place (diff-loop-app.md Decision 32). */
type Group = {
  key: string;
  title: string;
  search: string;
  /** Said when a search leaves nothing, and when it leaves some out. */
  none: string;
  more: string;
  refs: BaseRef[];
  /** The checked-out branch, listed first and not to be picked. */
  current: string | null;
};

export type Item = { kind: "choice"; choice: Choice } | { kind: "group"; group: Group };

/** What the picker lists, and whether a search left some out. */
type Listing = { items: Item[]; more: boolean };

/** Most refs listed at once; typing narrows to the rest. */
const SHOWN = 50;

/** A remote-tracking branch's short name split into its remote and the rest. */
export function remoteOf(name: string): [string, string] {
  const slash = name.indexOf("/");
  return slash < 0 ? ["", name] : [name.slice(0, slash), name.slice(slash + 1)];
}

/**
 * The lists the picker opens in place: local branches, then each remote by
 * name, then tags, each in `refs`' order. A list with nothing in it is left out.
 */
export function groupsOf(refs: BaseRef[], current: string | null): Group[] {
  const local: BaseRef[] = [];
  const remotes = new Map<string, BaseRef[]>();
  const tags: BaseRef[] = [];
  for (const ref of refs) {
    if (ref.kind === "branch") local.push(ref);
    else if (ref.kind === "tag") tags.push(ref);
    else {
      const [remote] = remoteOf(ref.name);
      const list = remotes.get(remote);
      if (list) list.push(ref);
      else remotes.set(remote, [ref]);
    }
  }
  const groups: Group[] = [];
  if (local.length > 0 || current !== null) {
    groups.push({
      key: "local",
      title: "Local branches",
      search: "Search local branches",
      none: "No matching branch",
      more: "More local branches — type to narrow",
      refs: local,
      current,
    });
  }
  for (const [remote, list] of [...remotes].sort(([a], [b]) => a.localeCompare(b))) {
    groups.push({
      key: `remote:${remote}`,
      title: remote,
      search: `Search ${remote}`,
      none: "No matching branch",
      more: `More ${remote} branches — type to narrow`,
      refs: list,
      current: null,
    });
  }
  if (tags.length > 0) {
    groups.push({
      key: "tags",
      title: "Tags",
      search: "Search tags",
      none: "No matching tag",
      more: "More tags — type to narrow",
      refs: tags,
      current: null,
    });
  }
  return groups;
}

/** How many rows a group lists, the checked-out branch included. */
export const groupSize = (group: Group) => group.refs.length + (group.current === null ? 0 : 1);

/** Up to `SHOWN` of `refs` whose names hold `query`, an exactly named one first; `more` when some were left out. */
export function matching(refs: BaseRef[], query: string): { matches: BaseRef[]; more: boolean; exact: boolean } {
  const q = query.trim().toLowerCase();
  // Typing more cannot narrow past a full name.
  const exactRef = refs.find((r) => r.name === query.trim());
  const matches: BaseRef[] = exactRef ? [exactRef] : [];
  // Stops at SHOWN matches: a repository can have thousands of refs, and only matches render.
  for (const r of refs) {
    if (r === exactRef || !r.name.toLowerCase().includes(q)) continue;
    if (matches.length === SHOWN) return { matches, more: true, exact: exactRef !== undefined };
    matches.push(r);
  }
  return { matches, more: false, exact: exactRef !== undefined };
}

/** What a ref's row ends with: its age, or in search results, that a tag is one. */
export function refTrail(ref: BaseRef, now: number, searched: boolean): { trail: string; title?: string } {
  if (searched && ref.kind === "tag") return { trail: "Tag" };
  if (ref.updated === null) return { trail: "" };
  return {
    trail: age(ref.updated, now),
    title: new Date(ref.updated).toLocaleString(),
  };
}

export function baseLabel(base: Base): string {
  switch (base.kind) {
    case "ref":
      // A commit named in full, as following a round names one, shows as its short id.
      return /^([0-9a-f]{40}|[0-9a-f]{64})$/.test(base.name) ? shortId(base.name) : base.name;
    case "uncommitted":
      return "uncommitted changes";
    case "lastCommit":
      return "last commit";
  }
}

/** "+42 −8", spaced as the design shows the uncommitted changes. */
function lineTrail(counts: LineCounts | null): ReactNode {
  if (counts === null) return null;
  return (
    <span className="flex gap-2">
      <LineTotals counts={counts} />
    </span>
  );
}

/** A ref's name, a remote's prefix faint (diff-loop-app.md Decision 32). */
function refName(ref: BaseRef): ReactNode {
  if (ref.kind !== "remote") return ref.name;
  const [remote, rest] = remoteOf(ref.name);
  return (
    <>
      <span className="text-faint">{remote}/</span>
      {rest}
    </>
  );
}

function refChoice(ref: BaseRef, now: number, searched: boolean): Choice {
  return {
    key: `ref:${ref.name}`,
    base: { kind: "ref", name: ref.name },
    label: refName(ref),
    mono: true,
    ...refTrail(ref, now, searched),
  };
}

const choiceItem = (choice: Choice): Item => ({ kind: "choice", choice });

/** What the picker lists: `group`'s refs while it is open, else the matches for `query`, else the first list (diff-loop-app.md Decision 32). */
export function listItems(at: {
  group: Group | null;
  query: string;
  groups: Group[];
  refs: BaseRef[];
  defaultBranch: string | null;
  base: Base;
  uncommitted: LineCounts | null;
  commit: string | null | undefined;
  now: number;
}): Listing {
  const q = at.query.trim();
  if (at.group) {
    const { matches, more } = matching(at.group.refs, q);
    const current = at.group.current;
    const currentRow =
      current !== null && current.toLowerCase().includes(q.toLowerCase())
        ? [
            choiceItem({
              key: "current",
              base: null,
              label: current,
              mono: true,
              trail: "Current",
            }),
          ]
        : [];
    return {
      items: [...currentRow, ...matches.map((r) => choiceItem(refChoice(r, at.now, false)))],
      more,
    };
  }
  if (q) {
    const { matches, more, exact } = matching(at.refs, q);
    const items = matches.map((r) => choiceItem(refChoice(r, at.now, true)));
    if (!exact)
      items.push(
        choiceItem({
          key: "typed",
          base: { kind: "ref", name: q },
          // Whatever git resolves is taken: a commit, `HEAD~2`, a ref not listed.
          label: (
            <>
              Compare with “<span className="font-mono text-[12.5px]">{q}</span>”
            </>
          ),
          mono: false,
          trail: "",
        }),
      );
    return { items, more };
  }
  const items: Item[] = [
    choiceItem({
      key: "uncommitted",
      base: { kind: "uncommitted" },
      label: "Uncommitted changes",
      mono: false,
      trail: lineTrail(at.uncommitted),
    }),
    choiceItem({
      key: "lastCommit",
      base: { kind: "lastCommit" },
      label: "Last commit",
      mono: false,
      trail: at.commit == null ? null : <span className="font-mono text-xs">{shortId(at.commit)}</span>,
    }),
  ];
  const fallback = at.defaultBranch;
  if (fallback !== null) {
    items.push(
      choiceItem({
        key: "default",
        base: { kind: "ref", name: fallback },
        label: fallback,
        mono: true,
        trail: "Default",
      }),
    );
  }
  // A base other than these is listed under them, so it shows ✓ and Return keeps it.
  const base = at.base;
  if (base.kind === "ref" && base.name !== fallback) {
    const ref = at.refs.find((r) => r.name === base.name);
    items.push(
      choiceItem(
        ref
          ? refChoice(ref, at.now, false)
          : {
              key: "base",
              base,
              label: baseLabel(base),
              mono: true,
              trail: "Commit",
            },
      ),
    );
  }
  return {
    items: [...items, ...at.groups.map((group): Item => ({ kind: "group", group }))],
    more: false,
  };
}

/** Whether `item` can be picked: every row but the checked-out branch's. */
export const picks = (item: Item | undefined) =>
  item !== undefined && !(item.kind === "choice" && item.choice.base === null);

const isBase = (item: Item, base: Base) =>
  item.kind === "choice" && item.choice.base !== null && sameBase(item.choice.base, base);

/** The first row of `items` that can be picked; 0 when none can. */
const firstPick = (items: Item[]) => Math.max(0, items.findIndex(picks));

/** The row highlighted on arriving at `items`: the list just `left`, else the base's, else the first that can be picked. */
export function arrival(items: Item[], base: Base, left: Group | null): number {
  const back = left === null ? -1 : items.findIndex((item) => item.kind === "group" && item.group.key === left.key);
  const at = back >= 0 ? back : items.findIndex((item) => isBase(item, base));
  return at >= 0 ? at : firstPick(items);
}

const ROW = "grid h-8 flex-none grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-2 rounded-lg px-2.5 text-left";

/** The "vs main ▾" control: choose what the checkout is compared with. */
export function BasePicker({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const base = useStore((s) => s.base);
  const choices = useStore((s) => s.choices);
  const setBase = useStore((s) => s.setBase);
  const commit = useStore((s) => s.review?.checkout.commit);
  const head = useStore((s) => (s.review?.checkout ?? s.opening?.checkout)?.head);
  const [query, setQuery] = useState("");
  const [groupKey, setGroupKey] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [uncommitted, setUncommitted] = useState<LineCounts | null>(null);
  const [now, setNow] = useState(Date.now);
  // Each time it opens, by its button, Compare with another branch or ⌘/Ctrl-Shift-B, the base is highlighted, so Return keeps it.
  const [wasOpen, setWasOpen] = useState(open);

  // Counted when the picker opens, not kept fresh: each reads the whole
  // working tree or every ref.
  useEffect(() => {
    if (!open) return;
    useStore.getState().refreshChoices();
    let live = true;
    api.uncommittedLines().then(
      (counts) => {
        if (!live) return;
        setUncommitted(counts);
        setNow(Date.now());
      },
      () => {
        if (!live) return;
        setUncommitted(null);
        setNow(Date.now());
      },
    );
    return () => {
      live = false;
    };
  }, [open]);

  const current = head?.kind === "branch" ? head.name : null;
  // Per load of the refs: they can number in the thousands.
  const groups = useMemo(() => groupsOf(choices.refs, current), [choices.refs, current]);
  const group = groups.find((g) => g.key === groupKey) ?? null;
  const listing = useMemo(
    () => (list: Group | null, search: string) =>
      listItems({
        group: list,
        query: search,
        groups,
        refs: choices.refs,
        defaultBranch: choices.defaultBranch,
        base,
        uncommitted,
        commit,
        now,
      }),
    [groups, choices, base, uncommitted, commit, now],
  );
  // Not per render: a search reads every ref, and moving the highlight renders again.
  const { items, more } = useMemo(() => listing(group, query), [listing, group, query]);

  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setGroupKey(null);
      setQuery("");
      setActive(arrival(listing(null, "").items, base, null));
    }
  }

  // A row that cannot be picked is never highlighted: a search that reset the highlight lands on the first that can.
  const at = picks(items[active]) ? active : firstPick(items);

  const step = (by: 1 | -1) => {
    for (let i = at + by; i >= 0 && i < items.length; i += by) {
      if (picks(items[i])) return setActive(i);
    }
  };

  /** Opens `next`'s list in place, or with `null` goes back to the first list. */
  const enter = (next: Group | null) => {
    setQuery("");
    setGroupKey(next?.key ?? null);
    setActive(arrival(listing(next, "").items, base, group));
  };

  const choose = (item: Item | undefined) => {
    if (!item || !picks(item)) return;
    if (item.kind === "group") return enter(item.group);
    const next = item.choice.base;
    if (next === null) return;
    onOpenChange(false);
    setQuery("");
    if (!sameBase(next, base)) void setBase(next);
  };

  const row = (item: Item, index: number) => {
    const highlight = index === at ? "bg-chip" : "";
    if (item.kind === "group") {
      return (
        <button
          type="button"
          role="option"
          aria-selected={index === at}
          onMouseEnter={() => setActive(index)}
          onClick={() => choose(item)}
          className={`${ROW} ${highlight}`}
        >
          <span />
          <span className="truncate">{item.group.title}</span>
          <span className="flex items-center gap-2 text-[12.5px] text-muted tabular-nums">
            {groupSize(item.group)}
            <span aria-hidden className="flex w-2.5 justify-center text-faint">
              ›
            </span>
          </span>
        </button>
      );
    }
    const { choice } = item;
    const disabled = choice.base === null;
    return (
      <button
        type="button"
        role="option"
        aria-selected={index === at}
        aria-disabled={disabled}
        onMouseEnter={() => !disabled && setActive(index)}
        onClick={() => choose(item)}
        className={`${ROW} ${highlight} ${disabled ? "cursor-default opacity-45" : ""}`}
      >
        <span className="flex justify-center text-xs font-semibold">{isBase(item, base) ? "✓" : ""}</span>
        <span className={`truncate ${choice.mono ? "font-mono text-[12.5px]" : ""}`}>{choice.label}</span>
        <span className="text-[12.5px] text-muted tabular-nums" title={choice.title}>
          {choice.trail}
        </span>
      </button>
    );
  };

  // The design's divider sits above the first row that opens a list.
  const firstGroup = !group && !query.trim() ? items.findIndex((item) => item.kind === "group") : -1;
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[13px] text-muted3"
        >
          vs <span className="font-mono text-[12.5px] text-fg">{baseLabel(base)}</span>
          <span aria-hidden className="text-[10px] text-faint">
            ▾
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={8}
          className="z-40 flex w-[320px] flex-col gap-px rounded-[14px] border border-line bg-bg p-1.5 text-[13.5px] shadow-pop"
          // Esc in an opened list goes back to the first; there, it closes.
          onEscapeKeyDown={(e) => {
            if (!group) return;
            e.preventDefault();
            enter(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") step(1);
            else if (e.key === "ArrowUp") step(-1);
            else if (e.key === "Enter") choose(items[at]);
            else if (e.key === "ArrowRight" && !query && items[at]?.kind === "group") choose(items[at]);
            else if (e.key === "ArrowLeft" && !query && group) enter(null);
            else return;
            e.preventDefault();
          }}
        >
          {group && (
            <button type="button" onClick={() => enter(null)} aria-label={`Back from ${group.title}`} className={ROW}>
              <span aria-hidden className="flex justify-center text-[15px] text-muted">
                ‹
              </span>
              <span className="truncate font-semibold">{group.title}</span>
              <span className="text-[12.5px] text-muted tabular-nums">{groupSize(group)}</span>
            </button>
          )}
          <input
            autoFocus
            // A new field per list, so focus lands in it on arrival.
            key={group?.key ?? "top"}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            placeholder={group?.search ?? "Search branches, tags or commits"}
            aria-label={group?.search ?? "Search branches, tags or commits"}
            className={`h-[34px] flex-none rounded-lg bg-chip px-2.5 outline-none placeholder:text-faint ${group ? "mt-0.5 mb-1" : "mb-1"}`}
          />
          <div
            role="listbox"
            className={`flex flex-col gap-px overflow-auto ${group ? "max-h-[268px]" : "max-h-[360px]"}`}
          >
            {items.map((item, i) => (
              <Fragment key={item.kind === "group" ? item.group.key : item.choice.key}>
                {i === firstGroup && i > 0 && <div className="mx-2.5 my-[5px] h-px flex-none bg-border" />}
                {row(item, i)}
              </Fragment>
            ))}
            {more && (
              <span className="px-2.5 py-1.5 text-xs text-muted">
                {group?.more ?? "More branches and tags — type to narrow"}
              </span>
            )}
            {items.length === 0 && (
              <span className="px-2.5 py-2 text-muted">{group?.none ?? "No matching branch or tag"}</span>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
