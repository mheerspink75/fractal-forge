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
  let camPitch = 0; // radians; 0 = the original slightly-above framing (y offset 0.6)
  let orbitRadius = 3.0;

  function applyOrbit() {
    // camPitch tilts the orbit up/down around the target. At camPitch = 0 the
    // horizontal radius is full and the height is the original +0.6 baseline, so
    // the default framing is byte-identical to before pitch existed.
    const horiz = orbitRadius * Math.cos(camPitch);
    camPos = [
      Math.sin(camAngle) * horiz,
      0.6 + orbitRadius * Math.sin(camPitch),
      Math.cos(camAngle) * horiz
    ];
    camTarget = [0, 0, 0];
  }

  function reset(modeId) {
    const m = Fractals.get(modeId);
    center = { x: m.center[0], y: m.center[1] };
    zoom = (window.innerHeight || 800) / m.span;
    camAngle = 0;
    orbitRadius = m.orbitRadius || 3.0; // per-mode framing (e.g. the tree is closer)
    camPitch = Number.isFinite(m.camPitch) ? m.camPitch : 0; // per-mode pitch default
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

  // Vertical orbit (pitch). Bounded so the camera stays in a sane band above
  // and below the subject instead of diving through it. Mirrors setAngle.
  const PITCH_MAX = 1.05; // ~60 degrees
  function setPitch(p) {
    camPitch = Util.clamp(Number.isFinite(p) ? p : 0, -PITCH_MAX, PITCH_MAX);
    applyOrbit();
  }
  function rotatePitch(delta) {
    camPitch = Util.clamp(camPitch + delta, -PITCH_MAX, PITCH_MAX);
    applyOrbit();
  }
  function getPitch() {
    return camPitch;
  }

  // --- 3D auto-orbit (Phase 4) ---
  // While the Mandelbulb is animating, the camera drifts around the bulb at a
  // slow, constant rate — the "orbit" half of the classic 3D intro. Any user
  // touch (orbit drag, zoom, focus) stops the drift for a grace window so the
  // camera never fights the hand.
  const AUTO_ORBIT_RATE = 0.05;   // rad/s — same family as the 2D pan rates
  const AUTO_ORBIT_IDLE_MS = 2000;
  let lastTouch = -Infinity;

  // Call from every user interaction with the 3D view.
  function touch() {
    lastTouch = performance.now();
  }

  // Advances the orbit when the view is idle. Safe no-op when the user is
  // actively driving the camera.
  //
  // The drift is driven by REAL elapsed time (the rAF timestamps), not the
  // loop's dt: the loop caps dt (anti time-jump), which would slow the camera
  // to a crawl on low-fps machines (software GL / CI) where each tick is
  // seconds apart. Real-time drift keeps the "slow constant rate" promise
  // there; on a 60fps machine the per-tick step is identical to the old
  // dt-based step, so shipped motion is unchanged.
  const AUTO_ORBIT_MAX_GAP_MS = 60000; // longer gaps = suspend/re-enable: no jump
  let lastOrbitNow = null;

  function autoOrbit(now) {
    if (now - lastTouch <= AUTO_ORBIT_IDLE_MS) {
      lastOrbitNow = null; // re-baseline on the next enabled tick (grace window)
      return;
    }
    if (lastOrbitNow != null && now - lastOrbitNow <= AUTO_ORBIT_MAX_GAP_MS) {
      camAngle += (AUTO_ORBIT_RATE * (now - lastOrbitNow)) / 1000;
    }
    lastOrbitNow = now;
    applyOrbit();
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
    setPitch,
    rotatePitch,
    getPitch,
    setOrbitRadius,
    getOrbitRadius,
    touch,
    autoOrbit
  };
})();
