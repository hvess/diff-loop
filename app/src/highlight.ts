// Syntax highlighting with Shiki, coloured through the --shiki-* variables in styles.css.
// Tokenizing runs in highlight.worker.ts (ADR 0011 §1); this module sends it lines and keeps the results.
import { useEffect, useState } from "react";
import type { FileDiff } from "./bindings/FileDiff";
import type { Side } from "./bindings/Side";
import { type Expanded, type Gap, gapAfter, gapBefore, gapKey, hunksOf, REST } from "./rows";

export type Token = { content: string; color: string | undefined; italic: boolean };
/** Line number → tokens, per side. */
export type Highlights = Record<Side, Map<number, Token[]>>;

/**
 * What the worker is sent: each side's lines in file order, split into runs of
 * consecutive line numbers. Each run is tokenized on its own, so a comment or
 * string left open where a hunk ends does not run on into the next hunk.
 */
export type HighlightRequest = { id: number; path: string; sides: Record<Side, string[][]> };
/** Its answer: tokens per line sent, or null when the language is unknown or tokenizing failed. */
export type HighlightReply = { id: number; tokens: Record<Side, Token[][]> | null };

/** Past this many shown lines, expanded ones included, a file is plain: it bounds the worker's time and the tokens sent back. */
const MAX_LINES = 5000;

type Line = { no: number; text: string };

/** Each side's shown lines in file order, a gap's expanded lines before their hunk; null past `MAX_LINES`. */
export function linesOf(file: FileDiff, expanded: Expanded | undefined): Record<Side, Line[]> | null {
  const sides: Record<Side, Line[]> = { old: [], new: [] };
  let shown = 0;
  const addGap = (gap: Gap | null, key: string) => {
    const texts = expanded?.[key];
    if (!gap || !Array.isArray(texts)) return;
    texts.forEach((text, i) => {
      sides.old.push({ no: gap.oldFirst + i, text });
      sides.new.push({ no: gap.newFirst + i, text });
    });
    shown += texts.length;
  };
  hunksOf(file).forEach((hunk, h, all) => {
    addGap(gapBefore(hunk, all[h - 1]), gapKey(hunk));
    shown += hunk.lines.length;
    for (const line of hunk.lines) {
      if (line.kind !== "added") sides.old.push({ no: line.old, text: line.text });
      if (line.kind !== "removed") sides.new.push({ no: line.new, text: line.text });
    }
  });
  addGap(gapAfter(file), REST);
  return shown > MAX_LINES ? null : sides;
}

/** `lines` split where a line number does not follow the one before: the runs a hidden gap separates. */
export function runsOf(lines: Line[]): string[][] {
  const runs: string[][] = [];
  let run: string[] = [];
  let next: number | null = null;
  for (const line of lines) {
    if (line.no !== next) runs.push((run = []));
    run.push(line.text);
    next = line.no + 1;
  }
  return runs;
}

/** The worker's tokens placed at the line numbers they were sent for. */
export function placed(lines: Record<Side, Line[]>, tokens: Record<Side, Token[][]>): Highlights {
  const out: Highlights = { old: new Map(), new: new Map() };
  for (const side of ["old", "new"] as const) {
    tokens[side].forEach((row, i) => {
      const at = lines[side][i];
      if (at) out[side].set(at.no, row);
    });
  }
  return out;
}

/** The worker; null before first use, and once it has failed, when everything stays plain. */
let worker: Worker | null = null;
let failed = false;
let nextId = 0;
const waiting = new Map<number, (tokens: HighlightReply["tokens"]) => void>();

/** The worker, started on first use. When it fails, the requests waiting and every later one are answered plain. */
function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./highlight.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<HighlightReply>) => {
    waiting.get(e.data.id)?.(e.data.tokens);
    waiting.delete(e.data.id);
  };
  worker.onerror = () => {
    failed = true;
    worker?.terminate();
    worker = null;
    for (const resolve of waiting.values()) resolve(null);
    waiting.clear();
  };
  return worker;
}

function requestTokens(path: string, lines: Record<Side, Line[]>): Promise<HighlightReply["tokens"]> {
  if (failed) return Promise.resolve(null);
  const id = nextId++;
  const request: HighlightRequest = {
    id,
    path,
    sides: { old: runsOf(lines.old), new: runsOf(lines.new) },
  };
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    getWorker().postMessage(request);
  });
}

/** Highlights per file version and its expansions, so coming back to a file shows them at once. */
const cache = new WeakMap<FileDiff, { expanded: Expanded | undefined; highlights: Highlights | null }>();

async function highlight(file: FileDiff, expanded: Expanded | undefined): Promise<Highlights | null> {
  const hit = cache.get(file);
  if (hit && hit.expanded === expanded) return hit.highlights;
  const lines = linesOf(file, expanded);
  const tokens = lines && (await requestTokens(file.path, lines));
  const highlights = lines && tokens ? placed(lines, tokens) : null;
  // A file past MAX_LINES stays plain for this version; a null answer is asked again next time.
  if (!lines || highlights) cache.set(file, { expanded, highlights });
  return highlights;
}

/**
 * Highlights for `file` and its `expanded` gaps. Null until the first are
 * ready, and when the language is unknown, more than `MAX_LINES` lines show,
 * or highlighting fails. Until newer ones are ready the last for the same
 * file stay: expanding a gap must not flash the whole file plain.
 */
export function useHighlights(file: FileDiff | undefined, expanded?: Expanded): Highlights | null {
  const [state, setState] = useState<{ file: FileDiff; highlights: Highlights | null } | null>(null);
  useEffect(() => {
    if (!file) return;
    let live = true;
    highlight(file, expanded).then(
      (highlights) => live && setState({ file, highlights }),
      () => live && setState({ file, highlights: null }),
    );
    return () => {
      live = false;
    };
  }, [file, expanded]);
  const hit = file && cache.get(file);
  if (hit && hit.expanded === expanded) return hit.highlights;
  return state && state.file === file ? state.highlights : null;
}
