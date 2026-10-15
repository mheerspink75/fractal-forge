# FRACTAL FORGE — Architecture

A map for contributors working in `script.js` (the ~3.9k-line monolith) and the test harness.
The README's **Architecture** section covers *what* each module does; this document covers *where*
things live, *which invariants the tests protect*, and *how to run and ship changes safely*.

> Line numbers below are as of the `master` at the time of writing and are **approximate — they
> will drift** after any edit. Grep the symbol, not the line number.

## Overview

FRACTAL FORGE is a zero-build static WebGL installation: `index.html` + `styles.css` + one plain
browser script (`script.js`) loaded directly by the page — no bundler, no framework, no runtime
dependencies. A frame is produced by: `State` (single source of truth) → `Fractals` registry
(picks the mode/params) → `Engine.renderFractal` (binds uniforms, runs the mode's fragment
shader) → `Effects` post pipeline (bright pass → blur → composite → feedback trails) → the `App`
main loop (`requestAnimationFrame`) that drives time, adaptive quality, and camera.

## Region map of `script.js`

The file is a sequence of IIFE modules in dependency order. Section boundaries (header comment
lines) at the time of writing:

| Lines (approx.) | Region | Notes |
|---|---|---|
| 1 | file header | module inventory |
| 30 | `Util` | PRNG (mulberry32 / sfc32), math, base64url, packing |
| 126 | `GL` | WebGL context, shader/program compilation, FBOs, fullscreen quad |
| 370 | `Shaders` | All GLSL: `COMMON` chunk + 10 fractal fragment shaders + 5 post passes |
| 911 | `ColorSystem` | 9 IQ cosine palettes, gradient editor, animated cycling |
| 1071 | `Fractals` | mode registry (14 modes: 10 GPU + 4 L-system) with per-mode params |
| 1234 | `Engine` | `setMode` (~1282), **`renderFractal` (~1313)** — uniform binding + draw |
| 1380 | `LSystem` | string-rewriting fractals on a 2D canvas |
| 1507 | `Effects` | post pipeline (bright → blur H/V → composite → feedback trails) |
| 1622 | `Camera` | pan/zoom/deep-zoom; **3D orbit for Mandelbulb** |
| 1735 | `Interaction` | mouse / touch / keyboard input, D10 key gating lives here + in `App` |
| 1926 | `State` | single source of truth for render params |
| 1976 | `Procedural` | seed, randomize, mutations, parameter blending |
| 2033 | `Share` | `FF-` code serialize/deserialize |
| 2158 | `Exporter` | offscreen FBO render at **live** animation time (D4) |
| 2244 | `Gallery` | saved worlds + thumbnails in `localStorage` |
| 2375 | `Audio` | mic-reactive frequency analysis (intentionally shadows the built-in `Audio`) |
| 2462 | `Ambient` | drifting particle field (2D canvas) |
| 2551 | `A11y` | reduced motion, contrast, adaptive quality settings |
| 2602 | `UI` | DOM bindings: panels, sliders, buttons, toasts, modals (focus trap) |
| 3345 | `App` | orchestrator: init, **main loop `loop` (~3684)**, `exportAt` (~3550), adaptive quality |
| 3847 | Boot | `App.init()` + graceful WebGL-missing fallback |

`index.html` hosts the panels/modals/onboarding markup; `styles.css` the glassmorphic theme.

## Invariants the tests protect

These are the behaviors the automated suites pin down — future changes must keep them true:

- **D3 — the seed drives every GPU mode.** All 10 GPU fragment shaders read `u_seed` in their
  body (statically verified by `test/glsl-check.js`; behaviorally verified by the browser suite's
  seedMAE check: a seed change must move composition by ≥ 1.5 MAE on a 64×64 downsample —
  measured jitter with an *ignored* seed is ~0.2).
- **In-frame — every GPU mode stays in frame.** The browser suite renders all 10 modes at two
  fresh seeds and requires a valid frame (`variance > 20 && mean > 1`). Seed-driven transforms must
  stay **bounded, continuous, deterministic** (the existing pattern: small `sin/cos(u_seed * k)`
  offsets/phases, e.g. the Sierpinski and Newton shaders).
- **3D framing (Mandelbulb lesson from PR #9):** a seed that changes the 3D view must orbit the
  *camera position* around `u_cam_target`, not rotate the look direction — the latter blanked the
  bulb for most seeds and was only caught by the browser suite.
- **D4 — export matches the on-screen frame.** `Exporter` renders at the **live** animation time
  (`App.getLiveTime()`), never a forced `time: 0`; verified by comparing screen vs export MAE.
- **D10 — action keys are inert behind an open modal** (`r/n/s/e/g/a`, `1-9`), while pan
  (arrows), zoom (`+`/`-`), and `Space` (pause) still work; verified with and without a modal.

## How to run everything

```bash
npm test                     # functional + smoke + glsl-check (Node only, no browser)
npm run lint                 # ESLint (flat config, eslint.config.mjs)
npm run format:check         # Prettier style check
npm run format               # Prettier write (after style changes)
npm run test:browser         # Playwright suite: local (auto-served :8123) + production site
SKIP_LIVE=1 npm run test:browser   # local target only (what CI runs)
BASE_URL=<url> npm run test:browser # a single custom target
```

- `npm test` loads `script.js` in a `vm` sandbox with mocked DOM/WebGL — it verifies logic and
  module APIs, **not pixels**.
- The browser suite runs real headless Chromium with SwiftShader WebGL; it verifies boot/render,
  D3, the in-frame guard, D4, and D10. Evidence (screenshots + exported PNGs) lands in
  `test/.evidence/<target>/`. Headless WebGL is slow: the Mandelbulb raymarch needs a 2500 ms
  settle before a frame is complete.
- **Gotcha (bit us before):** Node constants (`SEED_STEP`, `TIME_MODE`, …) are *not* visible
  inside `page.evaluate()` callbacks (browser scope). Pass them as arguments:
  `page.evaluate((arg) => { … }, VALUE)`.

CI (`.github/workflows/ci.yml`) runs both jobs on every push/PR to `master`:

| Job | Runs |
|---|---|
| `test` | `npm ci` → `npm test` → `npm run lint` |
| `browser` | `npm ci` → `npx playwright install --with-deps chromium` → `SKIP_LIVE=1 npm run test:browser` (the PR's own files, not production) |

Both must pass before merging.

## How deployment works

- `master` is the GitHub Pages **deploy branch** (source: `master`, path `/`), serving
  <https://mheerspink75.github.io/fractal-forge/>. Because there is no build step, a merge to
  `master` *is* the deploy — the site updates within a couple of minutes.
- Squash-merge discipline: one PR per logically scoped change, green CI, scoped diff. Check the
  deploy with `gh api repos/mheerspink75/fractal-forge/pages` (fresh `built` status) and re-run
  the browser suite against the live URL after merging.
- GitHub Pages serves over HTTPS (a secure context), so mic, clipboard, and `localStorage` work
  on the live site.

## Validation ladder (use in every change)

1. `node --check` each touched `.js` (syntax).
2. `npm test` (logic + GLSL static checks).
3. `SKIP_LIVE=1 npm run test:browser` (**the pixel proof** — cite its stats: per-mode mean/variance,
   seedMAE, export MAE).
4. CI green (`test` + `browser` jobs) → squash-merge → verify Pages build + live URL.

Never claim visual correctness from `npm test` alone — only the browser suite verifies pixels.
