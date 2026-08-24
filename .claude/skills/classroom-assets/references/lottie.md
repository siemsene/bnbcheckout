# Lottie in classroom apps

Read this before adding any Lottie animation. Most requests that sound like they
need Lottie do not.

## Route the request first

Work down this list and stop at the first match.

**1. Does a ready-made animation exist?**
Loading spinners, success checkmarks, error shakes, empty states, confetti,
progress indicators. Search the public library directly — no account, no API
key, no MCP:

```bash
scripts/find_lottie.py "success checkmark" --limit 24 --sheet /tmp/c.png
```

Read that one contact sheet, shortlist, then **have the user confirm the motion**
before committing:

```bash
scripts/find_lottie.py --pick 1,4,9 --preview /tmp/shortlist   # real, playing
scripts/find_lottie.py --pick 4 --download public/animations/
```

The still frame in a contact sheet cannot show timing, easing, or loop quality,
and those are most of what makes an animation good or bad. Never pick from stills
alone for anything the user will see repeatedly — build the preview page and ask.
This route covers most classroom-app animation needs.

**2. Can CSS or SVG do it?**
Fades, slides, scales, rotations, pulses, colour transitions, simple path
draw-on, staggered list entrances, hover and focus states. Do these in CSS or
with Motion. Zero runtime cost, fully themeable, trivially responsive to app
state. **Do not add a ~250KB animation runtime to fade a card in.**

**3. Is it data-driven or interactive?**
A chart that animates as values change, a simulation, anything that reacts
continuously to student input or app state. Use Canvas, SVG + code, or Motion.
Lottie plays a fixed timeline — it is the wrong tool for state-driven motion.
(Rive is the right tool for that, but it is a separate product and a separate
learning curve. Do not introduce it without asking the user.)

**4. Only now: custom Lottie.**
Justified when the animation has **many coordinated moving parts** and should
look authored rather than programmed — a mascot waving and blinking, liquid
filling a beaker, a diagram assembling itself piece by piece. This is where
Lottie earns its runtime.

If you land on 4, tell the user what it will involve before starting: it is a
hands-on browser session, not something you can do headless.

## Making Recraft output riggable

This is the step that determines whether custom Lottie is worth it at all.

Generated SVG comes out as a flat pile of unnamed paths. There is no "left arm"
layer, so an editor can only transform the whole object — which CSS already does
for free. To get real animation, generate the subject as **separate isolated
layers** and stack them:

```bash
scripts/gen_asset.py "friendly robot tutor, house style" \
  --parts "torso,left arm,right arm,head,left eye,right eye,mouth" \
  --alt "Cartoon robot tutor"
```

That writes `public/assets/parts/friendly-robot-tutor/01-torso.png`,
`02-left-arm.png`, and so on. Each layer is isolated on a transparent
background, and every layer after the first is style-chained to the first, so
the set stays on-model.

Guidance on choosing parts:

- Split on **what needs to move independently**, nothing more. A robot that only
  waves needs `torso, waving arm, head` — not eleven layers.
- Name parts anatomically, not by position, so the intent survives into the
  editor.
- Anything that never moves stays in one base layer. Extra layers are extra
  cost and extra rigging work.
- Vectorise the layers afterwards (`--vectorize`) if you want them scalable in
  the animation; raster layers are fine for fixed-size UI.

Then import bottom-up, in the numbered order.

## The Creator MCP: what it is and is not

Setup: `npx -y @lottiefiles/creator-mcp@latest`, and keep a
`creator.lottiefiles.com` tab open — the MCP drives that browser tab.

Consequences that must be stated to the user before relying on it:

- **Not headless.** It cannot run in CI, in a background session, or while the
  user is away. It needs a live browser and a person.
- **One scene at a time.** No batching.
- **Not reproducible.** Unlike `gen_asset.py`, there is no prompt→file
  determinism and no manifest. Commit the exported `.lottie` *and* keep the
  source layers in `public/assets/parts/` so the animation can be rebuilt.
- **Import and export are manual UI steps.** The round trip is: generate layers
  → import into Creator → prompt for animation → export `.lottie` → commit.

It exposes scene, layer, shape, fill/stroke, keyframe and playback control. It
is genuinely good at rigging imported artwork. It is not a pipeline component.

Creator access requires the paid Individual plan. The free library in route 1
does not — `find_lottie.py` needs no account at all. Never assume the user has
the paid plan; ask before routing them to Creator.

## Licensing

Library animations come under the **Lottie Simple License**: commercial use is
permitted, attribution is optional but encouraged, derivative works must carry
the same terms, and you may not republish them as a competing asset library.
The API exposes no per-animation licence field, so for anything high-stakes,
open the animation's own page (`url` in the results) and check.

`--download` writes a `LOTTIE-CREDITS.md` recording the name, author and source
URL for everything pulled in.

## Shipping it

Prefer `@lottiefiles/dotlottie-react` with a `.lottie` file (compressed) over
`lottie-react` with raw JSON. Lazy-load it so the runtime is not in the initial
bundle:

```jsx
import { lazy, Suspense } from 'react';
const DotLottieReact = lazy(() =>
  import('@lottiefiles/dotlottie-react').then(m => ({ default: m.DotLottieReact }))
);

<Suspense fallback={<img src="/animations/mascot-poster.png" alt="" />}>
  <DotLottieReact src="/animations/mascot-wave.lottie" autoplay loop />
</Suspense>
```

## Accessibility — required, not optional

Lottie does **not** honour `prefers-reduced-motion` on its own. You must handle
it explicitly. Vestibular disorders are common enough that in any classroom
someone is affected.

```jsx
const reduced = typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

return reduced
  ? <img src="/animations/mascot-poster.png" alt="Robot tutor waving" />
  : <DotLottieReact src="/animations/mascot-wave.lottie" autoplay loop
                    aria-label="Robot tutor waving" />;
```

Rules:

- Always export a **static poster frame** alongside the animation, for the
  reduced-motion path and for the lazy-load fallback.
- **Never loop** an animation that sits next to text a student is reading.
  Looping motion in peripheral vision measurably hurts reading. Play once on
  mount, or on interaction.
- Give every animation an `aria-label`, or `aria-hidden="true"` if purely
  decorative.
- Nothing instructional may exist only in the animation. If it teaches, it must
  also be in text.
