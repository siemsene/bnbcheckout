---
name: classroom-assets
description: Produce graphics and animation for classroom apps — decide between generating an asset, hand-authoring SVG, or animating in code, then execute. Use whenever the app needs an illustration, character, icon, background, diagram, figure, chart, loading state, transition, or animated feedback.
---

# Classroom app assets

The goal is a coherent visual system a class can actually read, not a pile of
one-off images. Most of that comes from choosing the right *production method*
before generating anything.

## Step 0 — is it already in the library?

If `assets.config.json` defines `asset_library`, **search it before generating
anything.** A pre-made asset is free, instant, and already stylistically
consistent with hundreds of siblings.

```bash
scripts/find_asset.py tree --kind image --no-sheets --sheet /tmp/c.png
```

Then read that one contact sheet and pick by number. Never browse the library by
listing its tree or opening sprites one at a time — it holds tens of thousands of
files. Full workflow in `references/asset-library.md`.

Generate only what the library lacks, and pass a library sprite as `--ref` so the
generated asset matches the pack's style.

## Step 1 — route the request

| What is needed | Method | Never do this |
|---|---|---|
| Diagram, figure, chart, plot, graph, labelled schematic, anything with axes, numbers, or scientific structure | **Hand-author** SVG, or use D3 / Vega-Lite / Mermaid / matplotlib | Do not use an image model. It will produce plausible-looking wrong labels, uneven axes, and invented data. A wrong diagram in front of a class is worse than none. |
| Animation, transition, hover state, animated feedback, simulation, loading state | **Write code**: CSS transitions, SVG/CSS, Canvas, Motion (Framer Motion), GSAP, Three.js — or search the free Lottie library with `scripts/find_lottie.py` | Do not generate image frames or ask for a "GIF". Do not add an animation runtime for a fade. |
| Mascot with many coordinated moving parts, liquid filling, diagram assembling itself | **Custom Lottie** — read `references/lottie.md` first, and generate riggable layers with `--parts` | Do not try to animate a flat single-layer SVG; it can only be transformed as one blob. |
| Simple icon, logo, badge, glyph, small scalable mark | **Hand-author the SVG.** For geometric marks this is free, exact, cleanly grouped, CSS-recolourable, and usually better than any generator. Try this first. | Do not generate a PNG icon. Do not pay for a shape you can write. |
| Detailed illustration that must scale | Generate raster, then `--vectorize` (free, local) | |
| Recraft's specific vector look, and API units are purchased | `scripts/gen_asset.py --kind vector` or `--kind icon` | Costs prepaid Recraft API units — never assume the user has them. |
| Character, mascot, scene, background, textured or painterly illustration, photographic imagery | `scripts/gen_asset.py --kind raster` |
| **Simulation** content — anything the model computes (bodies, vectors, fields, plots, particles) | **Draw it procedurally** in Canvas/SVG/WebGL from simulation state — read `references/games.md` | Do not generate art for something the code already knows the exact shape of. |
| **Game** sprite animation, walk cycles, character frames | `--frames` then `scripts/pack_sprites.py` — read `references/games.md` | |
| Tilesets, seamless terrain | Usually **not** generated — prefer CC0 sets or CSS/Canvas patterns; see `references/games.md` | Image models do not tile seamlessly; the seams show across a whole level. | |
| Existing raster that needs to become editable/scalable | `scripts/gen_asset.py --vectorize path.png` — free and local via vtracer/potrace | |

If a request mixes categories — "an animated diagram of a pendulum" — split it:
hand-author the SVG geometry, then animate it in code. Nothing is generated.

**For a game or simulation, read `references/games.md` first.** The single most
important call is whether the visual is *derived from computed state* — if so it
gets drawn from that state, not generated. Getting this backwards produces art
that silently disagrees with the model.

**Before reaching for Lottie at all, read `references/lottie.md`.** Four routes
get checked in order — free library, then CSS/Motion, then code for anything
data-driven or interactive, and only then a custom Lottie. Custom Lottie needs a
live browser session with the user present and a paid LottieFiles plan, so never
start down that path without saying so first.

## Step 2 — check before spending

- Always run with `--dry-run` first when the prompt is complex or the destination
  is uncertain. It resolves the prompt and path and calls nothing.
- Generating **more than about 8 images in one batch** — stop and confirm with the
  user first, with an estimated cost. These are paid API calls on their account.
- Look in the assets directory before generating. If a suitable asset already
  exists, reuse it.

## Step 3 — keep the set coherent

Visual consistency across an app is the single biggest quality difference, and it
does not happen by accident.

- **Always** pass `--preset` (or rely on `default_preset` in `assets.config.json`).
  The preset carries the house style sentence and the palette.
- When adding to an existing set — a new pose for a character, a sibling
  illustration — pass the approved existing asset with `--ref`:
  `--ref public/assets/robot-idle.png`. This is what keeps a character on-model.
  Multiple `--ref` flags are allowed. (Gemini only; ignored for vector/icon.)
- If no preset exists yet, propose one to the user and write it into
  `assets.config.json` before generating the set, not after.

## Step 4 — classroom-specific rules

These are not optional polish; they are what makes the asset usable in a room.

- **Alt text is mandatory.** Pass `--alt "..."` on every generation and put the
  same text in the `alt` attribute in the app. An asset without alt text is not
  finished.
- **Legibility at projection distance.** High contrast, bold shapes, no hairline
  strokes, no small text baked into the image.
- **Text belongs in the DOM, not in the pixels.** Never bake labels, captions, or
  UI copy into a generated image — it cannot be corrected, translated, searched,
  or read by a screen reader. Render text as HTML/SVG `<text>` over the asset.
- **Colour is never the only signal.** Pair every colour distinction with shape,
  label, or pattern. Check the preset palette is colourblind-safe.
- **Respect `prefers-reduced-motion`** in every animation you write. Gate
  non-essential motion behind the media query. Lottie does *not* do this on its
  own — it needs an explicit static-poster fallback (see `references/lottie.md`).
- **Never loop motion beside text students are reading.** Play once on mount or
  on interaction.
- **Hard limit of three flashes per second** in any game or animation (WCAG
  2.3.1), and no large saturated-red flashes. This is a seizure risk. It applies
  to damage flashes, explosions, and success effects.
- **No real people.** Do not generate likenesses of identifiable real individuals
  — historical figures, scientists, public figures. Use a diagram, a public-domain
  portrait, or a clearly stylised non-specific figure instead.
- Prefer **transparent backgrounds** (`--transparent`) for anything composited
  over app UI, so it works on light and dark themes.

## Step 5 — after generating

- Every asset gets a sidecar `<name>.meta.json` recording the prompt, model,
  preset and references. Keep it in version control — it is how the set gets
  regenerated or extended next semester.
- Optimise SVGs before shipping (`svgo`) and check raster file sizes; a 2K PNG
  behind a small UI element should be downscaled.
- Show the user what was produced and what it cost.

## Command reference

```bash
scripts/gen_asset.py "prompt" [--kind raster|vector|icon] [--out PATH]
                     [--preset NAME] [--quality fast|standard|best]
                     [--aspect 16:9] [--size 1K|2K|4K]
                     [--ref PATH ...] [--transparent] [--alt TEXT]
                     [--dry-run]

# one isolated, style-matched layer per part, for rigging in an animation editor
scripts/gen_asset.py "friendly robot tutor" --parts "torso,left arm,head,eyes"

# an ordered animation set, then packed into a sheet + atlas JSON
scripts/gen_asset.py "pixel-art fox, side view, facing right" \
    --frames "contact,down,passing,up" --transparent
scripts/pack_sprites.py public/assets/frames/<subject>   # free, local, deterministic

# free, local raster -> SVG (vtracer for colour, potrace for black and white)
scripts/gen_asset.py --vectorize input.png [--out out.svg]
                     [--tracer auto|vtracer|potrace|recraft]
                     [--trace-mode color|bw] [--trace-colors N] [--trace-speckle N]

# local CC0 library: index once, then search as text and preview in one image
scripts/index_library.py /path/to/library
scripts/find_asset.py QUERY [--kind image] [--pack NAME] [--min PX] [--no-sheets]
                      [--sheet OUT.png] [--pick 0,3] [--copy DIR]

# public LottieFiles library: no account needed
scripts/find_lottie.py "QUERY" [--limit N] [--sheet OUT.png]
                       [--pick 0,3] [--preview DIR] [--download DIR]
```

Contact sheets show one still frame. For Lottie that is not enough to judge
timing or loop quality — build `--preview` and let a human decide.

Split parts only on what actually needs to move independently — every extra
layer is another paid call and more rigging work.

### Cost note — Recraft

Recraft's **API is billed from prepaid API units that a subscription does not
include**: a Recraft plan pays for the web app, not for API calls. Vector
generation runs about $0.08 per image, raster about $0.04.

So `--kind vector` / `--kind icon` should not be a reflex. Prefer, in order:
hand-authored SVG (free), then Gemini raster plus `--vectorize` (~$0.04, and the
tracing itself is free and local), then Recraft only when its particular vector
aesthetic is wanted and the user has bought units. Ask before spending them.

`--quality best` (Gemini 3 Pro Image) costs roughly 3x `standard`. Use it for
hero art and character sheets that everything else will reference; use
`standard` for everything else and `fast` for throwaway exploration.
