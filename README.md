<div align="center">

# FRACTAL FORGE

### An immersive, infinitely generative fractal art installation

**Explore infinite worlds · Customize the render · Export gallery-quality art — all in your browser.**

[Features](#-features) · [Technologies](#-technologies) · [Getting Started](#-getting-started) · [Controls](#-controls) · [Deployment](#-github-pages-deployment) · [Architecture](#-architecture)

</div>

---

FRACTAL FORGE is a production-quality, **zero-dependency** generative art experience. It renders
real-time fractal mathematics directly on the GPU, wraps it in a premium dark/glassmorphic interface,
and lets you forge, save, share, and export unique compositions — no backend, no build step, no
install. Open `index.html` and it runs.

Every frame is computed on the GPU with hand-written GLSL. Every palette is a continuous IQ cosine
gradient. Every "world" is a deterministic function of a seed, so any composition can be reproduced
exactly from a short share code.

---

## ✨ Features

### Fractal systems
| Group | Modes |
|---|---|
| **Classic** | Mandelbrot (deep zoom, smooth escape coloring) · Julia Set · Burning Ship · Newton fractals · Sierpinski |
| **Experimental** | Cosmic Nebula · Dreamscape · Neural Bloom · Quantum Field — original procedural modes that generate a unique composition every time |
| **Structural** | Koch Snowflake · Dragon Curve · Fractal Tree · Plant Growth (L-systems) |
| **3D** | Mandelbulb — real-time raymarched distance-estimation fractal with orbit camera |

### Interaction
- **Deep zoom** (the zoom scale caps at 10⁹×) with smooth, continuous escape coloring. The math is 32-bit `highp float`, so very deep zooms show the familiar deep-zoom precision artifacts rather than lossless detail — **drag to pan**, **double-click to focus**
- **Touch**: pinch-to-zoom and pan gestures, mobile-optimized
- **Pause / resume** animation at any time
- **Randomize** — new colors, formulas, animation behavior, and composition in one click
- **New World** — forge an entirely new fractal + parameter set

### Color system
Nine continuous IQ cosine palettes — **Cyber Neon, Cosmic Sunset, Aurora, Deep Ocean, Firestorm,
Monochrome, Vaporwave, Synthwave, Rainbow** — with a live gradient editor, animated palette cycling,
and smooth interpolation. No flat or banded colors.

### Visual effects
Bloom · motion trails (feedback buffer) · chromatic aberration · vignette · depth fog · audio-reactive
brightness · a drifting ambient particle field behind the render. The scene never feels static.

### 3D experience
The **Mandelbulb** mode raymarches a true 3D fractal in real time with a smooth orbit camera and
adjustable power exponent.

### Gallery & persistence
- **Save Artwork** — capture the current composition (a thumbnail plus the full parameter set)
  into a local gallery stored in `localStorage`
- Browse, **favorite**, **restore**, and **delete** saved creations from the Gallery modal
- Deleting a piece asks for confirmation; favorites are protected when storage is trimmed
- No account, no server — everything stays on your device

### Share system
Every composition serializes into a compact **`FF-…` code**. Copy it, send it, paste it back — the
exact artwork (mode, palette, seed, camera, effects) is reproduced on any machine.

#### Shareable URLs
Any world is also **linkable**: the address bar mirrors the shareable state as
`?fractal=<mode>&seed=<n>&palette=<0–8>&time=<0–1>&iterations=<n>` (updated via `history.replaceState`, so the
back/forward stack stays clean). Opening such a link restores that fractal, seed, palette, animation speed,
and iteration count before the first render. Invalid or out-of-range values are dropped or clamped,
so a junk link always renders a valid default world instead of breaking.

### Export
Render to **PNG** at your current resolution or at wallpaper sizes — **1920×1080, 2560×1440,
3840×2160** — suitable for use as desktop wallpapers.

### Audio-reactive mode
Optional microphone input drives the render: frequency analysis splits the signal into bass / mid /
treble bands that modulate motion and brightness. Falls back gracefully if access is denied.

> **Secure context required:** browsers only expose the microphone (`getUserMedia`) in a *secure
> context* — `https://` or `localhost`. The GitHub Pages deployment is HTTPS, so it works there;
> opening the files via `file://` will not grant microphone access.

### Performance
- Targets **60 FPS** on modern hardware
- **Adaptive quality** automatically scales the render buffer to hold frame rate on slower devices
- GPU-accelerated rendering with ping-pong feedback buffers and a separable bloom pipeline

### Accessibility
Keyboard navigation · reduced-motion option · high-contrast mode · responsive, mobile-first layout.

---

## 🛠 Technologies

- **HTML5** — semantic, accessible document structure
- **CSS3** — dark glassmorphic UI, custom properties, responsive layout, motion
- **Modern JavaScript (ES6+)** — modular, namespaced architecture in a single dependency-free file
- **WebGL + GLSL** — all fractal and post-processing passes are hand-written fragment shaders
- **Canvas 2D API** — L-system generation and the ambient particle field
- **Web Audio API** — microphone frequency analysis for the reactive mode
- **localStorage** — gallery persistence and settings

> **Design note:** the brief suggested Three.js. FRACTAL FORGE deliberately uses **raw WebGL** instead —
> the fractal and post-processing passes are custom fragment shaders, so a scene-graph library would add
> weight without adding capability. The result is a fully self-contained project with **zero runtime
> dependencies**, which is what makes it trivially deployable to GitHub Pages.

---

## 🚀 Getting Started

### Requirements
Any modern browser with **WebGL** enabled. Designed for and manually tested on recent
**Chrome, Edge, Firefox, and Safari**; older or WebGL-disabled browsers will show a graceful
"WebGL is not supported" message instead of the render. No build tools, no package manager, no
server required.

### Run locally
1. Clone or download the project.
2. Open `index.html` directly in your browser — **or** serve the folder for the best experience:

```bash
# any static server works
python -m http.server 8000
# then visit http://localhost:8000
```

> Serving over a local origin (rather than `file://`) ensures `localStorage` and clipboard access
> behave consistently. Note that `http://localhost` is treated as a *secure context* by browsers,
> so the microphone works there too — but a plain-HTTP LAN IP (e.g. `http://192.168.x.x`) is not,
> and the mic will be unavailable.

---

## 🎮 Controls

### Mouse
| Action | Effect |
|---|---|
| Scroll wheel | Zoom in / out (cursor-anchored) |
| Click + drag | Pan the viewport |
| Double-click | Focus / recenter on a point |

### Touch
| Action | Effect |
|---|---|
| Pinch | Zoom |
| One-finger drag | Pan |

### Keyboard
| Key | Action |
|---|---|
| Arrow keys | Pan the viewport |
| `+` / `-` | Zoom in / out |
| `Space` | Pause / resume |
| `R` | Randomize |
| `N` | New world |
| `S` | Copy share code |
| `E` | Open export |
| `G` | Open gallery |
| `A` | Toggle audio-reactive mode |
| `1`–`9` | Select palette 1–9 |

> Keyboard shortcuts are ignored while you are typing in a text field, and can be
> disabled entirely from **Settings → Keyboard shortcuts**.

### Top bar
**Randomize** · **New World** · **Share** · **Export** · **Gallery** · **Save** · **Audio** · **Settings**

### Mode-specific controls
The left panel shows a context-sensitive control block for the active mode:
- **Mandelbulb** — **Power** slider (2–16) and a **Reset camera** button; drag to orbit the 3D view.
- **L-systems** (Koch, Dragon, Tree, Plant) — **Growth** slider (0–100%) that animates the structure drawing itself.
- **Julia Set** — **Drift** slider that moves the Julia constant for a continuously evolving set.

### Modals
Dialogs (Export, Gallery, Save, Settings, Help) are accessible: **Escape** closes the topmost
modal, **Tab / Shift+Tab** cycle focus within it, focus returns to the element that opened it on
close, and the background UI is made inert while a modal is open.

---

## 📁 Project structure

```
/
├── index.html        # Document, UI panels, modals, onboarding
├── styles.css        # Dark glassmorphic theme, responsive layout
├── src/
│   ├── main.js       # App entry (ES module): GL, ColorSystem, Engine, LSystem,
│   │                 #   Effects, Interaction, Procedural, Share, Gallery, Audio,
│   │                 #   Ambient, A11y, App + boot
│   ├── shaders.js    # GLSL source
│   ├── fractals.js   # mode registry + parameter sets
│   ├── util.js       # PRNG, math, encoding helpers
│   ├── camera.js     # pan/zoom, deep-zoom, 3D orbit
│   ├── state.js      # render-parameter source of truth
│   ├── exporter.js   # PNG / high-res / wallpaper rendering
│   └── ui.js         # DOM bindings, panels, toasts, modals
├── package.json      # `npm test` entry point (no runtime dependencies)
├── assets/
│   └── favicon.svg
├── test/
│   ├── functional.js     # Pure-logic test suite (share, state, gallery, L-systems)
│   ├── smoke.js          # Module API smoke test
│   ├── glsl-check.js     # GLSL sanity checks
│   └── MANUAL-CHECKLIST.md  # Browser smoke checklist
└── README.md
```

---

## 🏗 Architecture

> **Contributors:** the deep map — region line numbers, the invariants the tests protect, the
> validation ladder, and deployment mechanics — lives in [ARCHITECTURE.md](ARCHITECTURE.md).

The app is organized into **20 self-contained modules**, each an IIFE exposing a small public API.
`src/main.js` is the entry point; `Shaders`, `Fractals`, `Util`, `Camera`, `State`, `Exporter`,
and `UI` live in sibling files under `src/`, and the rest live in `main.js`.
There is no global state leakage and no external dependency — the modules communicate through
explicit function calls.

| Module | Responsibility |
|---|---|
| `Util` | PRNG (mulberry32 / sfc32), math helpers, base64url, number packing |
| `GL` | WebGL context, shader/program compilation, FBOs, fullscreen-quad rendering |
| `Shaders` | All GLSL: 10 fractal fragment shaders + 5 post-processing passes |
| `ColorSystem` | 9 IQ cosine palettes, gradient editor, animated cycling, CPU sampling |
| `Fractals` | 14-mode registry with per-mode parameter sets and grouping |
| `Engine` | Lazy program compilation, uniform binding, fractal + L-system rendering |
| `LSystem` | Koch / Dragon / Tree / Plant — string rewriting + turtle graphics |
| `Effects` | Post pipeline: bright pass → separable blur → composite → feedback trails |
| `Camera` | Pan / zoom / deep-zoom, 3D orbit for Mandelbulb |
| `Interaction` | Mouse, touch, and keyboard input |
| `State` | Single source of truth for render parameters |
| `Procedural` | Seed-based randomize, mutate, and parameter blending |
| `Share` | `FF-` code serialize / deserialize |
| `Exporter` | High-resolution PNG rendering and download |
| `Gallery` | Save / restore / favorite artworks with thumbnails (`localStorage`) |
| `Audio` | Microphone input and bass/mid/treble frequency analysis |
| `Ambient` | Background particle field (2D canvas) |
| `A11y` | Reduced motion, high contrast, adaptive quality, keyboard settings |
| `UI` | DOM bindings: panels, sliders, buttons, toasts, modals |
| `App` | Orchestrator: init, main `requestAnimationFrame` loop, adaptive quality |

### Rendering pipeline
```
fractal fragment shader ──► base FBO
        │
        ├─► bright pass ─► blur (H) ─► blur (V) ─┐
        │                                        ├─► composite ─► screen
        └─► feedback (ping-pong trails) ─────────┘
```
WebGL cannot read and write the same texture in one pass, so the trails buffer uses a **ping-pong**
pair that swaps each frame.

---

## 📦 GitHub Pages deployment

Because the project has **no build step and no dependencies**, deployment is trivial:

1. Push this repository to GitHub.
2. In the repo, go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to `Deploy from a branch`.
4. Choose the **`master`** branch (the repository default) and the `/ (root)` directory.
5. Click **Save**.

Within a minute or two your site is live. For this repository it is published at:

> **https://mheerspink75.github.io/fractal-forge/**

> No `base` path, no bundler, no environment variables — the relative asset paths work as-is.
> GitHub Pages serves over **HTTPS**, which is a secure context, so the microphone, clipboard,
> and `localStorage` features all work on the live site.

---

## 🩺 Troubleshooting

| Symptom | Likely cause & fix |
|---|---|
| **"FRACTAL FORGE could not start" overlay** | WebGL is unavailable or blocked. Enable hardware acceleration, update your GPU drivers, or try a different browser. |
| **Blank canvas / shader errors in the console** | A fragment shader failed to compile on your GPU. Check the console for the first error line; this is usually a driver issue — update graphics drivers. |
| **Microphone does nothing** | The page must be served over **HTTPS or `localhost`** (a secure context). `file://` and plain-HTTP origins cannot access the mic. Also confirm you granted the permission prompt. |
| **Share code won't copy** | Clipboard access also requires a secure context, or the browser blocked it. Use the code shown in the dialog and copy it manually. |
| **Export fails or the tab freezes** | Very large exports (4K) allocate big framebuffers and can exceed available memory. Close other tabs, retry at a smaller size, or use "Current". |
| **Gallery save fails / oldest items disappear** | `localStorage` is limited (typically ~5 MB). The app trims the oldest non-favorited pieces to make room; favorite the pieces you want to keep. |
| **Graphics context lost mid-session** | The GPU driver dropped the WebGL context (common under heavy load). The app pauses and automatically rebuilds when the context is restored. |

---

## 🧪 Testing

The project ships a lightweight, **dependency-free** test suite that runs in plain Node — no
framework, no browser, no build step. It exercises the pure logic (state, share codes, gallery,
L-systems, color system) and statically sanity-checks every GLSL shader.

```bash
npm test
```

This runs three suites:

| Suite | What it verifies |
|---|---|
| `test/functional.js` | Share-code encode/decode round trips, invalid-code rejection, boundary clamping, deterministic seeded generation, gallery schema migration & corrupt-JSON handling, mode-registry completeness |
| `test/smoke.js` | All 20 modules are defined and expose their expected public APIs |
| `test/glsl-check.js` | Every shader has balanced braces/parens and declares the uniforms it uses |

> **Browser behavior** (rendering, gestures, modals, audio) is covered by the automated
> Playwright suite below, with the manual checklist in
> [`test/MANUAL-CHECKLIST.md`](test/MANUAL-CHECKLIST.md) as a backup.

### Real-browser checks (Playwright)

The Node suite can't run WebGL, so `test/browser.js` drives real headless Chromium
(Playwright + software WebGL via SwiftShader) and verifies the checks only a real browser can:

- **D3** — the seed drives **every** GPU mode (all 10 modes render a valid frame and change
  composition when the seed changes),
- **D4** — export matches the on-screen composition at **live** animation time (not `time = 0`),
- **D10** — action keys are inert behind an open modal, while pan/zoom/space still work.

```bash
npm run test:browser                  # local (auto-served on :8123) + production site
SKIP_LIVE=1 npm run test:browser      # local target only (what CI runs)
BASE_URL=<url> npm run test:browser   # a single custom target
```

Evidence (screenshots + exported PNGs) is written to `test/.evidence/<target>/`.

### CI

GitHub Actions runs on every push/PR to `master` (`.github/workflows/ci.yml`). Both jobs must
pass before a merge:

| Job | What it runs |
|---|---|
| `test` | `npm ci` + `npm test` (functional + smoke + glsl-check) |
| `browser` | `npm ci` + `npx playwright install --with-deps chromium` + `SKIP_LIVE=1 npm run test:browser` (tests the PR's own files, not the production site) |

---

## 🔮 Future enhancements

- **More 3D fractals** — fractal caves, recursive crystals, infinite temples
- **Volumetric light rays** and god-ray scattering in the composite pass
- **WebGPU** backend for compute-shader fractals and higher iteration counts
- **Palette import** — load custom IQ cosine palettes from a URL
- **Time-lapse export** — render an animated sequence to WebM
- **Cloud gallery** — optional signed share links for cross-device collections
- **Presets marketplace** — community-curated `FF-` codes

---

<div align="center">

**FRACTAL FORGE** — built with raw WebGL, GLSL, and a love of mathematics.

*No frameworks. No build step. Just infinite art.*

</div>
