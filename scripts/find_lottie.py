#!/usr/bin/env python3
"""
find_lottie.py — search the public LottieFiles library and pull animations in.

    find_lottie.py "loading spinner"                       # list matches
    find_lottie.py "success checkmark" --sheet /tmp/c.png  # ONE image to look at
    find_lottie.py "success checkmark" --preview /tmp/pick # live HTML, real motion
    find_lottie.py --pick 2,5 --download public/animations/

Uses the public GraphQL endpoint — no account, no API key. Results from the
last search are cached, so --pick works without repeating the query.

Note what a still preview can and cannot tell you: the contact sheet shows one
frame. Timing, easing and loop quality are invisible in it. Use --preview to
render the candidates as actually-animating HTML and have a human confirm.

Pillow is needed only for --sheet:  pip install Pillow
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ENDPOINT = "https://graphql.lottiefiles.com/2022-08"
UA = "Mozilla/5.0 (compatible; classroom-assets-kit/1.0)"
CACHE = ".lottie-search.json"
TIMEOUT = 30

QUERY = """
query Search($q: String!, $n: Int, $after: String) {
  searchPublicAnimations(query: $q, first: $n, after: $after) {
    totalCount
    pageInfo { hasNextPage endCursor }
    edges { node {
      id name url jsonUrl lottieUrl imageUrl gifUrl
      frameRate downloads likesCount createdBy { username }
    } }
  }
}
"""

LICENSE_NOTE = (
    "Animations are provided under the Lottie Simple License (lottiefiles.com/page/license):\n"
    "commercial use permitted, attribution optional but encouraged, derivative works must\n"
    "carry the same terms, and you may not re-publish these as a competing asset library.\n"
    "Verify the licence on an animation's own page before shipping anything high-stakes.\n"
)


def die(msg: str) -> "NoReturn":  # type: ignore[valid-type]
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(1)


def info(msg: str) -> None:
    print(msg, file=sys.stderr)


def slug(s: str, n: int = 48) -> str:
    out = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return (out[:n].rstrip("-")) or "animation"


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return r.read()


def search(query: str, limit: int, after: str | None) -> dict:
    payload = {"query": QUERY, "variables": {"q": query, "n": limit, "after": after}}
    req = urllib.request.Request(
        ENDPOINT, data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            data = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        die(f"search failed (HTTP {exc.code}): "
            f"{exc.read().decode('utf-8', 'replace')[:300]}")
    except urllib.error.URLError as exc:
        die(f"network error reaching LottieFiles: {exc.reason}")
    if data.get("errors"):
        die("GraphQL error: " + json.dumps(data["errors"])[:400])
    res = (data.get("data") or {}).get("searchPublicAnimations")
    if res is None:
        die("unexpected response shape:\n" + json.dumps(data)[:400])
    return res


def build_sheet(nodes: list[dict], dest: Path, cols: int, cell: int) -> None:
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        die("--sheet needs Pillow.  pip install Pillow")

    import io
    n = len(nodes)
    cols = max(1, min(cols, n))
    rows = (n + cols - 1) // cols
    label = 16
    cw, ch = cell, cell + label
    sheet = Image.new("RGB", (cols * cw, rows * ch), (30, 30, 34))
    draw = ImageDraw.Draw(sheet)

    # Light cells: most Lottie previews are dark line art on transparency.
    tile = Image.new("RGB", (cell, cell), (240, 240, 243))

    for i, nd in enumerate(nodes):
        c, r = i % cols, i // cols
        ox, oy = c * cw, r * ch
        sheet.paste(tile, (ox, oy))
        try:
            im = Image.open(io.BytesIO(fetch(nd["imageUrl"]))).convert("RGBA")
            im.thumbnail((cell - 8, cell - 8), Image.LANCZOS)
            bg = Image.new("RGBA", im.size, (240, 240, 243, 255))
            bg.alpha_composite(im)
            sheet.paste(bg.convert("RGB"),
                        (ox + (cell - im.width) // 2, oy + (cell - im.height) // 2))
        except Exception:
            draw.text((ox + 8, oy + cell // 2), "no preview", fill=(150, 40, 40))
        draw.rectangle([ox, oy + cell, ox + cw, oy + ch], fill=(18, 18, 22))
        draw.text((ox + 4, oy + cell + 3), f"[{i}] {nd['name'][:22]}",
                  fill=(235, 235, 240))

    dest.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(dest)
    info(f"contact sheet: {dest}  ({cols}x{rows}, {n} animations)")
    info("note: this is ONE FRAME each. Motion quality is not visible — "
         "use --preview before committing.")


def build_preview(nodes: list[dict], dest: Path) -> None:
    """A local page that plays the candidates for real, for a human to judge."""
    dest.mkdir(parents=True, exist_ok=True)
    cards = []
    for i, nd in enumerate(nodes):
        cards.append(f"""
    <figure>
      <dotlottie-player src="{html.escape(nd['lottieUrl'])}" autoplay loop
                        background="transparent" speed="1"></dotlottie-player>
      <figcaption>
        <b>[{i}]</b> {html.escape(nd['name'])}<br>
        <a href="{html.escape(nd['url'])}" target="_blank" rel="noopener">source</a>
        &middot; {nd.get('downloads', 0)} downloads
      </figcaption>
    </figure>""")

    page = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Lottie candidates</title>
<script src="https://unpkg.com/@dotlottie/player-component@2.7.12/dist/dotlottie-player.mjs"
        type="module"></script>
<style>
  body {{ font: 15px/1.5 system-ui, sans-serif; margin: 2rem; background: #fafafa; color: #222; }}
  h1 {{ font-size: 1.25rem; }}
  .grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1.25rem; }}
  figure {{ margin: 0; background: #fff; border: 1px solid #e3e3e6; border-radius: 10px; padding: .75rem; }}
  dotlottie-player {{ width: 100%; height: 160px; }}
  figcaption {{ font-size: .8rem; color: #555; margin-top: .5rem; }}
  p.note {{ color: #666; font-size: .85rem; max-width: 60ch; }}
</style></head>
<body>
<h1>Lottie candidates &mdash; pick by number</h1>
<p class="note">These are playing for real. Judge timing, easing and loop
quality here; a still frame cannot show them. Then run
<code>find_lottie.py --pick N,M --download DIR</code>.</p>
<div class="grid">{''.join(cards)}
</div>
</body></html>
"""
    out = dest / "index.html"
    out.write_text(page, encoding="utf-8")
    info(f"preview page: {out}")
    info("open it in a browser to see the animations actually move.")


def main() -> None:
    ap = argparse.ArgumentParser(
        prog="find_lottie.py",
        description="Search the public LottieFiles library and download animations.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""typical flow:
  find_lottie.py "success checkmark" --limit 24 --sheet /tmp/c.png
  # look at the sheet, shortlist, then let a human confirm the motion:
  find_lottie.py --pick 1,4,9 --preview /tmp/shortlist
  find_lottie.py --pick 4 --download public/animations/
""")
    ap.add_argument("terms", nargs="*", help="search words")
    ap.add_argument("--limit", type=int, default=24, help="results to fetch (default: 24)")
    ap.add_argument("--after", help="pagination cursor from a previous search")
    ap.add_argument("--min-downloads", type=int, default=0,
                    help="drop results below this download count")
    ap.add_argument("--sheet", metavar="PATH", help="render previews as one contact sheet")
    ap.add_argument("--sheet-cols", type=int, default=6, help="columns (default: 6)")
    ap.add_argument("--cell", type=int, default=128, help="cell size px (default: 128)")
    ap.add_argument("--preview", metavar="DIR",
                    help="write a local HTML page that plays the candidates")
    ap.add_argument("--pick", help="comma-separated indices from the last search")
    ap.add_argument("--download", metavar="DIR", help="save picked animations here")
    ap.add_argument("--format", choices=["lottie", "json", "both"], default="lottie",
                    help="download .lottie (compressed) and/or raw .json (default: lottie)")
    ap.add_argument("--json", dest="as_json", action="store_true",
                    help="print full records as JSON")
    args = ap.parse_args()

    cache = Path(CACHE)

    if args.terms:
        query = " ".join(args.terms)
        res = search(query, max(1, min(args.limit, 100)), args.after)
        nodes = [e["node"] for e in res.get("edges", [])]
        if args.min_downloads:
            nodes = [n for n in nodes if (n.get("downloads") or 0) >= args.min_downloads]
        total = res.get("totalCount", len(nodes))
        page = res.get("pageInfo") or {}
        cache.write_text(json.dumps(
            {"query": query, "nodes": nodes, "pageInfo": page}, indent=2),
            encoding="utf-8")
        info(f"{total} matches; showing {len(nodes)} (cached to {cache})")
        if page.get("hasNextPage"):
            info(f"more available: --after {page.get('endCursor')}")
    else:
        if not cache.is_file():
            die("no search terms given and no cached search found. "
                'Run e.g.  find_lottie.py "loading spinner"')
        blob = json.loads(cache.read_text(encoding="utf-8"))
        nodes = blob["nodes"]
        info(f"using cached search: \"{blob['query']}\" ({len(nodes)} results)")

    if not nodes:
        info("no results. Try different or fewer words.")
        return

    if args.pick:
        try:
            idxs = [int(x) for x in args.pick.split(",") if x.strip() != ""]
        except ValueError:
            die("--pick takes comma-separated integers, e.g. --pick 0,3")
        bad = [i for i in idxs if i < 0 or i >= len(nodes)]
        if bad:
            die(f"--pick index out of range: {bad} (0..{len(nodes)-1})")
        nodes = [nodes[i] for i in idxs]
        info(f"picked {len(nodes)}")

    if args.sheet:
        build_sheet(nodes, Path(args.sheet).expanduser(), args.sheet_cols, args.cell)
    if args.preview:
        build_preview(nodes, Path(args.preview).expanduser())

    for i, nd in enumerate(nodes):
        if args.as_json:
            print(json.dumps(nd))
        else:
            print(f"[{i}] {nd['name'][:40]:40s} {nd.get('frameRate','?')}fps  "
                  f"{nd.get('downloads',0):>6} dl  {nd['url']}")

    if args.download:
        dest = Path(args.download).expanduser()
        dest.mkdir(parents=True, exist_ok=True)
        saved = []
        for nd in nodes:
            base = slug(nd["name"]) + f"-{nd['id']}"
            targets = []
            if args.format in ("lottie", "both"):
                targets.append((nd["lottieUrl"], dest / f"{base}.lottie"))
            if args.format in ("json", "both"):
                targets.append((nd["jsonUrl"], dest / f"{base}.json"))
            for url, path in targets:
                try:
                    path.write_bytes(fetch(url))
                    saved.append((nd, path))
                    info(f"  saved {path.name}")
                except Exception as exc:
                    info(f"  failed {url}: {type(exc).__name__}")

        credits = dest / "LOTTIE-CREDITS.md"
        lines = [] if credits.exists() else ["# Lottie animation credits\n\n", LICENSE_NOTE, "\n"]
        for nd, path in saved:
            who = (nd.get("createdBy") or {}).get("username") or "unknown"
            lines.append(f"- `{path.name}` — \"{nd['name']}\" by {who} — {nd['url']}\n")
        with credits.open("a", encoding="utf-8") as fh:
            fh.writelines(lines)
        info(f"{len(saved)} file(s) in {dest}; provenance in {credits.name}")


if __name__ == "__main__":
    main()
