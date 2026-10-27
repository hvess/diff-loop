# The website: research brief

Three passes, 26 October 2026, each a separate investigation: how
converting developer-tool sites are structured (18 live sites and Evil
Martians' study of 100), their visual language (computed styles read in
the browser from 18 sites), and messaging and trust for an indie
open-source Mac app (competitors, developer quotes, Gatekeeper handling,
SEO). The page is designed from these findings; the audits check it
against them.

## Structure

- Indie and open-source tools convert at 4–7 screens (Maccy, Rectangle,
  Fork, Kaleidoscope, OpenCode, GitButler). 15+ screens belong to
  companies.
- Hero: a 4–9 word headline, a sub of at most 15 words, two CTAs with the
  primary naming the action and platform ("Download for macOS") and the
  secondary visibly lighter, a requirements line under the button, and
  the product itself as the visual.
- Dominant order: hero → trust → how it works / features → comparison
  (rare, GitButler) → install → FAQ → final CTA repeating the hero's
  button → footer. 15 of 18 end on a repeated CTA.
- A numbered "how it works" is rare but recommended for agent products,
  where the loop is the product.
- FAQ is "probably the only supporting block you need", with practical
  questions: data, login, cost, platforms.
- Social proof without customers: open source as its own strip, a
  privacy claim as its own block, compatibility names (Claude Code,
  Codex), the GitHub link, and the product shot. No logos, no invented
  quotes.
- Skip: pricing, logo wall, changelog teaser, newsletter.

## Visual language

- Ground: near-black, never #000 (Linear #08090a, Zed #111216, Cursor
  #14120b). Diff Loop uses its own window colours, #181818 and #f9f9f9,
  which none of the peers do and which matches the app.
- Headline: 48–64 px, weight 400–510, tracking −0.02 to −0.06 em,
  line-height 1.0–1.1 (Linear 56/510/−0.022em, Graphite 60/500, Vercel
  64/400/−0.06em). Weight 700 is the older look.
- Body: 15–16 px grey at about 60% luminance (Linear #8a8f98, Vercel
  #a1a1a1); never white paragraphs.
- Buttons: a filled pill or 6–8 px rect (Linear, Cursor, Vercel). Diff
  Loop's own primary is the app's blue capsule (Copy Review).
- Product: recreated or cropped UI in a 12 px frame with a 1 px white-8%
  hairline and at most one soft shadow (Linear, Graphite, Conductor);
  captions like Linear's "Fig. 0.1". Not a full window on a blur.
- Features: alternating 2:1 text-and-vignette bands 112–128 px apart,
  vignettes drawn from the app's own CSS so they stay crisp in both
  modes (Cursor, Superwhisper, Graphite).
- Dated tells to avoid: gradient text, coloured button glows, three
  icon-circle cards, emoji, left-border callouts, chevrons on every CTA,
  autoplay videos, a bento with no hierarchy.
- Icon: shown plain, once large and once beside the wordmark; the two
  discs as the only decorative motif.
- Motion: none beyond a short fade.

## Messaging and trust

- Position in the human-reviews-the-agent niche, not "AI code review"
  (which now means an AI reviews for you: CodeRabbit, Greptile). Peers:
  Reviu "The agent writes. You own the branch.", Diffsmith "You review.
  Your agent rewrites.", Collina "The review happens too late."
- Diff Loop's defensible differences: a review per branch that survives
  sessions and worktrees; three comment kinds including suggestions with
  code; the round trip (resolve with a note, accept with R); state in
  `.git`, nothing else written; MIT and free.
- Headline chosen: "Read what your agent wrote. Then tell it what to
  fix." Sub names Claude Code and Codex.
- Visitor objections, in order: another AI reviewer? which agents? where
  does my code go? why does macOS refuse it? Mac only? will it touch my
  repo? who made it?
- Gatekeeper: say plainly it is ad-hoc signed and not notarized, give
  the System Settings › Privacy & Security › Open Anyway steps (macOS 15
  no longer honours right-click Open), and offer building from source.
- Trust to show: MIT, the GitHub link, 4.6 MB, "no account, no cloud, no
  telemetry", the `.git` path as proof. No stars badge until the
  repository is public.
- Developer quotes exist (HN: "Code review was always a significant
  bottleneck and is even more so with agentic coding.") but belong in a
  blog post, not on the page as testimonials.
- SEO: title "Diff Loop: Review Your Coding Agent's Changes on Mac";
  description naming Claude Code, Codex, Markdown, MCP and "nothing
  leaves your machine"; H1 as above.
