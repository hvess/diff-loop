# 0004 — Reviews kept between runs

**Status:** accepted, 2026-10-13
**Amends:** ADR 0001 §5 (review comments were not persisted) and §2 (adds
`serde_json` as a direct dependency of the app); ADR 0003 §2 (front-end
tests may test the store, with `api` mocked)
**Affects:** open-tasks 4; `docs/spec/diff-loop-core.md`,
`docs/spec/diff-loop-app.md`

## Context

Comments lived only in the front end's store, so quitting the app lost a
review in progress.

## Decision

1. **One saved review per working tree**, keyed by its root path: its
   comments and the general note (no note since ADR 0013 §3). Not per base: comments already follow
   their code across base and branch changes (`reanchor`), and keying by
   base would hide them on every switch, "Show what changed" included.
   (Amended by ADR 0015 §9: and its rounds. Amended by ADR 0026 §1: one
   per branch of a project instead, with its base and where its branch
   was seen.)
   Viewed marks are not kept: their signatures are valid within one run
   only. The developer's call, 2026-10-13.
2. **The core owns the port** (`ReviewStore`, `SavedReview`,
   `StoreError`); the app's adapter (`JsonReviews`,
   `app/src-tauri/src/reviews.rs`) keeps every review in one file,
   `reviews.json` in the OS app-data directory (Tauri's
   `app_data_dir`), chosen in `run`'s setup. The developer chose the
   app-data directory over `.git/`, 2026-10-13: nothing is written into a
   reviewed repository. (Superseded by ADR 0030 §1: a file per branch in
   the project's common git directory, the developer's call, 2026-10-24.)
3. **The format:** `{"version": 1, "reviews": {"<root>": SavedReview}}`,
   with `SavedReview` as its `serde` form (`comments` as `Comment`,
   `note`; no `note` since ADR 0013 §3). An empty review removes its entry. A file whose version is
   not 1, or that does not parse, is reported and never overwritten.
   (Amended by ADR 0015 §9: version 2, with rounds; a version 1 file is
   read and written back as 2.) Each
   save writes `reviews.json.next` and renames it over the file.
   (Amended by ADR 0020: version 3, with when each tree was last seen;
   saves take turns across processes on `reviews.json.lock`. Amended by
   ADR 0026 §8: version 4, by project then branch; an earlier version's
   reviews are dropped. Superseded by ADR 0030 §2: a new file, version 1.)
4. **When:** the front end reads the saved review before a checkout
   shows, and sets it with the checkout, so `load` moves its comments
   onto their code and opening is not a change. It saves on every change
   to the comments at once, and to the note 300 ms after typing stops
   (no note since ADR 0013 §3), and since ADR 0015 §9 to its rounds;
   a save equal to what that checkout last saved or read is skipped, so
   a refresh that only moves comments onto the same code writes nothing.
   Saves for a checkout run one after another (`app/src/store.ts`,
   `Saving`). (Amended by ADR 0026 §2 and §4: per review, with its base
   and where its branch was seen; a review never kept and still empty
   writes nothing.)
5. **A saved review that cannot be read stops saving** for that checkout:
   writing would replace a review never read. Try again reads it again
   and merges it into the window (comments by id, the window's note if it
   has one, until ADR 0013 §3) before saving. (Amended by ADR 0015 §9:
   the core's `merge` does it, counting rounds copied meanwhile on from
   the saved ones.)
6. **Front-end tests may test the store** (`app/src/store.test.ts`),
   with `api` mocked, besides plain functions (amends ADR 0003 §2).

## Consequences

- A failed read or write shows "Saved comments are unavailable" above
  the review, with Try again; the comments stay in the window.
- A moved or deleted working tree leaves its entry behind; nothing
  prunes it (open-tasks 9; since 2026-10-16 a save drops one whose tree
  has been missing 30 days, ADR 0020).
