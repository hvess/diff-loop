import { noteRuns } from "../note";

/** The agent's note, its code runs in the code face (ADR 0032 §1). */
export function AgentNote({ note }: { note: string }) {
  return (
    <>
      {noteRuns(note).map((run, i) =>
        run.code ? (
          <code key={i} className="font-mono text-[0.92em]">
            {run.text}
          </code>
        ) : (
          <span key={i}>{run.text}</span>
        ),
      )}
    </>
  );
}
