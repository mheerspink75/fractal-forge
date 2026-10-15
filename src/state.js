/* ============================================================
   State — single source of truth for the current render params
   ============================================================ */
export const State = (() => {
  const defaults = {
    mode: 'mandelbrot',
    seed: 12345,
    palette: 0,
    palettePhase: 0,
    paletteSpeed: 0.2,
    cycling: false,
    contrast: 1.0,
    iterations: 256,
    detail: 0.5,
    anim: 0.5,
    bloom: 0.6,
    trails: 0.0,
    aberration: 0.2,
    vignette: 0.4,
    fog: 0.3,
    power: 8,
    center: [-0.6, 0.0],
    zoom: 100,
    growth: 1.0,
    camAngle: 0,
    orbitRadius: 3.0,
    juliaPhase: 0.0
  };
  let current = cloneDefaults();

  function cloneDefaults() {
    return Object.assign({}, defaults, { center: defaults.center.slice() });
  }

  function set(partial) {
    Object.assign(current, partial);
  }
  function get() {
    return current;
  }
  function reset() {
    current = cloneDefaults();
  }
  function clone() {
    return Object.assign({}, current, { center: current.center.slice() });
  }

  return { defaults, set, get, reset, clone };
})();
