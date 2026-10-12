---
name: rust
description: Idiomatic Rust patterns, code style, project philosophy and the quality checks (cargo fmt, cargo clippy, cargo test) to run after any change to Rust code. Use when writing, editing or reviewing Rust in Diff Loop — the core crate or the Tauri app's Rust side.
---

# Rust

## Idiomatic Rust Patterns

### Use Concise Control Flow

Prefer `?` operator over explicit `match` statements for error propagation:

```rust
// Good
let result = operation()?;

// Avoid
match operation() {
    Ok(val) => val,
    Err(e) => return Err(MyError::from(e)),
}
```

Use `if let` instead of `match` when handling single patterns:

```rust
// Good
if let Some(value) = option {
    do_something(value);
}

// Avoid
match option {
    Some(value) => do_something(value),
    None => {}
}
```

Use `while let` for loop patterns:

```rust
// Good
while let Some(item) = iterator.next() {
    process(item);
}

// Avoid
loop {
    match iterator.next() {
        Some(item) => process(item),
        None => break,
    }
}
```

### Iterator Patterns

Prefer iterator chains over manual loops:

```rust
// Good
let results: Vec<_> = items
    .iter()
    .filter(|item| item.is_valid())
    .map(|item| item.process())
    .collect();

// Avoid
let mut results = Vec::new();
for item in &items {
    if item.is_valid() {
        results.push(item.process());
    }
}
```

Use functional combinators (`filter_map`, `flatten`, `fold`, etc.) instead of
intermediate collections.

### Error Handling

Use `?` operator over explicit error conversions when error types can be
automatically converted via `From` trait or `#[from]` attribute:

```rust
// Good: Use ? when StoreError has #[from] std::io::Error
write_record(&mut file, record).await?;

// Avoid: Explicit map_err when automatic conversion works
write_record(&mut file, record).await.map_err(StoreError::Io)?;
```

Use `map_err` only when you need custom error transformation that cannot be
handled by the `From` trait:

```rust
// Good: Custom error context that can't be expressed via From
let child = cmd.spawn().map_err(|source| RunError::Spawn { command: command.to_string(), source })?;
```

- Use `thiserror` for error types; `anyhow` only in a binary's `main`
- Use `Result` extensions like `ok_or`, `and_then`, `or_else` for complex flows

### Other Idiomatic Patterns

- Prefer destructuring assignments where appropriate
- Use `..` spread operator in struct updates
- Leverage `From`/`Into` traits for conversions
- Use `AsRef`/`AsMut` bounds for flexible parameter types

### Import Grouping

Group imports from same crate using curly braces:

```rust
// Good: Grouped imports
use diff_loop_core::{diff, store, Change, Session};
use diff_loop_core::diff::{hunks, Line};

// Avoid: Multiple separate imports
use diff_loop_core::diff;
use diff_loop_core::store;
use diff_loop_core::Change;
use diff_loop_core::Session;
use diff_loop_core::diff::hunks;
use diff_loop_core::diff::Line;
```

Use qualified paths sparingly — prefer imports over fully-qualified names in
function signatures:

```rust
// Good: Using imported types
pub async fn run() -> Result<(), StartupError> {
    // ...
}

// Avoid: Fully-qualified in signatures (verbose)
pub async fn run() -> Result<(), crate::error::StartupError> {
    // ...
}
```

The same holds in test bodies: a test module imports what its tests use
rather than spelling `super::module::Type` inline, and a test does not
re-import what its module already brings in.

### Tauri

- A `#[tauri::command]` is an adapter: it converts arguments, calls the
  core, and converts the result. Domain logic in a command handler belongs
  in the core (quality-gate §2).
- A command's error type implements `serde::Serialize` and is a typed enum,
  not a `String` — the front end acts on the variant.
- Shared state is registered once with `Builder::manage` in the
  composition root and taken as `State<'_, T>`; never a global.
- Async commands never block the runtime: blocking work goes through
  `tauri::async_runtime::spawn_blocking`.

## Project Philosophy

### Avoid Overengineering

- Implement exactly what's required by task specifications and acceptance criteria
- Cover specified edge cases but avoid adding extra functionality unless explicitly requested
- Focus on essential features — resist the urge to add bells and whistles
- Keep changes minimal and targeted — only modify what's necessary to fulfill requirements
- Refactor only when essential or explicitly requested

## Commands

### Build

```sh
cargo build
cargo build --release
```

### Test

```sh
cargo test --workspace
cargo test -p <crate>          # one crate
```

### Check

```sh
cargo check --workspace
cargo clippy --workspace --all-targets -- -D warnings
```

How to run the app is added here when the Tauri app is scaffolded.

## Code Style

### Rust Standards

- Follow standard Rust naming conventions (`snake_case` for functions/variables, `CamelCase` for types)
- Use `thiserror` for custom error types
- Prefer `?` operator over `match` for error propagation
- Use `async`/`await` for I/O operations
- Derive common traits: `Debug`, `Clone`, `PartialEq` where applicable

### Documentation

- Use `///` for public API documentation
- No `# Examples` sections: the code is the example, and a behaviour worth
  pinning is a unit test
- Document panics and errors

### Workspace lints

The checkable rules above are enforced as workspace lints, so clippy's
`-D warnings` fails on them. The workspace `Cargo.toml` carries, and every
crate opts in with `[lints] workspace = true`:

```toml
[workspace.lints.rust]
missing_docs                  = "warn"
missing_debug_implementations = "warn"

[workspace.lints.clippy]
missing_errors_doc = "warn"
missing_panics_doc = "warn"
# The big-o and data-structures skills' checkable rules.
linkedlist            = "warn"
stable_sort_primitive = "warn"
large_stack_arrays    = "warn"
inefficient_to_string = "warn"
```

A missing doc, `# Errors`, `# Panics` or `Debug` is fixed by writing it,
never by `#[allow]`.

### Testing

- Write unit tests in `#[cfg(test)]` modules
- Use `tempfile` for filesystem tests
- A bug fix lands with the test that would have caught it (quality-gate §8)

## Quality Assurance

Upon completion of each task that involves Rust code, AI agents MUST run the
following commands to ensure code quality and consistency.

### Required Checks

```sh
# Format all Rust code
cargo fmt

# Run linter and static analysis — warnings are errors
cargo clippy --workspace --all-targets -- -D warnings

# Run the tests
cargo test --workspace
```

Before committing, run the review loop (`review` skill). Its lint stage
enforces this skill's checkable rules, and its Rust judge the rest of this
skill against the diff.

### Handling Errors

If `cargo fmt`, `cargo clippy` or `cargo test` report issues:

1. Fix all warnings and errors reported by clippy
2. Re-run formatting if needed
3. Verify the fixes don't break existing tests
4. Re-run the commands to confirm compliance
