# Diff Loop's website

One static page with no build step and no dependencies beyond two Google
Fonts: `index.html`, its images in `img/`, and the icons beside it.

## Its design

The page is "7a · Website" on the redesign canvas (ADR 0027), and the
canvas is where a change to its look starts: change the artboard, then
carry the change into `index.html`. The page keeps the artboard's markup
and styles; its theme follows the visitor's system setting where the
canvas has an Appearance switch.

[`research.md`](research.md) is the brief the page was designed from:
the structure, look and messaging of comparable sites, and what the page
takes from each.

## Preview it

```sh
python3 -m http.server 4173 -d site
```

Then open <http://localhost:4173>.

## Its screenshots

`img/` holds 1600-pixel JPEG copies of `docs/screenshots/`, about a sixth
of their size. When the app's look changes, regenerate them from the new
screenshots:

```sh
for f in review base-picker suggestion instructions; do
  sips -s format jpeg -s formatOptions 80 --resampleWidth 1600 \
    "docs/screenshots/$f-dark.png" --out "site/img/$f-dark.jpg"
done
sips -s format jpeg -s formatOptions 80 --resampleWidth 1200 \
  docs/screenshots/review-dark.png --out site/img/og.jpg
```

`og.jpg` is the picture a shared link shows. Figures 2 to 4 are crops,
placed by a `transform` on each `img`: a new screenshot whose window moved
needs those percentages checked.

## What it states

Every claim on the page is one the README makes: platforms, size, license,
signing, what is written to a repository, the MCP server's commands. When
a release changes one of them, change it here too, with the version and
size in the structured data in `<head>`.

The page is not deployed yet; the open-tasks ledger (entry 30) says what
deploying it needs.
