// Tokenizes code off the UI thread (ADR 0011 §1); highlight.ts sends it each file's lines.
import type { HighlightCancel, HighlightReply, HighlightRequest } from "./highlight";
import { tokenize } from "./tokenize";

/** Requests not begun yet, oldest first: one at a time, so a cancel can still drop those waiting. */
const queue: HighlightRequest[] = [];
let draining = false;

self.onmessage = (e: MessageEvent<HighlightRequest | HighlightCancel>) => {
  const message = e.data;
  if ("cancel" in message) {
    const at = queue.findIndex((r) => r.id === message.cancel);
    if (at >= 0) queue.splice(at, 1);
    return;
  }
  queue.push(message);
  void drain();
};

async function drain() {
  if (draining) return;
  draining = true;
  for (;;) {
    // A task between requests, not a microtask: a message, and so a cancel, is only taken between tasks.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const request = queue.shift();
    if (!request) break;
    const tokens = await tokenize(request).catch(() => null);
    self.postMessage({ id: request.id, tokens } satisfies HighlightReply);
  }
  draining = false;
}
