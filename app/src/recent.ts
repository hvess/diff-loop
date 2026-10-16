// Recently opened folders, per viewer, in this webview's localStorage.

export type Recent = { path: string; name: string; branch: string; openedAt: number };

const KEY = "diff-loop.recent";
const LIMIT = 8;

function isRecent(value: unknown): value is Recent {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.path === "string" &&
    typeof r.name === "string" &&
    typeof r.branch === "string" &&
    typeof r.openedAt === "number"
  );
}

/** Stored entries that are well formed; anything else is dropped. */
export function loadRecent(): Recent[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isRecent) : [];
  } catch {
    return [];
  }
}

export function rememberRecent(entry: Recent): Recent[] {
  const list = [entry, ...loadRecent().filter((r) => r.path !== entry.path)].slice(0, LIMIT);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage unavailable: the list lives for this session only.
  }
  return list;
}
