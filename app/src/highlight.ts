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
import { hunksOf } from "./rows";

export type Token = { content: string; color?: string; italic: boolean };
/** Line number → tokens, per side. */
export type Highlights = Record<Side, Map<number, Token[]>>;

/** Past this many lines a file is shown plain: tokenizing runs on the UI thread. */
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

async function highlight(file: FileDiff): Promise<Highlights | null> {
  const lang = languageOf(file.path);
  if (!lang) return null;
  const sides: Record<Side, { no: number; text: string }[]> = { old: [], new: [] };
  for (const hunk of hunksOf(file)) {
    for (const line of hunk.lines) {
      if (line.kind !== "added") sides.old.push({ no: line.old, text: line.text });
      if (line.kind !== "removed") sides.new.push({ no: line.new, text: line.text });
    }
  }
  const diffLines = hunksOf(file).reduce((sum, hunk) => sum + hunk.lines.length, 0);
  if (diffLines > MAX_LINES) return null;
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

/** Highlights for `file`, or null until ready or when its language is unknown. */
export function useHighlights(file: FileDiff | undefined): Highlights | null {
  const [state, setState] = useState<{ file: FileDiff; highlights: Highlights | null } | null>(null);
  useEffect(() => {
    if (!file) return;
    let live = true;
    highlight(file).then(
      (highlights) => live && setState({ file, highlights }),
      () => live && setState({ file, highlights: null }),
    );
    return () => {
      live = false;
    };
  }, [file]);
  return state && state.file === file ? state.highlights : null;
}
