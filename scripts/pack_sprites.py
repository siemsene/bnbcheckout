#!/usr/bin/env python3
"""
pack_sprites.py — turn a folder of frames into a sprite sheet.

Local image processing only. No API calls, nothing to pay for, deterministic:
same inputs always give the same sheet.

    pack_sprites.py public/assets/frames/fox-run
    pack_sprites.py frames/ --columns 4 --format phaser --out public/sprites/fox

Emits <name>.png (the atlas) plus, depending on --format:
    phaser  <name>.json   Phaser 3 / Pixi "JSON Hash" texture atlas
    array   <name>.json   TexturePacker "JSON Array"
    css     <name>.css    background-position steps() animation, no engine needed
    all     all of the above

Requires Pillow:  pip install Pillow
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("error: this script needs Pillow.\n"
          "       pip install Pillow    (or: pip install --break-system-packages Pillow)",
          file=sys.stderr)
    sys.exit(1)

IMAGE_EXTS = {".png", ".webp", ".gif"}


def die(msg: str) -> "NoReturn":  # type: ignore[valid-type]
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(1)


def info(msg: str) -> None:
    print(msg, file=sys.stderr)


def collect_frames(src: Path, frameset_order: bool = True) -> list[Path]:
    """Frames in a stable order: frameset.json if present, else filename sort."""
    if src.is_file():
        return [src]
    if not src.is_dir():
        die(f"not found: {src}")

    manifest = src / "frameset.json"
    if frameset_order and manifest.is_file():
        try:
            names = json.loads(manifest.read_text(encoding="utf-8")).get("frames", [])
        except json.JSONDecodeError:
            names = []
        paths = [src / n for n in names if (src / n).is_file()]
        if paths:
            return paths

    return sorted(p for p in src.iterdir()
                  if p.suffix.lower() in IMAGE_EXTS and not p.name.startswith("."))


def load_fps(src: Path, fallback: int) -> int:
    manifest = src / "frameset.json" if src.is_dir() else None
    if manifest and manifest.is_file():
        try:
            return int(json.loads(manifest.read_text(encoding="utf-8")).get("fps", fallback))
        except (json.JSONDecodeError, TypeError, ValueError):
            pass
    return fallback


def alpha_bbox(im: Image.Image) -> tuple[int, int, int, int] | None:
    """Bounding box of non-transparent pixels."""
    if im.mode != "RGBA":
        return im.getbbox()
    return im.getchannel("A").getbbox()


def main() -> None:
    ap = argparse.ArgumentParser(
        prog="pack_sprites.py",
        description="Pack a folder of frames into a sprite sheet with metadata.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""notes:
  Frames are ordered by frameset.json when present, otherwise by filename —
  so keep the 01-, 02- prefixes that gen_asset.py writes.

  --trim (default) crops transparent padding from every frame, then centres
  each one in a uniform cell. That keeps the sprite from wobbling when played,
  which is the usual cause of "my walk cycle looks drunk".
""")
    ap.add_argument("src", help="directory of frames (or a single image)")
    ap.add_argument("--out", help="output path without extension "
                                  "(default: alongside src, named after it)")
    ap.add_argument("--columns", type=int, default=0,
                    help="cells per row (default: a single horizontal strip)")
    ap.add_argument("--padding", type=int, default=0,
                    help="transparent gutter between cells, px (default: 0)")
    ap.add_argument("--format", choices=["phaser", "array", "css", "all"],
                    default="phaser", help="metadata format (default: phaser)")
    ap.add_argument("--fps", type=int, default=8,
                    help="frames per second for the CSS animation (default: from "
                         "frameset.json, else 8)")
    ap.add_argument("--no-trim", dest="trim", action="store_false",
                    help="keep each frame's original bounds instead of trimming alpha")
    ap.add_argument("--scale", type=float, default=1.0,
                    help="scale every frame before packing, e.g. 0.5 (default: 1.0)")
    ap.add_argument("--max-width", type=int, default=8192,
                    help="fail if the atlas would exceed this width (default: 8192)")
    args = ap.parse_args()

    src = Path(args.src).expanduser()
    paths = collect_frames(src)
    if not paths:
        die(f"no images found in {src}")

    info(f"packing {len(paths)} frames from {src}")

    # ---- load, scale, trim ------------------------------------------------
    frames: list[tuple[str, Image.Image]] = []
    for p in paths:
        im = Image.open(p).convert("RGBA")
        if args.scale != 1.0:
            im = im.resize((max(1, round(im.width * args.scale)),
                            max(1, round(im.height * args.scale))),
                           Image.LANCZOS)
        if args.trim:
            box = alpha_bbox(im)
            if box is None:
                info(f"  warning: {p.name} is fully transparent — skipped")
                continue
            im = im.crop(box)
        frames.append((p.stem, im))

    if not frames:
        die("every frame was empty after trimming")

    # ---- uniform cell -----------------------------------------------------
    cell_w = max(im.width for _, im in frames)
    cell_h = max(im.height for _, im in frames)
    cols = args.columns if args.columns > 0 else len(frames)
    cols = max(1, min(cols, len(frames)))
    rows = math.ceil(len(frames) / cols)

    pad = max(0, args.padding)
    sheet_w = cols * cell_w + (cols - 1) * pad
    sheet_h = rows * cell_h + (rows - 1) * pad
    if sheet_w > args.max_width:
        die(f"atlas would be {sheet_w}px wide (limit {args.max_width}). "
            f"Use --columns to wrap, or --scale to shrink.")

    sheet = Image.new("RGBA", (sheet_w, sheet_h), (0, 0, 0, 0))
    entries = []
    for i, (name, im) in enumerate(frames):
        c, r = i % cols, i // cols
        cx = c * (cell_w + pad)
        cy = r * (cell_h + pad)
        # Centre horizontally, sit on the cell floor: keeps feet on the ground
        # across frames of differing height, which is what the eye tracks.
        ox = cx + (cell_w - im.width) // 2
        oy = cy + (cell_h - im.height)
        sheet.paste(im, (ox, oy), im)
        entries.append({"name": name, "x": cx, "y": cy,
                        "w": cell_w, "h": cell_h, "index": i})

    # ---- write ------------------------------------------------------------
    if args.out:
        out_base = Path(args.out).expanduser()
    else:
        stem = src.stem if src.is_dir() else src.parent.name
        out_base = (src.parent if src.is_dir() else src.parent) / stem
    out_base.parent.mkdir(parents=True, exist_ok=True)

    png_path = out_base.with_suffix(".png")
    sheet.save(png_path, optimize=True)
    info(f"  atlas: {png_path}  ({sheet_w}x{sheet_h}, {cols}x{rows} cells of "
         f"{cell_w}x{cell_h})")

    fps = args.fps if args.fps != 8 else load_fps(src, 8)
    written = [png_path]
    want = {"phaser", "array", "css"} if args.format == "all" else {args.format}

    if "phaser" in want:
        data = {
            "frames": {
                e["name"]: {
                    "frame": {"x": e["x"], "y": e["y"], "w": e["w"], "h": e["h"]},
                    "rotated": False, "trimmed": False,
                    "spriteSourceSize": {"x": 0, "y": 0, "w": e["w"], "h": e["h"]},
                    "sourceSize": {"w": e["w"], "h": e["h"]},
                } for e in entries
            },
            "meta": {"image": png_path.name, "format": "RGBA8888",
                     "size": {"w": sheet_w, "h": sheet_h}, "scale": "1",
                     "frameRate": fps, "frameOrder": [e["name"] for e in entries]},
        }
        jp = out_base.with_suffix(".json")
        jp.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
        written.append(jp)

    if "array" in want:
        data = {
            "frames": [{
                "filename": e["name"],
                "frame": {"x": e["x"], "y": e["y"], "w": e["w"], "h": e["h"]},
                "rotated": False, "trimmed": False,
                "spriteSourceSize": {"x": 0, "y": 0, "w": e["w"], "h": e["h"]},
                "sourceSize": {"w": e["w"], "h": e["h"]},
            } for e in entries],
            "meta": {"image": png_path.name, "format": "RGBA8888",
                     "size": {"w": sheet_w, "h": sheet_h}, "scale": "1",
                     "frameRate": fps},
        }
        jp = out_base.with_name(out_base.name + ".array.json")
        jp.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
        written.append(jp)

    if "css" in want:
        cls = out_base.stem.replace("_", "-")
        dur = round(len(frames) / max(1, fps), 3)
        css = f""".{cls} {{
  width: {cell_w}px;
  height: {cell_h}px;
  background-image: url("{png_path.name}");
  background-repeat: no-repeat;
  animation: {cls}-play {dur}s steps({len(frames)}) infinite;
}}

@keyframes {cls}-play {{
  from {{ background-position: 0 0; }}
  to   {{ background-position: -{cols * (cell_w + pad)}px 0; }}
}}

/* Required: some students get migraines or seizures from looping motion.
   The app mirrors prefers-reduced-motion (plus the in-app override) onto
   <html data-motion> — see src/state/motionStore.ts. */
[data-motion='reduced'] .{cls} {{ animation: none; background-position: 0 0; }}
"""
        if rows > 1:
            css = ("/* NOTE: this sheet has multiple rows; the CSS steps() "
                   "animation below only walks row 1.\n"
                   "   Re-pack with the default single strip for CSS use. */\n") + css
        cp = out_base.with_suffix(".css")
        cp.write_text(css, encoding="utf-8")
        written.append(cp)

    for w in written[1:]:
        info(f"  meta:  {w}")
    for w in written:
        print(w)


if __name__ == "__main__":
    main()
