
<!-- Paste this block into your project's CLAUDE.md -->

## Graphics and animation

This project has an asset pipeline. Before producing any visual, read
`.claude/skills/classroom-assets/SKILL.md` and follow its routing table.

The short version:

- **Diagrams, figures, charts, anything with labels or data** — hand-author SVG,
  or use D3 / Vega-Lite / Mermaid / matplotlib. Never an image model.
- **Animation and transitions** — write code (CSS, Canvas, Motion, GSAP) or use a
  ready-made animation from the free Lottie library. Never generate frames.
  Always honour `prefers-reduced-motion`, and never loop motion next to text.
- **Ready-made Lottie**: `scripts/find_lottie.py "QUERY" --sheet /tmp/c.png` searches
  the public library with no account. Shortlist from the sheet, then `--preview DIR`
  so a human can judge the actual motion before it ships.
- **Custom Lottie** is a last resort for genuinely multi-part motion. It needs a
  live browser session and a paid plan — read
  `.claude/skills/classroom-assets/references/lottie.md` and check with me first.
- **Simple icons and geometric marks** — hand-author the SVG. Free, exact, and
  usually better than a generator. `--vectorize` converts a raster to SVG free
  and locally. Recraft's API costs prepaid units a subscription does NOT include
  — ask before using `--kind vector`/`--kind icon`.
- **Illustrations, characters, scenes** — `scripts/gen_asset.py --kind raster`.

Rules that always apply: pass `--preset` so the set stays visually coherent; pass
`--ref` with an existing approved asset when extending a set; pass `--alt` on
every generation; never bake text into a generated image; confirm with me before
generating more than ~8 images in one go, since these are paid API calls.

For **games and simulations**, read
`.claude/skills/classroom-assets/references/games.md` first. Key call: anything
the simulation computes gets drawn procedurally from state, not generated.
Sprite animation is `--frames` plus `scripts/pack_sprites.py`. Hard limit of
three flashes per second — seizure risk.

If `assets.config.json` sets `asset_library`, **search it before generating**:
`scripts/find_asset.py QUERY --sheet /tmp/c.png` renders all matches into one
image to look at. Never browse the library by listing files or opening sprites
individually — see `.claude/skills/classroom-assets/references/asset-library.md`.

Style presets and the assets directory live in `assets.config.json`.
