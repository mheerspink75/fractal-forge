/* ============================================================
   FRACTAL FORGE — script.js
   A browser-only generative fractal art installation.
   Raw WebGL · no dependencies · internally modular.

   Module map (namespaced objects, defined in order):
     Util            — PRNG, math, encoding helpers
     GL              — WebGL context, shaders, programs, FBOs
     Shaders         — GLSL source (common chunks + per-mode)
     ColorSystem     — palettes, gradient editor, cycling
     Fractals        — mode registry + parameter sets
     Engine          — dispatches the active mode, owns uniforms
     LSystem         — Koch / Dragon / Tree / Plant string rewriting
     Effects         — post-processing pipeline (bloom/trails/etc.)
     Camera          — pan/zoom state, deep-zoom precision, 3D orbit
     Interaction     — mouse / touch / keyboard input
     State           — single source of truth for render parameters
     Procedural      — seed, randomize, mutations, blending
     Share           — FF- code serialize / import / export
     Exporter        — PNG / high-res / wallpaper rendering
     Gallery         — save / restore / favorite / thumbnails
     Audio           — microphone reactive mode
     Ambient         — background particle field
     A11y            — reduced motion, high contrast, keyboard
     UI              — DOM bindings, panels, toasts, modals
     App             — orchestrator, main loop, adaptive quality
   ============================================================ */
'use strict';

/* ============================================================
   Util — PRNG, math, encoding
   ============================================================ */
const Util = (() => {
  // Deterministic 32-bit PRNG (mulberry32). Returns a function in [0,1).
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 4-state PRNG (sfc32) — longer period, good for procedural variety.
  function sfc32(a, b, c, d) {
    return function () {
      a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
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
    return nums.map((n) => {
      const r = Math.round(n * 1e5) / 1e5;
      return String(r).replace('-', '~');
    }).join('_');
  }
  function unpackNumbers(str) {
    return str.split('_').map((s) => parseFloat(s.replace('~', '-')));
  }

  const now = () => performance.now();

  return {
    mulberry32, sfc32, clamp, lerp, smoothstep,
    randInt, randRange, pick,
    b64urlEncode, b64urlDecode, packNumbers, unpackNumbers, now,
  };
})();

/* ============================================================
   GL — WebGL context, shader/program/FBO management
   ============================================================ */
const GL = (() => {
  let gl = null;
  let canvas = null;
  let quadBuffer = null;
  let contextLost = false;
  let onContextLost = null;
  let onContextRestored = null;

  function setContextHandlers(handlers) {
    onContextLost = handlers.onLost || null;
    onContextRestored = handlers.onRestored || null;
  }

  function init(canvasEl) {
    canvas = canvasEl;
    const attrs = {
      antialias: false,
      depth: false,
      stencil: false,
      alpha: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    };
    gl = canvasEl.getContext('webgl', attrs) || canvasEl.getContext('experimental-webgl', attrs);
    if (!gl) throw new Error('WebGL is not supported in this browser.');
    setupQuad();
    // Handle GPU context loss: pause, then rebuild resources on restore.
    canvasEl.addEventListener('webglcontextlost', (e) => {
      e.preventDefault(); // signal intent to restore
      contextLost = true;
      if (onContextLost) onContextLost();
    });
    canvasEl.addEventListener('webglcontextrestored', () => {
      contextLost = false;
      setupQuad();
      if (onContextRestored) onContextRestored();
    });
    return gl;
  }

  // Fullscreen quad: two triangles covering clip space [-1,1].
  function setupQuad() {
    quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  }

  function compile(type, source, name) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      // Keep the full source + diagnostics in the console; surface a concise message.
      console.error('[FRACTAL FORGE] Shader compile failed (' + name + '):\n' + log + '\n\n' + source);
      const first = log ? log.split('\n')[0].trim() : 'unknown error';
      throw new Error('Shader compile failed: ' + name + ' — ' + first);
    }
    return shader;
  }

  // Create a program from vertex + fragment source, cache uniform locations.
  // `name` is used in diagnostics so failures are attributable to a specific pass.
  function createProgram(vsSource, fsSource, name) {
    const label = name || 'program';
    let vs = null, fs = null, program = null;
    try {
      vs = compile(gl.VERTEX_SHADER, vsSource, label + ':vertex');
      fs = compile(gl.FRAGMENT_SHADER, fsSource, label + ':fragment');
      program = gl.createProgram();
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(program);
        console.error('[FRACTAL FORGE] Program link failed (' + label + '):\n' + log);
        const first = log ? log.split('\n')[0].trim() : 'unknown error';
        throw new Error('Program link failed: ' + label + ' — ' + first);
      }
    } catch (e) {
      // Clean up any partially-created objects before rethrowing.
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
      if (program) gl.deleteProgram(program);
      throw e;
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    const uniforms = {};
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(program, i);
      uniforms[info.name] = { loc: gl.getUniformLocation(program, info.name), type: info.type };
    }
    return { program, uniforms };
  }

  // Create a texture + framebuffer of a given size.
  function createFBO(width, height, { float = false } = {}) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    const internal = float ? gl.HALF_FLOAT : gl.RGBA;
    const type = float ? (gl.HALF_FLOAT_OES !== undefined ? gl.HALF_FLOAT_OES : gl.UNSIGNED_BYTE) : gl.UNSIGNED_BYTE;
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, gl.RGBA, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

    // Validate completeness before the framebuffer is ever used for rendering.
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteTexture(texture);
      gl.deleteFramebuffer(fbo);
      console.error('[FRACTAL FORGE] Incomplete framebuffer (' + width + 'x' + height + '): 0x' + status.toString(16));
      throw new Error('Failed to create a complete ' + width + 'x' + height + ' framebuffer (status 0x' + status.toString(16) + ').');
    }

    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, texture, width, height };
  }

  function deleteFBO(target) {
    if (!target) return;
    gl.deleteTexture(target.texture);
    gl.deleteFramebuffer(target.fbo);
  }

  // Bind a program, draw the fullscreen quad.
  // The quad buffer is a 4-vertex triangle strip covering clip space [-1,1];
  // it must be drawn as a TRIANGLE_STRIP (not TRIANGLES) or only one triangle
  // (half the viewport) is rasterized.
  function draw(programObj) {
    gl.useProgram(programObj.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    const loc = gl.getAttribLocation(programObj.program, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // Render a program to a target FBO (or null = default framebuffer / screen).
  function render(programObj, target, width, height) {
    if (target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, target.width, target.height);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
    }
    draw(programObj);
  }

  function setUniform(name, value, programObj) {
    const u = programObj.uniforms[name];
    if (!u) return;
    // gl.uniform*() is a no-op unless the location belongs to the *currently
    // bound* program, so bind it first (callers set uniforms before draw()).
    gl.useProgram(programObj.program);
    const loc = u.loc;
    const v = Array.isArray(value) ? value : [value];
    // Integer / sampler / bool uniforms must use the *i setters.
    if (u.type === gl.INT || u.type === gl.BOOL || u.type === gl.SAMPLER_2D) {
      gl.uniform1i(loc, Math.round(v[0]));
      return;
    }
    if (typeof v[0] === 'number') {
      if (v.length === 1) gl.uniform1f(loc, v[0]);
      else if (v.length === 2) gl.uniform2f(loc, v[0], v[1]);
      else if (v.length === 3) gl.uniform3f(loc, v[0], v[1], v[2]);
      else if (v.length === 4) gl.uniform4f(loc, v[0], v[1], v[2], v[3]);
    } else if (typeof v[0] === 'boolean') {
      gl.uniform1i(loc, v[0] ? 1 : 0);
    }
  }

  function resize(width, height) {
    canvas.width = width;
    canvas.height = height;
  }

  function bindTexture(unit, texture) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
  }

  return {
    init, createProgram, createFBO, deleteFBO, render, setUniform, resize, bindTexture,
    setContextHandlers,
    get gl() { return gl; },
    get canvas() { return canvas; },
    get contextLost() { return contextLost; },
  };
})();

/* ============================================================
   Shaders — GLSL source (common chunks + per-mode + post-fx)
   ============================================================ */
const Shaders = (() => {
  const VERTEX = `
    attribute vec2 a_pos;
    varying vec2 vUv;
    void main() {
      vUv = a_pos * 0.5 + 0.5;
      gl_Position = vec4(a_pos, 0.0, 1.0);
    }
  `;

  // Shared uniforms + helper functions used by every fractal mode.
  const COMMON = `
    precision highp float;
    uniform vec2  u_resolution;
    uniform float u_time;
    uniform vec2  u_center;
    uniform float u_zoom;        // pixels per fractal unit
    uniform int   u_iterations;
    uniform float u_detail;
    uniform float u_anim;
    uniform float u_seed;
    uniform vec3  u_pal_a;       // IQ cosine palette (a,b,c,d) as RGB vectors
    uniform vec3  u_pal_b;
    uniform vec3  u_pal_c;
    uniform vec3  u_pal_d;
    uniform float u_palette_phase;
    uniform float u_contrast;
    uniform vec3  u_audio;       // bass, mid, treble
    uniform float u_high_contrast;
    uniform vec2  u_mouse;

    vec3 palette(float t) {
      // Detail control (u_detail, [0,1], default 0.5): scales the palette
      // color-frequency. Neutral at the default (s == 1.0, render unchanged);
      // higher adds fine detail, lower softens it.
      float s = 1.0 + 0.5 * (u_detail - 0.5);
      return u_pal_a + u_pal_b * cos(6.28318530718 * (u_pal_c * (t * s) + u_pal_d));
    }

    float hash21(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    float vnoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      float a = hash21(i);
      float b = hash21(i + vec2(1.0, 0.0));
      float c = hash21(i + vec2(0.0, 1.0));
      float d = hash21(i + vec2(1.0, 1.0));
      return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
    }

    float fbm(vec2 p) {
      float v = 0.0;
      float a = 0.5;
      for (int i = 0; i < 6; i++) {
        v += a * vnoise(p);
        p = p * 2.03 + vec2(1.7, 9.2);
        a *= 0.5;
      }
      return v;
    }

    vec2 toFractal() {
      return u_center + (gl_FragCoord.xy - 0.5 * u_resolution) / u_zoom;
    }

    vec3 applyContrast(vec3 c) {
      float k = mix(1.0, u_contrast, 0.6);
      c = (c - 0.5) * k + 0.5;
      if (u_high_contrast > 0.5) {
        float l = dot(c, vec3(0.299, 0.587, 0.114));
        c = mix(vec3(l), c, 1.6);
      }
      return clamp(c, 0.0, 1.0);
    }
  `;

  /* ---------------- Classic fractals ---------------- */

  const MANDELBROT = COMMON + `
    void main() {
      vec2 c = toFractal();
      // Seed-driven view offset (bounded, continuous, deterministic in u_seed).
      c += vec2(0.06 * sin(u_seed * 1.7), 0.06 * cos(u_seed * 2.3));
      vec2 z = vec2(0.0);
      float escape = -1.0;
      for (int i = 0; i < 4096; i++) {
        if (i >= u_iterations) break;
        z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
        if (dot(z, z) > 256.0) { escape = float(i); break; }
      }
      if (escape < 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
      float smoothIter = escape - log2(log2(dot(z, z))) + 4.0;
      float t = smoothIter / float(u_iterations);
      vec3 col = palette(t * 2.0 + u_palette_phase);
      col *= 1.0 + u_audio.x * 0.5;
      gl_FragColor = vec4(applyContrast(col), 1.0);
    }
  `;

  const JULIA = COMMON + `
    uniform float u_julia_phase;
    void main() {
      vec2 p = toFractal();
      float t = u_time * 0.12 * u_anim + u_seed + u_julia_phase;
      vec2 c = vec2(0.7885 * cos(t), 0.7885 * sin(1.3 * t));
      vec2 z = p;
      float escape = -1.0;
      for (int i = 0; i < 4096; i++) {
        if (i >= u_iterations) break;
        z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
        if (dot(z, z) > 256.0) { escape = float(i); break; }
      }
      if (escape < 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
      float smoothIter = escape - log2(log2(dot(z, z))) + 4.0;
      float tt = smoothIter / float(u_iterations);
      vec3 col = palette(tt * 2.0 + u_palette_phase);
      col *= 1.0 + u_audio.x * 0.4;
      gl_FragColor = vec4(applyContrast(col), 1.0);
    }
  `;

  const BURNING_SHIP = COMMON + `
    void main() {
      vec2 c = toFractal();
      // Seed-driven view offset (bounded, continuous, deterministic in u_seed).
      c += vec2(0.06 * sin(u_seed * 2.1), 0.06 * cos(u_seed * 1.9));
      vec2 z = vec2(0.0);
      float escape = -1.0;
      for (int i = 0; i < 4096; i++) {
        if (i >= u_iterations) break;
        z = vec2(abs(z.x), abs(z.y));
        z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
        if (dot(z, z) > 256.0) { escape = float(i); break; }
      }
      if (escape < 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
      float smoothIter = escape - log2(log2(dot(z, z))) + 4.0;
      float t = smoothIter / float(u_iterations);
      vec3 col = palette(t * 2.0 + u_palette_phase);
      gl_FragColor = vec4(applyContrast(col), 1.0);
    }
  `;

  const NEWTON = COMMON + `
    void main() {
      vec2 c = toFractal();
      vec2 z = c;
      // Seed picks the target root (a unit-circle point); rotating the root
      // configuration changes the basin layout deterministically.
      vec2 target = vec2(cos(u_seed * 1.3), sin(u_seed * 1.7));
      float escape = -1.0;
      int root = 0;
      for (int i = 0; i < 200; i++) {
        if (i >= u_iterations) break;
        vec2 z2 = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y);
        vec2 z3 = vec2(z2.x * z.x - z2.y * z.y, z2.x * z.y + z2.y * z.x);
        vec2 num = z3 - target;
        vec2 den = 3.0 * z2;
        float dd = dot(den, den);
        if (dd < 1e-12) break;
        vec2 step = vec2(num.x * den.x + num.y * den.y, num.y * den.x - num.x * den.y) / dd;
        z = z - step;
        if (dot(step, step) < 1e-8) {
          if (z.x > 0.5) root = 0;
          else if (z.x < -0.5 && z.y > 0.0) root = 1;
          else root = 2;
          escape = float(i);
          break;
        }
      }
      if (escape < 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
      vec3 col;
      if (root == 0) col = vec3(1.0, 0.35, 0.45);
      else if (root == 1) col = vec3(0.35, 1.0, 0.55);
      else col = vec3(0.45, 0.55, 1.0);
      float tt = escape / float(u_iterations);
      col = mix(col, palette(tt + u_palette_phase), 0.35);
      gl_FragColor = vec4(applyContrast(col), 1.0);
    }
  `;

  const SIERPINSKI = COMMON + `
    void main() {
      vec2 p = toFractal();
      // Seed-driven domain offset (bounded, continuous, deterministic in u_seed).
      p += vec2(0.05 * sin(u_seed * 2.7), 0.05 * cos(u_seed * 3.1));
      float ang = u_time * 0.05 * u_anim;
      float s = sin(ang), c = cos(ang);
      p = mat2(c, -s, s, c) * p;
      float v = 0.0;
      vec2 z = p;
      for (int i = 0; i < 12; i++) {
        z = abs(z);
        if (z.x + z.y > 1.0) z = z - vec2(1.0, 0.0);
        z = z * 2.0;
        v += 1.0;
        if (z.x + z.y > 2.0) break;
      }
      float t = v / 12.0;
      vec3 col = palette(t * 1.5 + u_palette_phase);
      gl_FragColor = vec4(applyContrast(col), 1.0);
    }
  `;

  /* ---------------- Experimental fractals ---------------- */

  const COSMIC_NEBULA = COMMON + `
    void main() {
      vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;
      // Seed shifts the nebula field (bounded, continuous, deterministic in u_seed).
      uv += vec2(0.15 * sin(u_seed * 1.1), 0.15 * cos(u_seed * 1.9));
      float t = u_time * 0.05 * u_anim;
      vec2 q = vec2(fbm(uv * 2.0 + t), fbm(uv * 2.0 - t + 5.0));
      vec2 r = vec2(fbm(uv * 2.0 + q * 2.0 + 1.7 + t), fbm(uv * 2.0 + q * 2.0 + 4.3 - t));
      float f = fbm(uv * 2.0 + r * 2.0);
      float stars = 0.0;
      vec2 sp = uv * 40.0;
      vec2 id = floor(sp);
      float h = hash21(id);
      if (h > 0.985) {
        vec2 fp = fract(sp) - 0.5;
        stars += smoothstep(0.1, 0.0, length(fp)) * (h - 0.985) * 60.0;
      }
      float density = smoothstep(0.3, 0.9, f);
      vec3 base = palette(f * 0.8 + u_palette_phase);
      vec3 col = base * density * 1.4 + vec3(stars);
      col *= 1.0 + u_audio.x * 0.6;
      gl_FragColor = vec4(applyContrast(col), 1.0);
    }
  `;

  const DREAMSCAPE = COMMON + `
    void main() {
      vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;
      float t = u_time * 0.1 * u_anim;
      vec2 z = uv * 1.5;
      float v = 0.0;
      for (int i = 0; i < 8; i++) {
        z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) * 0.5;
        z += vec2(sin(t + u_seed), cos(t * 0.7 + u_seed)) * 0.3;
        z += uv * 0.15;
        v += abs(z.x) + abs(z.y);
      }
      float bands = sin(v * 3.0 + t) * 0.5 + 0.5;
      vec3 col = palette(bands * 0.5 + u_palette_phase);
      col *= 0.6 + 0.4 * smoothstep(0.0, 1.0, v * 0.2);
      col *= 1.0 + u_audio.y * 0.5;
      gl_FragColor = vec4(applyContrast(col), 1.0);
    }
  `;

  const NEURAL_BLOOM = COMMON + `
    void main() {
      vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;
      float t = u_time * 0.15 * u_anim;
      float ang = atan(uv.y, uv.x);
      float rad = length(uv);
      float branches = 6.0 + mod(u_seed, 8.0);
      float wave = sin(ang * branches + t * 2.0) * 0.5 + 0.5;
      float rings = sin(rad * 20.0 - t * 3.0) * 0.5 + 0.5;
      float signal = wave * rings;
      float glow = smoothstep(0.2, 0.0, rad) * 0.5;
      vec3 col = palette(signal * 0.6 + u_palette_phase);
      col *= (0.3 + signal * 0.9) + glow;
      col *= 1.0 + u_audio.z * 0.6;
      gl_FragColor = vec4(applyContrast(col), 1.0);
    }
  `;

  const QUANTUM_FIELD = COMMON + `
    void main() {
      vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;
      float t = u_time * 0.2 * u_anim;
      // Seed shifts the interference phase (bounded, continuous in u_seed).
      float ph = 0.4 * u_seed;
      float a = sin(uv.x * 8.0 + t + ph) * cos(uv.y * 8.0 - t + ph);
      float b = sin(length(uv) * 12.0 - t * 2.0 + ph);
      float c = sin((uv.x + uv.y) * 6.0 + t * 1.5 + ph);
      float field = (a + b + c) / 3.0;
      float interference = smoothstep(0.0, 1.0, abs(field));
      vec3 col = palette(field * 0.5 + 0.5 + u_palette_phase);
      col *= 0.4 + interference;
      float sp = hash21(floor(uv * 60.0) + floor(t));
      col += step(0.99, sp) * 0.5;
      col *= 1.0 + u_audio.x * 0.5;
      gl_FragColor = vec4(applyContrast(col), 1.0);
    }
  `;

  /* ---------------- 3D Mandelbulb (raymarched) ---------------- */

  const MANDELBULB = COMMON + `
    uniform vec3 u_cam_pos;
    uniform vec3 u_cam_target;
    uniform float u_power;

    float mandelbulbDE(vec3 pos) {
      vec3 z = pos;
      float dr = 1.0;
      float r = 0.0;
      const float EPS = 1e-6;
      for (int i = 0; i < 12; i++) {
        r = length(z);
        if (r > 2.0) break;
        if (r < EPS) r = EPS;   // guard division by zero and log(0)
        float theta = acos(clamp(z.z / r, -1.0, 1.0)) * u_power;
        float phi = atan(z.y, z.x) * u_power;
        float zr = pow(r, u_power);
        dr = pow(r, u_power - 1.0) * u_power * dr + 1.0;
        z = zr * vec3(sin(theta) * cos(phi), sin(theta) * sin(phi), cos(theta)) + pos;
      }
      r = max(r, EPS);
      dr = max(dr, EPS);
      return 0.5 * log(r) * r / dr;
    }

    void main() {
      vec3 ro = u_cam_pos;
      vec3 ww = normalize(u_cam_target - ro);
      // Seed rotates the camera orbit around the vertical axis (bounded isometry,
      // continuous in u_seed), changing which side of the bulb is seen.
      float sa = 0.4 * u_seed;
      float cs = cos(sa), sn = sin(sa);
      ww = normalize(vec3(ww.x * cs + ww.z * sn, ww.y, -ww.x * sn + ww.z * cs));
      vec3 uu = normalize(cross(ww, vec3(0.0, 1.0, 0.0)));
      vec3 vv = cross(uu, ww);
      vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;
      vec3 rd = normalize(uv.x * uu + uv.y * vv + 1.6 * ww);

      float t = 0.0;
      float dist = 1e9;
      vec3 pos = ro;
      for (int i = 0; i < 160; i++) {
        pos = ro + rd * t;
        dist = mandelbulbDE(pos);
        if (dist < 0.0) dist = 0.0;   // guard against negative/NaN estimates
        t += min(dist, 0.5) * 0.85;  // cap the step to avoid tunneling
        if (t > 24.0 || dist < 0.0006) break;
      }

      vec3 col;
      if (dist < 0.0006) {
        vec2 e = vec2(1e-4, 0.0);
        vec3 n = normalize(vec3(
          mandelbulbDE(pos + e.xyy) - mandelbulbDE(pos - e.xyy),
          mandelbulbDE(pos + e.yxy) - mandelbulbDE(pos - e.yxy),
          mandelbulbDE(pos + e.yyx) - mandelbulbDE(pos - e.yyx)
        ));
        vec3 lightDir = normalize(vec3(0.5, 0.8, -0.6));
        float diff = max(dot(n, lightDir), 0.0);
        float spec = pow(max(dot(reflect(-lightDir, n), rd), 0.0), 32.0);
        float fresnel = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
        vec3 base = palette(length(pos) * 0.6 + u_palette_phase);
        col = base * (0.18 + diff * 0.95) + spec * 0.6 + fresnel * base * 0.6;
      } else {
        col = vec3(0.015, 0.02, 0.04);
      }
      col *= 1.0 + u_audio.x * 0.3;
      gl_FragColor = vec4(applyContrast(col), 1.0);
    }
  `;

  /* ---------------- Post-processing passes ---------------- */

  const POST_HEADER = `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D u_texture;
    uniform vec2 u_resolution;
    uniform float u_time;
    uniform vec3 u_audio;
    uniform float u_high_contrast;
  `;

  // Bright pass: isolate luminous regions for bloom.
  const BRIGHT_PASS = POST_HEADER + `
    uniform float u_threshold;
    void main() {
      vec4 c = texture2D(u_texture, vUv);
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      float b = smoothstep(u_threshold, u_threshold + 0.6, l);
      gl_FragColor = vec4(c.rgb * b, 1.0);
    }
  `;

  // Separable Gaussian blur (direction via u_direction).
  const BLUR = POST_HEADER + `
    uniform vec2 u_direction;
    void main() {
      vec2 off = u_direction / u_resolution;
      vec3 acc = texture2D(u_texture, vUv).rgb * 0.227027;
      vec2 o1 = off * 1.3846153846;
      vec2 o2 = off * 3.2307692308;
      acc += texture2D(u_texture, vUv + o1).rgb * 0.3162162162;
      acc += texture2D(u_texture, vUv - o1).rgb * 0.3162162162;
      acc += texture2D(u_texture, vUv + o2).rgb * 0.0702702703;
      acc += texture2D(u_texture, vUv - o2).rgb * 0.0702702703;
      gl_FragColor = vec4(acc, 1.0);
    }
  `;

  // Composite: base + bloom + trails + chromatic aberration + vignette + fog.
  const COMPOSITE = POST_HEADER + `
    uniform sampler2D u_bloom;
    uniform sampler2D u_trails;
    uniform float u_bloom_strength;
    uniform float u_trails_amount;
    uniform float u_aberration;
    uniform float u_vignette;
    uniform float u_fog;
    uniform float u_contrast;

    void main() {
      vec2 uv = vUv;
      vec2 center = vec2(0.5);
      vec2 dir = uv - center;
      float dist = length(dir);

      // Chromatic aberration (subtle lens effect).
      float ab = u_aberration * 0.004 * dist;
      float r = texture2D(u_texture, uv + dir * ab).r;
      float g = texture2D(u_texture, uv).g;
      float b = texture2D(u_texture, uv - dir * ab).b;
      vec3 col = vec3(r, g, b);

      // Bloom.
      vec3 bloom = texture2D(u_bloom, uv).rgb;
      col += bloom * u_bloom_strength;

      // Motion trails (feedback buffer).
      if (u_trails_amount > 0.001) {
        vec3 trail = texture2D(u_trails, uv).rgb;
        col = mix(col, trail, u_trails_amount * 0.5);
      }

      // Depth fog: darken edges toward a deep tone for atmosphere.
      float fog = smoothstep(0.2, 1.0, dist) * u_fog;
      col = mix(col, col * 0.4 + vec3(0.01, 0.01, 0.03), fog);

      // Vignette.
      float vig = smoothstep(0.9, 0.3, dist) * u_vignette;
      col *= mix(1.0, vig, 0.6);

      // Contrast + high-contrast boost.
      float k = mix(1.0, u_contrast, 0.5);
      col = (col - 0.5) * k + 0.5;
      if (u_high_contrast > 0.5) {
        float l = dot(col, vec3(0.299, 0.587, 0.114));
        col = mix(vec3(l), col, 1.5);
      }

      // Audio-reactive brightness pulse.
      col *= 1.0 + u_audio.x * 0.15;

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `;

  // Feedback: accumulate the base frame into a trails buffer (ping-ponged).
  const FEEDBACK = POST_HEADER + `
    uniform sampler2D u_base;
    uniform sampler2D u_trails;
    uniform float u_fade;
    void main() {
      vec3 b = texture2D(u_base, vUv).rgb;
      vec3 t = texture2D(u_trails, vUv).rgb;
      gl_FragColor = vec4(mix(b, t, u_fade), 1.0);
    }
  `;

  // Simple texture display (used for L-System canvas -> texture).
  const TEXTURE_DISPLAY = POST_HEADER + `
    uniform float u_contrast;
    void main() {
      vec4 c = texture2D(u_texture, vUv);
      float k = mix(1.0, u_contrast, 0.5);
      c.rgb = (c.rgb - 0.5) * k + 0.5;
      gl_FragColor = vec4(clamp(c.rgb, 0.0, 1.0), 1.0);
    }
  `;

  return {
    VERTEX,
    MANDELBROT, JULIA, BURNING_SHIP, NEWTON, SIERPINSKI,
    COSMIC_NEBULA, DREAMSCAPE, NEURAL_BLOOM, QUANTUM_FIELD,
    MANDELBULB,
    BRIGHT_PASS, BLUR, COMPOSITE, FEEDBACK, TEXTURE_DISPLAY,
  };
})();

/* ============================================================
   ColorSystem — palettes, gradient editor, animated cycling
   ============================================================ */
const ColorSystem = (() => {
  // IQ cosine palettes: color(t) = a + b * cos(2π(c*t + d)), each a/b/c/d is RGB.
  const PALETTES = [
    { name: 'Cyber Neon',    a: [0.5, 0.5, 0.5], b: [0.9, 0.9, 0.9], c: [1.0, 1.0, 1.0], d: [0.0, 0.33, 0.67] },
    { name: 'Cosmic Sunset', a: [0.5, 0.5, 0.5], b: [0.5, 0.5, 0.5], c: [1.0, 1.0, 1.0], d: [0.8, 0.7, 0.2] },
    { name: 'Aurora',        a: [0.5, 0.5, 0.5], b: [0.5, 0.5, 0.5], c: [1.0, 1.0, 1.0], d: [0.4, 0.3, 0.2] },
    { name: 'Deep Ocean',    a: [0.1, 0.2, 0.4], b: [0.2, 0.3, 0.4], c: [1.0, 1.0, 1.0], d: [0.6, 0.7, 0.8] },
    { name: 'Firestorm',     a: [0.5, 0.5, 0.5], b: [0.5, 0.5, 0.5], c: [1.0, 1.0, 1.0], d: [0.0, 0.1, 0.2] },
    { name: 'Monochrome',    a: [0.5, 0.5, 0.5], b: [0.5, 0.5, 0.5], c: [1.0, 1.0, 1.0], d: [0.0, 0.0, 0.0] },
    { name: 'Vaporwave',     a: [0.5, 0.5, 0.5], b: [0.5, 0.5, 0.5], c: [1.0, 1.0, 1.0], d: [0.5, 0.8, 0.9] },
    { name: 'Synthwave',     a: [0.5, 0.5, 0.5], b: [0.5, 0.5, 0.5], c: [1.0, 1.0, 1.0], d: [0.9, 0.9, 0.4] },
    { name: 'Rainbow',       a: [0.5, 0.5, 0.5], b: [0.5, 0.5, 0.5], c: [1.0, 1.0, 1.0], d: [0.0, 0.33, 0.67] },
  ];

  const state = {
    index: 0,
    speed: 0.2,        // cycling speed
    contrast: 1.0,     // contrast multiplier
    cycling: false,    // animated palette cycling
    cycleOffset: 0,    // transient animated offset (NOT serialized; base phase lives in State)
  };

  function current() { return PALETTES[state.index]; }

  function setIndex(i) {
    state.index = Util.clamp(i, 0, PALETTES.length - 1);
  }

  // Advance the animated cycle offset (called each frame). The user's base
  // phase is owned by State; this only tracks the transient animated offset so
  // the two are never added together twice.
  function tick(dt) {
    if (state.cycling) state.cycleOffset = (state.cycleOffset + dt * state.speed * 0.1) % 1.0;
  }

  // Reset the transient animated offset (e.g., when applying a saved world).
  function resetCycle() { state.cycleOffset = 0; }

  // Effective render phase = user base phase + animated cycle offset.
  function effectivePhase(basePhase) {
    return ((basePhase || 0) + state.cycleOffset) % 1.0;
  }

  // Sample the palette at t in [0,1] on the CPU (for gradient preview + thumbnails).
  function sample(t) {
    const p = current();
    const out = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      out[i] = p.a[i] + p.b[i] * Math.cos(6.28318530718 * (p.c[i] * t + p.d[i]));
    }
    return out.map((v) => Math.round(Util.clamp(v, 0, 1) * 255));
  }

  // Build a CSS linear-gradient string for the gradient bar preview.
  function cssGradient(basePhase) {
    const phase = effectivePhase(basePhase);
    const stops = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const [r, g, b] = sample(t + phase);
      stops.push(`rgb(${r},${g},${b}) ${i * 10}%`);
    }
    return `linear-gradient(90deg, ${stops.join(', ')})`;
  }

  // CSS gradient for a specific palette index (for swatch previews).
  function cssGradientFor(index) {
    const p = PALETTES[Util.clamp(index, 0, PALETTES.length - 1)];
    const stops = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const r = Math.round(Util.clamp(p.a[0] + p.b[0] * Math.cos(6.28318530718 * (p.c[0] * t + p.d[0])), 0, 1) * 255);
      const g = Math.round(Util.clamp(p.a[1] + p.b[1] * Math.cos(6.28318530718 * (p.c[1] * t + p.d[1])), 0, 1) * 255);
      const b = Math.round(Util.clamp(p.a[2] + p.b[2] * Math.cos(6.28318530718 * (p.c[2] * t + p.d[2])), 0, 1) * 255);
      stops.push(`rgb(${r},${g},${b}) ${i * 12.5}%`);
    }
    return `linear-gradient(90deg, ${stops.join(', ')})`;
  }

  return {
    PALETTES, state, current, setIndex, tick, resetCycle, effectivePhase, sample, cssGradient, cssGradientFor,
  };
})();

/* ============================================================
   Fractals — mode registry + per-mode parameter sets
   ============================================================ */
const Fractals = (() => {
  // Each mode maps to a shader source and a default parameter set.
  // `group` drives the left-panel grouping; `kind` drives the render path.
  const MODES = {
    mandelbrot:     { label: 'Mandelbrot',     group: 'classic',      kind: 'gpu',    shader: 'MANDELBROT',     center: [-0.6, 0.0],   span: 3.2,  iterations: 256 },
    julia:          { label: 'Julia Set',      group: 'classic',      kind: 'gpu',    shader: 'JULIA',          center: [0.0, 0.0],    span: 3.4,  iterations: 256 },
    burningShip:    { label: 'Burning Ship',   group: 'classic',      kind: 'gpu',    shader: 'BURNING_SHIP',   center: [-0.5, 0.0],   span: 3.4,  iterations: 256 },
    newton:         { label: 'Newton',         group: 'classic',      kind: 'gpu',    shader: 'NEWTON',         center: [0.0, 0.0],    span: 3.0,  iterations: 64 },
    sierpinski:     { label: 'Sierpinski',     group: 'classic',      kind: 'gpu',    shader: 'SIERPINSKI',     center: [0.0, 0.0],    span: 2.4,  iterations: 256 },
    cosmicNebula:   { label: 'Cosmic Nebula',  group: 'experimental', kind: 'gpu',    shader: 'COSMIC_NEBULA',  center: [0.0, 0.0],    span: 2.0,  iterations: 256 },
    dreamscape:     { label: 'Dreamscape',     group: 'experimental', kind: 'gpu',    shader: 'DREAMSCAPE',     center: [0.0, 0.0],    span: 2.0,  iterations: 256 },
    neuralBloom:    { label: 'Neural Bloom',   group: 'experimental', kind: 'gpu',    shader: 'NEURAL_BLOOM',   center: [0.0, 0.0],    span: 2.0,  iterations: 256 },
    quantumField:   { label: 'Quantum Field',  group: 'experimental', kind: 'gpu',    shader: 'QUANTUM_FIELD',  center: [0.0, 0.0],    span: 2.0,  iterations: 256 },
    koch:           { label: 'Koch Snowflake', group: 'structural',   kind: 'lsystem', lsystem: 'koch',        center: [0.0, 0.0],    span: 2.0,  iterations: 256 },
    dragon:         { label: 'Dragon Curve',   group: 'structural',   kind: 'lsystem', lsystem: 'dragon',      center: [0.0, 0.0],    span: 2.0,  iterations: 256 },
    tree:           { label: 'Fractal Tree',   group: 'structural',   kind: 'lsystem', lsystem: 'tree',        center: [0.0, 0.0],    span: 2.0,  iterations: 256 },
    plant:          { label: 'Plant Growth',   group: 'structural',   kind: 'lsystem', lsystem: 'plant',       center: [0.0, 0.0],    span: 2.0,  iterations: 256 },
    mandelbulb:     { label: 'Mandelbulb',     group: '3d',           kind: 'gpu3d',  shader: 'MANDELBULB',     center: [0.0, 0.0],    span: 2.0,  iterations: 256, power: 8 },
  };

  const ORDER = [
    'mandelbrot', 'julia', 'burningShip', 'newton', 'sierpinski',
    'cosmicNebula', 'dreamscape', 'neuralBloom', 'quantumField',
    'koch', 'dragon', 'tree', 'plant',
    'mandelbulb',
  ];

  function get(id) { return MODES[id]; }
  function list(group) { return ORDER.filter((id) => MODES[id].group === group); }

  return { MODES, ORDER, get, list };
})();

/* ============================================================
   Engine — program management, uniforms, fractal rendering
   ============================================================ */
const Engine = (() => {
  const programCache = {};
  let currentModeId = 'mandelbrot';
  let lsystemTexture = null;
  let lsystemCanvas = null;
  let lsystemCtx = null;

  const SHADER_MAP = {
    MANDELBROT: Shaders.MANDELBROT,
    JULIA: Shaders.JULIA,
    BURNING_SHIP: Shaders.BURNING_SHIP,
    NEWTON: Shaders.NEWTON,
    SIERPINSKI: Shaders.SIERPINSKI,
    COSMIC_NEBULA: Shaders.COSMIC_NEBULA,
    DREAMSCAPE: Shaders.DREAMSCAPE,
    NEURAL_BLOOM: Shaders.NEURAL_BLOOM,
    QUANTUM_FIELD: Shaders.QUANTUM_FIELD,
    MANDELBULB: Shaders.MANDELBULB,
  };

  function getProgram(name) {
    if (!programCache[name]) {
      const src = SHADER_MAP[name];
      if (!src) throw new Error('Unknown fractal shader: ' + name);
      programCache[name] = GL.createProgram(Shaders.VERTEX, src, name);
    }
    return programCache[name];
  }

  function getPostProgram(name) {
    const map = {
      BRIGHT_PASS: Shaders.BRIGHT_PASS,
      BLUR: Shaders.BLUR,
      COMPOSITE: Shaders.COMPOSITE,
      FEEDBACK: Shaders.FEEDBACK,
      TEXTURE_DISPLAY: Shaders.TEXTURE_DISPLAY,
    };
    if (!programCache[name]) {
      const src = map[name];
      if (!src) throw new Error('Unknown post-processing shader: ' + name);
      programCache[name] = GL.createProgram(Shaders.VERTEX, src, name);
    }
    return programCache[name];
  }

  function setMode(id) { currentModeId = id; }
  function getMode() { return currentModeId; }

  // Create/size the L-system 2D canvas (setting width clears it).
  function ensureLsystemCanvas(width, height) {
    if (!lsystemCanvas) {
      lsystemCanvas = document.createElement('canvas');
      lsystemCtx = lsystemCanvas.getContext('2d');
    }
    lsystemCanvas.width = width;
    lsystemCanvas.height = height;
  }

  // Upload the current L-system canvas as a WebGL texture.
  function uploadLsystemTexture() {
    if (!lsystemTexture) lsystemTexture = GL.gl.createTexture();
    const gl = GL.gl;
    gl.bindTexture(gl.TEXTURE_2D, lsystemTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, lsystemCanvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return lsystemTexture;
  }

  // Render the active mode into `target` (an FBO) at the given resolution.
  function renderFractal(target, width, height, params) {
    const gl = GL.gl;
    const mode = Fractals.get(currentModeId);

    if (mode.kind === 'lsystem') {
      // Size the canvas (clears it), draw the L-system, then upload.
      ensureLsystemCanvas(width, height);
      LSystem.draw(mode.lsystem, lsystemCtx, width, height, params);
      const tex = uploadLsystemTexture();
      const prog = getPostProgram('TEXTURE_DISPLAY');
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      GL.setUniform('u_texture', 0, prog);
      GL.setUniform('u_contrast', params.contrast, prog);
      GL.render(prog, target, width, height);
      return;
    }

    const prog = getProgram(mode.shader);
    // Common uniforms.
    GL.setUniform('u_resolution', [width, height], prog);
    GL.setUniform('u_time', params.time, prog);
    GL.setUniform('u_center', params.center, prog);
    GL.setUniform('u_zoom', params.zoom, prog);
    GL.setUniform('u_iterations', params.iterations, prog);
    GL.setUniform('u_detail', params.detail, prog);
    GL.setUniform('u_anim', params.anim, prog);
    GL.setUniform('u_seed', params.seed, prog);
    const pal = ColorSystem.current();
    GL.setUniform('u_pal_a', pal.a, prog);
    GL.setUniform('u_pal_b', pal.b, prog);
    GL.setUniform('u_pal_c', pal.c, prog);
    GL.setUniform('u_pal_d', pal.d, prog);
    GL.setUniform('u_palette_phase', params.palettePhase, prog);
    GL.setUniform('u_contrast', params.contrast, prog);
    GL.setUniform('u_audio', params.audio, prog);
    GL.setUniform('u_high_contrast', params.highContrast, prog);
    GL.setUniform('u_mouse', params.mouse, prog);

    // Mode-specific uniforms.
    if (mode.shader === 'MANDELBULB') {
      GL.setUniform('u_cam_pos', params.camPos, prog);
      GL.setUniform('u_cam_target', params.camTarget, prog);
      GL.setUniform('u_power', params.power, prog);
    }
    if (mode.shader === 'JULIA') {
      GL.setUniform('u_julia_phase', params.juliaPhase || 0, prog);
    }

    GL.render(prog, target, width, height);
  }

  // Drop all cached programs so they recompile after a context restore
  // (every GL object is invalidated when the context is lost).
  function resetPrograms() {
    for (const key of Object.keys(programCache)) delete programCache[key];
  }

  return {
    setMode, getMode, renderFractal, getPostProgram, resetPrograms,
    getLsystemCanvas: () => lsystemCanvas,
  };
})();

/* ============================================================
   LSystem — string-rewriting fractals drawn to a 2D canvas
   (Koch, Dragon, Tree, Plant). Rendered to a texture by the Engine.
   ============================================================ */
const LSystem = (() => {
  const SYSTEMS = {
    koch:   { axiom: 'F--F--F', rules: { F: 'F+F--F+' }, angle: 60,   iterations: 4, startAngle: 90 },
    dragon: { axiom: 'FX',      rules: { X: 'X+YF+', Y: '-FX-Y' }, angle: 90, iterations: 10, startAngle: 0 },
    tree:   { axiom: 'X',       rules: { X: 'F+[[X]-X]-F[-FX]+X', F: 'FF' }, angle: 25, iterations: 4, startAngle: 90 },
    plant:  { axiom: 'X',       rules: { X: 'F[+X][-X]FX', F: 'FF' }, angle: 25.7, iterations: 5, startAngle: 90 },
  };

  function generate(system, iterations) {
    let str = system.axiom;
    for (let i = 0; i < iterations; i++) {
      let next = '';
      for (let j = 0; j < str.length; j++) {
        next += system.rules[str[j]] || str[j];
      }
      str = next;
    }
    return str;
  }

  // Draw the L-system into a 2D canvas context, fitted to the canvas.
  // `growth` in [0,1] controls how much of the structure is drawn (animation).
  function draw(name, ctx, width, height, params) {
    const system = SYSTEMS[name];
    if (!system || !ctx) return;
    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, width, height);

    const growth = params && params.growth != null ? params.growth : 1;
    const full = generate(system, system.iterations);
    const str = full.slice(0, Math.max(1, Math.floor(full.length * growth)));
    const angle = system.angle * Math.PI / 180;

    // Turtle pass in unit space, collecting segments grouped by depth.
    let x = 0, y = 0, dir = system.startAngle * Math.PI / 180;
    const stack = [];
    let depth = 0;
    const groups = {};
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (ch === 'F' || ch === 'G') {
        const nx = x + Math.cos(dir);
        const ny = y + Math.sin(dir);
        (groups[depth] = groups[depth] || []).push(x, y, nx, ny);
        x = nx; y = ny;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      } else if (ch === '+') dir += angle;
      else if (ch === '-') dir -= angle;
      else if (ch === '[') { stack.push(x, y, dir); depth++; }
      else if (ch === ']') { dir = stack.pop(); y = stack.pop(); x = stack.pop(); depth--; }
    }
    if (minX === Infinity) return;

    // Fit to canvas with margin, centered.
    const spanX = (maxX - minX) || 1;
    const spanY = (maxY - minY) || 1;
    const margin = 0.14;
    const scale = Math.min(width * (1 - 2 * margin) / spanX, height * (1 - 2 * margin) / spanY);
    const offX = width / 2 - (minX + spanX / 2) * scale;
    const offY = height / 2 - (minY + spanY / 2) * scale;
    const tx = (v) => v * scale + offX;
    const ty = (v) => height - (v * scale + offY);

    const depths = Object.keys(groups).map(Number);
    const maxDepth = Math.max(1, ...depths);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const d of depths) {
      const t = (d / maxDepth + (params ? params.palettePhase : 0)) % 1;
      const [r, g, b] = ColorSystem.sample(t);
      ctx.strokeStyle = `rgb(${r},${g},${b})`;
      ctx.lineWidth = Math.max(1, scale * 0.018) * (1 + d * 0.12);
      ctx.shadowBlur = 8;
      ctx.shadowColor = `rgb(${r},${g},${b})`;
      ctx.beginPath();
      const segs = groups[d];
      for (let i = 0; i < segs.length; i += 4) {
        ctx.moveTo(tx(segs[i]), ty(segs[i + 1]));
        ctx.lineTo(tx(segs[i + 2]), ty(segs[i + 3]));
      }
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }

  return { SYSTEMS, generate, draw };
})();

/* ============================================================
   Effects — post-processing pipeline (bloom, trails, aberration,
   vignette, fog). Owns the intermediate FBOs.
   ============================================================ */
const Effects = (() => {
  let brightFBO = null;
  let blurAFBO = null;
  let blurBFBO = null;
  let trailsA = null;
  let trailsB = null;
  let trailsRead = null;   // the buffer the composite pass samples
  let trailsWrite = null;  // the buffer the feedback pass writes
  let width = 0;
  let height = 0;

  function resize(w, h) {
    width = w; height = h;
    const bw = Math.max(1, Math.floor(w / 4));
    const bh = Math.max(1, Math.floor(h / 4));
    [brightFBO, blurAFBO, blurBFBO].forEach((f) => GL.deleteFBO(f));
    [trailsA, trailsB].forEach((f) => GL.deleteFBO(f));
    brightFBO = GL.createFBO(bw, bh);
    blurAFBO = GL.createFBO(bw, bh);
    blurBFBO = GL.createFBO(bw, bh);
    trailsA = GL.createFBO(w, h);
    trailsB = GL.createFBO(w, h);
    trailsRead = trailsA;
    trailsWrite = trailsB;
  }

  function bindTex(unit, texture) {
    const gl = GL.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
  }

  // Run the full post pipeline. `baseFBO` holds the rendered fractal.
  // `outTarget` (optional) composites to an FBO instead of the screen.
  function render(baseFBO, params, outTarget) {
    const gl = GL.gl;
    const bw = brightFBO.width;
    const bh = brightFBO.height;

    // 1. Bright pass.
    const bright = Engine.getPostProgram('BRIGHT_PASS');
    bindTex(0, baseFBO.texture);
    GL.setUniform('u_texture', 0, bright);
    GL.setUniform('u_resolution', [bw, bh], bright);
    GL.setUniform('u_threshold', 0.45, bright);
    GL.render(bright, brightFBO, bw, bh);

    // 2. Blur horizontal.
    const blur = Engine.getPostProgram('BLUR');
    bindTex(0, brightFBO.texture);
    GL.setUniform('u_texture', 0, blur);
    GL.setUniform('u_resolution', [bw, bh], blur);
    GL.setUniform('u_direction', [1, 0], blur);
    GL.render(blur, blurAFBO, bw, bh);

    // 3. Blur vertical.
    bindTex(0, blurAFBO.texture);
    GL.setUniform('u_texture', 0, blur);
    GL.setUniform('u_direction', [0, 1], blur);
    GL.render(blur, blurBFBO, bw, bh);

    // 4. Composite to screen.
    const comp = Engine.getPostProgram('COMPOSITE');
    bindTex(0, baseFBO.texture);
    GL.setUniform('u_texture', 0, comp);
    bindTex(1, blurBFBO.texture);
    GL.setUniform('u_bloom', 1, comp);
    bindTex(2, trailsRead.texture);
    GL.setUniform('u_trails', 2, comp);
    GL.setUniform('u_resolution', [width, height], comp);
    GL.setUniform('u_time', params.time, comp);
    GL.setUniform('u_bloom_strength', params.bloom, comp);
    GL.setUniform('u_trails_amount', params.trails, comp);
    GL.setUniform('u_aberration', params.aberration, comp);
    GL.setUniform('u_vignette', params.vignette, comp);
    GL.setUniform('u_fog', params.fog, comp);
    GL.setUniform('u_contrast', params.contrast, comp);
    GL.setUniform('u_audio', params.audio, comp);
    GL.setUniform('u_high_contrast', params.highContrast, comp);
    GL.render(comp, outTarget || null, width, height);

    // 5. Feedback: accumulate trails (ping-pong to avoid read/write conflict).
    if (params.trails > 0.01) {
      const fb = Engine.getPostProgram('FEEDBACK');
      bindTex(0, baseFBO.texture);
      GL.setUniform('u_base', 0, fb);
      bindTex(1, trailsRead.texture);
      GL.setUniform('u_trails', 1, fb);
      GL.setUniform('u_fade', params.trails, fb);
      GL.render(fb, trailsWrite, width, height);
      const tmp = trailsRead; trailsRead = trailsWrite; trailsWrite = tmp;
    }
  }

  // Clear the trails buffers (e.g., on mode change).
  function clearTrails() {
    const gl = GL.gl;
    [trailsA, trailsB].forEach((f) => {
      if (!f) return;
      gl.bindFramebuffer(gl.FRAMEBUFFER, f.fbo);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  return { resize, render, clearTrails };
})();

/* ============================================================
   Camera — pan/zoom state, deep-zoom, 3D orbit
   ============================================================ */
const Camera = (() => {
  let center = { x: -0.6, y: 0.0 };
  let zoom = 100;          // pixels per fractal unit
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
    const w = window.innerWidth, h = window.innerHeight;
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
  function setZoom(z) { zoom = Util.clamp(z, 0.5, 1e9); }

  // Push an absolute 2D center (used when applying a saved/randomized world).
  function setCenter(x, y) {
    center.x = Number.isFinite(x) ? x : center.x;
    center.y = Number.isFinite(y) ? y : center.y;
  }

  // Focus: bring the point under the cursor to center and zoom in.
  function focusAt(screenX, screenY) {
    const w = window.innerWidth, h = window.innerHeight;
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
  function getAngle() { return camAngle; }
  function setOrbitRadius(r) {
    orbitRadius = Util.clamp(Number.isFinite(r) ? r : 3.0, 1.5, 8.0);
    applyOrbit();
  }
  function getOrbitRadius() { return orbitRadius; }

  return {
    get center() { return center; },
    get zoom() { return zoom; },
    get camPos() { return camPos; },
    get camTarget() { return camTarget; },
    reset, pan, zoomAt, zoomCenter, focusAt, setZoom, setCenter,
    rotate3d, setAngle, getAngle, setOrbitRadius, getOrbitRadius,
  };
})();

/* ============================================================
   Interaction — mouse / touch / keyboard input
   ============================================================ */
const Interaction = (() => {
  // Handlers the App registers.
  let onPan = null;
  let onZoom = null;
  let onRotate = null;
  let onFocus = null;
  let onAction = null;

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let pinchDist = 0;
  // Pointer/touch and keyboard are independent: the "Keyboard shortcuts"
  // setting must never disable mouse dragging, wheel zoom, or touch panning.
  let pointerEnabled = true;
  let keyboardEnabled = true;

  function register(handlers) {
    onPan = handlers.onPan || null;
    onZoom = handlers.onZoom || null;
    onRotate = handlers.onRotate || null;
    onFocus = handlers.onFocus || null;
    onAction = handlers.onAction || null;
  }

  function setEnabled(v) { pointerEnabled = v; }
  function setKeyboardEnabled(v) { keyboardEnabled = v; }

  function init(canvas) {
    // --- Mouse ---
    canvas.addEventListener('mousedown', (e) => {
      if (!pointerEnabled) return;
      dragging = true;
      lastX = e.clientX; lastY = e.clientY;
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging || !pointerEnabled) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      if (onPan) onPan(dx, dy);
    });
    window.addEventListener('mouseup', () => { dragging = false; });

    canvas.addEventListener('wheel', (e) => {
      if (!pointerEnabled || !onZoom) return;
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0015);
      onZoom(factor, e.clientX, e.clientY);
    }, { passive: false });

    // Double-click focuses and recenters on the point (not a plain zoom).
    canvas.addEventListener('dblclick', (e) => {
      if (!pointerEnabled || !onFocus) return;
      onFocus(e.clientX, e.clientY);
    });

    // --- Touch ---
    canvas.addEventListener('touchstart', (e) => {
      if (!pointerEnabled) return;
      if (e.touches.length === 1) {
        dragging = true;
        lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        dragging = false;
        pinchDist = touchDist(e.touches);
      }
    }, { passive: true });

    canvas.addEventListener('touchmove', (e) => {
      if (!pointerEnabled) return;
      e.preventDefault();
      if (e.touches.length === 1 && dragging) {
        const dx = e.touches[0].clientX - lastX;
        const dy = e.touches[0].clientY - lastY;
        lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
        if (onPan) onPan(dx, dy);
      } else if (e.touches.length === 2 && onZoom) {
        const d = touchDist(e.touches);
        if (pinchDist > 0) {
          const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
          const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
          onZoom(d / pinchDist, midX, midY);
        }
        pinchDist = d;
      }
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
      if (e.touches.length === 0) dragging = false;
      pinchDist = 0;
    });

    // --- Keyboard ---
    window.addEventListener('keydown', (e) => {
      if (!keyboardEnabled || !onAction) return;
      // Ignore when typing in an input.
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      const key = e.key;
      const step = 40;
      switch (key) {
        case 'ArrowLeft': onAction('pan', [-step, 0]); break;
        case 'ArrowRight': onAction('pan', [step, 0]); break;
        case 'ArrowUp': onAction('pan', [0, -step]); break;
        case 'ArrowDown': onAction('pan', [0, step]); break;
        case '+': case '=': onAction('zoom', [1.2]); break;
        case '-': case '_': onAction('zoom', [1 / 1.2]); break;
        case ' ': e.preventDefault(); onAction('pause'); break;
        case 'r': case 'R': onAction('randomize'); break;
        case 'n': case 'N': onAction('newworld'); break;
        case 's': case 'S': onAction('share'); break;
        case 'e': case 'E': onAction('export'); break;
        case 'g': case 'G': onAction('gallery'); break;
        case 'a': case 'A': onAction('audio'); break;
        default:
          if (key >= '1' && key <= '9') onAction('palette', [parseInt(key, 10) - 1]);
      }
    });
  }

  function touchDist(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  return { init, register, setEnabled, setKeyboardEnabled };
})();

/* ============================================================
   State — single source of truth for the current render params
   ============================================================ */
const State = (() => {
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
    juliaPhase: 0.0,
  };
  let current = cloneDefaults();

  function cloneDefaults() {
    return Object.assign({}, defaults, { center: defaults.center.slice() });
  }

  function set(partial) { Object.assign(current, partial); }
  function get() { return current; }
  function reset() { current = cloneDefaults(); }
  function clone() { return Object.assign({}, current, { center: current.center.slice() }); }

  return { defaults, set, get, reset, clone };
})();

/* ============================================================
   Procedural — seed, randomize, mutations, parameter blending
   ============================================================ */
const Procedural = (() => {
  // Full randomize: new colors, formula params, animation, composition.
  function randomize(rng) {
    const s = State.get();
    const mode = Fractals.get(s.mode);
    s.seed = Math.floor(rng() * 1e9);
    s.palette = Math.floor(rng() * ColorSystem.PALETTES.length);
    s.palettePhase = rng();
    s.paletteSpeed = 0.1 + rng() * 0.5;
    s.cycling = rng() > 0.5;
    s.contrast = 0.8 + rng() * 0.6;
    s.iterations = 128 + Math.floor(rng() * 12) * 64;
    s.detail = rng();
    s.anim = 0.2 + rng() * 0.8;
    s.bloom = 0.3 + rng() * 0.6;
    s.trails = rng() > 0.6 ? 0.3 + rng() * 0.5 : 0;
    s.aberration = rng() * 0.5;
    s.vignette = 0.2 + rng() * 0.5;
    s.fog = rng() * 0.5;
    s.power = 4 + Math.floor(rng() * 8);
    s.center = [
      mode.center[0] + (rng() - 0.5) * 0.6,
      mode.center[1] + (rng() - 0.5) * 0.6,
    ];
    s.zoom = ((window.innerHeight || 800) / mode.span) * (0.5 + rng() * 2.0);
    s.growth = 1.0;
  }

  // Gentle mutation: perturb the current composition (fractal evolution).
  function mutate(rng) {
    const s = State.get();
    s.seed = Math.floor(rng() * 1e9);
    s.palettePhase = (s.palettePhase + rng() * 0.3) % 1;
    s.anim = Util.clamp(s.anim + (rng() - 0.5) * 0.3, 0, 1);
    s.bloom = Util.clamp(s.bloom + (rng() - 0.5) * 0.3, 0, 1);
    s.contrast = Util.clamp(s.contrast + (rng() - 0.5) * 0.2, 0.5, 1.6);
    s.center = [s.center[0] + (rng() - 0.5) * 0.2, s.center[1] + (rng() - 0.5) * 0.2];
  }

  // Blend two param sets (parameter blending / evolution).
  function blend(a, b, t) {
    const out = {};
    for (const k of Object.keys(a)) {
      if (Array.isArray(a[k])) {
        out[k] = a[k].map((v, i) => Util.lerp(v, b[k][i], t));
      } else if (typeof a[k] === 'number') {
        out[k] = Util.lerp(a[k], b[k], t);
      } else {
        out[k] = t < 0.5 ? a[k] : b[k];
      }
    }
    return out;
  }

  return { randomize, mutate, blend };
})();

/* ============================================================
   Share — serialize/deserialize the current world to a compact
   "FF-" prefixed base64url code (URL-safe, copy/paste friendly).
   ============================================================ */
const Share = (() => {
  const PREFIX = 'FF-';
  const VERSION = 1;

  // Pick the fields worth sharing (drop transient ones).
  const FIELDS = [
    'mode', 'seed', 'palette', 'palettePhase', 'paletteSpeed', 'cycling',
    'contrast', 'iterations', 'detail', 'anim', 'bloom', 'trails',
    'aberration', 'vignette', 'fog', 'power', 'center', 'zoom', 'growth',
    'camAngle', 'orbitRadius', 'juliaPhase',
  ];

  // Bounds for clamping untrusted numeric input.
  const NUMERIC = {
    seed: [0, 1e9],
    palette: [0, 8],
    palettePhase: [0, 1],
    paletteSpeed: [0, 1],
    contrast: [0.2, 2],
    iterations: [16, 4096],
    detail: [0, 1],
    anim: [0, 1],
    bloom: [0, 1],
    trails: [0, 1],
    aberration: [0, 1],
    vignette: [0, 1],
    fog: [0, 1],
    power: [2, 16],
    zoom: [0.5, 1e7],
    growth: [0, 1],
    camAngle: [-1000, 1000],
    orbitRadius: [1.5, 8],
    juliaPhase: [0, 100],
  };

  function encode() {
    const s = State.get();
    const payload = { v: VERSION };
    for (const k of FIELDS) {
      if (s[k] !== undefined) payload[k] = s[k];
    }
    const json = JSON.stringify(payload);
    return PREFIX + Util.b64urlEncode(json);
  }

  // Parse a code (with or without the prefix) into a raw object, checking the
  // version. Throws a useful error for malformed or unsupported codes.
  function decode(code) {
    if (typeof code !== 'string') throw new Error('Not a share code');
    let raw = code.trim();
    if (raw.startsWith(PREFIX)) raw = raw.slice(PREFIX.length);
    if (!raw) throw new Error('Empty share code');
    let obj;
    try {
      obj = JSON.parse(Util.b64urlDecode(raw));
    } catch (e) {
      throw new Error('Malformed share code');
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('Malformed share code');
    if (obj.v !== undefined && obj.v !== VERSION) {
      throw new Error('Unsupported share code version: ' + obj.v);
    }
    return obj;
  }

  // Validate + clamp a raw payload into a clean partial. Only known fields are
  // copied (prevents prototype-pollution-style data); non-finite values are
  // dropped; numbers are clamped to safe bounds.
  function sanitize(raw) {
    const out = {};
    if (typeof raw.mode === 'string' && Fractals.get(raw.mode)) out.mode = raw.mode;
    if (typeof raw.cycling === 'boolean') out.cycling = raw.cycling;
    if (Array.isArray(raw.center) && raw.center.length === 2) {
      const x = Number(raw.center[0]);
      const y = Number(raw.center[1]);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        out.center = [Util.clamp(x, -1e6, 1e6), Util.clamp(y, -1e6, 1e6)];
      }
    }
    for (const k of Object.keys(NUMERIC)) {
      if (raw[k] === undefined) continue;
      const v = Number(raw[k]);
      if (!Number.isFinite(v)) continue;
      const [lo, hi] = NUMERIC[k];
      out[k] = (k === 'seed' || k === 'iterations' || k === 'palette')
        ? Math.round(Util.clamp(v, lo, hi))
        : Util.clamp(v, lo, hi);
    }
    return out;
  }

  // Apply a decoded payload to the live state (validated + clamped).
  function apply(code) {
    const partial = sanitize(decode(code));
    State.set(partial);
    return partial;
  }

  return { encode, decode, sanitize, apply, PREFIX, VERSION };
})();

/* ============================================================
   Exporter — render the current world to an offscreen FBO at a
   fixed resolution, read the pixels back, and produce a PNG.
   ============================================================ */
const Exporter = (() => {
  // Render the current world to a 2D canvas at (w, h).
  // Preserves the on-screen framing by scaling zoom with height.
  function renderToCanvas(w, h, time) {
    w = Math.round(w); h = Math.round(h);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 16 || h < 16) {
      throw new Error('Invalid export dimensions');
    }
    const gl = GL.gl;
    const screenH = window.innerHeight || 800;
    const s = State.get();
    const exportZoom = s.zoom * (h / screenH);

    // Temporarily size the post pipeline to the export resolution.
    const prevW = window.innerWidth, prevH = window.innerHeight;
    let baseFBO = null, outFBO = null;
    Effects.resize(w, h);
    try {
      baseFBO = GL.createFBO(w, h);
      outFBO = GL.createFBO(w, h);

      const params = Object.assign({}, s, {
        zoom: exportZoom,
        time: (time != null) ? time : 0,
        audio: [0, 0, 0],
        highContrast: A11y.get().highContrast ? 1 : 0,
        mouse: [0.5, 0.5],
        camPos: Camera.camPos,
        camTarget: Camera.camTarget,
      });

      Engine.renderFractal(baseFBO, w, h, params);
      Effects.render(baseFBO, params, outFBO);

      // Read pixels back (WebGL is bottom-up, so flip vertically).
      gl.bindFramebuffer(gl.FRAMEBUFFER, outFBO.fbo);
      const buf = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      const img = ctx.createImageData(w, h);
      const data = img.data;
      for (let y = 0; y < h; y++) {
        const srcRow = (h - 1 - y) * w * 4;
        const dstRow = y * w * 4;
        data.set(buf.subarray(srcRow, srcRow + w * 4), dstRow);
      }
      ctx.putImageData(img, 0, 0);

      return canvas;
    } finally {
      // Always clean up FBOs and restore pipeline sizing.
      if (baseFBO) GL.deleteFBO(baseFBO);
      if (outFBO) GL.deleteFBO(outFBO);
      Effects.resize(prevW, prevH);
    }
  }

  function renderToDataURL(w, h, time) {
    return renderToCanvas(w, h, time).toDataURL('image/png');
  }

  // Trigger a browser download of the current world at (w, h).
  function download(w, h, filename, time) {
    const url = renderToDataURL(w, h, time);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `fractal-forge-${w}x${h}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  return { renderToCanvas, renderToDataURL, download };
})();

/* ============================================================
   Gallery — persist saved worlds (state + thumbnail) in
   localStorage. Favorites float to the top.
   ============================================================ */
const Gallery = (() => {
  const KEY = 'fractal-forge:gallery';
  const SCHEMA_VERSION = 1;
  const THUMB_W = 384, THUMB_H = 216;

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      // Support both the legacy bare-array format and the versioned envelope.
      const arr = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.items) ? parsed.items : []);
      return arr.filter((it) => it && typeof it === 'object' && it.id);
    } catch (e) {
      return [];
    }
  }

  // Persist a versioned envelope. Returns { ok, trimmed?, error? } so callers
  // can report honest success/failure instead of assuming it worked.
  function persist(items) {
    const write = (arr) => localStorage.setItem(KEY, JSON.stringify({ v: SCHEMA_VERSION, items: arr }));
    try {
      write(items);
      return { ok: true };
    } catch (e) {
      // Quota exceeded — drop oldest non-favorites until it fits.
      const sorted = items.slice();
      while (sorted.length > 1) {
        const idx = sorted.findIndex((it) => !it.favorite);
        if (idx === -1) break;
        sorted.splice(idx, 1);
        try {
          write(sorted);
          return { ok: true, trimmed: items.length - sorted.length };
        } catch (e2) { /* keep trimming */ }
      }
      return { ok: false, error: 'Browser storage is full and could not be trimmed.' };
    }
  }

  function makeThumb(time) {
    try {
      const c = Exporter.renderToCanvas(THUMB_W, THUMB_H, time);
      return c.toDataURL('image/jpeg', 0.8);
    } catch (e) {
      return '';
    }
  }

  function save(name, time) {
    const items = load();
    const item = {
      id: 'ff-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36),
      name: name || (Fractals.get(State.get().mode).label + ' #' + (items.length + 1)),
      createdAt: Date.now(),
      favorite: false,
      thumb: makeThumb(time),
      state: State.clone(),
    };
    items.unshift(item);
    const result = persist(items);
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, item, trimmed: result.trimmed || 0 };
  }

  function list() {
    const items = load();
    // Favorites first, then most recent.
    return items.sort((a, b) => {
      if (!!b.favorite !== !!a.favorite) return b.favorite - a.favorite;
      return b.createdAt - a.createdAt;
    });
  }

  function get(id) { return load().find((it) => it.id === id) || null; }

  function remove(id) {
    const items = load().filter((it) => it.id !== id);
    return persist(items);
  }

  function toggleFavorite(id) {
    const items = load();
    const it = items.find((x) => x.id === id);
    if (it) {
      it.favorite = !it.favorite;
      persist(items);
    }
    return it;
  }

  function restore(id) {
    const it = get(id);
    if (!it || !it.state || typeof it.state !== 'object') return false;
    // Only apply a saved world if it references a known mode; otherwise fall
    // back to the current mode so a corrupt entry can't break the renderer.
    if (!Fractals.get(it.state.mode)) it.state.mode = State.get().mode;
    State.set(it.state);
    return true;
  }

  function clear() {
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  }

  function count() { return load().length; }

  return { save, list, get, remove, toggleFavorite, restore, clear, count };
})();

/* ============================================================
   Audio — microphone-reactive mode. Analyzes the mic signal into
   bass / mid / treble bands and exposes a smoothed overall level
   that the render pipeline can modulate.
   ============================================================ */
const Audio = (() => {
  let ctx = null;
  let analyser = null;
  let stream = null;
  let freqData = null;
  let enabled = false;
  let level = 0;        // smoothed overall level [0,1]
  let bands = { bass: 0, mid: 0, treble: 0 };

  async function enable() {
    if (enabled) return true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Microphone not available');
    }
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const source = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.8;
    source.connect(analyser);
    freqData = new Uint8Array(analyser.frequencyBinCount);
    enabled = true;
    return true;
  }

  function disable() {
    enabled = false;
    level = 0;
    bands = { bass: 0, mid: 0, treble: 0 };
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    if (ctx) {
      ctx.close().catch(() => {});
      ctx = null;
    }
    analyser = null;
    freqData = null;
  }

  // Average a slice of the frequency data into [0,1].
  function bandAvg(data, start, end) {
    let sum = 0;
    const s = Math.max(0, Math.floor(start));
    const e = Math.min(data.length, Math.ceil(end));
    for (let i = s; i < e; i++) sum += data[i];
    const n = Math.max(1, e - s);
    return sum / (n * 255);
  }

  // Sample the current level (call once per frame).
  function sample() {
    if (!enabled || !analyser) {
      level *= 0.9;
      return { level, bands };
    }
    analyser.getByteFrequencyData(freqData);
    const n = freqData.length;
    const raw = {
      bass: bandAvg(freqData, 0, n * 0.1),
      mid: bandAvg(freqData, n * 0.1, n * 0.5),
      treble: bandAvg(freqData, n * 0.5, n),
    };
    const overall = raw.bass * 0.5 + raw.mid * 0.35 + raw.treble * 0.15;
    // Smooth toward the target for a musical, non-jittery response.
    level += (overall - level) * 0.25;
    bands = raw;
    return { level, bands };
  }

  function isEnabled() { return enabled; }

  return { enable, disable, sample, isEnabled };
})();

/* ============================================================
   Ambient — a subtle drifting particle field on the 2D canvas
   behind the WebGL surface. Respects reduced-motion (static).
   ============================================================ */
const Ambient = (() => {
  let canvas = null;
  let ctx = null;
  let particles = [];
  let w = 0, h = 0;
  let enabled = true;
  let reducedMotion = false;
  let running = false;

  function makeParticles() {
    const count = Math.min(140, Math.floor((w * h) / 14000));
    particles = [];
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 0.5 + Math.random() * 1.8,
        vx: (Math.random() - 0.5) * 0.15,
        vy: (Math.random() - 0.5) * 0.15,
        a: 0.15 + Math.random() * 0.5,
        hue: 220 + Math.random() * 80,
      });
    }
  }

  function init(c) {
    canvas = c;
    ctx = c.getContext('2d');
    resize();
    makeParticles();
  }

  function resize() {
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    w = window.innerWidth; h = window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    makeParticles();
  }

  function setEnabled(v) { enabled = v; }
  function setReducedMotion(v) {
    reducedMotion = v;
    if (v) drawStatic();
  }

  function drawStatic() {
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    for (const p of particles) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${p.hue}, 60%, 70%, ${p.a * 0.6})`;
      ctx.fill();
    }
  }

  function tick(dt) {
    if (!enabled || !ctx) return;
    if (reducedMotion) return; // static field already drawn
    ctx.clearRect(0, 0, w, h);
    for (const p of particles) {
      p.x += p.vx * dt * 60;
      p.y += p.vy * dt * 60;
      if (p.x < -5) p.x = w + 5; else if (p.x > w + 5) p.x = -5;
      if (p.y < -5) p.y = h + 5; else if (p.y > h + 5) p.y = -5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${p.hue}, 60%, 72%, ${p.a})`;
      ctx.fill();
    }
  }

  return { init, resize, tick, setEnabled, setReducedMotion };
})();

/* ============================================================
   A11y — accessibility + preference settings (reduced motion,
   high contrast, adaptive quality, keyboard). Persisted.
   ============================================================ */
const A11y = (() => {
  const KEY = 'fractal-forge:settings';
  const defaults = {
    reducedMotion: false,
    highContrast: false,
    adaptive: true,
    keyboard: true,
  };
  let settings = Object.assign({}, defaults);

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) settings = Object.assign({}, defaults, JSON.parse(raw));
    } catch (e) { /* keep defaults */ }
    // Respect the OS-level reduced-motion preference on first run.
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      settings.reducedMotion = true;
    }
  }

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
  }

  function get() { return Object.assign({}, settings); }
  function set(partial) {
    Object.assign(settings, partial);
    persist();
  }

  function reset() {
    settings = Object.assign({}, defaults);
    persist();
  }

  return { load, get, set, reset, defaults };
})();

/* ============================================================
   UI — DOM bindings: panels, sliders, buttons, toasts, modals.
   Reads/writes State directly; delegates orchestration to App.
   ============================================================ */
const UI = (() => {
  const $ = (id) => document.getElementById(id);
  let actions = {};      // App-provided callbacks
  let toastTimer = null;
  let pendingConfirm = null; // callback for the confirm modal

  // ---------- Toasts ----------
  function toast(msg, type) {
    const stack = $('toast-stack');
    if (!stack) return;
    let cls = 'toast';
    if (type === 'ok' || type === 'success') cls += ' success';
    else if (type === 'error') cls += ' error';
    const el = document.createElement('div');
    el.className = cls;
    el.textContent = msg;
    stack.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    }, 2600);
  }

  // ---------- Modals ----------
  // Full modal behavior: focus moves in on open, is trapped while open,
  // Escape closes, focus returns to the opener, and the background is inert.
  const modalStack = [];   // open modal ids, topmost last
  const focusStack = [];   // element focused before each modal opened
  let trapBound = false;

  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function focusableIn(root) {
    return Array.from(root.querySelectorAll(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
  }

  function setInert(on) {
    const targets = [
      document.querySelector('.topbar'),
      document.querySelector('.panel-left'),
      document.querySelector('.panel-right'),
      document.querySelector('.statusbar'),
      document.querySelector('.onboarding'),
    ];
    targets.forEach((el) => { if (el && 'inert' in el) el.inert = on; });
  }

  function topModal() { return modalStack[modalStack.length - 1] || null; }

  function trapFocus(e) {
    const id = topModal();
    if (!id) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeModal(id);
      return;
    }
    if (e.key !== 'Tab') return;
    const m = $(id);
    if (!m) return;
    const focusables = focusableIn(m);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === m)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function openModal(id) {
    const m = $(id);
    if (!m) return;
    focusStack.push(document.activeElement);
    modalStack.push(id);
    if (modalStack.length === 1) {
      setInert(true);
      if (!trapBound) {
        document.addEventListener('keydown', trapFocus);
        trapBound = true;
      }
    }
    m.hidden = false;
    requestAnimationFrame(() => {
      m.classList.add('open');
      const focusables = focusableIn(m);
      (focusables[0] || m).focus();
    });
  }

  function closeModal(id) {
    const m = $(id);
    if (!m) return;
    m.classList.remove('open');
    const idx = modalStack.lastIndexOf(id);
    if (idx !== -1) {
      const wasTop = idx === modalStack.length - 1;
      modalStack.splice(idx, 1);
      const prev = focusStack.splice(idx, 1)[0];
      if (wasTop && prev && typeof prev.focus === 'function') prev.focus();
    }
    if (modalStack.length === 0) {
      setInert(false);
      if (trapBound) {
        document.removeEventListener('keydown', trapFocus);
        trapBound = false;
      }
    }
    setTimeout(() => { m.hidden = true; }, 200);
  }

  function closeAllModals() {
    ['modal-gallery', 'modal-export', 'modal-settings', 'modal-help'].forEach(closeModal);
  }

  // ---------- Onboarding ----------
  function hideOnboarding() {
    const el = $('onboarding');
    if (!el) return;
    el.classList.add('hide');
    setTimeout(() => { el.hidden = true; }, 500);
  }

  // ---------- Status bar ----------
  function updateStatus() {
    const s = State.get();
    const mode = Fractals.get(s.mode);
    const modeEl = $('status-mode');
    if (modeEl) modeEl.textContent = mode.label;
    const seedEl = $('status-seed');
    if (seedEl) seedEl.textContent = 'seed ' + String(s.seed).padStart(8, '0');
  }
  function updateZoomStatus() {
    const el = $('status-zoom');
    if (el) el.textContent = (Camera.zoom / 100).toFixed(2) + '×';
  }
  function updateFps(fps) {
    const el = $('status-fps');
    if (el) el.textContent = Math.round(fps) + ' fps';
  }

  // ---------- Mode list ----------
  function populateModes() {
    const groups = { classic: [], experimental: [], structural: [], '3d': [] };
    for (const id of Fractals.ORDER) {
      const m = Fractals.get(id);
      (groups[m.group] || (groups[m.group] = [])).push(Object.assign({ id }, m));
    }
    const map = {
      classic: 'mode-list-classic',
      experimental: 'mode-list-experimental',
      structural: 'mode-list-structural',
      '3d': 'mode-list-3d',
    };
    for (const g of Object.keys(map)) {
      const container = $(map[g]);
      if (!container) continue;
      container.innerHTML = '';
      for (const m of (groups[g] || [])) {
        const btn = document.createElement('button');
        btn.className = 'mode-item';
        btn.dataset.mode = m.id;
        btn.setAttribute('aria-pressed', 'false');
        btn.innerHTML = `<span class="dot" aria-hidden="true"></span><span class="mode-name">${m.label}</span>`;
        btn.addEventListener('click', () => actions.setMode && actions.setMode(m.id));
        container.appendChild(btn);
      }
    }
    highlightMode(State.get().mode);
  }

  function highlightMode(id) {
    document.querySelectorAll('.mode-item').forEach((el) => {
      el.setAttribute('aria-pressed', String(el.dataset.mode === id));
    });
  }

  // ---------- Palette grid ----------
  function populatePalettes() {
    const grid = $('palette-grid');
    if (!grid) return;
    grid.innerHTML = '';
    ColorSystem.PALETTES.forEach((p, i) => {
      const sw = document.createElement('button');
      sw.className = 'palette-swatch';
      sw.dataset.index = i;
      sw.title = p.name;
      sw.setAttribute('aria-label', p.name);
      sw.setAttribute('aria-pressed', 'false');
      sw.style.background = ColorSystem.cssGradientFor(i);
      sw.addEventListener('click', () => actions.setPalette && actions.setPalette(i));
      grid.appendChild(sw);
    });
    highlightPalette(State.get().palette);
  }

  function highlightPalette(i) {
    document.querySelectorAll('.palette-swatch').forEach((el) => {
      el.setAttribute('aria-pressed', String(parseInt(el.dataset.index, 10) === i));
    });
  }

  function updateGradientBar() {
    const bar = $('gradient-bar');
    if (bar) bar.style.background = ColorSystem.cssGradient(State.get().palettePhase);
  }

  // ---------- Sliders ----------
  // Each slider maps to a State key with a value transform.
  const SLIDERS = [
    { id: 'grad-phase',    key: 'palettePhase', scale: 0.001, val: 'val-grad-phase',    fmt: (v) => Math.round(v * 1000) },
    { id: 'grad-speed',    key: 'paletteSpeed', scale: 0.01,  val: null,                fmt: (v) => Math.round(v * 100) },
    { id: 'grad-contrast', key: 'contrast',     scale: 0.01,  val: null,                fmt: (v) => Math.round(v * 100) },
    { id: 'ctl-iterations',key: 'iterations',   scale: 1,     val: 'val-iterations',    fmt: (v) => Math.round(v) },
    { id: 'ctl-detail',    key: 'detail',       scale: 0.01,  val: 'val-detail',        fmt: (v) => v.toFixed(1) },
    { id: 'ctl-anim',      key: 'anim',         scale: 0.01,  val: 'val-anim',          fmt: (v) => Math.round(v * 100) },
    { id: 'ctl-bloom',     key: 'bloom',        scale: 0.01,  val: 'val-bloom',         fmt: (v) => Math.round(v * 100) },
    { id: 'ctl-trails',    key: 'trails',       scale: 0.01,  val: 'val-trails',        fmt: (v) => Math.round(v * 100) },
    { id: 'ctl-aberration',key: 'aberration',   scale: 0.01,  val: 'val-aberration',    fmt: (v) => Math.round(v * 100) },
    { id: 'ctl-vignette',  key: 'vignette',     scale: 0.01,  val: 'val-vignette',      fmt: (v) => Math.round(v * 100) },
    { id: 'ctl-fog',       key: 'fog',          scale: 0.01,  val: 'val-fog',           fmt: (v) => Math.round(v * 100) },
  ];

  function bindSlider(def) {
    const el = $(def.id);
    if (!el) return;
    el.addEventListener('input', () => {
      const v = parseFloat(el.value) * def.scale;
      State.set({ [def.key]: v });
      if (def.val) {
        const ve = $(def.val);
        if (ve) ve.textContent = def.fmt(v);
      }
      if (def.key === 'contrast') updateGradientBar();
      if (def.key === 'palettePhase' || def.key === 'paletteSpeed') updateGradientBar();
      if (actions.onParam) actions.onParam(def.key, v);
    });
  }

  // Zoom slider uses a log mapping relative to the mode's base zoom.
  function bindZoomSlider() {
    const el = $('ctl-zoom');
    if (!el) return;
    el.addEventListener('input', () => {
      const v = parseFloat(el.value);
      const mode = Fractals.get(State.get().mode);
      const baseZoom = (window.innerHeight || 800) / mode.span;
      const zoom = baseZoom * Math.pow(10, (v - 20) / 20);
      State.set({ zoom });
      Camera.setZoom(zoom);
      const ve = $('val-zoom');
      if (ve) ve.textContent = (zoom / baseZoom).toFixed(2);
      updateZoomStatus();
      if (actions.onParam) actions.onParam('zoom', zoom);
    });
  }

  // Reflect current State into the sliders (after restore/randomize).
  function syncSliders() {
    const s = State.get();
    for (const def of SLIDERS) {
      const el = $(def.id);
      if (!el) continue;
      el.value = Math.round(s[def.key] / def.scale);
      if (def.val) {
        const ve = $(def.val);
        if (ve) ve.textContent = def.fmt(s[def.key]);
      }
    }
    // Zoom slider: invert the log mapping.
    const zEl = $('ctl-zoom');
    if (zEl) {
      const mode = Fractals.get(s.mode);
      const baseZoom = (window.innerHeight || 800) / mode.span;
      const ratio = s.zoom / baseZoom;
      zEl.value = Math.round(20 + 20 * Math.log10(ratio));
      const ve = $('val-zoom');
      if (ve) ve.textContent = ratio.toFixed(2);
    }
  }

  // ---------- Mobile drawer backdrop ----------
  // On small screens the side panels become overlay drawers. Show a backdrop
  // behind whichever panel is open so the user can tap outside to close it.
  function isMobileDrawer() { return window.matchMedia('(max-width: 720px)').matches; }
  function syncPanelBackdrop() {
    const bd = $('panel-backdrop');
    if (!bd) return;
    if (!isMobileDrawer()) { bd.classList.remove('show'); return; }
    const anyOpen = ['panel-modes', 'panel-params'].some((id) => {
      const p = $(id); return p && !p.classList.contains('collapsed');
    });
    bd.classList.toggle('show', anyOpen);
  }

  // ---------- Buttons ----------
  function bindButtons() {
    const bind = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
    bind('btn-randomize', () => actions.randomize && actions.randomize());
    bind('btn-newworld', () => actions.newWorld && actions.newWorld());
    bind('btn-share', () => actions.share && actions.share());
    bind('btn-export', () => { openModal('modal-export'); });
    bind('btn-gallery', () => { renderGallery(); openModal('modal-gallery'); });
    bind('btn-save', () => openSaveModal());
    bind('btn-audio', () => actions.toggleAudio && actions.toggleAudio());
    bind('btn-settings', () => { syncSettings(); openModal('modal-settings'); });
    bind('btn-cycle', () => {
      const s = State.get();
      const cycling = !s.cycling;
      State.set({ cycling });
      ColorSystem.state.cycling = cycling;
      const btn = $('btn-cycle');
      if (btn) btn.setAttribute('aria-pressed', String(cycling));
    });
    // Panel collapse (syncs the mobile drawer backdrop).
    bind('collapse-modes', () => { $('panel-modes').classList.toggle('collapsed'); syncPanelBackdrop(); });
    bind('collapse-params', () => { $('panel-params').classList.toggle('collapsed'); syncPanelBackdrop(); });
    // Mobile drawer backdrop: tap outside to close the open panel(s).
    const pbd = $('panel-backdrop');
    if (pbd) pbd.addEventListener('click', () => {
      ['panel-modes', 'panel-params'].forEach((id) => { const p = $(id); if (p) p.classList.add('collapsed'); });
      syncPanelBackdrop();
    });
    // Onboarding.
    bind('onboard-start', () => { hideOnboarding(); actions.onboarded && actions.onboarded(); });
    bind('onboard-help', () => { hideOnboarding(); openModal('modal-help'); });
    // Modal close buttons + backdrop.
    document.querySelectorAll('.modal-close').forEach((btn) => {
      btn.addEventListener('click', () => closeModal(btn.dataset.close));
    });
    document.querySelectorAll('.modal-backdrop').forEach((bd) => {
      bd.addEventListener('click', (e) => { if (e.target === bd) closeModal(bd.id); });
    });
    // Import code.
    bind('btn-import-code', () => {
      const code = window.prompt('Paste a FRACTAL FORGE share code:');
      if (code && actions.importCode) actions.importCode(code);
    });
    // Save modal.
    bind('btn-save-cancel', () => closeModal('modal-save'));
    bind('btn-save-confirm', () => {
      const name = ($('save-name') || {}).value || '';
      if (actions.saveArtwork) actions.saveArtwork(name.trim());
    });
    // Confirm modal (used for destructive actions like delete).
    bind('btn-confirm-cancel', () => { pendingConfirm = null; closeModal('modal-confirm'); });
    bind('btn-confirm-ok', () => {
      const fn = pendingConfirm;
      pendingConfirm = null;
      closeModal('modal-confirm');
      if (fn) fn();
    });
  }

  // Open the save modal with a sensible default name for the current world.
  function openSaveModal() {
    const input = $('save-name');
    if (input) {
      const mode = Fractals.get(State.get().mode);
      input.value = (mode ? mode.label : 'Artwork') + ' #' + (Gallery.count() + 1);
    }
    openModal('modal-save');
    if (input) { input.focus(); input.select && input.select(); }
  }

  // Show the confirm modal; `onConfirm` runs when the user accepts.
  function openConfirm(message, onConfirm) {
    const desc = $('confirm-desc');
    if (desc && message) desc.textContent = message;
    pendingConfirm = onConfirm;
    openModal('modal-confirm');
    const ok = $('btn-confirm-ok');
    if (ok) ok.focus();
  }

  // ---------- Gallery ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function renderGallery() {
    const grid = $('gallery-grid');
    const empty = $('gallery-empty');
    if (!grid) return;
    const items = Gallery.list();
    grid.innerHTML = '';
    if (empty) empty.hidden = items.length > 0;
    for (const it of items) {
      const name = esc(it.name);
      const card = document.createElement('div');
      card.className = 'gallery-card';
      card.innerHTML = `
        ${it.thumb ? `<img src="${it.thumb}" alt="${name}" />` : ''}
        <div class="gc-meta"><span class="gc-name">${name}</span></div>
        <div class="gc-actions">
          <button class="gc-restore" aria-label="Restore ${name}">Restore</button>
          <button class="gc-fav" aria-pressed="${!!it.favorite}" aria-label="${it.favorite ? 'Unfavorite' : 'Favorite'} ${name}">${it.favorite ? '★' : '☆'}</button>
          <button class="gc-del" aria-label="Delete ${name}">✕</button>
        </div>`;
      card.querySelector('.gc-restore').addEventListener('click', () => actions.galleryRestore && actions.galleryRestore(it.id));
      card.querySelector('.gc-fav').addEventListener('click', (e) => {
        e.stopPropagation();
        Gallery.toggleFavorite(it.id);
        renderGallery();
      });
      card.querySelector('.gc-del').addEventListener('click', (e) => {
        e.stopPropagation();
        openConfirm('Delete "' + it.name + '"? This cannot be undone.', () => {
          Gallery.remove(it.id);
          renderGallery();
        });
      });
      grid.appendChild(card);
    }
  }

  // ---------- Mode-specific controls ----------
  // Populate the mode-specific section for the active mode only.
  function renderModeSpecific() {
    const section = $('mode-specific');
    const body = $('mode-specific-body');
    const title = $('mode-specific-title');
    if (!section || !body) return;
    const mode = Fractals.get(State.get().mode);
    if (!mode) { section.hidden = true; return; }

    body.innerHTML = '';
    const addSlider = (id, label, min, max, step, value, onInput, fmt) => {
      const row = document.createElement('label');
      row.className = 'slider-row';
      const span = document.createElement('span');
      span.className = 'val';
      span.textContent = fmt(value);
      row.appendChild(document.createTextNode(label + ' '));
      row.appendChild(span);
      const input = document.createElement('input');
      input.type = 'range';
      input.id = id;
      input.min = min; input.max = max; input.step = step; input.value = value;
      input.setAttribute('aria-label', label);
      row.appendChild(input);
      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        span.textContent = fmt(v);
        onInput(v);
      });
      body.appendChild(row);
    };
    const addButton = (id, label, onClick) => {
      const btn = document.createElement('button');
      btn.className = 'btn btn-ghost';
      btn.id = id;
      btn.textContent = label;
      btn.addEventListener('click', onClick);
      body.appendChild(btn);
    };

    if (mode.shader === 'MANDELBULB') {
      title.textContent = 'Mandelbulb';
      addSlider('ms-power', 'Power', 2, 16, 1, State.get().power, (v) => State.set({ power: v }), (v) => String(v));
      addButton('ms-reset-cam', 'Reset camera', () => {
        Camera.setAngle(0);
        Camera.setOrbitRadius(3.0);
        State.set({ camAngle: 0, orbitRadius: 3.0 });
      });
    } else if (mode.kind === 'lsystem') {
      title.textContent = mode.label;
      addSlider('ms-growth', 'Growth', 0, 100, 1, Math.round((State.get().growth || 1) * 100), (v) => State.set({ growth: v / 100 }), (v) => v + '%');
    } else if (mode.shader === 'JULIA') {
      title.textContent = 'Julia Set';
      addSlider('ms-julia', 'Drift', 0, 1000, 1, Math.round((State.get().juliaPhase || 0) * 1000), (v) => State.set({ juliaPhase: v / 1000 }), (v) => (v / 1000).toFixed(3));
    } else {
      section.hidden = true;
      return;
    }
    section.hidden = false;
  }

  // ---------- Export ----------
  function bindExport() {
    document.querySelectorAll('.export-card').forEach((card) => {
      card.addEventListener('click', () => {
        const res = card.dataset.res;
        if (actions.exportAt) actions.exportAt(res);
      });
    });
  }

  function setExportProgress(pct, status) {
    const fill = $('export-fill');
    const prog = $('export-progress');
    const st = $('export-status');
    if (prog) prog.hidden = false;
    if (fill) fill.style.width = pct + '%';
    if (st) st.textContent = status;
  }

  // ---------- Settings ----------
  function syncSettings() {
    const s = A11y.get();
    const set = (id, v) => { const el = $(id); if (el) el.checked = !!v; };
    set('set-reduced-motion', s.reducedMotion);
    set('set-high-contrast', s.highContrast);
    set('set-adaptive', s.adaptive);
    set('set-keyboard', s.keyboard);
  }

  function bindSettings() {
    const bind = (id, key) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener('change', () => {
        A11y.set({ [key]: el.checked });
        if (actions.onSetting) actions.onSetting(key, el.checked);
      });
    };
    bind('set-reduced-motion', 'reducedMotion');
    bind('set-high-contrast', 'highContrast');
    bind('set-adaptive', 'adaptive');
    bind('set-keyboard', 'keyboard');
    const resetBtn = $('btn-reset');
    if (resetBtn) resetBtn.addEventListener('click', () => {
      if (window.confirm('Reset all settings and clear the gallery?')) {
        A11y.reset();
        Gallery.clear();
        syncSettings();
        toast('Settings reset', 'ok');
      }
    });
  }

  // ---------- Init ----------
  function init(a) {
    actions = a || {};
    populateModes();
    populatePalettes();
    updateGradientBar();
    SLIDERS.forEach(bindSlider);
    bindZoomSlider();
    bindButtons();
    bindExport();
    bindSettings();
    syncSliders();
    syncSettings();
    updateStatus();
    // On small screens start with both panels collapsed so the artwork is visible.
    if (isMobileDrawer()) {
      const pm = $('panel-modes'); if (pm) pm.classList.add('collapsed');
      const pp = $('panel-params'); if (pp) pp.classList.add('collapsed');
    }
    syncPanelBackdrop();
    // Keep the drawer backdrop in sync when crossing the mobile breakpoint.
    window.addEventListener('resize', syncPanelBackdrop);
    // Show onboarding only on first visit.
    try {
      $('onboarding').hidden = !!localStorage.getItem('fractal-forge:onboarded');
    } catch (e) { /* ignore */ }
  }

  return {
    toast, openModal, closeModal, closeAllModals, openSaveModal, openConfirm,
    updateStatus, updateZoomStatus, updateFps,
    populateModes, highlightMode, populatePalettes, highlightPalette, updateGradientBar,
    renderGallery, setExportProgress, syncSliders, syncSettings, renderModeSpecific,
    init,
  };
})();

/* ============================================================
   App — orchestrator: init, main loop, adaptive quality,
   mode switching, and event wiring between all modules.
   ============================================================ */
const App = (() => {
  let baseFBO = null;
  let paused = false;
  let lastTime = 0;
  let time = 0;
  let fpsSmooth = 60;
  let renderScale = 1.0;
  let renderW = 0, renderH = 0;
  let audioBands = [0, 0, 0];   // [bass, mid, treble]
  let mouse = [0.5, 0.5];

  const $ = (id) => document.getElementById(id);

  // ---------- Buffer management ----------
  function computeRenderSize() {
    return {
      w: Math.max(2, Math.floor(window.innerWidth * renderScale)),
      h: Math.max(2, Math.floor(window.innerHeight * renderScale)),
    };
  }

  function rebuildBuffers() {
    const { w, h } = computeRenderSize();
    renderW = w; renderH = h;
    GL.resize(w, h);
    if (baseFBO) GL.deleteFBO(baseFBO);
    baseFBO = GL.createFBO(w, h);
    Effects.resize(w, h);
  }

  function setRenderScale(scale) {
    const next = Util.clamp(scale, 0.4, 1.0);
    if (Math.abs(next - renderScale) < 0.01) return;
    renderScale = next;
    rebuildBuffers();
  }

  // Discrete quality levels + cooldown prevent the adaptive loop from
  // rebuilding every framebuffer on adjacent frames (thrashing).
  const QUALITY_LEVELS = [1.0, 0.85, 0.7, 0.55, 0.4];
  let qualityIndex = 0;
  let lastQualityChange = 0;
  const QUALITY_COOLDOWN = 1500; // ms between adjustments

  // ---------- Camera sync ----------
  function syncCamera() {
    State.set({
      center: [Camera.center.x, Camera.center.y],
      zoom: Camera.zoom,
      camAngle: Camera.getAngle(),
      orbitRadius: Camera.getOrbitRadius(),
    });
    UI.updateZoomStatus();
  }

  // ---------- Actions (exposed to UI) ----------
  // Apply a mode's defaults to State (center/zoom/iterations/power) without
  // touching the other parameters.
  function applyModeDefaults(id) {
    const m = Fractals.get(id);
    State.set({
      mode: id,
      center: [m.center[0], m.center[1]],
      zoom: (window.innerHeight || 800) / m.span,
    });
    if (m.iterations) State.set({ iterations: m.iterations });
    if (m.power) State.set({ power: m.power });
  }

  function setMode(id) {
    if (!Fractals.get(id)) return;
    applyModeDefaults(id);
    applyWorld();
  }

  function randomize() {
    const rng = Util.mulberry32((Date.now() ^ (Math.random() * 1e9)) >>> 0);
    Procedural.randomize(rng);
    applyWorld();
  }

  function newWorld() {
    const rng = Util.mulberry32((Date.now() ^ (Math.random() * 1e9)) >>> 0);
    const id = Fractals.ORDER[Math.floor(rng() * Fractals.ORDER.length)];
    applyModeDefaults(id);
    Procedural.randomize(rng);
    applyWorld();
    UI.toast('Forged a new world', 'ok');
  }

  function setPalette(i) {
    ColorSystem.setIndex(i);
    State.set({ palette: i });
    UI.highlightPalette(i);
    UI.updateGradientBar();
  }

  function share() {
    const code = Share.encode();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(
        () => UI.toast('Share code copied to clipboard', 'ok'),
        () => UI.toast(code, 'info')
      );
    } else {
      UI.toast(code, 'info');
    }
  }

  // Save the current world to the local gallery with a thumbnail.
  function saveArtwork(name) {
    const result = Gallery.save(name, getLiveTime());
    if (result.ok) {
      UI.closeModal('modal-save');
      if (result.trimmed > 0) {
        UI.toast('Saved (storage full — removed ' + result.trimmed + ' oldest non-favorite' + (result.trimmed > 1 ? 's' : '') + ')', 'info');
      } else {
        UI.toast('Artwork saved to gallery', 'ok');
      }
    } else {
      UI.toast('Could not save: ' + (result.error || 'storage error'), 'error');
    }
  }

  function toggleAudio() {
    const btn = $('btn-audio');
    if (Audio.isEnabled()) {
      Audio.disable();
      if (btn) btn.setAttribute('aria-pressed', 'false');
      UI.toast('Audio reactive off', 'info');
    } else {
      Audio.enable().then(() => {
        if (btn) btn.setAttribute('aria-pressed', 'true');
        UI.toast('Audio reactive on — make some noise', 'ok');
      }).catch((e) => UI.toast('Mic unavailable: ' + e.message, 'error'));
    }
  }

  // Single reliable sync point: apply the current State to every subsystem
  // (engine, camera, color system, UI) so they cannot silently diverge.
  // Used by setMode, randomize, newWorld, gallery restore, and share import.
  function applyWorld() {
    const s = State.get();
    const cx = Array.isArray(s.center) ? s.center[0] : 0;
    const cy = Array.isArray(s.center) ? s.center[1] : 0;

    Engine.setMode(s.mode);

    // Color system: index, speed, cycling; reset the transient cycle offset.
    ColorSystem.setIndex(s.palette);
    ColorSystem.state.speed = s.paletteSpeed != null ? s.paletteSpeed : 0.2;
    ColorSystem.state.cycling = !!s.cycling;
    ColorSystem.resetCycle();

    // Camera: apply the saved center + zoom (2D) and orbit (3D).
    Camera.setCenter(cx, cy);
    Camera.setZoom(s.zoom);
    if (s.camAngle != null) Camera.setAngle(s.camAngle);
    if (s.orbitRadius != null) Camera.setOrbitRadius(s.orbitRadius);

    Effects.clearTrails();

    // UI.
    UI.highlightMode(s.mode);
    UI.highlightPalette(s.palette);
    UI.updateStatus();
    UI.syncSliders();
    UI.updateGradientBar();
    UI.renderModeSpecific();
  }

  function galleryRestore(id) {
    if (Gallery.restore(id)) {
      applyWorld();
      UI.closeModal('modal-gallery');
      UI.toast('World loaded', 'ok');
    }
  }

  function importCode(code) {
    try {
      Share.apply(code);
      applyWorld();
      UI.closeModal('modal-gallery');
      UI.toast('World imported', 'ok');
    } catch (e) {
      UI.toast('Invalid code: ' + e.message, 'error');
    }
  }

  let exporting = false;
  function exportAt(res) {
    if (exporting) return; // busy lock: one export at a time
    let w, h;
    if (res === 'current') {
      w = window.innerWidth; h = window.innerHeight;
    } else {
      const parts = res.split('x').map(Number);
      w = parts[0]; h = parts[1];
    }
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 16 || h < 16) {
      UI.toast('Invalid export size', 'error');
      return;
    }
    exporting = true;
    UI.setExportProgress(15, 'Rendering ' + w + '×' + h + '…');
    setTimeout(() => {
      try {
        Exporter.download(w, h, null, getLiveTime());
        UI.setExportProgress(100, 'Done — check your downloads');
        UI.toast('Exported ' + w + '×' + h, 'ok');
      } catch (e) {
        UI.setExportProgress(0, 'Export failed: ' + e.message);
        UI.toast('Export failed', 'error');
      } finally {
        rebuildBuffers(); // restore App buffers to the current render scale
        exporting = false;
      }
    }, 60);
  }

  function onSetting(key, value) {
    applySettings();
    if (key === 'reducedMotion' && value) {
      UI.toast('Reduced motion enabled', 'info');
    }
  }

  function applySettings() {
    const s = A11y.get();
    Ambient.setReducedMotion(s.reducedMotion);
    Ambient.setEnabled(!s.reducedMotion);
    // Pointer/touch always stay available; only keyboard shortcuts toggle.
    Interaction.setEnabled(true);
    Interaction.setKeyboardEnabled(s.keyboard);
    document.body.classList.toggle('high-contrast', s.highContrast);
    document.body.classList.toggle('reduced-motion', s.reducedMotion);
  }

  function togglePause() {
    paused = !paused;
    UI.toast(paused ? 'Paused' : 'Resumed', 'info');
  }

  function handleAction(action, arg) {
    switch (action) {
      case 'pan': Camera.pan(arg[0], arg[1]); syncCamera(); break;
      case 'zoom': Camera.zoomCenter(arg[0]); syncCamera(); break;
      case 'pause': togglePause(); break;
      case 'randomize': randomize(); break;
      case 'newworld': newWorld(); break;
      case 'share': share(); break;
      case 'export': UI.openModal('modal-export'); break;
      case 'gallery': UI.renderGallery(); UI.openModal('modal-gallery'); break;
      case 'audio': toggleAudio(); break;
      case 'palette': setPalette(arg[0]); break;
      default: break;
    }
  }

  // ---------- Resize ----------
  let resizeTimer = null;
  function onResize() {
    // Debounce so a resize gesture rebuilds GPU resources only once.
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      rebuildBuffers();
      Ambient.resize();
    }, 150);
  }

  // ---------- Adaptive quality ----------
  function adaptQuality(dt, now) {
    const inst = 1 / Math.max(dt, 0.001);
    fpsSmooth = fpsSmooth * 0.9 + inst * 0.1;
    if (!A11y.get().adaptive) {
      if (qualityIndex !== 0) { qualityIndex = 0; setRenderScale(QUALITY_LEVELS[0]); }
      return;
    }
    // Cooldown prevents thrashing (rebuilding buffers on adjacent frames).
    if (now - lastQualityChange < QUALITY_COOLDOWN) return;
    if (fpsSmooth < 45 && qualityIndex < QUALITY_LEVELS.length - 1) {
      // Severe load drops two levels for faster recovery.
      const drop = fpsSmooth < 25 ? 2 : 1;
      qualityIndex = Math.min(QUALITY_LEVELS.length - 1, qualityIndex + drop);
      setRenderScale(QUALITY_LEVELS[qualityIndex]);
      lastQualityChange = now;
    } else if (fpsSmooth > 57 && qualityIndex > 0) {
      qualityIndex = Math.max(0, qualityIndex - 1);
      setRenderScale(QUALITY_LEVELS[qualityIndex]);
      lastQualityChange = now;
    }
  }

  // ---------- Main loop ----------
  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - lastTime) / 1000 || 0.016);
    lastTime = now;
    // GPU context lost: skip rendering until it is restored.
    if (GL.contextLost) return;
    // Reduced motion freezes time-based animation but keeps a static frame.
    const reduced = A11y.get().reducedMotion;
    if (!paused && !reduced) time += dt;

    if (Audio.isEnabled()) {
      const { bands } = Audio.sample();
      audioBands = [bands.bass, bands.mid, bands.treble];
    } else {
      audioBands = [audioBands[0] * 0.95, audioBands[1] * 0.95, audioBands[2] * 0.95];
    }

    const s = State.get();

    // Keep the color system's transient settings in sync with State each frame
    // so slider changes (cycle speed / on-off) take effect immediately.
    ColorSystem.state.speed = s.paletteSpeed != null ? s.paletteSpeed : 0.2;
    ColorSystem.state.cycling = reduced ? false : !!s.cycling;
    if (!reduced) ColorSystem.tick(dt);
    Ambient.tick(dt);
    adaptQuality(dt, now);
    const params = {
      time,
      center: s.center,
      zoom: s.zoom * renderScale, // preserve field of view at scaled buffer size
      iterations: s.iterations,
      detail: s.detail,
      anim: s.anim,
      seed: s.seed,
      palettePhase: ColorSystem.effectivePhase(s.palettePhase),
      contrast: s.contrast,
      bloom: s.bloom,
      trails: reduced ? 0 : s.trails,
      aberration: s.aberration,
      vignette: s.vignette,
      fog: s.fog,
      power: s.power,
      growth: s.growth,
      juliaPhase: s.juliaPhase,
      audio: audioBands,
      highContrast: A11y.get().highContrast ? 1 : 0,
      mouse,
      camPos: Camera.camPos,
      camTarget: Camera.camTarget,
    };

    Engine.renderFractal(baseFBO, renderW, renderH, params);
    Effects.render(baseFBO, params);

    if (Math.floor(now / 250) !== Math.floor((now - dt * 1000) / 250)) {
      UI.updateFps(fpsSmooth);
    }
  }

  // ---------- Init ----------
  function init() {
    const canvas = $('gl-canvas');
    GL.init(canvas);
    GL.setContextHandlers({
      onLost: () => {
        UI.toast('Graphics context lost — waiting to restore…', 'info');
      },
      onRestored: () => {
        // Every GL object was invalidated; rebuild programs and buffers.
        Engine.resetPrograms();
        rebuildBuffers();
        UI.toast('Graphics context restored', 'ok');
      },
    });
    A11y.load();
    applySettings();

    Camera.reset(State.get().mode);
    syncCamera();
    rebuildBuffers();

    Interaction.init(canvas);
    Interaction.register({
      onPan: (dx, dy) => {
        if (State.get().mode === 'mandelbulb') {
          Camera.rotate3d(dx * 0.01);
        } else {
          Camera.pan(dx, dy);
        }
        syncCamera();
      },
      onZoom: (factor, x, y) => {
        if (State.get().mode === 'mandelbulb') {
          Camera.setOrbitRadius(Camera.getOrbitRadius() / factor);
        } else {
          Camera.zoomAt(factor, x, y);
        }
        syncCamera();
      },
      onFocus: (x, y) => {
        if (State.get().mode === 'mandelbulb') {
          Camera.setAngle(0);
          Camera.setOrbitRadius(3.0);
        } else {
          Camera.focusAt(x, y);
        }
        syncCamera();
      },
      onAction: handleAction,
    });

    // Track normalized mouse for the u_mouse uniform.
    window.addEventListener('mousemove', (e) => {
      mouse = [e.clientX / window.innerWidth, 1 - e.clientY / window.innerHeight];
    });

    Ambient.init($('ambient-canvas'));

    UI.init({
      setMode, randomize, newWorld, share, toggleAudio, saveArtwork,
      galleryRestore, importCode, exportAt,
      onParam: () => {},
      onSetting,
      onboarded: () => { try { localStorage.setItem('fractal-forge:onboarded', '1'); } catch (e) { /* ignore */ } },
    });
    UI.renderModeSpecific();

    window.addEventListener('resize', onResize);
    requestAnimationFrame(loop);
  }

  // Expose the live animation time so the export/thumbnail path can render
  // the exact on-screen composition instead of forcing time = 0.
  function getLiveTime() { return time; }

  return {
    init, setMode, randomize, newWorld, share, toggleAudio, saveArtwork,
    galleryRestore, importCode, exportAt, togglePause, getLiveTime,
  };
})();

/* ============================================================
   Boot
   ============================================================ */
function boot() {
  try {
    App.init();
  } catch (e) {
    console.error('FRACTAL FORGE failed to start:', e);
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;' +
      'color:#e5e7eb;font-family:system-ui,sans-serif;padding:2rem;text-align:center;background:#05060a';
    overlay.innerHTML = '<div><h2 style="margin:0 0 .5rem">FRACTAL FORGE could not start</h2>' +
      '<p style="margin:0;opacity:.8">' + (e && e.message ? e.message : 'Unknown error') +
      '. WebGL may be unavailable or blocked in this browser.</p></div>';
    document.body.appendChild(overlay);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
