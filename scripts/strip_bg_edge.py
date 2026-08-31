#!/usr/bin/env python3
"""
Remove a flat background by flooding inward from the image border.

Why this exists alongside strip_checker_bg.py: that script decides what is
background by picking the most FREQUENT tones in the image. A character with a
large block of solid colour — Taro's black hair — makes that colour frequent,
so it gets erased along with the backdrop, leaving a hole you only notice once
the sprite is on screen. It has silently eaten his hair twice.

Flooding from the edge can only ever remove pixels connected to the border, so
an interior colour is safe no matter how much of the image it covers.

    python scripts/strip_bg_edge.py path.png [--tolerance 228] [--size 256]

Writes path.png.bak once, then overwrites path.png.
"""
import argparse
import shutil
from collections import deque
from pathlib import Path

from PIL import Image


def is_background(px, tolerance: int) -> bool:
    r, g, b, a = px
    if a < 8:
        return True
    if r > tolerance and g > tolerance and b > tolerance:
        return True
    # The mid-grey square of a baked-in "transparency" checkerboard.
    if abs(r - g) < 10 and abs(g - b) < 10 and 178 < r <= tolerance:
        return True
    return False


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("path")
    ap.add_argument("--tolerance", type=int, default=228,
                    help="channel value at or above which a grey counts as background")
    ap.add_argument("--size", type=int, default=0, help="also resize to NxN")
    args = ap.parse_args()

    path = Path(args.path)
    backup = path.with_suffix(path.suffix + ".bak")
    if not backup.exists():
        shutil.copy2(path, backup)

    im = Image.open(path).convert("RGBA")
    w, h = im.size
    px = im.load()

    seen = bytearray(w * h)
    q = deque()

    def push(x, y):
        if not seen[y * w + x] and is_background(px[x, y], args.tolerance):
            seen[y * w + x] = 1
            q.append((x, y))

    for x in range(w):
        push(x, 0)
        push(x, h - 1)
    for y in range(h):
        push(0, y)
        push(w - 1, y)

    cleared = 0
    while q:
        x, y = q.popleft()
        px[x, y] = (255, 255, 255, 0)
        cleared += 1
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h:
                push(nx, ny)

    if args.size:
        im = im.resize((args.size, args.size), Image.LANCZOS)
    im.save(path, optimize=True)
    pct = round(100 * cleared / (w * h))
    print(f"{path.name}: cleared {cleared} border pixels ({pct}% of the image); "
          f"interior colours untouched")


if __name__ == "__main__":
    main()
