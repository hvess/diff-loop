# The app icon: Eclipse

Two discs of the same size. The later one passes in front of the earlier
one towards the top right, so the earlier one shows as a crescent at the
lower left: the change is the light that gets through. Chosen from the
sketch round of 2026-10-26; the concept board is the Claude artifact
`PeqgqWezhov7Xi79emaPoH`.

## Construction (1024 × 1024)

| Piece | Geometry | Fill |
|---|---|---|
| Earlier disc | centre (468, 520), r 256 | `#ECECEC`, the app's dark-mode foreground |
| Later disc | centre (572, 468), r 256 | `#26262B`, dark glass |
| Ground | vertical gradient `#2A2A2E` → `#111113` | the app's dark window, set in Icon Composer |

The offset is 116 px at 26.6°; the crescent is 116 px at its widest; the
mark spans 212 … 828. The accent colourway swaps the earlier disc's fill
for `#93ACFF`, the dark-mode accent: one fill change in Icon Composer.

## `Eclipse.icon`

The bundle is `app/src-tauri/icons/Eclipse.icon`, a build input since
ADR 0038: `icon.json` plus the two flat, opaque, unmasked SVG layers in
`Assets/`. The JSON lists its groups front to back, as
Icon Composer's sidebar does, so `later` comes first. The ground, the
fills per appearance, the glass, the shadow and the later disc's
translucency are set in the JSON, as the guidelines ask, so the SVGs
carry nothing but geometry. It needs Xcode 26's `actool`, the first with
Icon Composer; it was checked with 26.6, 2026-10-26.

1. Open it: Xcode → Open Developer Tool → Icon Composer, or double-click
   the bundle.
2. Check the six appearances (Default, Dark, Clear light and dark, Tinted
   light and dark). In Mono the earlier disc is the near-white element the
   guidance asks for; the later disc should read as dark glass with a lit
   edge. If its edge pillows, turn Specular off on the `later` group.
3. For the light appearance, consider the System Light ground with the
   later disc turned light and the earlier disc in the accent; the JSON
   ships the dark look for both, since dark mode is what is marketed.
4. Save it in place. A macOS build compiles it (`npm run icon:glass` in
   `app/`, run by `tauri.macos.conf.json`) into the app's `Assets.car`.

## The flat icons

`app/src-tauri/icons/app-icon.svg` draws the same design flat on the
pre-26 macOS grid, for Linux, Windows and macOS before 26. It cannot
have the material, so it stands in for it: a light gradient on the
earlier disc and a rim light on the later one, over the table's geometry
scaled onto the tile. A change to the bundle's layers is made there too,
then `npx tauri icon src-tauri/icons/app-icon.svg -o src-tauri/icons` in
`app/` (ADR 0038 §2).
