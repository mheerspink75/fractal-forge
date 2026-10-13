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

## Modals & accessibility
- [ ] Modals open and close correctly (button, Escape, and backdrop).
- [ ] Focus is trapped inside an open modal and restored to the opener on close.
- [ ] Keyboard-disable (Settings) does **not** disable pointer/touch controls.
- [ ] Reduced-motion preference freezes time-based animation but keeps a static frame.
- [ ] High-contrast preference changes the palette rendering.

## Viewports
- [ ] Desktop viewport (≥1280px) layout is correct.
- [ ] Mobile viewport (≤480px) layout is usable; panels are reachable.
- [ ] Resizing the window re-renders without a crash (debounced buffer rebuild).

## Context loss (best effort)
- [ ] If the GPU context is lost and restored, the app recovers and re-renders.
