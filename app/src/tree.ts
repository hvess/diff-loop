// The sidebar's tree: changed files nested in their folders, as on disk (ADR 0016 §1).
import type { FileDiff } from "./bindings/FileDiff";
import { nameOf } from "./path";
import { folded } from "./search";

export type TreeRow = { depth: number } & (
  | { kind: "folder"; key: string; name: string }
  | { kind: "file"; key: string; file: FileDiff }
);

type Folder = { folders: Map<string, Folder>; files: FileDiff[] };

const collator = new Intl.Collator(undefined, { numeric: true });
const byName = (a: string, b: string) => collator.compare(a, b);

/**
 * The rows for `files`, each folder before its files, both by name; a folder
 * holding one folder and nothing else is one row with it, `a/b`.
 * O(f · d + f log f) for f files at depth d, over up to f · d rows; once per
 * load.
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
      rows.push({ kind: "file", key: `f:${entry.file.path}`, file: entry.file, depth: entry.depth });
      continue;
    }
    rows.push({ kind: "folder", key: `d:${entry.path}`, name: entry.name, depth: entry.depth });
    const inside = entriesOf(entry.folder, entry.path, entry.depth + 1);
    // One at a time: a folder can hold more entries than a spread may pass.
    for (let i = inside.length - 1; i >= 0; i--) stack.push(inside[i]!);
  }
  return rows;
}

/** The one folder `folder` holds when it holds nothing else: a link of a chain read as one row. */
function lone(folder: Folder): [string, Folder] | undefined {
  return folder.files.length === 0 && folder.folders.size === 1 ? folder.folders.entries().next().value : undefined;
}

/**
 * The rows shown with the folders in `closed` (by row key) folded: what each
 * holds is left out. O(rows).
 */
export function fold(rows: TreeRow[], closed: ReadonlySet<string>): TreeRow[] {
  if (closed.size === 0) return rows;
  const shown: TreeRow[] = [];
  // The depth of the nearest closed folder a row is under, while it is under one.
  let under: number | null = null;
  for (const row of rows) {
    if (under !== null && row.depth > under) continue;
    under = row.kind === "folder" && closed.has(row.key) ? row.depth : null;
    shown.push(row);
  }
  return shown;
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

/** Whether Filter Files keeps a path for `query`: case and diacritics ignored, every path for a blank query. */
function keeper(query: string): (file: FileDiff) => boolean {
  const q = folded(query.trim());
  return (file) => foldedPath(file).includes(q);
}

/** Per file, its path folded: once per load, not per keystroke (FileDiff objects are replaced, never mutated). */
const foldedPaths = new WeakMap<FileDiff, string>();

function foldedPath(file: FileDiff): string {
  let path = foldedPaths.get(file);
  if (path === undefined) {
    path = folded(file.path);
    foldedPaths.set(file, path);
  }
  return path;
}

/** The files of `order` Filter Files keeps for `query`, and each one's place. */
type Kept = { query: string; files: FileDiff[]; position: Map<string, number> };

/**
 * Per order, the last two queries': built once per query, so a step through them costs O(1). Two, because the
 * sidebar reads the deferred query while the keys read the typed one, and one entry would be rebuilt by each in turn.
 */
const keptCache = new WeakMap<FileDiff[], Kept[]>();

/** The files of `order` Filter Files keeps for `query`, in order; O(files) once per query and order. */
export function keptOrder(order: FileDiff[], query: string): Kept {
  const cached = keptCache.get(order) ?? [];
  const hit = cached.find((k) => k.query === query);
  if (hit) return hit;
  const keeps = keeper(query);
  const files = order.filter(keeps);
  const kept = { query, files, position: new Map(files.map((f, i) => [f.path, i])) };
  keptCache.set(order, [kept, ...cached.slice(0, 1)]);
  return kept;
}

/**
 * The file rows whose path holds `query`, case and diacritics ignored, and the row of the file `open` (the one
 * the pane shows, so the sidebar never loses it), with the folders they are under, in the tree's order; every
 * row for a blank query. O(rows · d), each kept row walking up its d folders.
 */
export function filterTree(rows: TreeRow[], query: string, open: string | null = null): TreeRow[] {
  if (query.trim() === "") return rows;
  const keeps = keeper(query);
  const shown: TreeRow[] = [];
  // The folders open on the way down, each shown once a file under it matches.
  const above: { row: TreeRow; shown: boolean }[] = [];
  for (const row of rows) {
    above.length = row.depth;
    if (row.kind === "folder") {
      above.push({ row, shown: false });
      continue;
    }
    if (!keeps(row.file) && row.file.path !== open) continue;
    for (const folder of above) {
      if (folder.shown) continue;
      shown.push(folder.row);
      folder.shown = true;
    }
    shown.push(row);
  }
  return shown;
}
