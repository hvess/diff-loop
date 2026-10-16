// The sidebar's tree: changed files nested in their folders, as on disk (ADR 0016 §1).
import type { FileDiff } from "./bindings/FileDiff";
import { nameOf } from "./path";

/** One indent guide: the line at a depth this row is under. */
export type Guide = {
  /** The row above is the folder the line hangs from: it starts under that folder's icon. */
  start: boolean;
  /** No row below is in this folder: the line stops short. */
  end: boolean;
};

export type TreeRow = { depth: number; guides: Guide[] } & (
  | { kind: "folder"; key: string; name: string }
  | { kind: "file"; key: string; file: FileDiff }
);

type Folder = { folders: Map<string, Folder>; files: FileDiff[] };

const collator = new Intl.Collator(undefined, { numeric: true });
const byName = (a: string, b: string) => collator.compare(a, b);

/**
 * The rows for `files`, each folder before its files, both by name; a folder
 * holding one folder and nothing else is one row with it, `a/b`.
 * O(f · d² + f log f) for f files at depth d, the guides being d per row
 * over up to f · d rows; once per load, and d is a path's depth.
 */
export function treeRows(files: FileDiff[]): TreeRow[] {
  const root: Folder = { folders: new Map(), files: [] };
  for (const file of files) {
    const parts = file.path.split("/");
    parts.pop();
    let folder = root;
    for (const part of parts) {
      let next = folder.folders.get(part);
      if (!next) {
        next = { folders: new Map(), files: [] };
        folder.folders.set(part, next);
      }
      folder = next;
    }
    folder.files.push(file);
  }
  const rows: TreeRow[] = [];
  // An explicit stack, not recursion: depth follows the paths (data-structures, Recursion).
  // What is pushed last comes out first, so each folder's entries go on in reverse.
  type Entry =
    | { kind: "folder"; name: string; path: string; folder: Folder; depth: number }
    | { kind: "file"; file: FileDiff; depth: number };
  const entriesOf = (folder: Folder, path: string, depth: number): Entry[] => [
    ...[...folder.folders.keys()].sort(byName).map((name) => {
      let inner = folder.folders.get(name)!;
      // A chain of lone folders reads as one, so the tree is no deeper than its files need.
      for (let only = lone(inner); only; only = lone(inner)) {
        name = `${name}/${only[0]}`;
        inner = only[1];
      }
      return { kind: "folder" as const, name, path: `${path}${name}/`, folder: inner, depth };
    }),
    ...[...folder.files]
      .sort((a, b) => byName(nameOf(a.path), nameOf(b.path)))
      .map((file) => ({ kind: "file" as const, file, depth })),
  ];
  const stack = entriesOf(root, "", 0).reverse();
  for (let entry = stack.pop(); entry; entry = stack.pop()) {
    if (entry.kind === "file") {
      rows.push({ kind: "file", key: `f:${entry.file.path}`, file: entry.file, depth: entry.depth, guides: [] });
      continue;
    }
    rows.push({ kind: "folder", key: `d:${entry.path}`, name: entry.name, depth: entry.depth, guides: [] });
    const inside = entriesOf(entry.folder, entry.path, entry.depth + 1);
    // One at a time: a folder can hold more entries than a spread may pass.
    for (let i = inside.length - 1; i >= 0; i--) stack.push(inside[i]!);
  }
  return withGuides(rows);
}

/** The one folder `folder` holds when it holds nothing else: a link of a chain read as one row. */
function lone(folder: Folder): [string, Folder] | undefined {
  return folder.files.length === 0 && folder.folders.size === 1 ? folder.folders.entries().next().value : undefined;
}

/** `rows` with their guides set from their neighbours. */
function withGuides(rows: TreeRow[]): TreeRow[] {
  rows.forEach((row, i) => {
    const above = rows[i - 1]?.depth ?? -1;
    const below = rows[i + 1]?.depth ?? -1;
    row.guides = Array.from({ length: row.depth }, (_, d) => ({ start: above === d, end: below <= d }));
  });
  return rows;
}

/**
 * The rows shown with the folders in `closed` (by row key) folded: what each
 * holds is left out, and the guides are drawn for what is left. O(rows).
 */
export function fold(rows: TreeRow[], closed: ReadonlySet<string>): TreeRow[] {
  if (closed.size === 0) return rows;
  const shown: TreeRow[] = [];
  // The depth of the nearest closed folder a row is under, while it is under one.
  let under: number | null = null;
  for (const row of rows) {
    if (under !== null && row.depth > under) continue;
    under = row.kind === "folder" && closed.has(row.key) ? row.depth : null;
    shown.push({ ...row });
  }
  return withGuides(shown);
}

/** Each folder row's key → how many changed files it holds, at any depth: what a folded folder says it hides. O(rows · d), once per load. */
export function folderCounts(folders: Map<string, string[]>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const keys of folders.values()) for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
}

/** Each file's path → the keys of the folder rows it is under, outermost first: what selecting it opens. O(rows · d), once per load. */
export function folderKeys(rows: TreeRow[]): Map<string, string[]> {
  const keys = new Map<string, string[]>();
  // The folders open at each depth on the way down.
  const stack: string[] = [];
  for (const row of rows) {
    stack.length = row.depth;
    if (row.kind === "folder") stack.push(row.key);
    else keys.set(row.file.path, [...stack]);
  }
  return keys;
}
