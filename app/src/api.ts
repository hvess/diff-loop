// Typed calls to the Tauri commands in src-tauri/src/lib.rs; argument names
// must match the commands' parameter names (Tauri converts them to camelCase).
import { invoke } from "@tauri-apps/api/core";
import type { Base } from "./bindings/Base";
import type { BaseRef } from "./bindings/BaseRef";
import type { CommandError } from "./bindings/CommandError";
import type { Comment } from "./bindings/Comment";
import type { InstructionsRequest } from "./bindings/InstructionsRequest";
import type { KnownFile } from "./bindings/KnownFile";
import type { Opening } from "./bindings/Opening";
import type { Review } from "./bindings/Review";
import type { SavedReview } from "./bindings/SavedReview";
import type { Side } from "./bindings/Side";
import type { Snapshot } from "./bindings/Snapshot";

export const api = {
  openRepository: (path: string) => invoke<Opening>("open_repository", { path }),
  refs: () => invoke<BaseRef[]>("refs"),
  loadReview: (base: Base, comments: Comment[], known: KnownFile[]) =>
    invoke<Review>("load_review", { base, comments, known }),
  fingerprint: (base: Base) => invoke<string>("fingerprint", { base }),
  uncommittedFiles: () => invoke<number>("uncommitted_files"),
  commitsBetween: (from: string, to: string) =>
    invoke<number | null>("commits_between", { from, to }),
  blob: (snapshot: Snapshot, side: Side, path: string) =>
    invoke<ArrayBuffer>("blob", { snapshot, side, path }),
  fileLines: (snapshot: Snapshot, side: Side, path: string, first: number, last: number) =>
    invoke<string[]>("file_lines", { snapshot, side, path, first, last }),
  watchRepository: () => invoke<boolean>("watch_repository"),
  savedReview: (root: string) => invoke<SavedReview>("saved_review", { root }),
  saveReview: (root: string, review: SavedReview) => invoke<null>("save_review", { root, review }),
  launchPath: () => invoke<string | null>("launch_path"),
  instructions: (request: InstructionsRequest) =>
    invoke<string>("instructions", { request }),
};

/** A command failure in words a person can act on. */
export function describe(error: unknown): { title: string; detail: string } {
  const e = error as CommandError | undefined;
  if (e?.kind === "noRepository") {
    return { title: "No repository is open", detail: "Open a folder to start a review." };
  }
  if (e?.kind === "store") {
    return { title: "Saved comments are unavailable", detail: e.error.message };
  }
  if (e?.kind === "internal") {
    return { title: "Diff Loop hit a problem", detail: e.message };
  }
  if (e?.kind === "repository") {
    const r = e.error;
    switch (r.kind) {
      case "notARepository":
        return {
          title: "Not a git repository",
          detail: `${r.path} is not inside a git repository. Open the repository root or one of its worktrees.`,
        };
      case "unknownBase":
        return {
          title: `Can’t find ${r.name}`,
          detail: "It is not a branch, tag or commit in this repository. Choose another base.",
        };
      case "noCommits":
        return {
          title: "No commits yet",
          detail: "This branch has no commits, so only uncommitted changes can be shown.",
        };
      case "outsideRepository":
        return { title: "File outside the repository", detail: `${r.path} can’t be shown.` };
      case "failed":
        return { title: "Git reported a problem", detail: r.message };
    }
  }
  return { title: "Something went wrong", detail: String(error) };
}
