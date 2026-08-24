#!/usr/bin/env python3
"""Remove a baked-in fake 'transparency checkerboard' background from generated
PNGs by flood-filling from the image border across the checker tones, then
writing true alpha. Local and free; used when an image model ignores the
transparent-background instruction and paints the checker pattern instead.

Usage: strip_checker_bg.py IMG [IMG...]   (overwrites in place, keeps a .bak)
"""

import sys
from collections import deque
from pathlib import Path

from PIL import Image


def dominant_border_colors(im, k=4, distinct=30):
    """Up to k mutually-distinct common colors from a wide border band — catches
    BOTH tones of a fake checkerboard, not just shades of the brightest one."""
    w, h = im.size
    counts = {}
    ring = max(24, w // 12)  # wide enough to include at least one checker square
    px = im.load()
    for x in range(0, w, 2):
        for y in list(range(0, ring, 2)) + list(range(h - ring, h, 2)):
            c = px[x, y][:3]
            counts[c] = counts.get(c, 0) + 1
    for y in range(0, h, 2):
        for x in list(range(0, ring, 2)) + list(range(w - ring, w, 2)):
            c = px[x, y][:3]
            counts[c] = counts.get(c, 0) + 1
    refs = []
    for c, _ in sorted(counts.items(), key=lambda kv: -kv[1]):
        if all(max(abs(c[i] - r[i]) for i in range(3)) > distinct for r in refs):
            refs.append(c)
            if len(refs) == k:
                break
    return refs


def close(c, ref, tol):
    return abs(c[0] - ref[0]) <= tol and abs(c[1] - ref[1]) <= tol and abs(c[2] - ref[2]) <= tol


def strip(path: Path, tol=26):
    im = Image.open(path).convert('RGBA')
    w, h = im.size
    px = im.load()
    refs = dominant_border_colors(im)

    def is_bg(c):
        return any(close(c, r, tol) for r in refs)

    seen = bytearray(w * h)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if is_bg(px[x, y][:3]):
                q.append((x, y))
                seen[y * w + x] = 1
    for y in range(h):
        for x in (0, w - 1):
            if is_bg(px[x, y][:3]) and not seen[y * w + x]:
                q.append((x, y))
                seen[y * w + x] = 1

    while q:
        x, y = q.popleft()
        px[x, y] = (0, 0, 0, 0)
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx]:
                if is_bg(px[nx, ny][:3]):
                    seen[ny * w + nx] = 1
                    q.append((nx, ny))

    # Soften the cut edge: 1px alpha feather where transparent meets opaque.
    alpha = im.getchannel('A')
    from PIL import ImageFilter

    soft = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.6))
    im.putalpha(soft)

    bak = path.with_suffix('.png.bak')
    if not bak.exists():
        path.rename(bak)
    im.save(path)
    ratio = sum(1 for v in soft.getdata() if v < 16) / (w * h)
    print(f'{path.name}: removed {ratio:.0%} as background (tones {refs})')


if __name__ == '__main__':
    for arg in sys.argv[1:]:
        strip(Path(arg))
