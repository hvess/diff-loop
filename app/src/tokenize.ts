// Shiki's tokenizing for highlight.worker.ts (ADR 0011 §1), apart from the worker so it can be tested.
import { createCssVariablesTheme, createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { bundledLanguages, type BundledLanguage } from "shiki/langs";
import type { Side } from "./bindings/Side";
import { nameOf } from "./path";
import type { HighlightRequest, Token } from "./highlight";

const theme = createCssVariablesTheme({ name: "diff-loop", variablePrefix: "--shiki-", fontStyle: true });

let highlighter: Promise<HighlighterCore> | null = null;
function getHighlighter(): Promise<HighlighterCore> {
  // The JavaScript engine needs no WebAssembly, which the CSP does not allow.
  highlighter ??= createHighlighterCore({
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
  const name = nameOf(path);
  if (NAMES[name]) return NAMES[name];
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (ALIASES[ext]) return ALIASES[ext];
  return ext in bundledLanguages ? (ext as BundledLanguage) : null;
}

/** Each side's lines as tokens, in the order sent; null for a language Shiki does not know. */
export async function tokenize({ path, sides }: HighlightRequest): Promise<Record<Side, Token[][]> | null> {
  const lang = languageOf(path);
  if (!lang) return null;
  const hl = await getHighlighter();
  // Loaded once per language: `bundledLanguages` maps each to its own chunk.
  if (!hl.getLoadedLanguages().includes(lang)) await hl.loadLanguage(bundledLanguages[lang]);
  // Each run starts from a fresh grammar state; the rows come back flat, one per line sent.
  const side = (runs: string[][]): Token[][] =>
    runs.flatMap((run) =>
      hl
        .codeToTokensBase(run.join("\n"), { lang, theme: theme.name! })
        .map((row) => row.map((t) => ({ content: t.content, color: t.color, italic: ((t.fontStyle ?? 0) & 1) === 1 }))),
    );
  return { old: side(sides.old), new: side(sides.new) };
}
