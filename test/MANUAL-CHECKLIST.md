# FRACTAL FORGE — Manual Browser Checklist

Browser automation (Playwright/Puppeteer) is not available in the current
environment, so the browser-level smoke checks below are run manually.
Open the site (local `index.html` or the GitHub Pages URL) in a real browser
with WebGL enabled, and work through each item. Mark each box as you verify.

## Boot & rendering
- [ ] The app boots without an uncaught exception (check DevTools Console).
- [ ] A fractal frame renders on the canvas (not a blank/black screen).
- [ ] The FPS counter in the status bar updates.

## Modes
- [ ] Every one of the 14 modes can be selected from the mode list and renders.
- [ ] Selecting a 3D mode (Mandelbulb) shows the orbit controls.
- [ ] Selecting an L-system mode (Koch/Dragon/Tree/Plant) renders the structure.

## Effects
- [ ] Motion trails can be enabled and disabled without a shader failure.
- [ ] Bloom, vignette, and aberration sliders change the image without errors.

## State & randomize
- [ ] Randomize changes the image and synchronizes palette + camera state.
- [ ] New World resets to a fresh, valid state.
- [ ] **Seed drives every GPU mode:** change the seed (Randomize, or import a share code
      with a different seed) and confirm the composition changes in *all* GPU modes —
      Mandelbrot, Julia, Burning Ship, Newton, Sierpinski, Cosmic Nebula, Dreamscape,
      Neural Bloom, Quantum Field, Mandelbulb — while the render stays stable (no
      flicker, NaNs, or broken geometry). (D3 — real-browser check.)

## Share codes
- [ ] A share code can be generated (export) and copied.
- [ ] A share code can be pasted and imported, restoring the world.
- [ ] An invalid/garbage share code is rejected with an error toast (no crash).

## Gallery
- [ ] An artwork can be saved and appears in the gallery.
- [ ] A saved artwork can be restored, returning the exact world.
- [ ] Gallery controls work: favorite, delete (with confirmation), and list order.

## Export
- [ ] Export completes at a modest test resolution (e.g. 1024×1024) and downloads a PNG.
- [ ] A second export click while one is in progress does not start a duplicate.
- [ ] **Export matches the screen (D4):** animate a time-based mode (e.g. Dreamscape or
      Quantum Field), pause mid-motion, then export — the PNG matches the on-screen
      composition (not the `time = 0` frame). Save to gallery and confirm the thumbnail
      also matches. (Real-browser check — pixel comparison.)

## Modals & accessibility
- [ ] Modals open and close correctly (button, Escape, and backdrop).
- [ ] Focus is trapped inside an open modal and restored to the opener on close.
- [ ] Keyboard-disable (Settings) does **not** disable pointer/touch controls.
- [ ] Reduced-motion preference freezes time-based animation but keeps a static frame.
- [ ] High-contrast preference changes the palette rendering.

## Viewports & responsive layout
- [ ] Desktop viewport (≥1280px) layout is correct; both side panels sit beside the artwork.
- [ ] Tablet viewport (~1024px) layout is usable.
- [ ] Mobile portrait (≤480px): both panels start **collapsed** as narrow edge tabs so the artwork is fully visible.
- [ ] Tapping an edge tab opens that panel as a full-height drawer with a dimmed backdrop.
- [ ] Tapping the backdrop (or the panel's collapse button) closes the drawer and restores the artwork.
- [ ] The top bar buttons fit without overflowing or wrapping on a 390px-wide viewport.
- [ ] Mobile landscape (short height): the top bar / status bar compress and the panels remain usable.
- [ ] At 200% browser zoom the layout still adapts (no clipped or unreachable controls).
- [ ] Resizing the window re-renders without a crash (debounced buffer rebuild).

## Context loss (best effort)
- [ ] If the GPU context is lost and restored, the app recovers and re-renders.
