# Games and simulations

Read this before making art for a game or simulation. The first section is the
one that saves the most time and money.

## Simulations usually need no art at all

A physics, chemistry, population, or economics simulation should be **drawn
procedurally** — circles, vectors, springs, field lines, particles, plots — in
Canvas, SVG, or WebGL, directly from the model's state.

This is not a shortcut. It is more correct:

- The visual is *derived from* the simulated quantities, so it cannot silently
  disagree with them. A sprite can.
- It scales to any resolution and any parameter range.
- Students can be shown the drawing code as part of the lesson.
- Values, units, and vectors stay exact.

**Only reach for generated art in a simulation for framing and chrome** —
a title illustration, a lab-bench backdrop, an icon for a control panel. The
simulated content itself is drawn from state.

Ask a blunt question before generating anything: *is this asset showing
something the model computes?* If yes, draw it. If it is decoration around the
model, generate it.

## Games: what to generate and what to draw

| Need | Approach |
|---|---|
| Character sprites, creatures, items, props | Generate — `--frames` for animation, `--parts` if it will be rigged |
| Backgrounds, title screens, scene art | Generate — `--aspect 16:9`, high `--quality` for the one hero image |
| UI: buttons, panels, meters, icons | Generate icons as vector (`--kind icon`); build panels and meters in CSS |
| HUD, score, timers, dialogue, menus | DOM/CSS. Never bake into art — it must stay readable, translatable, screen-reader-visible |
| Particles, trails, explosions, weather | Code. Cheaper, scalable, and reactive to game state |
| Tilesets and seamless terrain | See the caveat below — mostly do not generate |

### The tileset caveat

Seamless tiling requires pixel-exact edge wrapping, and image models do not
reliably produce it. A tileset that *almost* tiles shows visible seams across a
whole level, which looks worse than flat colour.

Options that actually work, in order of preference: use an existing CC0 tileset
(Kenney.nl is the standard recommendation and is genuinely good); build terrain
from solid colours and CSS/Canvas patterns; or generate a few large,
non-repeating background *scenes* rather than tiles. If a tileset really is
required, expect to hand-fix edges — budget for that, or use a purpose-built
tool (see the note on Ludo below).

## Animation frames

```bash
scripts/gen_asset.py "pixel-art fox, side view, facing right, full body" \
  --frames "contact,down,passing,up" --transparent --alt "Running fox"
scripts/pack_sprites.py public/assets/frames/pixel-art-fox-side-view-facing-right
```

Every frame after the first is pinned to frame 1 by reference, and the prompt
demands identical character, colours, proportions, camera, scale, and position —
only the pose changes.

**Be honest with the user about the limits.** General image models drift. Four
to six frames usually hold together; beyond that, character identity and framing
wander, and the wander reads as jitter once played. Practical guidance:

- Keep cycles short. A 4-frame run cycle reads fine at 8–12 fps.
- Prefer **fewer frames plus code motion**: one sprite translated and squashed by
  code often looks better than eight drifting frames, and costs one API call.
- Always view the packed sheet before wiring it in. If frames jitter, regenerate
  the offending frame with the good frames as extra `--ref`s.
- For side views, say "side view, facing right, full body" explicitly in the base
  prompt — silent camera drift is the most common failure.

Prompt the pose names in animation terms where you can: a run cycle is
`contact, down, passing, up`. Naming the standard poses gets better spacing than
"running 1, running 2".

## Packing

`pack_sprites.py` trims transparent padding, normalises every frame to one cell
size, centres horizontally and **sits each frame on the cell floor** — so feet
stay on the ground across frames of different heights. That floor alignment is
what stops a walk cycle looking drunk.

```bash
pack_sprites.py FRAMES_DIR [--columns N] [--padding PX]
                [--format phaser|array|css|all] [--scale 0.5]
```

- `phaser` — Phaser 3 / Pixi JSON Hash atlas (the default)
- `array` — TexturePacker JSON Array
- `css` — a `steps()` background animation with **no engine at all**, which is
  often the right answer for a small classroom game
- The packer is deterministic and free. Re-run it as often as you like.

Ship one atlas rather than many PNGs: one request, one texture upload, no
per-sprite pop-in.

## Accessibility — non-negotiable in a classroom

You are shipping to a whole class, so assume every condition is present.

- **Flashing: hard limit of three flashes per second** (WCAG 2.3.1), and avoid
  large saturated-red flashes entirely. This is a seizure risk, not a preference.
  It applies to explosions, damage flashes, and success effects.
- **Never colour alone.** Team, state, correct/incorrect, and hazard must also
  differ by shape, icon, label, or pattern.
- **Keyboard and pointer both.** Never require precise dragging, fast reflexes,
  or simultaneous keypresses for anything graded. Offer a slower or paused mode.
- **Honour `prefers-reduced-motion`** — reduce parallax, screen shake, and
  looping idle animation.
- **Captions and text for all audio cues.** Never signal something important by
  sound alone.
- **Pause must always exist**, and the game must not punish pausing.

## Pedagogy notes

- **Seed the randomness and expose the seed.** A student who cannot reproduce
  their run cannot reason about it, and you cannot grade or debug it.
- **Let the state be inspectable.** A debug overlay showing the real variables
  turns a black box into a teaching tool.
- **Separate the model from the rendering.** Keep simulation state in plain data,
  with drawing as a pure function of it. It is testable, and students can read
  the model without wading through draw calls.
- Prefer a **fixed timestep** for physics so results do not vary with a student's
  hardware.

## When to reach outside this pipeline

`--frames` uses a general image model, which is not purpose-built for sprite
coherence or tilesets. Dedicated game-asset tools do that better. If frame
consistency or tilesets become a real bottleneck, say so to the user and let them
decide — do not sign them up for a subscription. Note that such tools typically
gate API/MCP access behind a mid-tier plan, so check the price of the tier that
actually includes automation, not the entry tier.

Also worth naming: **CC0 asset libraries** (Kenney.nl and similar) solve a large
share of classroom-game needs for free, with consistent style across a whole set,
and no generation at all. Check there before generating a single sprite.
