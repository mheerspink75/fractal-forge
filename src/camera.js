/* ============================================================
   Camera — pan/zoom state, deep-zoom, 3D orbit
   ============================================================ */
import { Util } from './util.js';
import { Fractals } from './fractals.js';

export const Camera = (() => {
  let center = { x: -0.6, y: 0.0 };
  let zoom = 100; // pixels per fractal unit
  let camPos = [0, 0.6, 3.0];
  let camTarget = [0, 0, 0];
  let camAngle = 0;
  let orbitRadius = 3.0;

  function applyOrbit() {
    camPos = [Math.sin(camAngle) * orbitRadius, 0.6, Math.cos(camAngle) * orbitRadius];
    camTarget = [0, 0, 0];
  }

  function reset(modeId) {
    const m = Fractals.get(modeId);
    center = { x: m.center[0], y: m.center[1] };
    zoom = (window.innerHeight || 800) / m.span;
    camAngle = 0;
    orbitRadius = 3.0;
    applyOrbit();
  }

  function pan(dxPixels, dyPixels) {
    center.x -= dxPixels / zoom;
    center.y += dyPixels / zoom;
  }

  // Zoom toward a screen point (CSS coords, y-down).
  function zoomAt(factor, screenX, screenY) {
    const w = window.innerWidth,
      h = window.innerHeight;
    const fx = center.x + (screenX - w / 2) / zoom;
    const fy = center.y - (screenY - h / 2) / zoom;
    zoom = Util.clamp(zoom * factor, 0.5, 1e9);
    center.x = fx - (screenX - w / 2) / zoom;
    center.y = fy + (screenY - h / 2) / zoom;
  }

  function zoomCenter(factor) {
    zoomAt(factor, window.innerWidth / 2, window.innerHeight / 2);
  }

  // Push an absolute zoom (keeps Camera in sync with the zoom slider).
  function setZoom(z) {
    zoom = Util.clamp(z, 0.5, 1e9);
  }

  // Push an absolute 2D center (used when applying a saved/randomized world).
  function setCenter(x, y) {
    center.x = Number.isFinite(x) ? x : center.x;
    center.y = Number.isFinite(y) ? y : center.y;
  }

  // Focus: bring the point under the cursor to center and zoom in.
  function focusAt(screenX, screenY) {
    const w = window.innerWidth,
      h = window.innerHeight;
    center.x += (screenX - w / 2) / zoom;
    center.y -= (screenY - h / 2) / zoom;
    zoomAt(2.2, w / 2, h / 2);
  }

  // --- 3D orbit (Mandelbulb) ---
  function rotate3d(delta) {
    camAngle += delta;
    applyOrbit();
  }
  function setAngle(a) {
    camAngle = Number.isFinite(a) ? a : 0;
    applyOrbit();
  }
  function getAngle() {
    return camAngle;
  }
  function setOrbitRadius(r) {
    orbitRadius = Util.clamp(Number.isFinite(r) ? r : 3.0, 1.5, 8.0);
    applyOrbit();
  }
  function getOrbitRadius() {
    return orbitRadius;
  }

  return {
    get center() {
      return center;
    },
    get zoom() {
      return zoom;
    },
    get camPos() {
      return camPos;
    },
    get camTarget() {
      return camTarget;
    },
    reset,
    pan,
    zoomAt,
    zoomCenter,
    focusAt,
    setZoom,
    setCenter,
    rotate3d,
    setAngle,
    getAngle,
    setOrbitRadius,
    getOrbitRadius
  };
})();
