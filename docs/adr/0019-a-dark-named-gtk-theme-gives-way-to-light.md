# 0019 — A GTK theme dark by name gives way to its light one

**Status:** accepted, 2026-10-16
**Amends:** ADR 0010 §4 (how the portal's preference is applied)
**Affects:** `app/src-tauri/src/appearance.rs`, `app/src-tauri/Cargo.toml`
(`gtk`); open-tasks 14, closed

## Context

On Linux the app applies the XDG settings portal's `color-scheme` with
GTK's prefer-dark setting (ADR 0010 §4). WebKitGTK also reads the GTK
theme's name, so under a theme dark by name (`Arc-Dark`) the window
stayed dark when the portal asked for light (ADR 0010, Consequences;
open-tasks 14). The developer asked for every open task to be fixed,
2026-10-16.

## Decision

1. **When the portal asks for light and the desktop's GTK theme is dark
   by name, the app draws with its light one.** `Arc-Dark` and
   `Adwaita-dark`, in any case, name the dark theme of `Arc` and
   `Adwaita` (`light_of`). At each value the portal sends, the app first
   resets its own `gtk-theme-name`, so GTK follows the desktop's theme
   again, changes made while it runs included; then, asked for light, it
   sets the light one of the desktop's theme when that is dark by name.
   GTK draws a theme it cannot find as Adwaita.
2. **It changes only the app's own GTK settings,** never the desktop's;
   `GTK_THEME` in the environment still wins, as GTK lets it.
3. **`gtk` is named directly for Linux,** at the version Tauri's GTK
   stack already uses (0.18), as `gio` is (ADR 0010 §4).

## Consequences

- Under `Arc-Dark` with a light preference the window is light, as the
  desktop's other GTK apps that follow the portal are; walked on Linux
  with a stand-in portal on a private session bus, 2026-10-16.
- A theme dark by another kind of name (`Arc-Darker`, `Nordic`) is left
  as the desktop set it.
- While the app draws with a light theme of its own, any change to the
  desktop's theme is followed at the portal's next value, not at once.
