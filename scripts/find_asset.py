#!/usr/bin/env python3
"""
find_asset.py — search an indexed asset library, and look at the results.

    find_asset.py tree                          # what's there
    find_asset.py tree --kind image --min 64
    find_asset.py tree --sheet /tmp/trees.png   # ONE image showing 40 candidates
    find_asset.py tree --pick 3,7 --copy public/assets/

The --sheet flag is the important one. Opening 40 sprites costs 40 image reads;
a contact sheet costs one. Search, render a sheet, look at it, pick by number.

Requires Pillow for --sheet:  pip install Pillow
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

INDEX_NAMES = ("asset-index.jsonl",)


def die(msg: str) -> "NoReturn":  # type: ignore[valid-type]
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(1)


def info(msg: str) -> None:
    print(msg, file=sys.stderr)


def locate_index(explicit: str | None) -> Path:
    if explicit:
        p = Path(explicit).expanduser()
        if p.is_dir():
            for n in INDEX_NAMES:
                if (p / n).is_file():
                    return p / n
            die(f"no index in {p}. Run index_library.py first.")
        if not p.is_file():
            die(f"index not found: {p}")
        return p

    # search cwd, then ancestors, then a config pointer
    here = Path.cwd().resolve()
    for d in [here, *here.parents]:
        for n in INDEX_NAMES:
            if (d / n).is_file():
                return d / n
        cfg = d / "assets.config.json"
        if cfg.is_file():
            try:
                lib = json.loads(cfg.read_text(encoding="utf-8")).get("asset_library")
            except json.JSONDecodeError:
                lib = None
            if lib:
                lp = Path(lib).expanduser()
                for n in INDEX_NAMES:
                    if (lp / n).is_file():
                        return lp / n
    die("no asset-index.jsonl found. Run index_library.py on your library, or "
        'set "asset_library": "/path/to/library" in assets.config.json.')


def load(index: Path) -> list[dict]:
    out = []
    with index.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    return out


def matches(rec: dict, terms: list[str], args) -> bool:
    hay = rec["path"].lower() + " " + " ".join(rec.get("tokens", []))
    for t in terms:
        if t.startswith("-"):
            if t[1:] in hay:
                return False
        elif t not in hay:
            return False
    if args.kind and rec.get("kind") != args.kind:
        return False
    if args.pack and args.pack.lower() not in rec.get("pack", "").lower():
        return False
    if args.ext and rec.get("ext") != args.ext.lstrip("."):
        return False
    w, h = rec.get("w"), rec.get("h")
    if args.min is not None and (w is None or min(w, h) < args.min):
        return False
    if args.max is not None and (w is None or max(w, h) > args.max):
        return False
    if args.square and (w is None or w != h):
        return False
    if args.alpha and not rec.get("alpha"):
        return False
    if args.no_sheets and rec.get("sheet"):
        return False
    return True


def build_sheet(recs: list[dict], root: Path, dest: Path, cols: int,
                cell: int) -> None:
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        die("--sheet needs Pillow.  pip install Pillow")

    n = len(recs)
    cols = max(1, min(cols, n))
    rows = (n + cols - 1) // cols
    label_h = 16
    cw, ch = cell, cell + label_h
    sheet = Image.new("RGB", (cols * cw, rows * ch), (32, 32, 36))
    draw = ImageDraw.Draw(sheet)

    # Checkerboard behind each thumbnail, or white-on-white sprites vanish.
    tile = Image.new("RGB", (cell, cell), (210, 210, 214))
    td = ImageDraw.Draw(tile)
    for y in range(0, cell, 12):
        for x in range(0, cell, 12):
            if (x // 12 + y // 12) % 2 == 0:
                td.rectangle([x, y, x + 11, y + 11], fill=(178, 178, 184))

    for i, rec in enumerate(recs):
        c, r = i % cols, i // cols
        ox, oy = c * cw, r * ch
        sheet.paste(tile, (ox, oy))
        src = root / rec["path"]
        try:
            with Image.open(src) as im:
                im = im.convert("RGBA")
                im.thumbnail((cell - 8, cell - 8), Image.LANCZOS)
                sheet.paste(im, (ox + (cell - im.width) // 2,
                                 oy + (cell - im.height) // 2), im)
        except Exception:
            draw.text((ox + 6, oy + cell // 2), "unreadable", fill=(120, 0, 0))
        name = rec["name"][:22]
        draw.rectangle([ox, oy + cell, ox + cw, oy + ch], fill=(20, 20, 24))
        draw.text((ox + 4, oy + cell + 3), f"[{i}] {name}", fill=(235, 235, 240))

    dest.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(dest)
    info(f"contact sheet: {dest}  ({cols}x{rows}, {n} assets)")


def main() -> None:
    ap = argparse.ArgumentParser(
        prog="find_asset.py",
        description="Search an indexed asset library and preview matches.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""search terms are ANDed; prefix a term with - to exclude it:
  find_asset.py tree pine -sheet
  find_asset.py button ui --kind image --min 32 --sheet /tmp/buttons.png
  find_asset.py character walk --pack platformer --pick 0,4 --copy public/assets/
""")
    ap.add_argument("terms", nargs="*", help="words to match against path and name")
    ap.add_argument("--index", help="index file or library dir (default: auto-locate)")
    ap.add_argument("--kind", choices=["image", "vector", "audio", "model", "font", "data"])
    ap.add_argument("--pack", help="restrict to packs whose name contains this")
    ap.add_argument("--ext", help="file extension, e.g. png")
    ap.add_argument("--min", type=int, help="minimum of width/height, px")
    ap.add_argument("--max", type=int, help="maximum of width/height, px")
    ap.add_argument("--square", action="store_true", help="only square images")
    ap.add_argument("--alpha", action="store_true", help="only images with transparency")
    ap.add_argument("--no-sheets", action="store_true",
                    help="exclude packed spritesheets and huge images")
    ap.add_argument("--limit", type=int, default=40, help="max results (default: 40)")
    ap.add_argument("--sheet", metavar="PATH", help="render matches as one contact sheet PNG")
    ap.add_argument("--sheet-cols", type=int, default=8, help="columns (default: 8)")
    ap.add_argument("--cell", type=int, default=96, help="thumbnail cell px (default: 96)")
    ap.add_argument("--pick", help="comma-separated result indices, e.g. 0,3,7")
    ap.add_argument("--copy", metavar="DIR", help="copy picked (or all) matches here")
    ap.add_argument("--json", action="store_true", help="print full records as JSON")
    ap.add_argument("--packs", action="store_true", help="list packs and counts, then exit")
    args = ap.parse_args()

    index = locate_index(args.index)
    root = index.parent
    recs = load(index)
    if not recs:
        die(f"index is empty: {index}")

    if args.packs:
        counts: dict[str, int] = {}
        for r in recs:
            counts[r["pack"]] = counts.get(r["pack"], 0) + 1
        for pack, n in sorted(counts.items(), key=lambda kv: -kv[1]):
            print(f"{n:7d}  {pack}")
        return

    terms = [t.lower() for t in args.terms]
    hits = [r for r in recs if matches(r, terms, args)]
    total = len(hits)
    hits.sort(key=lambda r: (len(r["path"]), r["path"]))
    hits = hits[:args.limit]

    if not hits:
        info(f"no matches in {len(recs)} assets. Try fewer terms, or --packs to "
             f"see what the library contains.")
        return

    if args.pick:
        try:
            idxs = [int(x) for x in args.pick.split(",") if x.strip() != ""]
        except ValueError:
            die("--pick takes comma-separated integers, e.g. --pick 0,3,7")
        bad = [i for i in idxs if i < 0 or i >= len(hits)]
        if bad:
            die(f"--pick index out of range: {bad} (0..{len(hits)-1})")
        hits = [hits[i] for i in idxs]
        info(f"{total} matches; picked {len(hits)} (library: {root})")
    else:
        info(f"{total} matches, showing {len(hits)} (library: {root})")
        if total > len(hits):
            info(f"note: {total - len(hits)} more not shown — raise --limit or "
                 f"narrow the search.")

    if args.sheet:
        imgs = [r for r in hits if r.get("kind") in ("image", "vector")]
        if not imgs:
            info("no previewable images among the matches; skipping the sheet")
        else:
            build_sheet(imgs, root, Path(args.sheet).expanduser(),
                        args.sheet_cols, args.cell)

    for i, r in enumerate(hits):
        if args.json:
            print(json.dumps(r))
        else:
            dims = f"{r.get('w','?')}x{r.get('h','?')}" if r.get("kind") == "image" else r["kind"]
            print(f"[{i}] {dims:>11}  {r['path']}")

    if args.copy:
        dest = Path(args.copy).expanduser()
        dest.mkdir(parents=True, exist_ok=True)
        copied = []
        for r in hits:
            src = root / r["path"]
            if not src.is_file():
                info(f"missing on disk, skipped: {r['path']}")
                continue
            target = dest / src.name
            k = 2
            while target.exists():
                target = dest / f"{src.stem}-{k}{src.suffix}"
                k += 1
            shutil.copy2(src, target)
            copied.append((r, target))
        info(f"copied {len(copied)} file(s) to {dest}")

        # CC0 needs no attribution, but recording provenance is good practice
        # and makes the set reproducible.
        credits = dest / "CREDITS.md"
        lines = [] if credits.exists() else [
            "# Asset credits\n",
            "\nAssets below are from a CC0 (public domain) library — attribution is\n"
            "not legally required, but is recorded here for provenance.\n\n"]
        for r, t in copied:
            lines.append(f"- `{t.name}` — {r['pack']} (`{r['path']}`)\n")
        with credits.open("a", encoding="utf-8") as fh:
            fh.writelines(lines)
        info(f"provenance appended to {credits}")


if __name__ == "__main__":
    main()
