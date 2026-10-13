//! Diff Loop's executable.

// Without a console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::ExitCode;

fn main() -> ExitCode {
    match diff_loop_app::run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("Diff Loop could not start: {error}");
            ExitCode::FAILURE
        }
    }
}
