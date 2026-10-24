# 0020 — Saved reviews are pruned when their tree is long gone, and saved in turn

**Status:** accepted, 2026-10-16; superseded by ADR 0030
**Amends:** ADR 0004 §3 (the format, and how a save writes it); ADR 0015
§9 (`reviews.json` version 2)
**Affects:** `app/src-tauri/src/reviews.rs`; open-tasks 9, closed

## Context

`reviews.json` kept an entry for every working tree ever reviewed,
moved or deleted ones included, each now with up to 20 rounds; and its
save lock was per process, so two running instances could overwrite each
other's saves (open-tasks 9). The developer asked for every open task to
be fixed, 2026-10-16, and chose how long a review outlives its tree: 30
days missing, so a drive or share that is away a while keeps its
reviews.

## Decision

1. **Version 3 records when each tree was last seen:** each entry is its
   `SavedReview` as before with `seen`, milliseconds since the Unix
   epoch, beside it. Versions 1 and 2 are read, their entries counted as
   seen at the next save, and written back as 3. Any other version is
   refused and left alone (ADR 0004 §3). (Amended by ADR 0026 §8:
   version 4 keeps reviews by project, each project with when its git
   directory was last seen.)
2. **Each save marks every tree it finds as seen, and drops an entry
   whose tree has been missing for more than 30 days** (`KEPT_MISSING`,
   `prune`). A tree is found when its root is a directory, looked at
   before the save takes its lock, so a share that hangs holds up no
   other instance. (Amended by ADR 0026 §8: a project is found when its
   common git directory is a directory, and its reviews go together.)
3. **Saves take turns across processes:** each save holds an exclusive
   lock on `reviews.json.lock` beside the file across its read, change
   and write (`std::fs::File::lock`, per open handle, so it orders saves
   within one instance too), so two instances neither lose each other's
   reviews nor collide on `reviews.json.next`. Reads take no
   lock: the rename keeps the file whole.

## Consequences

- A review whose tree is gone is lost 30 days after the last save that
  found it, by any instance; reopening the tree within that time finds
  it.
- An earlier build reading a version 3 file reports it unreadable and
  leaves it alone, as ADR 0015 noted for version 2.
- A save stats every kept root: O(trees reviewed), small.
