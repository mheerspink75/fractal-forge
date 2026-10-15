# FRACTAL FORGE — Architecture

A map for contributors working in the app's modules (entry `src/main.js` plus its sibling
files under `src/`) and the test harness.
The README's **Architecture** section covers *what* each module does; this document covers *where*
things live, *which invariants the tests protect*, and *how to run and ship changes safely*.

## Overview

FRACTAL FORGE is a zero-build static WebGL installation: `index.html` + `styles.css` + a set of
native ES modules loaded directly by the page (entry `src/main.js`, plus 7 sibling files under
`src/`) — no bundler, no framework, no runtime dependencies. A frame is produced by: `State`
(single source of truth) → `Fractals` registry (picks the mode/params) → `Engine.renderFractal`
(binds uniforms, runs the mode's fragment shader) → `Effects` post pipeline (bright pass → blur →
composite → feedback trails) → the `App` main loop (`requestAnimationFrame`) that drives time,
adaptive quality, and camera.

## Module files

Each module is an IIFE exposing a small public API (`export const Name = (() => {...})();`),
imported by `main.js` (or by `exporter.js` / `ui.js` where a dependency points the other way —
those circular imports are safe because every cross-reference happens at call time).

| File | Line count (approx.) | Modules |
|---|---|---|
| `src/main.js` | ~1.9k | `GL`, `ColorSystem`, `Engine` (with **`renderFractal`** — uniform binding + draw), `LSystem`, `Effects` (post pipeline: bright → blur H/V → composite → feedback trails), `Interaction` (mouse/touch/keyboard, D10 key gating lives here + in `App`), `Procedural`, `Share`, `Gallery`, `Audio`, `Ambient`, `A11y`, `App` (orchestrator: init, **main loop**, `exportAt`, adaptive quality), and `boot()` |
| `src/ui.js` | ~710 | `UI` — DOM bindings: panels, sliders, buttons, toasts, modals (focus trap) |
| `src/shaders.js` | ~500 | `Shaders` — all GLSL: `COMMON` chunk + 10 fractal fragment shaders + 5 post passes |
| `src/fractals.js` | ~160 | `Fractals` — mode registry (14 modes: 10 GPU + 4 L-system) with per-mode params |
| `src/camera.js` | ~105 | `Camera` — pan/zoom/deep-zoom; **3D orbit for Mandelbulb** |
| `src/util.js` | ~90 | `Util` — PRNG (mulberry32 / sfc32), math, base64url, packing |
| `src/exporter.js` | ~80 | `Exporter` — offscreen FBO render at **live** animation time (D4) |
| `src/state.js` | ~45 | `State` — single source of truth for render params |

> Line counts are as of the `master` at the time of writing and **will drift** after any edit.
> Grep the symbol, not the line number.

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

- `npm test` loads the module graph (entry `src/main.js`, via `test/load-app-source.js`) in a
  `vm` sandbox with mocked DOM/WebGL — it verifies logic and module APIs, **not pixels**.
- The browser suite runs real headless Chromium with SwiftShader WebGL; it verifies boot/render,
  D3, the in-frame guard, D4, D10, Share URL, and the golden-image pixel regression. Evidence
  (screenshots + exported PNGs) lands in `test/.evidence/<target>/`. Headless WebGL is slow:
  the Mandelbulb raymarch needs a 2500 ms settle before a frame is complete.
- **Golden image:** `test/golden/mandelbrot-424242.json` is the committed 64×64 pixel baseline.
  If the app's appearance *intentionally* changes, regenerate it with `node test/make-golden.cjs`
  and commit the new file — otherwise the golden check is your pixel-regression guard.
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
