#!/usr/bin/env python3
"""
gen_asset.py — generate app assets for classroom apps.

Raster (illustrations, characters, scenes, backgrounds) -> Google Gemini
Vector (icons, logos, scalable marks)                   -> Recraft (true SVG)
Raster -> SVG conversion                                -> Recraft vectorize

Zero dependencies: Python 3.9+ standard library only.

Keys are read from the environment, or from a .env file in the project root:
    GEMINI_API_KEY=...
    RECRAFT_API_TOKEN=...

Every generated file gets a sidecar <name>.meta.json recording the prompt,
model, preset and reference images, so a whole asset set can be regenerated
or extended consistently months later.
"""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import re
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

# --------------------------------------------------------------------------
# Constants
# --------------------------------------------------------------------------

GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"
RECRAFT_BASE = "https://external.api.recraft.ai/v1"

# Gemini image models, cheapest first. Docs: ai.google.dev/gemini-api/docs/image-generation
GEMINI_MODELS = {
    "fast": "gemini-3.1-flash-lite-image",   # 1K only, cheapest
    "standard": "gemini-3.1-flash-image",    # 512px-4K, the everyday default
    "best": "gemini-3-pro-image",            # premium quality / hardest prompts
    "legacy": "gemini-2.5-flash-image",
}

# Rough list prices per output image (USD), for the budget line printed after
# each run. Treat as an estimate, not a bill. Check current provider pricing.
COST_HINT = {
    "gemini-3.1-flash-lite-image": 0.02,
    "gemini-3.1-flash-image": 0.04,
    "gemini-3-pro-image": 0.13,
    "gemini-2.5-flash-image": 0.039,
    # Recraft API is billed from PREPAID API UNITS, which are separate from a
    # Recraft subscription — subscription credits do not pay for API calls.
    # $1 = 1000 units. Docs: recraft.ai/docs/api-reference/pricing
    "recraft-vector": 0.08,
    "recraft-raster": 0.04,
    "local-trace": 0.0,
}

# Recraft top-level style strings. Substyles: recraft.ai/docs/api-reference/styles.md
RECRAFT_STYLES = ["vector_illustration", "icon", "digital_illustration",
                  "realistic_image", "logo_raster"]

# Styles are supported on V3/V2 models; V4.x does not take a `style` parameter.
RECRAFT_VECTOR_MODEL = "recraftv3_vector"
RECRAFT_ICON_MODEL = "recraftv2_vector"   # `icon` styles live on V2 vector
RECRAFT_RASTER_MODEL = "recraftv3"

TIMEOUT = 180


# --------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------

def die(msg: str, code: int = 1) -> "NoReturn":  # type: ignore[valid-type]
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(code)


def info(msg: str) -> None:
    print(msg, file=sys.stderr)


def slugify(text: str, maxlen: int = 48) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return (s[:maxlen].rstrip("-")) or "asset"


def find_project_root(start: Path) -> Path:
    """Walk up looking for a project marker; fall back to cwd."""
    markers = {"assets.config.json", ".git", "package.json",
               "pyproject.toml", "CLAUDE.md"}
    cur = start.resolve()
    for candidate in [cur, *cur.parents]:
        if any((candidate / m).exists() for m in markers):
            return candidate
    return cur


def load_dotenv(root: Path) -> None:
    """Populate os.environ from .env without overwriting real env vars."""
    env_file = root / ".env"
    if not env_file.is_file():
        return
    for raw in env_file.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val


def load_config(root: Path) -> dict:
    cfg_path = root / "assets.config.json"
    if not cfg_path.is_file():
        return {}
    try:
        return json.loads(cfg_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        die(f"assets.config.json is not valid JSON: {exc}")


def http_json(url: str, payload: dict, headers: dict) -> dict:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST",
                                 headers={"Content-Type": "application/json", **headers})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:1200]
        raise ApiError(exc.code, detail) from None
    except urllib.error.URLError as exc:
        die(f"network error contacting {url}: {exc.reason}")


class ApiError(Exception):
    def __init__(self, status: int, detail: str):
        self.status = status
        self.detail = detail
        super().__init__(f"HTTP {status}: {detail}")


# --------------------------------------------------------------------------
# Prompt assembly
# --------------------------------------------------------------------------

def build_prompt(user_prompt: str, cfg: dict, preset_name: str | None,
                 transparent: bool, kind: str) -> str:
    parts = [user_prompt.strip()]

    preset = None
    presets = cfg.get("presets", {})
    if preset_name:
        preset = presets.get(preset_name)
        if preset is None:
            available = ", ".join(sorted(presets)) or "(none defined)"
            die(f"unknown preset '{preset_name}'. Available: {available}")
    elif cfg.get("default_preset"):
        preset = presets.get(cfg["default_preset"])

    if preset:
        if preset.get("style"):
            parts.append(preset["style"].strip())
        palette = preset.get("palette") or []
        if palette:
            parts.append("Use only this colour palette: " + ", ".join(palette) + ".")
        if preset.get("notes"):
            parts.append(preset["notes"].strip())

    if transparent:
        parts.append("Isolated on a fully transparent background, no backdrop, "
                     "no drop shadow, no ground plane.")

    if kind in ("vector", "icon"):
        parts.append("Clean flat shapes, no gradients meshes, no photographic "
                     "texture, no fine noise — must survive conversion to vector.")

    # Classroom defaults: legibility beats flourish.
    parts.append("High contrast and clearly readable when projected at a distance. "
                 "Avoid embedded paragraphs of text.")
    return "  ".join(p for p in parts if p)


# --------------------------------------------------------------------------
# Gemini
# --------------------------------------------------------------------------

def read_reference(path_str: str) -> dict:
    p = Path(path_str).expanduser()
    if not p.is_file():
        die(f"reference image not found: {p}")
    mime = mimetypes.guess_type(p.name)[0] or "image/png"
    if not mime.startswith("image/"):
        die(f"reference is not an image: {p}")
    return {"mime_type": mime,
            "data": base64.b64encode(p.read_bytes()).decode("ascii")}


def gemini_generate(prompt: str, model: str, aspect: str, size: str,
                    refs: list[str], api_key: str) -> bytes:
    parts: list[dict] = [{"text": prompt}]
    for r in refs:
        parts.append({"inline_data": read_reference(r)})

    payload = {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "imageConfig": {"aspectRatio": aspect, "imageSize": size},
        },
    }
    url = f"{GEMINI_BASE}/models/{model}:generateContent"
    headers = {"x-goog-api-key": api_key}

    try:
        data = http_json(url, payload, headers)
    except ApiError as exc:
        # A bad/absent key is terminal — never burn a second call on it.
        auth_problem = any(t in exc.detail for t in
                           ("API_KEY", "UNAUTHENTICATED", "PERMISSION_DENIED",
                            "billing", "quota", "RESOURCE_EXHAUSTED"))
        if exc.status in (400, 404) and not auth_problem:
            info("note: generateContent did not accept this request; retrying "
                 "on the newer /interactions endpoint...")
            return gemini_generate_interactions(prompt, model, aspect, size,
                                                refs, api_key)
        die(f"Gemini request failed ({exc.status}). {exc.detail}")

    blob = _extract_gemini_image(data)
    if blob is None:
        die("Gemini returned no image. Full response:\n"
            + json.dumps(data, indent=2)[:2000])
    return blob


def gemini_generate_interactions(prompt: str, model: str, aspect: str,
                                 size: str, refs: list[str],
                                 api_key: str) -> bytes:
    inp: list[dict] = [{"type": "text", "text": prompt}]
    for r in refs:
        ref = read_reference(r)
        inp.append({"type": "image", "mime_type": ref["mime_type"],
                    "data": ref["data"]})
    payload = {
        "model": model,
        "input": inp,
        "response_format": {"type": "image", "mime_type": "image/png",
                            "aspect_ratio": aspect, "image_size": size},
    }
    try:
        data = http_json(f"{GEMINI_BASE}/interactions", payload,
                         {"x-goog-api-key": api_key})
    except ApiError as exc:
        die(f"Gemini request failed ({exc.status}). {exc.detail}")

    blob = _extract_gemini_image(data)
    if blob is None:
        die("Gemini returned no image. Full response:\n"
            + json.dumps(data, indent=2)[:2000])
    return blob


def _extract_gemini_image(data: dict) -> bytes | None:
    """Pull base64 image bytes out of either response shape."""
    # interactions: output_image.data
    out = data.get("output_image")
    if isinstance(out, dict) and out.get("data"):
        return base64.b64decode(out["data"])

    # interactions: steps[].content[] {type: image, data}
    for step in data.get("steps", []) or []:
        for item in step.get("content", []) or []:
            if item.get("type") == "image" and item.get("data"):
                return base64.b64decode(item["data"])

    # generateContent: candidates[].content.parts[].inlineData.data
    for cand in data.get("candidates", []) or []:
        for part in (cand.get("content") or {}).get("parts", []) or []:
            blob = part.get("inlineData") or part.get("inline_data")
            if blob and blob.get("data"):
                return base64.b64decode(blob["data"])
    return None


# --------------------------------------------------------------------------
# Recraft
# --------------------------------------------------------------------------

def recraft_generate(prompt: str, kind: str, size: str, style: str | None,
                     substyle: str | None, model: str | None,
                     token: str) -> bytes:
    if kind == "icon":
        model = model or RECRAFT_ICON_MODEL
        style = style or "icon"
    elif kind == "vector":
        model = model or RECRAFT_VECTOR_MODEL
        style = style or "vector_illustration"
    else:
        model = model or RECRAFT_RASTER_MODEL
        style = style or "digital_illustration"

    payload: dict = {"prompt": prompt, "model": model, "style": style,
                     "size": size, "n": 1, "response_format": "b64_json"}
    if substyle:
        payload["substyle"] = substyle

    try:
        data = http_json(f"{RECRAFT_BASE}/images/generations", payload,
                         {"Authorization": f"Bearer {token}"})
    except ApiError as exc:
        hint = ""
        if exc.status in (400, 422):
            hint = ("\nhint: style/substyle/model combinations are validated "
                    "server-side. Valid top-level styles: "
                    + ", ".join(RECRAFT_STYLES)
                    + "\nSubstyle list: https://www.recraft.ai/docs/api-reference/styles.md")
        die(f"Recraft request failed ({exc.status}). {exc.detail}{hint}")

    items = data.get("data") or []
    if not items:
        die("Recraft returned no image:\n" + json.dumps(data, indent=2)[:2000])
    first = items[0]
    if first.get("b64_json"):
        return base64.b64decode(first["b64_json"])
    if first.get("url"):
        with urllib.request.urlopen(first["url"], timeout=TIMEOUT) as resp:
            return resp.read()
    die("Recraft response contained neither b64_json nor url.")


def trace_vtracer(src: Path, colors: int, speckle: int, mode: str) -> bytes:
    """Colour-aware local tracing. Excellent on flat/vector-style art."""
    import tempfile
    import vtracer  # type: ignore
    with tempfile.NamedTemporaryFile(suffix=".svg", delete=False) as tmp:
        out = Path(tmp.name)
    try:
        vtracer.convert_image_to_svg_py(
            str(src), str(out),
            colormode="binary" if mode == "bw" else "color",
            filter_speckle=speckle, color_precision=colors,
            path_precision=5, corner_threshold=60)
        return out.read_bytes()
    finally:
        out.unlink(missing_ok=True)


def trace_potrace(src: Path) -> bytes:
    """Black-and-white local tracing via the potrace binary."""
    import subprocess
    import tempfile
    from PIL import Image  # type: ignore

    with Image.open(src) as im:
        im = im.convert("RGBA")
        flat = Image.new("RGB", im.size, (255, 255, 255))
        flat.paste(im, mask=im.split()[3])
        bw = flat.convert("L").point(lambda v: 255 if v > 128 else 0).convert("1")
    with tempfile.TemporaryDirectory() as td:
        pbm, svg = Path(td) / "in.pbm", Path(td) / "out.svg"
        bw.save(pbm)
        r = subprocess.run(["potrace", "-s", "-o", str(svg), str(pbm)],
                           capture_output=True, text=True)
        if r.returncode != 0:
            die(f"potrace failed: {r.stderr.strip()[:300]}")
        return svg.read_bytes()


def pick_tracer(requested: str) -> str:
    """Resolve 'auto' to whichever backend is actually available."""
    import shutil as _sh
    if requested != "auto":
        return requested
    try:
        import vtracer  # noqa: F401
        return "vtracer"
    except ImportError:
        pass
    if _sh.which("potrace"):
        return "potrace"
    if os.environ.get("RECRAFT_API_TOKEN"):
        return "recraft"
    die("no vectorizer available. Install a free local one:\n"
        "  pip install vtracer          (colour, recommended)\n"
        "  apt install potrace          (black and white)\n"
        "or set RECRAFT_API_TOKEN to use Recraft's paid API "
        "(billed from prepaid API units, which a subscription does not include).")


def recraft_vectorize(src: Path, token: str) -> bytes:
    """POST a raster file to /images/vectorize as multipart/form-data."""
    if not src.is_file():
        die(f"file not found: {src}")
    mime = mimetypes.guess_type(src.name)[0] or "image/png"
    boundary = "----genasset" + uuid.uuid4().hex

    body = bytearray()
    body += f"--{boundary}\r\n".encode()
    body += (f'Content-Disposition: form-data; name="file"; '
             f'filename="{src.name}"\r\n').encode()
    body += f"Content-Type: {mime}\r\n\r\n".encode()
    body += src.read_bytes()
    body += f"\r\n--{boundary}\r\n".encode()
    body += b'Content-Disposition: form-data; name="response_format"\r\n\r\nb64_json\r\n'
    body += f"--{boundary}--\r\n".encode()

    req = urllib.request.Request(
        f"{RECRAFT_BASE}/images/vectorize", data=bytes(body), method="POST",
        headers={"Authorization": f"Bearer {token}",
                 "Content-Type": f"multipart/form-data; boundary={boundary}"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        die(f"Recraft vectorize failed (HTTP {exc.code}): "
            f"{exc.read().decode('utf-8', 'replace')[:1000]}")
    except urllib.error.URLError as exc:
        die(f"network error: {exc.reason}")

    items = data.get("data") or []
    if not items:
        die("vectorize returned no image:\n" + json.dumps(data, indent=2)[:1500])
    if items[0].get("b64_json"):
        return base64.b64decode(items[0]["b64_json"])
    with urllib.request.urlopen(items[0]["url"], timeout=TIMEOUT) as resp:
        return resp.read()


# --------------------------------------------------------------------------
# Output
# --------------------------------------------------------------------------

def unique_path(path: Path) -> Path:
    if not path.exists():
        return path
    stem, suffix, n = path.stem, path.suffix, 2
    while True:
        candidate = path.with_name(f"{stem}-{n}{suffix}")
        if not candidate.exists():
            return candidate
        n += 1


def write_asset(blob: bytes, out: Path, meta: dict, overwrite: bool) -> Path:
    out.parent.mkdir(parents=True, exist_ok=True)
    final = out if overwrite else unique_path(out)
    final.write_bytes(blob)
    meta["file"] = final.name
    meta["bytes"] = len(blob)
    meta["created"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    final.with_suffix(final.suffix + ".meta.json").write_text(
        json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    return final


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def produce(args, cfg: dict, prompt: str, out: Path, refs: list,
            meta: dict) -> tuple:
    """Generate one asset. Returns (path, cost), or (None, 0.0) on --dry-run."""
    if args.kind == "raster":
        model = args.model or GEMINI_MODELS[args.quality]
        meta.update(provider="gemini", model=model, aspect=args.aspect,
                    size=args.size)
        if args.dry_run:
            info(f"[dry-run] gemini {model} -> {out}\n---\n{prompt}\n---")
            return None, 0.0
        key = os.environ.get("GEMINI_API_KEY")
        if not key:
            die("GEMINI_API_KEY is not set. Get one at https://aistudio.google.com/apikey")
        blob = gemini_generate(prompt, model, args.aspect, args.size, refs, key)
        cost = COST_HINT.get(model, 0.05)
    else:
        size = args.size if "x" in args.size or ":" in args.size else "1024x1024"
        meta.update(provider="recraft", model=args.model or "(default)",
                    style=args.style, substyle=args.substyle, size=size)
        if args.dry_run:
            info(f"[dry-run] recraft {args.kind} -> {out}\n---\n{prompt}\n---")
            return None, 0.0
        token = os.environ.get("RECRAFT_API_TOKEN")
        if not token:
            die("RECRAFT_API_TOKEN is not set. Get one at https://app.recraft.ai/profile/api")
        if refs:
            info("note: reference images are ignored for vector/icon (Gemini-only).")
        blob = recraft_generate(prompt, args.kind, size, args.style,
                                args.substyle, args.model, token)
        cost = COST_HINT["recraft-vector"]

    return write_asset(blob, out, meta, args.overwrite), cost


def main() -> None:
    ap = argparse.ArgumentParser(
        prog="gen_asset.py",
        description="Generate illustration / icon / vector assets for classroom apps.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""examples:
  # a scene illustration, 16:9, house style from assets.config.json
  gen_asset.py "a friendly robot tutor at a chalkboard" --kind raster --aspect 16:9

  # a new character pose that matches an approved existing asset
  gen_asset.py "the same robot waving" --ref public/assets/robot-idle.png

  # a scalable SVG icon
  gen_asset.py "a beaker of bubbling liquid" --kind icon --out public/icons/beaker.svg

  # a riggable character: one isolated layer per part, all on-model
  gen_asset.py "friendly robot tutor" --parts "torso,left arm,right arm,head,eyes"

  # an animation frame set for a game sprite, then pack it into a sheet
  gen_asset.py "pixel-art fox, side view, facing right" \
      --frames "contact,down,passing,up" --transparent
  pack_sprites.py public/assets/frames/pixel-art-fox-side-view-facing-right

  # turn an existing raster into an editable SVG — free, local, no API
  gen_asset.py --vectorize public/assets/robot-idle.png

  # see the resolved prompt and destination without spending anything
  gen_asset.py "a parabola on graph paper" --dry-run
""")

    ap.add_argument("prompt", nargs="?", help="what to draw")
    ap.add_argument("--kind", choices=["raster", "vector", "icon"], default="raster",
                    help="raster=Gemini illustration; vector/icon=Recraft SVG (default: raster)")
    ap.add_argument("--out", help="output path (extension decides format)")
    ap.add_argument("--preset", help="style preset name from assets.config.json")
    ap.add_argument("--quality", choices=list(GEMINI_MODELS), default="standard",
                    help="Gemini tier (default: standard)")
    ap.add_argument("--model", help="override the model id entirely")
    ap.add_argument("--aspect", default="1:1", help="aspect ratio, e.g. 16:9 (default: 1:1)")
    ap.add_argument("--size", default="2K",
                    help="Gemini: 512px|1K|2K|4K. Recraft: WxH e.g. 1024x1024 (default: 2K)")
    ap.add_argument("--ref", action="append", default=[], metavar="PATH",
                    help="reference image for style/character consistency (repeatable, Gemini only)")
    ap.add_argument("--style", help="Recraft style (e.g. vector_illustration, icon)")
    ap.add_argument("--substyle", help="Recraft substyle")
    ap.add_argument("--transparent", action="store_true",
                    help="ask for an isolated subject on a transparent background")
    ap.add_argument("--alt", help="alt text to record in the sidecar manifest")
    ap.add_argument("--parts", metavar="LIST",
                    help="comma-separated layer list; generates each as an isolated, "
                         "transparent, style-matched layer so the subject can be rigged "
                         'for animation, e.g. --parts "torso,left arm,right arm,head"')
    ap.add_argument("--frames", metavar="LIST",
                    help="comma-separated animation frames of ONE subject, each "
                         "chained to the first for consistency, e.g. "
                         '--frames "idle,step left,mid stride,step right"')
    ap.add_argument("--fps", type=int, default=8,
                    help="frames per second recorded in the frame-set manifest (default: 8)")
    ap.add_argument("--yes", action="store_true",
                    help="skip the confirmation guard on large --parts/--frames batches")
    ap.add_argument("--vectorize", metavar="PATH",
                    help="convert an existing raster file to SVG and exit")
    ap.add_argument("--tracer", choices=["auto", "vtracer", "potrace", "recraft"],
                    default="auto",
                    help="vectorizer backend for --vectorize. vtracer and potrace "
                         "are free and local; recraft costs prepaid API units "
                         "(default: auto)")
    ap.add_argument("--trace-mode", choices=["color", "bw"], default="color",
                    help="vtracer colour mode (default: color)")
    ap.add_argument("--trace-colors", type=int, default=6,
                    help="vtracer colour precision, higher = more colours (default: 6)")
    ap.add_argument("--trace-speckle", type=int, default=6,
                    help="vtracer speckle filter, higher = fewer stray shapes (default: 6)")
    ap.add_argument("--overwrite", action="store_true",
                    help="replace an existing file instead of adding -2, -3 ...")
    ap.add_argument("--dry-run", action="store_true",
                    help="print the resolved prompt, model and destination; call nothing")
    args = ap.parse_args()

    root = find_project_root(Path.cwd())
    load_dotenv(root)
    cfg = load_config(root)
    assets_dir = root / cfg.get("assets_dir", "public/assets")

    # ---- vectorize mode -------------------------------------------------
    if args.vectorize:
        src = Path(args.vectorize).expanduser()
        out = Path(args.out).expanduser() if args.out else src.with_suffix(".svg")
        if args.dry_run:
            info(f"[dry-run] vectorize {src} -> {out}")
            return
        backend = pick_tracer(args.tracer)
        if backend == "vtracer":
            try:
                blob = trace_vtracer(src, args.trace_colors, args.trace_speckle,
                                     args.trace_mode)
            except ImportError:
                die("vtracer is not installed.  pip install vtracer")
            cost = 0.0
        elif backend == "potrace":
            blob = trace_potrace(src)
            cost = 0.0
        else:
            token = os.environ.get("RECRAFT_API_TOKEN")
            if not token:
                die("RECRAFT_API_TOKEN is not set. Note that Recraft's API is paid "
                    "from PREPAID API UNITS, separate from a subscription. A free "
                    "local alternative: pip install vtracer")
            blob = recraft_vectorize(src, token)
            cost = COST_HINT["recraft-vector"]

        final = write_asset(blob, out, {"source": str(src), "op": "vectorize",
                                        "provider": backend}, args.overwrite)
        info(f"wrote {final}  [{backend}]"
             + (f"  (~${cost:.3f})" if cost else "  (free, local)"))
        print(final)
        return

    if not args.prompt:
        ap.error("a prompt is required (or use --vectorize)")

    # ---- frames mode: an ordered animation set --------------------------
    if args.frames:
        frames = [x.strip() for x in args.frames.split(",") if x.strip()]
        if not frames:
            die('--frames was empty. Give a comma-separated list, e.g. '
                '--frames "contact,down,passing,up"')
        if len(frames) > 8 and not args.yes:
            die(f"--frames asks for {len(frames)} images. That is a paid API call "
                f"each, and long frame sets drift badly. Re-run with --yes if "
                f"that is intended.")
        if args.kind != "raster":
            die("--frames is Gemini-only (it depends on reference chaining). "
                "Drop --kind, or generate vector frames one at a time.")

        subject = slugify(args.prompt)
        base_dir = Path(args.out).expanduser() if args.out else assets_dir / "frames" / subject
        if not base_dir.is_absolute():
            base_dir = root / base_dir

        info(f"generating {len(frames)} frames into {base_dir}")
        chained: list[str] = list(args.ref)
        total = 0.0
        written: list[Path] = []

        for i, frame in enumerate(frames, 1):
            # Every frame after the first is pinned to frame 1 so the character
            # stays the same character. Framing must not drift either, or the
            # sprite will jitter once the frames are played in sequence.
            frame_prompt = (
                f"{args.prompt}. Animation frame {i} of {len(frames)}: {frame}. "
                f"Identical character, identical colours, identical proportions, "
                f"identical camera angle and distance, identical scale and position "
                f"within the frame. ONLY the pose changes.")
            full = build_prompt(frame_prompt, cfg, args.preset, True, args.kind)
            out = base_dir / f"{i:02d}-{slugify(frame)}.png"
            meta = {"prompt_user": frame_prompt, "prompt_sent": full,
                    "kind": args.kind, "frame": frame, "frame_index": i,
                    "frame_count": len(frames), "fps": args.fps,
                    "subject": args.prompt,
                    "preset": args.preset or cfg.get("default_preset"),
                    "references": list(chained), "alt": args.alt}
            info(f"  [{i}/{len(frames)}] {frame}")
            path, cost = produce(args, cfg, full, out, chained, meta)
            if path is None:
                continue
            written.append(path)
            total += cost
            if i == 1:
                chained = [str(path)] + list(args.ref)

        if args.dry_run:
            return

        # A set-level manifest, so the packer and the app agree on frame order.
        (base_dir / "frameset.json").write_text(json.dumps({
            "subject": args.prompt, "fps": args.fps,
            "frames": [w.name for w in written], "alt": args.alt,
        }, indent=2) + "\n", encoding="utf-8")

        info(f"\ndone: {len(written)} frames, ~${total:.2f} total")
        info(f"next: pack_sprites.py {base_dir}")
        info("check the set plays cleanly before packing — image models drift, "
             "and drift reads as jitter once animated.")
        for w in written:
            print(w)
        return

    # ---- parts mode: one riggable layer per part ------------------------
    if args.parts:
        parts = [x.strip() for x in args.parts.split(",") if x.strip()]
        if not parts:
            die("--parts was empty. Give a comma-separated list, e.g. "
                "--parts \"torso,left arm,right arm,head\"")
        if len(parts) > 8 and not args.yes:
            die(f"--parts asks for {len(parts)} images. That is a paid API call "
                f"each. Re-run with --yes if that is intended.")

        subject = slugify(args.prompt)
        base_dir = Path(args.out).expanduser() if args.out else assets_dir / "parts" / subject
        if not base_dir.is_absolute():
            base_dir = root / base_dir
        ext = ".svg" if args.kind in ("vector", "icon") else ".png"

        info(f"generating {len(parts)} layers into {base_dir}")
        chained: list[str] = list(args.ref)
        total = 0.0
        written: list[Path] = []

        for i, part in enumerate(parts, 1):
            # Each layer is isolated and transparent so it can be stacked and
            # rigged independently in an animation editor.
            layer_prompt = (f"{args.prompt} — show ONLY the {part}, as a single "
                            f"isolated element. Nothing else from the subject is "
                            f"visible. Centred, complete, not cropped.")
            full = build_prompt(layer_prompt, cfg, args.preset, True, args.kind)
            out = base_dir / f"{i:02d}-{slugify(part)}{ext}"
            meta = {"prompt_user": layer_prompt, "prompt_sent": full,
                    "kind": args.kind, "part": part, "part_index": i,
                    "subject": args.prompt,
                    "preset": args.preset or cfg.get("default_preset"),
                    "references": list(chained), "alt": args.alt}
            info(f"  [{i}/{len(parts)}] {part}")
            path, cost = produce(args, cfg, full, out, chained, meta)
            if path is None:      # dry run
                continue
            written.append(path)
            total += cost
            # Style-chain: every later layer references the first one, so the
            # whole set stays on-model.
            if i == 1 and args.kind == "raster":
                chained = [str(path)] + list(args.ref)

        if args.dry_run:
            return
        info(f"\ndone: {len(written)} layers, ~${total:.2f} total")
        info("next: import these into your animation editor bottom-up and rig "
             "each as its own layer. See references/lottie.md.")
        for w in written:
            print(w)
        return

    # ---- single asset ---------------------------------------------------
    prompt = build_prompt(args.prompt, cfg, args.preset, args.transparent, args.kind)

    if args.out:
        out = Path(args.out).expanduser()
        if not out.is_absolute():
            out = root / out
    else:
        ext = ".svg" if args.kind in ("vector", "icon") else ".png"
        sub = {"raster": "", "vector": "vector", "icon": "icons"}[args.kind]
        out = assets_dir / sub / (slugify(args.prompt) + ext)

    meta = {
        "prompt_user": args.prompt,
        "prompt_sent": prompt,
        "kind": args.kind,
        "preset": args.preset or cfg.get("default_preset"),
        "references": args.ref,
        "alt": args.alt,
    }

    final, cost = produce(args, cfg, prompt, out, args.ref, meta)
    if final is None:
        return
    info(f"wrote {final}  (~${cost:.3f})")
    if not args.alt:
        info("reminder: no --alt given. Every classroom asset needs alt text.")
    print(final)


if __name__ == "__main__":
    main()
