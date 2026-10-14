//! Diff Loop's domain: what changed on a checkout, review comments, and the
//! instructions they become.
//!
//! Knows no adapter (AGENTS.md, Key Constraints): git, Tauri and the
//! filesystem reach it only through [`Repository`].

mod anchor;
mod base;
mod diff;
mod instructions;
mod lines;
mod repository;
mod review;
mod saved;
mod update;

pub use anchor::{AnchorState, Comment, Target};
pub use base::{Base, BaseRef, RefKind};
pub use diff::{Content, FileDiff, Hunk, Line, Side, Status};
pub use instructions::{InstructionsRequest, instructions};
pub use lines::lines;
pub use repository::{
    Changes, Checkout, Head, NewSide, OnChange, RepoError, Repository, Snapshot, Touched,
    WatchGuard,
};
pub use review::{KnownFile, Loaded, Opening, Review, ReviewFile, load, open};
pub use saved::{ReviewStore, SavedReview, StoreError};
