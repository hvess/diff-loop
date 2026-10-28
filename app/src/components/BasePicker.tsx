import * as Popover from "@radix-ui/react-popover";
import { age, shortId } from "../format";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../api";
import type { Base } from "../bindings/Base";
import type { BaseRef } from "../bindings/BaseRef";
import type { LineCounts } from "../bindings/LineCounts";
import { folded } from "../search";
import { lineTotals } from "../rows";
import { holdsReview, isLive, sameBase, useStore } from "../store";
import { LineTotals } from "./LineTotals";
import { Sym } from "./Icon";
import { PopArrow } from "./PopArrow";

/** A row that compares with `base`; one without a base is shown and cannot be picked. */
type Choice = {
  key: string;
  base: Base | null;
  label: ReactNode;
  trail: ReactNode;
  /** The trail's full meaning, where it is abbreviated. */
  title?: string;
  /** Under a row that cannot be picked, why not. */
  why?: string;
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
  /** What its row counts: "24 branches". */
  unit: "branch" | "tag";
  /** The checked-out branch, listed first and not to be picked. */
  current: string | null;
};

export type Item = { kind: "choice"; choice: Choice } | { kind: "group"; group: Group };

/** What the picker lists, and whether a search left some out. */
type Listing = { items: Item[]; more: boolean };

const NOTHING_LISTED: Listing = { items: [], more: false };

/** Most refs listed at once; typing narrows to the rest. */
const SHOWN = 50;

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
      const remote = ref.remote ?? "";
      const list = remotes.get(remote);
      if (list) list.push(ref);
      else remotes.set(remote, [ref]);
    }
  }
  const groups: Group[] = [];
  if (local.length > 0 || current !== null) {
    groups.push({
      key: "local",
      title: "Local Branches",
      search: "Search Local Branches",
      none: "No matching branch",
      more: "More local branches — type to narrow",
      refs: local,
      unit: "branch",
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
      unit: "branch",
      current: null,
    });
  }
  if (tags.length > 0) {
    groups.push({
      key: "tags",
      title: "Tags",
      search: "Search Tags",
      none: "No matching tag",
      more: "More tags — type to narrow",
      refs: tags,
      unit: "tag",
      current: null,
    });
  }
  return groups;
}

/** How many rows a group lists, the checked-out branch included. */
export const groupSize = (group: Group) => group.refs.length + (group.current === null ? 0 : 1);

/** "24 branches", as a list's row counts it. */
export function groupCount(group: Group): string {
  const n = groupSize(group);
  const noun = group.unit === "tag" ? (n === 1 ? "tag" : "tags") : n === 1 ? "branch" : "branches";
  return `${n} ${noun}`;
}

/** Up to `SHOWN` of `refs` whose names hold `query`, an exactly named one first; `more` when some were left out. */
export function matching(refs: BaseRef[], query: string): { matches: BaseRef[]; more: boolean; exact: boolean } {
  const q = folded(query.trim());
  // Typing more cannot narrow past a full name.
  const exactRef = refs.find((r) => r.name === query.trim());
  const matches: BaseRef[] = exactRef ? [exactRef] : [];
  // Stops at SHOWN matches: a repository can have thousands of refs, and only matches render.
  for (const r of refs) {
    if (r === exactRef || !folded(r.name).includes(q)) continue;
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

/** "+42 −8": the row's trail spaces the two. */
function lineTrail(counts: LineCounts | null): ReactNode {
  return counts === null ? null : <LineTotals counts={counts} />;
}

/** A ref's name, a remote's prefix faint (diff-loop-app.md Decision 32). */
function refName(ref: BaseRef): ReactNode {
  if (ref.kind !== "remote" || ref.remote === null) return ref.name;
  return (
    <>
      <span className="k">{ref.remote}/</span>
      {ref.name.slice(ref.remote.length + 1)}
    </>
  );
}

function refChoice(ref: BaseRef, now: number, searched: boolean): Choice {
  return {
    key: `ref:${ref.name}`,
    base: { kind: "ref", name: ref.name },
    label: refName(ref),
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
  /** The branch shown, when no worktree has it checked out: it has no uncommitted changes (ADR 0026 §3). */
  committedOnly: string | null;
  now: number;
}): Listing {
  const q = at.query.trim();
  if (at.group) {
    const { matches, more } = matching(at.group.refs, q);
    const current = at.group.current;
    const currentRow =
      current !== null && folded(current).includes(folded(q))
        ? [
            choiceItem({
              key: "current",
              base: null,
              label: current,
              trail: "Under review",
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
              Compare with “<span className="font-mono">{q}</span>”
            </>
          ),
          trail: "",
        }),
      );
    return { items, more };
  }
  const items: Item[] = [
    choiceItem(
      at.committedOnly === null
        ? {
            key: "uncommitted",
            base: { kind: "uncommitted" },
            label: "Uncommitted Changes",
            trail: lineTrail(at.uncommitted),
          }
        : {
            key: "uncommitted",
            base: null,
            label: "Uncommitted Changes",
            trail: null,
            why: `${at.committedOnly} isn’t checked out in any worktree. Check it out in one to compare with its uncommitted changes.`,
          },
    ),
    choiceItem({
      key: "lastCommit",
      base: { kind: "lastCommit" },
      label: "Last Commit",
      trail: at.commit == null ? null : <span className="font-mono">{shortId(at.commit)}</span>,
    }),
  ];
  const fallback = at.defaultBranch;
  if (fallback !== null) {
    items.push(
      choiceItem({
        key: "default",
        base: { kind: "ref", name: fallback },
        label: fallback,
        trail: "Default",
      }),
    );
  }
  // A base other than these is listed under them, so it shows its check and Return keeps it.
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


/** The "vs main" capsule: choose what the checkout is compared with. */
export function BasePicker({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const base = useStore((s) => s.base);
  const choices = useStore((s) => s.choices);
  const chooseBase = useStore((s) => s.chooseBase);
  const commit = useStore((s) => s.review?.checkout.commit);
  const head = useStore((s) => (s.review?.checkout ?? s.opening?.checkout)?.head);
  const live = useStore(isLive);
  // Kept with a review once it has one: a branch only looked at keeps nothing (ADR 0026 §2).
  const kept = useStore((s) => s.key !== null && holdsReview(s));
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
    // A branch with no worktree has no uncommitted changes to count.
    let asked = live;
    if (!asked) {
      setUncommitted(null);
      setNow(Date.now());
      return;
    }
    // Compared with them already, the review's own files are the uncommitted changes: O(files), each cached.
    const review = useStore.getState().review;
    if (review?.base.kind === "uncommitted") {
      setUncommitted(lineTotals(review.changes.files));
      setNow(Date.now());
      return;
    }
    api.uncommittedLines().then(
      (counts) => {
        if (!asked) return;
        setUncommitted(counts);
        setNow(Date.now());
      },
      () => {
        if (!asked) return;
        setUncommitted(null);
        setNow(Date.now());
      },
    );
    return () => {
      asked = false;
    };
  }, [open, live]);

  const current = head?.kind === "branch" ? head.name : null;
  const committedOnly = live ? null : current;
  // Per load of the refs while open: they can number in the thousands.
  const groups = useMemo(() => (open ? groupsOf(choices.refs, current) : []), [open, choices.refs, current]);
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
        committedOnly,
        now,
      }),
    [groups, choices, base, uncommitted, commit, committedOnly, now],
  );
  // Not per render: a search reads every ref, and moving the highlight renders again. Closed, nothing is listed.
  const { items, more } = useMemo(() => (open ? listing(group, query) : NOTHING_LISTED), [open, listing, group, query]);

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
    if (!sameBase(next, base)) void chooseBase(next);
  };

  const row = (item: Item, index: number) => {
    const hi = index === at;
    if (item.kind === "group") {
      return (
        <button
          type="button"
          role="option"
          aria-selected={hi}
          onMouseEnter={() => setActive(index)}
          onClick={() => choose(item)}
          className={`li ${hi ? "hi" : ""}`}
        >
          <span className="w-3.5 flex-none" />
          <span className="truncate">{item.group.title}</span>
          <span className="r tabular-nums">
            <span>{groupCount(item.group)}</span>
            <Sym name="right" />
          </span>
        </button>
      );
    }
    const { choice } = item;
    const disabled = choice.base === null;
    if (choice.why !== undefined) {
      return (
        <div role="option" aria-selected={false} aria-disabled className="li dim items-start">
          <span className="w-3.5 flex-none" />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span>{choice.label}</span>
            <span className="text-[11px] leading-[1.45]">{choice.why}</span>
          </span>
        </div>
      );
    }
    const checked = isBase(item, base);
    return (
      <button
        type="button"
        role="option"
        aria-selected={hi}
        aria-disabled={disabled}
        aria-current={checked || undefined}
        onMouseEnter={() => !disabled && setActive(index)}
        onClick={() => choose(item)}
        className={`li ${hi ? "hi" : ""} ${disabled ? "dim cursor-default" : ""}`}
      >
        <span className="ck">
          {checked && <Sym name="check" />}
        </span>
        <span className="truncate">{choice.label}</span>
        <span className="r tabular-nums" title={choice.title}>
          {choice.trail}
        </span>
      </button>
    );
  };

  // The canvas's divider sits above the first row that opens a list.
  const firstGroup = !group && !query.trim() ? items.findIndex((item) => item.kind === "group") : -1;
  const search = group?.search ?? "Search Branches, Tags, or Commits";
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`Compare with ${baseLabel(base)}`}
          className="cap"
        >
          <span className="text-[var(--sec)]">vs</span>
          <span>{baseLabel(base)}</span>
          <Sym name="updown" className="text-[var(--sec)]" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={12}
          aria-label="Compare with"
          className="pop-body z-40 flex w-[360px] flex-col pb-1 text-[var(--label)] outline-none"
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
          <PopArrow />
          {group && (
            <button
              type="button"
              onClick={() => enter(null)}
              aria-label={`Back from ${group.title}`}
              className="lihead mt-1.5 text-left"
            >
              <Sym name="back" />
              <span className="truncate">{group.title}</span>
              <span className="font-medium tabular-nums">{groupSize(group)}</span>
            </button>
          )}
          <label className={`search ${group ? "mt-1" : ""}`}>
            <Sym name="search" />
            <input
              autoFocus
              // A new field per list, so focus lands in it on arrival.
              key={group?.key ?? "top"}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              placeholder={search}
              aria-label={search}
              className="placeholder:text-[var(--sec)]"
            />
          </label>
          <div role="listbox" className={`flex flex-col overflow-auto ${group ? "max-h-[300px]" : "max-h-[420px]"}`}>
            {items.map((item, i) => (
              <Fragment key={item.kind === "group" ? item.group.key : item.choice.key}>
                {i === firstGroup && i > 0 && <div className="lisep flex-none" />}
                {row(item, i)}
              </Fragment>
            ))}
            {more && (
              <span className="px-[18px] py-1.5 text-[11px] text-[var(--sec)]">
                {group?.more ?? "More branches and tags — type to narrow"}
              </span>
            )}
            {items.length === 0 && (
              <span className="px-[18px] py-2 text-[13px] text-[var(--sec)]">{group?.none ?? "No matching branch or tag"}</span>
            )}
          </div>
          {kept && !group && !query.trim() && (
            <div className="foot mt-1 text-[11px] text-[var(--sec)]">Saved with this review. Switching back restores this base.</div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
