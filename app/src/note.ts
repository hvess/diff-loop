// The agent's note as the window shows it (ADR 0032 §1).

/** The note to show, if any: a blank one, which an agent editing the file can leave, is none, as the MCP tool keeps it. */
export function shownNote(note: string | null): string | null {
  return note === null || note.trim() === "" ? null : note;
}

/** `note` cut into plain runs and the code runs it sets in backticks; an unclosed backtick stays text. */
export function noteRuns(note: string): { code: boolean; text: string }[] {
  const parts = note.split("`");
  // An even count of parts means an odd count of backticks: the last one opens nothing.
  const closed = parts.length % 2 === 1 ? parts : [...parts.slice(0, -2), `${parts.at(-2) ?? ""}\`${parts.at(-1) ?? ""}`];
  return closed.map((text, i) => ({ code: i % 2 === 1, text })).filter((run) => run.text !== "");
}
