#!/usr/bin/env python3
"""
index_library.py — make a large CC0 asset library searchable.

Point it at an unzipped asset library (Kenney's All-in-1, or any folder of
packs) and it writes a one-line-per-asset JSONL index. After that, finding an
asset is a text search over the index instead of opening thousands of files.

    index_library.py ~/assets/kenney
    index_library.py ~/assets/kenney --colors        # slower, adds palette data

Writes <root>/asset-index.jsonl by default. The format is deliberately
greppable — `grep tree asset-index.jsonl` works — and each line is valid JSON.

Requires Pillow for image dimensions:  pip install Pillow
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("error: this script needs Pillow.\n"
          "       pip install Pillow    (or: pip install --break-system-packages Pillow)",
          file=sys.stderr)
    sys.exit(1)

Image.MAX_IMAGE_PIXELS = None  # asset sheets are legitimately huge

RASTER = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tga"}
VECTOR = {".svg"}
AUDIO = {".ogg", ".wav", ".mp3", ".flac"}
MODEL = {".obj", ".fbx", ".gltf", ".glb", ".dae", ".blend"}
FONT = {".ttf", ".otf", ".woff", ".woff2"}
DATA = {".xml", ".json", ".tsx", ".tmx", ".atlas", ".fnt"}

KIND = [(RASTER, "image"), (VECTOR, "vector"), (AUDIO, "audio"),
        (MODEL, "model"), (FONT, "font"), (DATA, "data")]

SHEET_HINTS = ("sheet", "spritesheet", "tilesheet", "tilemap", "atlas", "packed")
SKIP_DIRS = {"__macosx", ".git", ".svn", "node_modules"}

TOKEN_RE = re.compile(r"[A-Za-z][a-z]+|[A-Za-z]+(?![a-z])|\d+")


def die(msg: str) -> "NoReturn":  # type: ignore[valid-type]
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(1)


def kind_of(ext: str) -> str:
    for exts, name in KIND:
        if ext in exts:
            return name
    return "other"


def tokenize(rel: Path) -> list[str]:
    """Searchable words from the whole path, camelCase-aware.

    Kenney names things like `platformerPack_industrial/PNG/Tiles/grassMid.png`,
    so the directory names carry as much meaning as the filename.
    """
    raw = " ".join(rel.parts).replace("_", " ").replace("-", " ")
    words = {w.lower() for w in TOKEN_RE.findall(raw) if len(w) > 1}
    return sorted(words)


def dominant_colors(im: Image.Image, n: int = 3) -> list[str]:
    small = im.convert("RGBA").resize((32, 32), Image.NEAREST)
    px = [p for p in small.getdata() if p[3] > 128]
    if not px:
        return []
    q = Image.new("RGB", (len(px), 1))
    q.putdata([p[:3] for p in px])
    q = q.quantize(colors=n, method=Image.MEDIANCUT)
    pal = q.getpalette() or []
    counts = sorted(q.getcolors() or [], reverse=True)
    out = []
    for _, idx in counts[:n]:
        r, g, b = pal[idx * 3:idx * 3 + 3]
        out.append(f"#{r:02X}{g:02X}{b:02X}")
    return out


def probe(path: Path, root: Path, want_colors: bool) -> dict | None:
    ext = path.suffix.lower()
    kind = kind_of(ext)
    if kind == "other":
        return None
    rel = path.relative_to(root)
    rec: dict = {
        "path": str(rel),
        "pack": rel.parts[0] if len(rel.parts) > 1 else "(root)",
        "name": path.stem,
        "ext": ext.lstrip("."),
        "kind": kind,
        "tokens": tokenize(rel),
    }
    try:
        rec["bytes"] = path.stat().st_size
    except OSError:
        rec["bytes"] = 0

    if kind == "image":
        try:
            with Image.open(path) as im:
                rec["w"], rec["h"] = im.width, im.height
                rec["alpha"] = im.mode in ("RGBA", "LA", "P")
                if want_colors or (im.width * im.height) <= 512 * 512:
                    im2 = im.convert("RGBA")
                    a = im2.getchannel("A")
                    bbox = a.getbbox()
                    # How much of the canvas the artwork actually fills. Useful
                    # for spotting mostly-empty frames and oversized canvases.
                    if bbox:
                        rec["content"] = round(
                            ((bbox[2] - bbox[0]) * (bbox[3] - bbox[1]))
                            / max(1, im.width * im.height), 3)
                    else:
                        rec["content"] = 0.0
                    if want_colors:
                        rec["colors"] = dominant_colors(im2)
            low = rec["name"].lower()
            rec["sheet"] = (any(h in low for h in SHEET_HINTS)
                            or rec["w"] * rec["h"] > 1024 * 1024)
        except Exception as exc:                      # corrupt or exotic file
            rec["error"] = type(exc).__name__
    return rec


def main() -> None:
    ap = argparse.ArgumentParser(
        prog="index_library.py",
        description="Build a searchable index of a large asset library.")
    ap.add_argument("root", help="the unzipped library directory")
    ap.add_argument("--out", help="index path (default: <root>/asset-index.jsonl)")
    ap.add_argument("--colors", action="store_true",
                    help="also record dominant colours (much slower)")
    ap.add_argument("--workers", type=int, default=8, help="parallel readers (default: 8)")
    args = ap.parse_args()

    root = Path(args.root).expanduser().resolve()
    if not root.is_dir():
        die(f"not a directory: {root}")
    out = Path(args.out).expanduser() if args.out else root / "asset-index.jsonl"

    print(f"scanning {root} ...", file=sys.stderr)
    files: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d.lower() not in SKIP_DIRS
                       and not d.startswith(".")]
        for fn in filenames:
            if not fn.startswith("."):
                files.append(Path(dirpath) / fn)
    print(f"found {len(files)} files; probing...", file=sys.stderr)

    packs: dict[str, int] = {}
    kinds: dict[str, int] = {}
    written = 0
    with out.open("w", encoding="utf-8") as fh, \
            ThreadPoolExecutor(max_workers=args.workers) as pool:
        for i, rec in enumerate(pool.map(lambda p: probe(p, root, args.colors), files)):
            if rec is None:
                continue
            fh.write(json.dumps(rec, separators=(",", ":")) + "\n")
            written += 1
            packs[rec["pack"]] = packs.get(rec["pack"], 0) + 1
            kinds[rec["kind"]] = kinds.get(rec["kind"], 0) + 1
            if written % 2000 == 0:
                print(f"  {written} indexed...", file=sys.stderr)

    summary = {"root": str(root), "assets": written,
               "packs": len(packs), "kinds": kinds,
               "top_packs": sorted(packs.items(), key=lambda kv: -kv[1])[:15]}
    (out.with_suffix(".summary.json")).write_text(
        json.dumps(summary, indent=2) + "\n", encoding="utf-8")

    print(f"\nindexed {written} assets from {len(packs)} packs", file=sys.stderr)
    for k, v in sorted(kinds.items(), key=lambda kv: -kv[1]):
        print(f"  {k:8s} {v}", file=sys.stderr)
    print(f"\nindex:   {out}", file=sys.stderr)
    print(f"summary: {out.with_suffix('.summary.json')}", file=sys.stderr)
    print(out)


if __name__ == "__main__":
    main()
