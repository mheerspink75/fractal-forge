/* ============================================================
   Util — PRNG, math, encoding
   ============================================================ */
export const Util = (() => {
  // Deterministic 32-bit PRNG (mulberry32). Returns a function in [0,1).
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 4-state PRNG (sfc32) — longer period, good for procedural variety.
  function sfc32(a, b, c, d) {
    return function () {
      a >>>= 0;
      b >>>= 0;
      c >>>= 0;
      d >>>= 0;
      let t = (a + b) | 0;
      a = b ^ (b >>> 9);
      b = (c + (c << 3)) | 0;
      c = (c << 21) | (c >>> 11);
      d = (d + 1) | 0;
      t = (t + d) | 0;
      c = (c + t) | 0;
      return (t >>> 0) / 4294967296;
    };
  }

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (e0, e1, x) => {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };

  // Random integer in [min, max] inclusive from a PRNG.
  const randInt = (rng, min, max) => Math.floor(rng() * (max - min + 1)) + min;
  // Random float in [min, max) from a PRNG.
  const randRange = (rng, min, max) => min + rng() * (max - min);
  // Pick a random element from an array using a PRNG.
  const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

  // Base64url encode/decode of a UTF-8 string (for share codes).
  function b64urlEncode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecode(str) {
    let b = str.replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) b += '=';
    const bin = atob(b);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  // Compact number array -> base36 string (for share codes).
  function packNumbers(nums) {
    return nums
      .map((n) => {
        const r = Math.round(n * 1e5) / 1e5;
        return String(r).replace('-', '~');
      })
      .join('_');
  }
  function unpackNumbers(str) {
    return str.split('_').map((s) => parseFloat(s.replace('~', '-')));
  }

  const now = () => performance.now();

  return {
    mulberry32,
    sfc32,
    clamp,
    lerp,
    smoothstep,
    randInt,
    randRange,
    pick,
    b64urlEncode,
    b64urlDecode,
    packNumbers,
    unpackNumbers,
    now
  };
})();
