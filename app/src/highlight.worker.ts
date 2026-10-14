// Tokenizes code off the UI thread (ADR 0011 §1); highlight.ts sends it each file's lines.
import type { HighlightReply, HighlightRequest } from "./highlight";
import { tokenize } from "./tokenize";

self.onmessage = (e: MessageEvent<HighlightRequest>) => {
  const { id } = e.data;
  tokenize(e.data).then(
    (tokens) => self.postMessage({ id, tokens } satisfies HighlightReply),
    () => self.postMessage({ id, tokens: null } satisfies HighlightReply),
  );
};
