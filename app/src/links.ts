// How changed files relate, for the sidebar's captions: a test and the file
// it covers, a new file and the changed files that import it. Both are read
// from names alone, so they can be wrong, and a caption only suggests.
import type { FileDiff } from "./bindings/FileDiff";
import { hunksOf } from "./rows";

export type Links = {
  /** Source path → the tests that cover it. */
  testedBy: Map<string, string[]>;
  /** Test path → the source files it covers. */
  covers: Map<string, string[]>;
  /** New file path → the changed files whose added lines import it. */
  importedBy: Map<string, string[]>;
};

/** Marks that make a file name a test's: `handler.test.ts`, `parse_test.go`, `test_foo.py`. */
const MARKERS = [".test.", ".spec.", "_test.", "_spec."];

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const dirName = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")));
const stem = (name: string) => (name.includes(".") ? name.slice(0, name.indexOf(".")) : name);

/** The source file name a test's name points at, or null when it carries no marker. */
export function testedName(testPath: string): string | null {
  const name = baseName(testPath);
  const marker = MARKERS.find((m) => name.includes(m));
  if (marker) return name.replace(marker, ".");
  return name.startsWith("test_") ? name.slice("test_".length) : null;
}

/** A line that brings in another module, in the common languages' words. */
const IMPORTING = /\b(import|from|require|use|include|mod)\b/;

/** Per file, built on first use: a refresh carries unchanged files over, so only changed ones are read. */
const wordsCache = new WeakMap<FileDiff, Set<string>>();

/** The words on `file`'s added lines that import something. */
function importWords(file: FileDiff): Set<string> {
  let words = wordsCache.get(file);
  if (!words) {
    words = new Set();
    for (const hunk of hunksOf(file)) {
      for (const line of hunk.lines) {
        if (line.kind !== "added" || !IMPORTING.test(line.text)) continue;
        for (const word of line.text.split(/\W+/)) if (word) words.add(word);
      }
    }
    wordsCache.set(file, words);
  }
  return words;
}

function push(map: Map<string, string[]>, key: string, value: string) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * The links among `files`; `tests` are the paths the review groups as tests.
 * O(files + import words), the words read once per file version.
 */
export function linksOf(files: FileDiff[], tests: Set<string>): Links {
  const links: Links = { testedBy: new Map(), covers: new Map(), importedBy: new Map() };
  const sources = files.filter((f) => !tests.has(f.path));
  const byName = new Map<string, string[]>();
  for (const file of sources) push(byName, baseName(file.path), file.path);
  for (const test of tests) {
    const name = testedName(test);
    const candidates = name ? (byName.get(name) ?? []) : [];
    // The source beside the test, else the only one of that name.
    const beside = candidates.filter((path) => dirName(path) === dirName(test));
    const covered = beside.length > 0 ? beside : candidates.length === 1 ? candidates : [];
    for (const source of covered) {
      push(links.testedBy, source, test);
      push(links.covers, test, source);
    }
  }
  const added = new Map<string, string[]>();
  for (const file of sources) {
    if (file.status.kind === "added") push(added, stem(baseName(file.path)), file.path);
  }
  if (added.size === 0) return links;
  for (const file of files) {
    for (const word of importWords(file)) {
      for (const target of added.get(word) ?? []) {
        if (target !== file.path) push(links.importedBy, target, file.path);
      }
    }
  }
  return links;
}

/** "name" or "name and N more", for a caption. */
function names(paths: string[]): string {
  const [first, ...rest] = paths;
  const name = baseName(first ?? "");
  return rest.length === 0 ? name : `${name} and ${rest.length} more`;
}

/** What the sidebar says under `path` about its links, in the design's words; empty when none. */
export function captionOf(links: Links, path: string): string[] {
  const parts: string[] = [];
  const importers = links.importedBy.get(path);
  if (importers) parts.push(`new, imported by ${names(importers)}`);
  const tests = links.testedBy.get(path);
  if (tests) parts.push(`tested by ${names(tests)}`);
  const covered = links.covers.get(path);
  if (covered) parts.push(`covers ${names(covered)}`);
  return parts;
}
