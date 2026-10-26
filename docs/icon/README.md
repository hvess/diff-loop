# The app icon: Eclipse

Two discs of the same size. The later one, in the app's blue, passes in
front of the earlier one, in white, towards the top right: the change
laid over what was. Chosen from a round of sketches on 2026-10-26 and
refined the same day after seeing it in the Dock.

## Construction (1024 × 1024)

| Piece | Geometry | Fill |
|---|---|---|
| Earlier disc | centre (419.8, 557.8), r 300 | `#ECECEC`, the app's dark-mode foreground |
| Later disc | centre (604.2, 466.2), r 300 | gradient `#93ACFF` → `#3B5BDB`, the dark-mode accent to the button blue; 15 % translucent glass |
| Ground | vertical gradient `#2E3242` → `#15171F` | a dark blue-grey, set in Icon Composer |

The offset is 205.9 px at 26.4°; the mark spans 120 … 904 across and
166 … 858 down, so it fills the tile about as much as the system's own
icons do. Three things were learnt from the Dock, and each is a reason
for a number above:

- **The front disc is bright.** As dark glass it vanished at Dock size
  and the icon read as a crescent moon.
- **The blue is deep, not pale.** Pale periwinkle against white blurred
  the edge between the discs and looked washed out beside other icons.
- **The pair is large and set wide apart**, so the white disc still reads
  at 32 px.

## `Eclipse.icon`

The bundle is `app/src-tauri/icons/Eclipse.icon`, a build input since
ADR 0038: `icon.json` plus the two flat, opaque, unmasked SVG layers in
`Assets/`. The JSON lists its groups front to back, as Icon Composer's
sidebar does, so `later` comes first. The ground, the fills per
appearance, the glass, the shadow and the later disc's translucency are
set in the JSON, as the guidelines ask, so the SVGs carry nothing but
geometry. It needs Xcode 26's `actool`, the first with Icon Composer; it
was checked with 26.6, 2026-10-26.

1. Open it: Xcode → Open Developer Tool → Icon Composer, or double-click
   the bundle.
2. Check the six appearances (Default, Dark, Clear light and dark, Tinted
   light and dark). In each, the earlier disc is the brightest element and
   the two discs stay apart. `ictool`, inside Icon Composer's bundle at
   `Contents/Executables/`, renders one from the command line:

   ```sh
   ictool app/src-tauri/icons/Eclipse.icon --export-image --output-file out.png --platform macOS --rendition ClearDark --width 256 --height 256 --scale 1
   ```

   A tinted rendition also takes `--tint-color` and `--tint-strength`.
3. The default appearance is the dark one, since dark mode is what is
   marketed; there is no separate light variant.
4. Save it in place. A macOS build compiles it (`npm run icon:glass` in
   `app/`, run by `tauri.macos.conf.json`) into the app's `Assets.car`.

## The flat icons

`app/src-tauri/icons/app-icon.svg` draws the same design flat on the
pre-26 macOS grid, for Linux, Windows and macOS before 26. It cannot
have the material, so it stands in for it: a light gradient on the
earlier disc and a rim light on the later one, over the table's geometry
scaled onto the tile. A change to the bundle's layers is made there too,
then `npx tauri icon src-tauri/icons/app-icon.svg -o src-tauri/icons` in
`app/` (ADR 0038 §2), and `docs/icon.png` is `icon.png` at 256 px.
