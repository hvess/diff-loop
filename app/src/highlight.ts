// Syntax highlighting with Shiki, coloured through the --shiki-* variables in styles.css.
import { useEffect, useState } from "react";
import {
  bundledLanguages,
  createCssVariablesTheme,
  createHighlighter,
  type BundledLanguage,
  type Highlighter,
} from "shiki";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import type { FileDiff } from "./bindings/FileDiff";
import type { Side } from "./bindings/Side";
import { type Expanded, type Gap, gapAfter, gapBefore, gapKey, hunksOf, REST } from "./rows";

export type Token = { content: string; color: string | undefined; italic: boolean };
/** Line number → tokens, per side. */
export type Highlights = Record<Side, Map<number, Token[]>>;

/** Past this many shown lines, expanded ones included, a file is plain: tokenizing runs on the UI thread. */
const MAX_LINES = 5000;

const theme = createCssVariablesTheme({ name: "diff-loop", variablePrefix: "--shiki-", fontStyle: true });

let highlighter: Promise<Highlighter> | null = null;
function getHighlighter(): Promise<Highlighter> {
  // The JavaScript engine needs no WebAssembly, which the CSP does not allow.
  highlighter ??= createHighlighter({
    themes: [theme],
    langs: [],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });
  return highlighter;
}

const ALIASES: Record<string, BundledLanguage> = {
  rs: "rust",
  py: "python",
  rb: "ruby",
  yml: "yaml",
  md: "markdown",
  sh: "bash",
  mts: "typescript",
  cts: "typescript",
  mjs: "javascript",
  cjs: "javascript",
  kt: "kotlin",
  h: "c",
  hpp: "cpp",
  cc: "cpp",
};
const NAMES: Record<string, BundledLanguage> = { Dockerfile: "docker", Makefile: "make" };

function languageOf(path: string): BundledLanguage | null {
  const name = path.split("/").pop() ?? path;
  if (NAMES[name]) return NAMES[name];
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (ALIASES[ext]) return ALIASES[ext];
  return ext in bundledLanguages ? (ext as BundledLanguage) : null;
}

async function highlight(file: FileDiff, expanded: Expanded | undefined): Promise<Highlights | null> {
  const lang = languageOf(file.path);
  if (!lang) return null;
  // Each side in file order: a gap's expanded lines precede their hunk.
  const sides: Record<Side, { no: number; text: string }[]> = { old: [], new: [] };
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
  if (shown > MAX_LINES) return null;
  const hl = await getHighlighter();
  await hl.loadLanguage(lang);
  const out: Highlights = { old: new Map(), new: new Map() };
  for (const side of ["old", "new"] as const) {
    const lines = sides[side];
    if (lines.length === 0) continue;
    const tokens = hl.codeToTokensBase(lines.map((l) => l.text).join("\n"), { lang, theme });
    tokens.forEach((row, i) => {
      const at = lines[i];
      if (at) {
        out[side].set(
          at.no,
          row.map((t) => ({ content: t.content, color: t.color, italic: ((t.fontStyle ?? 0) & 1) === 1 })),
        );
      }
    });
  }
  return out;
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
  return state && state.file === file ? state.highlights : null;
}
