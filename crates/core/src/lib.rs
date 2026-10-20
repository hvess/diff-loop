//! Diff Loop's domain: what changed on a checkout, review comments, and the
//! instructions they become.
//!
//! Knows no adapter (AGENTS.md, Key Constraints): git, Tauri and the
//! filesystem reach it only through [`Repository`], [`Project`] and
//! [`ReviewStore`].

mod anchor;
mod base;
mod check;
mod code;
mod diff;
mod instructions;
mod lines;
mod project;
mod repository;
mod resume;
mod review;
mod rounds;
mod saved;
mod update;

pub use anchor::{AnchorState, Comment, Place, Resolution, Sent, Target, Verdict};
pub use base::{Base, BaseChoices, BaseRef, RefKind};
pub use check::{CheckError, CheckedReview, GoneReview, ProjectCheck, check_kept};
pub use diff::{Content, FileDiff, Hunk, Line, LineCounts, Side, Status};
pub use instructions::{InstructionsRequest, instructions};
pub use lines::lines;
pub use project::{Branch, Location, Project, project_name};
pub use repository::{
    Changes, Checkout, FileStates, Head, NewSide, OnChange, RepoError, Repository, Snapshot,
    Touched, WatchGuard,
};
pub use resume::{Resumed, SinceSeen, resume};
pub use review::{
    KnownFile, Loaded, Opening, Review, ReviewFile, choices, load, load_polled, open,
};
pub use rounds::{Round, RoundRequest, end_round, merge, round_to_follow};
pub use saved::{
    ReviewKey, ReviewStore, ReviewSummary, RoundSummary, SavedReview, Seen, StoreError,
};
