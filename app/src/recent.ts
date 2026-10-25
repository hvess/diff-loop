// The projects most recently opened, per viewer, in this webview's localStorage (ADR 0033).
import type { Checkout } from "./bindings/Checkout";
import { projectRoot } from "./path";

/** A project as the welcome screen lists it: its common git directory, its name, and the folder its row opens. */
export type Recent = { project: string; name: string; folder: string; openedAt: number };

const KEY = "diff-loop.recent";

/** How many projects the welcome screen lists. */
export const LIMIT = 8;

function isRecent(value: unknown): value is Recent {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return typeof r.project === "string" && typeof r.name === "string" && typeof r.folder === "string" && typeof r.openedAt === "number";
}

/** The entries kept, newest first; an entry of ADR 0001's recent folders, or anything else unreadable, is dropped. */
export function loadRecent(): Recent[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isRecent) : [];
  } catch {
    return [];
  }
}

/**
 * `list` with `checkout`'s project first, opened `now`. Its row opens the main checkout, the folder its common git
 * directory is the `.git` of; a bare project's, the folder it was last opened from (ADR 0033 §3). One shown only from
 * its commits, with neither, is left where it was.
 */
export function withOpened(list: Recent[], checkout: Checkout, now: number): Recent[] {
  const { project, name, worktree } = checkout;
  const main = project.endsWith("/.git") ? projectRoot(project) : null;
  const folder = main ?? worktree ?? list.find((r) => r.project === project)?.folder;
  if (folder === undefined) return list;
  return [{ project, name, folder, openedAt: now }, ...list.filter((r) => r.project !== project)].slice(0, LIMIT);
}

/** Keeps `checkout`'s project as the one opened last, and returns the list kept. */
export function rememberOpened(checkout: Checkout, now: number): Recent[] {
  const list = withOpened(loadRecent(), checkout, now);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage unavailable: the list lives for this session only.
  }
  return list;
}
