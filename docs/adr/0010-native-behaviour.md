# 0010 — Native behaviour of the window

**Status:** accepted, 2026-10-14
**Affects:** `app/src-tauri/src/lib.rs`, `app/src-tauri/src/renderer.rs`,
`app/src-tauri/src/appearance.rs`, `app/src-tauri/tauri.conf.json`,
`app/src-tauri/capabilities/default.json`, `Cargo.toml`, `app/src/`
(`nativeWindow.ts`, `contextMenu.ts`, `menuBar.ts`, `delay.ts`,
`platform.ts`); diff-loop-app.md Decisions 17–21; open tasks 14 and 15 (opened here)

## Context

The developer wants the app to feel native on Linux and macOS: it should
not behave like a web page in a window. Research on 2026-10-14 named what
gives a webview app away: a blank or white window at launch, the
webview's own context menu ("Back", "Reload"), no remembered window
size, no menu bar on macOS (where Cut, Copy and Paste then stop working
in text fields), a light window on a dark Linux desktop, indicators that
flash for waits too short to notice, and slow repaints from a misconfigured
WebKitGTK renderer.

## Decision

1. **The window opens hidden and shows after the first paint.**
   `tauri.conf.json` creates it with `visible: false`; the front end shows
   it two frames after mounting (`showWhenPainted`), and `run` shows it
   anyway after `SHOW_ANYWAY` (3 s), so a front end that fails still
   leaves a window. The window's background follows `--ui-bg`
   (`matchBackground`), so resizing shows no white edge in dark mode.
   **Its size, position, maximized and full-screen state are kept between
   runs** by `tauri-plugin-window-state` (a new dependency), in
   `.window-state.json` in the app's config directory; not its
   visibility, which `showWhenPainted` owns. On macOS the traffic lights
   sit in the 52 px title bar (`trafficLightPosition`), and a window out
   of view is throttled rather than suspended (`backgroundThrottling`), so
   watch events still apply while it is hidden.
2. **Release builds are optimised across crates:** `codegen-units = 1`,
   `lto = true` and `strip = true` in the workspace `Cargo.toml`. Not
   `panic = "abort"`: `blocking` turns a panicking command into
   `CommandError::Internal`, which needs unwinding.
3. **On Linux under NVIDIA's own driver, WebKitGTK moves its buffers
   through shared memory** (`WEBKIT_DMABUF_RENDERER_FORCE_SHM=1`, set by
   `renderer::choose` before any thread starts), which avoids the driver's
   DMA-BUF failures ("Error 71", blank windows) while keeping the
   composited renderer. A renderer variable the person set already is
   left alone. The app never disables DMA-BUF or compositing outright:
   both fall back to painting the whole window on the CPU.
4. **On Linux the app follows the XDG settings portal's
   `org.freedesktop.appearance` `color-scheme`**, read at start and on
   each change, and applies it with `AppHandle::set_theme` (GTK's
   prefer-dark setting, which WebKitGTK reads for
   `prefers-color-scheme`). GTK 3 does not read the portal itself. It
   talks D-Bus through `gio`, already in the build under Tauri's GTK stack
   (0.18), now named directly for Linux.
5. **Menus are native, built with Tauri's menu API from the front end.**
   On macOS the app installs a menu bar (`menuBar.ts`): the app menu,
   File, Edit (the system's Undo, Redo, Cut, Copy, Paste, Select All),
   View, Review and Window. Context menus are native menus too
   (`contextMenu.ts`); in a text field or over selected text the
   webview's own menu stays, because it is already the platform's native
   one; everywhere else the webview's menu is removed.
6. **Something running shows only after 200 ms** (`INDICATOR_DELAY_MS`,
   `useDelayed`): shorter waits show nothing.
7. **On macOS a character key the app does not handle is consumed**
   (`wouldBeep`), so WebKit does not sound the alert beep.

## Consequences

- No browser keyboard shortcut is blocked: WebKitGTK and WKWebView bind
  none (reload, find, print and the like belong to browsers built on
  them, and to WebView2 on Windows, which is not built for). If a Windows
  build is added, this needs looking at again.
- A Linux desktop whose GTK theme is a dark one by name (`Arc-Dark`)
  stays dark when the portal asks for light: WebKitGTK reads the theme
  name too (open task 14).
- The macOS side is untested on a Mac at the time of writing; Linux was
  walked (open task 15).
- A hybrid laptop with the NVIDIA module loaded uses shared-memory
  buffers even when the integrated GPU draws the window.
