//! Diff Loop's domain: what changed on a checkout, the files grouped by what
//! they are for, review comments, and the instructions they become.
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
mod role;
mod saved;

pub use anchor::{AnchorState, Comment, Target};
pub use base::{Base, BaseRef, RefKind};
pub use diff::{Content, FileDiff, Hunk, Line, Side, Status};
pub use instructions::{Format, InstructionsRequest, instructions};
pub use lines::lines;
pub use repository::{
    Changes, Checkout, Head, NewSide, OnChange, RepoError, Repository, Snapshot, WatchGuard,
};
pub use review::{KnownFile, Opening, Review, ReviewFile, load, open};
pub use role::{FileGroup, Role};
pub use saved::{ReviewStore, SavedReview, StoreError};
