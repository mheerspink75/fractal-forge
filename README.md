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
- **Infinite zoom** with deep-zoom precision, **drag to pan**, **double-click to focus**
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
- Save artworks locally (thumbnail + full parameter set) in `localStorage`
- Browse, favorite, restore, and delete saved creations
- No account, no server — everything stays on your device

### Share system
Every composition serializes into a compact **`FF-…` code**. Copy it, send it, paste it back — the
exact artwork (mode, palette, seed, camera, effects) is reproduced on any machine.

### Export
Render to **PNG** at your current resolution or at wallpaper sizes — **1920×1080, 2560×1440,
3840×2160** — suitable for use as desktop wallpapers.

### Audio-reactive mode
Optional microphone input drives the render: frequency analysis splits the signal into bass / mid /
treble bands that modulate motion and brightness. Falls back gracefully if access is denied.

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
Any modern browser with WebGL enabled (Chrome, Edge, Firefox, Safari). No build tools, no package
manager, no server.

### Run locally
1. Clone or download the project.
2. Open `index.html` directly in your browser — **or** serve the folder for the best experience:

```bash
# any static server works
python -m http.server 8000
# then visit http://localhost:8000
```

> Serving over HTTP (rather than `file://`) ensures `localStorage`, the microphone, and clipboard
> access all behave consistently.

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
| `R` | Randomize |
| `N` | New world |
| `Space` | Pause / resume |
| `S` | Copy share code |
| `G` | Open gallery |
| `E` | Open export |
| `?` | Help / controls |

### Top bar
**Randomize** · **New World** · **Share** · **Export** · **Gallery** · **Audio** · **Settings**

---

## 📁 Project structure

```
/
├── index.html        # Document, UI panels, modals, onboarding
├── styles.css        # Dark glassmorphic theme, responsive layout
├── script.js         # All application logic (18 namespaced modules)
├── assets/
│   ├── favicon.svg
│   └── logo.svg
└── README.md
```

---

## 🏗 Architecture

`script.js` is organized into **18 self-contained modules**, each an IIFE exposing a small public API.
There is no global state leakage and no external dependency — the modules communicate through explicit
function calls.

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

## 🖼 Screenshots

> *Add screenshots here once the project is running in a browser.*

| Classic | Experimental | 3D |
|---|---|---|
| _Mandelbrot deep zoom_ | _Cosmic Nebula_ | _Mandelbulb_ |
| `![mandelbrot](assets/screenshots/mandelbrot.png)` | `![nebula](assets/screenshots/nebula.png)` | `![mandelbulb](assets/screenshots/mandelbulb.png)` |

---

## 📦 GitHub Pages deployment

Because the project has **no build step and no dependencies**, deployment is trivial:

1. Push this repository to GitHub.
2. In the repo, go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to `Deploy from a branch`.
4. Choose the `main` branch and the `/ (root)` directory.
5. Click **Save**.

Within a minute or two your site is live at `https://<username>.github.io/<repo>/`.

> No `base` path, no bundler, no environment variables — the relative asset paths work as-is.

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
