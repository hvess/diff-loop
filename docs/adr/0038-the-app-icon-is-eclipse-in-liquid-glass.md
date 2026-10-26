# 0038 — The app icon is Eclipse, in Liquid Glass on macOS

**Status:** accepted, 2026-10-26
**Supersedes:** `docs/spec/diff-loop-app.md` Decision 14 (the icon is
design 2a, "Pinned line"; Icon Composer not used)
**Affects:** `app/src-tauri/icons/`, `app/src-tauri/tauri.macos.conf.json`,
`app/src-tauri/Info.plist`, `app/package.json` (`icon:glass`),
`.gitignore`, `docs/icon/README.md`, `docs/icon.png`,
`docs/spec/diff-loop-open-tasks.md` (task 29),
`docs/spec/diff-loop-app.md` (Decision 37, step 17), `AGENTS.md`

## Context

The icon of 2026-10-13 drew three bars and a pinned dot on white: a
thumbnail of the interface, which Apple's guidelines ask an icon not to
be, and light, while the app is marketed in its dark appearance. macOS 26
draws app icons as layered Liquid Glass from an Icon Composer bundle
compiled into the app's `Assets.car`; an app without one is shown flat,
and one whose shape is not the system's square is set on a grey plate.
The developer chose the "Eclipse" design from a round of sketches,
2026-10-26, and asked that it be used both as the flat icon and as the
glass one.

## Decision

1. **The icon is Eclipse**: two discs of the same size, the later in front
   of the earlier, on the dark window's gradient (`docs/icon/README.md`
   gives the construction). The developer's choice, 2026-10-26.
2. **The flat icons are made from one source.** `icons/app-icon.svg` draws
   Eclipse on the pre-26 macOS grid, and `npx tauri icon
   src-tauri/icons/app-icon.svg -o src-tauri/icons` in `app/` makes the
   sizes `tauri.conf.json` lists; the others it makes are not kept, as
   before. They are the icon on Linux, Windows, and macOS before 26.
3. **On macOS the glass icon is compiled at build time.**
   `icons/Eclipse.icon` is the Icon Composer bundle, the source of the
   layers and their material. `tauri.macos.conf.json` makes a macOS
   build's `beforeBuildCommand` also run `npm run icon:glass`, which
   compiles the bundle with Xcode's `actool` into
   `src-tauri/gen/icon/Assets.car` (ignored by git), and copies that file
   into `Contents/Resources/`. `Info.plist` names the icon, `Eclipse`, so
   macOS 26 draws it from the catalogue; earlier systems keep
   `CFBundleIconFile`, the flat `icon.icns`.
4. **A macOS release build needs Xcode 26** for `actool`; the
   Command Line Tools alone cannot compile an `.icon`. Other platforms'
   builds are unchanged.

## Consequences

- `npm run tauri dev` does not run `beforeBuildCommand`, so a dev window's
  Dock tile shows the flat icon; the glass one is seen in a built bundle.
- A change to the icon is made in two places, kept in step by hand: the
  bundle's layers and `app-icon.svg`, then `tauri icon` once more.
- The Release workflow's macOS runner (ADR 0009, started by hand since
  ADR 0028) needs an image with Xcode 26 to build a `.dmg` of its own;
  `docs/spec/diff-loop-open-tasks.md` task 29.
