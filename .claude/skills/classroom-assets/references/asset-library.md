# Using a local CC0 asset library

If `assets.config.json` has an `asset_library` path, **search it before
generating anything.** A pre-made asset is free, instant, already consistent
with hundreds of sibling assets, and already CC0. Generation is the fallback.

## Why this needs tooling

A library like Kenney's All-in-1 holds 60,000+ files. Two approaches fail:

- **Listing the tree.** Tens of thousands of paths floods the context and still
  does not show what anything looks like.
- **Opening images to browse.** Each image read is expensive. Forty candidates
  is forty reads, and you may need several rounds.

So: index once, search as text, and view many candidates in **one** image.

## The workflow

**1. Index (once per library, or after an update)**

```bash
scripts/index_library.py /path/to/library
```

Writes `asset-index.jsonl` at the library root — one JSON object per asset with
pack, path, searchable tokens, dimensions, transparency and kind. Also writes a
`.summary.json` with pack counts. Re-run after the library updates.

Record the library path in `assets.config.json` so searches auto-locate it:

```json
{ "asset_library": "/path/to/library" }
```

**2. Search — cheap, text only**

```bash
scripts/find_asset.py tree                                  # what exists
scripts/find_asset.py button ui --kind image --min 48 --no-sheets
scripts/find_asset.py character walk --pack platformer
scripts/find_asset.py tile -sheet                           # leading - excludes
```

Terms are ANDed and match the **whole path**, not just the filename — so
directory names like `PNG/Players/` are searchable, and camelCase is split
(`playerWalk1` matches `player` and `walk`). Useful filters: `--kind`,
`--pack`, `--min`/`--max`, `--square`, `--alpha`, `--no-sheets`, `--limit`.

Start with `--packs` to see what the library actually contains before guessing
search terms.

**3. Look — one image, many candidates**

```bash
scripts/find_asset.py tree --sheet /tmp/trees.png --sheet-cols 8
```

Renders every match into a single numbered contact sheet on a checkerboard
(so white and transparent sprites stay visible), then **read that one image**
and choose by number. This is the whole point: one read instead of forty.

**4. Take what you picked**

```bash
scripts/find_asset.py tree --pick 3,7 --copy public/assets/
```

Indices refer to the listing from the same search. Copying also appends
provenance to `CREDITS.md` in the destination.

## Judgement calls

- **Style coherence beats individual fit.** Prefer several assets from *one
  pack* over the best individual match from five different packs. Mixed line
  weights and palettes look broken even when each sprite is good. If you must
  mix, say so and check the result.
- **Only generate what the library lacks.** A common good outcome: tiles, UI,
  props and audio all come from the library; one custom mascot is generated to
  match it. Pass an existing library sprite as `--ref` so the generated asset
  adopts the pack's style.
- **Check dimensions before committing to a pack.** Tile sizes vary (16/32/64);
  mixing grid sizes causes alignment pain later. Use `--min`/`--max`/`--square`.
- **Watch for packed spritesheets.** Large `spritesheet.png` files need slicing,
  usually via an accompanying `.xml`/`.json` map. `--no-sheets` filters them out
  when you want individual files.
- **The index can go stale.** If a search returns a path that is missing on
  disk, re-run `index_library.py`.

## Licensing

CC0 means public domain: no attribution required, commercial and classroom use
fine, redistribution fine. Two things still matter:

- **Confirm the licence for the specific library.** Do not assume every folder
  a user points at is CC0. Check for a `License.txt` in the pack.
- **CC0 covers the artwork, not trademarks.** Assets resembling a company's
  characters or logos are still not usable as that character.

`--copy` writes a `CREDITS.md` recording pack and original path. Not legally
required, but it makes the asset set reproducible and is good practice to model
for students.

## Accessibility still applies

Library assets are not automatically accessible. Everything in the main skill
holds: alt text on every asset, no meaning conveyed by colour alone, and
contrast checked against your actual background rather than the pack's preview.
