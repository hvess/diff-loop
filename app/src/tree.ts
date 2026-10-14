// The sidebar's tree: changed files nested in their folders, as on disk.
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
 * The rows for `files`, each folder before its files, both by name.
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
    ...[...folder.folders.keys()].sort(byName).map((name) => ({
      kind: "folder" as const,
      name,
      path: `${path}${name}/`,
      folder: folder.folders.get(name)!,
      depth,
    })),
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
  rows.forEach((row, i) => {
    const above = rows[i - 1]?.depth ?? -1;
    const below = rows[i + 1]?.depth ?? -1;
    row.guides = Array.from({ length: row.depth }, (_, d) => ({ start: above === d, end: below <= d }));
  });
  return rows;
}
