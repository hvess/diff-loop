// Typed calls to the Tauri commands in src-tauri/src/lib.rs; argument names
// must match the commands' parameter names (Tauri converts them to camelCase).
import { Channel, invoke } from "@tauri-apps/api/core";
import type { Base } from "./bindings/Base";
import type { BaseChoices } from "./bindings/BaseChoices";
import type { Checkout } from "./bindings/Checkout";
import type { CommandError } from "./bindings/CommandError";
import type { Comment } from "./bindings/Comment";
import type { InstructionsRequest } from "./bindings/InstructionsRequest";
import type { KeptReview } from "./bindings/KeptReview";
import type { KnownFile } from "./bindings/KnownFile";
import type { LineCounts } from "./bindings/LineCounts";
import type { Opening } from "./bindings/Opening";
import type { Place } from "./bindings/Place";
import type { ProjectCheck } from "./bindings/ProjectCheck";
import type { RepoError } from "./bindings/RepoError";
import type { Resumed } from "./bindings/Resumed";
import type { Review } from "./bindings/Review";
import type { ReviewFile } from "./bindings/ReviewFile";
import type { ReviewKey } from "./bindings/ReviewKey";
import type { ReviewPart } from "./bindings/ReviewPart";
import type { RoundRequest } from "./bindings/RoundRequest";
import type { SavedReview } from "./bindings/SavedReview";
import type { Side } from "./bindings/Side";
import type { Snapshot } from "./bindings/Snapshot";

export const api = {
  openRepository: (path: string) => invoke<Opening>("open_repository", { path }),
  /** The review kept under `key`: live in the worktree that has its branch checked out, else its commits (ADR 0026 §3). */
  openReview: (key: ReviewKey) => invoke<Opening>("open_review", { key }),
  /** `review` as the open checkout, read as `checkout` on opening, shows it now: its base, where its branch went since it was seen (ADR 0026 §4). */
  resumeReview: (review: SavedReview, checkout: Checkout, fallback: Base, at: number) =>
    invoke<Resumed>("resume_review", { review, checkout, default: fallback, at }),
  /** Closes the open checkout, letting another window show its review (ADR 0026 §9). */
  closeRepository: () => invoke<null>("close_repository"),
  worktreeOf: (key: ReviewKey) => invoke<string | null>("worktree_of", { key }),
  /** Every review kept, for the review switcher and the welcome screen (ADR 0026 §7). */
  keptReviews: () => invoke<KeptReview[]>("kept_reviews"),
  /** `project`'s branches, and where its reviews' went; a review whose branch is gone is deleted, and named (ADR 0026 §6). */
  checkProject: (project: string) => invoke<ProjectCheck>("check_project", { project }),
  baseChoices: () => invoke<BaseChoices>("base_choices"),
  /** `full` reads everything again, even while a watch runs (ADR 0014 §1). */
  loadReview: (base: Base, comments: Comment[], known: KnownFile[], full: boolean) =>
    new Promise<Review>((resolve, reject) => {
      const files: ReviewFile[] = [];
      // In order: batches of files, then the rest (ADR 0012); each is parsed as it arrives.
      const parts = new Channel<ReviewPart>((part) => {
        if (part.kind === "files") files.push(...part.files);
        else resolve({ ...part.review, files });
      });
      invoke<null>("load_review", { base, comments, known, full, parts }).catch(reject);
    }),
  fingerprint: (base: Base) => invoke<string>("fingerprint", { base }),
  uncommittedLines: () => invoke<LineCounts>("uncommitted_lines"),
  commitsBetween: (from: string, to: string) =>
    invoke<number | null>("commits_between", { from, to }),
  blob: (snapshot: Snapshot, side: Side, path: string) =>
    invoke<ArrayBuffer>("blob", { snapshot, side, path }),
  fileLines: (snapshot: Snapshot, side: Side, path: string, first: number, last: number) =>
    invoke<string[]>("file_lines", { snapshot, side, path, first, last }),
  watchRepository: () => invoke<boolean>("watch_repository"),
  savedReview: (key: ReviewKey) => invoke<SavedReview>("saved_review", { key }),
  saveReview: (key: ReviewKey, review: SavedReview) => invoke<null>("save_review", { key, review }),
  launchPath: () => invoke<string | null>("launch_path"),
  instructions: (request: InstructionsRequest) =>
    invoke<string>("instructions", { request }),
  /** The review after a copy: a round ended, every unresolved comment sent (ADR 0015 §1). */
  endRound: (request: RoundRequest) => invoke<SavedReview>("end_round", { request }),
  roundToFollow: (comments: Comment[], now: Place, previous: string) =>
    invoke<number | null>("round_to_follow", { comments, now, previous }),
  /** The saved review merged into the window's, once a failed read is read again (ADR 0004 §5). */
  mergeReviews: (window: SavedReview, saved: SavedReview) => invoke<SavedReview>("merge_reviews", { window, saved }),
};

/** Whether `error` is a command's own failure, not one from the IPC layer (a string). */
function isCommandError(error: unknown): error is CommandError {
  return typeof error === "object" && error !== null && "kind" in error;
}

/** Whether `error` says another window shows the review asked for (ADR 0026 §9). */
export function isOpenElsewhere(error: unknown): boolean {
  return isCommandError(error) && error.kind === "openElsewhere";
}

/** A command failure in words a person can act on. */
export function describe(error: unknown): { title: string; detail: string } {
  if (!isCommandError(error)) return { title: "Something went wrong", detail: String(error) };
  switch (error.kind) {
    case "noRepository":
      return { title: "No repository is open", detail: "Open a folder to start a review." };
    case "store":
      return { title: "Saved comments are unavailable", detail: error.error.message };
    case "claim":
      return {
        title: "Can’t tell whether another window shows this review",
        detail: `${error.message}. Try again, or close the other Diff Loop windows.`,
      };
    case "openElsewhere":
      return {
        title: `${error.branch} is open in another window`,
        detail: `Look for “${error.name} · ${error.branch}” in your window list.`,
      };
    case "internal":
      return { title: "Diff Loop hit a problem", detail: error.message };
    case "repository":
      return describeRepository(error.error);
    default:
      return unknownFailure(error);
  }
}

function describeRepository(r: RepoError): { title: string; detail: string } {
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
    case "notCheckedOut":
      return {
        title: `${r.branch} isn’t checked out`,
        detail: "It isn’t checked out in any worktree, so only its commits can be shown. Choose another base.",
      };
    case "noBranch":
      return {
        title: `Can’t find ${r.name}`,
        detail: "No branch has that name any more. It may have been deleted.",
      };
    case "outsideRepository":
      return { title: "File outside the repository", detail: `${r.path} can’t be shown.` };
    case "failed":
      return { title: "Git reported a problem", detail: r.message };
    default:
      return unknownFailure(r);
  }
}

/**
 * A failure kind these bindings do not name. `never`, so a new variant in Rust
 * fails the type check until it has words. `isCommandError` checks only that a
 * `kind` is present, so at run time an unnamed one can still reach here.
 */
function unknownFailure(failure: never): { title: string; detail: string } {
  return { title: "Something went wrong", detail: JSON.stringify(failure) };
}
