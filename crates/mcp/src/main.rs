//! `diff-loop-mcp`: an MCP server on stdio through which a coding agent reads
//! the review of the branch checked out in its folder and resolves the
//! comments it fixed (`docs/spec/diff-loop-mcp.md`). Run by the agent, as
//! `claude mcp add diff-loop -- diff-loop-mcp`.

#[cfg(test)]
mod memory;
mod rpc;
mod tools;

use std::{
    env,
    io::{self, Write as _},
    path::PathBuf,
    process::ExitCode,
};

use diff_loop_core::{RepoError, Repository, ReviewKey};
use diff_loop_git::{Git, GitProgram};
use diff_loop_store::FileReviews;

use crate::{rpc::Server, tools::ToolError};

/// The app's identifier, which names its data directory. Must match
/// `identifier` in `app/src-tauri/tauri.conf.json`.
const IDENTIFIER: &str = "xyz.hvesserlewis.diffloop";

fn main() -> ExitCode {
    let Some(app_data) = app_data() else {
        let _ = writeln!(
            io::stderr(),
            "diff-loop-mcp: no home directory to find the app's data in"
        );
        return ExitCode::FAILURE;
    };
    let store = FileReviews::new(app_data.join("projects.json"));
    let git = GitProgram::default();
    let locate = || -> Result<ReviewKey, ToolError> {
        let here = env::current_dir().map_err(|e| RepoError::Failed {
            message: format!("cannot read the working directory: {e}"),
        })?;
        let checkout = Git::open(&git, &here)?.checkout()?;
        ReviewKey::of(&checkout).ok_or(ToolError::Detached)
    };
    let server = Server {
        store: &store,
        key: &locate,
    };
    match server.serve(io::stdin().lock(), io::stdout().lock()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            let _ = writeln!(io::stderr(), "diff-loop-mcp: {e}");
            ExitCode::FAILURE
        }
    }
}

/// The directory Tauri's `app_data_dir` gives the app on this platform.
fn app_data() -> Option<PathBuf> {
    let home = env::var_os("HOME").map(PathBuf::from);
    let base = if cfg!(target_os = "macos") {
        home.map(|home| home.join("Library/Application Support"))
    } else if cfg!(windows) {
        env::var_os("APPDATA").map(PathBuf::from)
    } else {
        env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .filter(|dir| dir.is_absolute())
            .or_else(|| home.map(|home| home.join(".local/share")))
    };
    base.map(|dir| dir.join(IDENTIFIER))
}
