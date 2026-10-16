/* ============================================================
   State — single source of truth for the current render params
   ============================================================ */
import { Fractals } from './fractals.js';
import { Util } from './util.js';

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
    clock: 0,
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

  // ---------- Shareable URL (link a world) ----------
  // The six fields carried in the URL, with bounds mirroring Share's
  // NUMERIC ranges so a URL can never smuggle an out-of-range uniform.
  // `clock` is the paused moment (seconds, float >= 0); toQuery omits it
  // while it is 0, so a resumed/non-paused world never carries it.
  const URL_FIELDS = [
    { key: 'mode', param: 'fractal', type: 'mode' },
    { key: 'seed', param: 'seed', type: 'int', range: [0, 1e9] },
    { key: 'palette', param: 'palette', type: 'int', range: [0, 8] },
    { key: 'anim', param: 'time', type: 'num', range: [0, 1] },
    { key: 'iterations', param: 'iterations', type: 'int', range: [16, 4096] },
    { key: 'clock', param: 'clock', type: 'num', range: [0, 3600] }
  ];

  // Serialize a state into a query string (no leading '?'). The clock field
  // only appears when it names a moment (> 0): pausing pins it, resuming
  // drops it (clock back to 0).
  function toQuery(s) {
    const fields = URL_FIELDS.filter((f) => f.param !== 'clock' || Number(s[f.key]) > 0);
    return (
      '?' + fields.map((f) => f.param + '=' + encodeURIComponent(String(s[f.key]))).join('&')
    );
  }

  // Parse a query/search string into a validated partial. Unknown or invalid
  // values are dropped; numbers are clamped to their safe bounds.
  function parseURL(search) {
    const out = { partial: {}, changed: false };
    const q = String(search == null ? '' : search).replace(/^[?#]+/, '');
    if (!q) return out;
    const values = {};
    for (const pair of q.split('&')) {
      const i = pair.indexOf('=');
      if (i <= 0) continue;
      let k = pair.slice(0, i);
      let v = pair.slice(i + 1);
      try {
        k = decodeURIComponent(k);
        v = decodeURIComponent(v);
      } catch (e) {
        /* keep raw values on malformed encoding */
      }
      if (values[k] === undefined) values[k] = v;
    }
    for (const f of URL_FIELDS) {
      const raw = values[f.param];
      if (raw === undefined) continue;
      if (f.type === 'mode') {
        if (Fractals.get(raw)) {
          out.partial.mode = raw;
          out.changed = true;
        }
        continue;
      }
      const n = Number(raw);
      if (!Number.isFinite(n)) continue;
      out.partial[f.key] =
        f.type === 'int'
          ? Math.round(Util.clamp(n, f.range[0], f.range[1]))
          : Util.clamp(n, f.range[0], f.range[1]);
      out.changed = true;
    }
    return out;
  }

  return { defaults, set, get, reset, clone, toQuery, parseURL };
})();
