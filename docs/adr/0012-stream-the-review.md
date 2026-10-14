# 0012 — The review arrives in batches

**Status:** accepted, 2026-10-14
**Affects:** `app/src-tauri/src/lib.rs` (`load_review`, `ReviewPart`,
`batches`), `app/src/api.ts`, `app/src/bindings/ReviewPart.ts`

## Context

`load_review` answered with the whole `Review` as one JSON message. On a
large diff the webview parsed it in one task, so input waited for it, which
is what ADR 0010 and ADR 0011 set out to remove. Tauri's docs recommend a
`Channel` for large or ordered data, and say events are not built for it.
The developer chose to stream the review rather than leave it whole,
2026-10-14.

## Decision

1. **`load_review` takes a `Channel<ReviewPart>` and returns nothing.** It
   sends the review's files in `Files` parts, then the rest of the review
   in one `Rest` part, last, whose `files` are empty. A channel delivers
   its messages in order.
2. **A batch weighs at most `BATCH_LINES` (2000)**, a file weighing one
   plus its diff lines (so one for a file unchanged, binary or only
   renamed); a file heavier on its own goes in a batch alone, and is then
   parsed in one piece.
3. **The core is unchanged.** `diff_loop_core::load` still builds the whole
   `Review`; batching is how the app sends it, so it lives in the app crate.
   `api.loadReview` joins the parts back into a `Review`, so the store and
   its tests see the same value as before.

## Consequences

- The first file still shows only once the whole review has arrived: the
  store needs every file to group them, carry viewed marks and move
  comments. What streaming buys is a webview that stays responsive while a
  large review comes in.
- Reading the diff from git is not streamed; a very large diff still takes
  as long to read as before.
