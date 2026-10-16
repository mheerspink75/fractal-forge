/* ============================================================
   FRACTAL FORGE — src/main.js
   A browser-only generative fractal art installation.
   Raw WebGL · no dependencies · internally modular.

   Module map (namespaced objects; several live in sibling files):
     util.js         — Util: PRNG, math, encoding helpers
     shaders.js      — Shaders: GLSL source (common chunks + per-mode)
     fractals.js     — Fractals: mode registry + parameter sets
     state.js        — State: single source of truth for render params
     camera.js       — Camera: pan/zoom, deep-zoom precision, 3D orbit
     exporter.js     — Exporter: PNG / high-res / wallpaper rendering
     ui.js           — UI: DOM bindings, panels, toasts, modals
     main.js (this)  — GL, ColorSystem, Engine, LSystem, Effects,
                       Interaction, Procedural, Share, Gallery, Audio,
                       Ambient, A11y, App (orchestrator, main loop)
   ============================================================ */
import { Shaders } from './shaders.js';
import { UI } from './ui.js';
import { Exporter } from './exporter.js';
import { State } from './state.js';
import { Camera } from './camera.js';
import { Util } from './util.js';
import { Fractals } from './fractals.js';

('use strict');

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
      powerPreference: 'high-performance'
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
      console.error(
        '[FRACTAL FORGE] Shader compile failed (' + name + '):\n' + log + '\n\n' + source
      );
      const first = log ? log.split('\n')[0].trim() : 'unknown error';
      throw new Error('Shader compile failed: ' + name + ' — ' + first);
    }
    return shader;
  }

  // Create a program from vertex + fragment source, cache uniform locations.
  // `name` is used in diagnostics so failures are attributable to a specific pass.
  function createProgram(vsSource, fsSource, name) {
    const label = name || 'program';
    let vs = null,
      fs = null,
      program = null;
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
    const type = float
      ? gl.HALF_FLOAT_OES !== undefined
        ? gl.HALF_FLOAT_OES
        : gl.UNSIGNED_BYTE
      : gl.UNSIGNED_BYTE;
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
      console.error(
        '[FRACTAL FORGE] Incomplete framebuffer (' +
          width +
          'x' +
          height +
          '): 0x' +
          status.toString(16)
      );
      throw new Error(
        'Failed to create a complete ' +
          width +
          'x' +
          height +
          ' framebuffer (status 0x' +
          status.toString(16) +
          ').'
      );
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
    init,
    createProgram,
    createFBO,
    deleteFBO,
    render,
    setUniform,
    resize,
    bindTexture,
    setContextHandlers,
    get gl() {
      return gl;
    },
    get canvas() {
      return canvas;
    },
    get contextLost() {
      return contextLost;
    }
  };
})();

/* ============================================================
   ColorSystem — palettes, gradient editor, animated cycling
   ============================================================ */
const ColorSystem = (() => {
  // IQ cosine palettes: color(t) = a + b * cos(2π(c*t + d)), each a/b/c/d is RGB.
  const PALETTES = [
    {
      name: 'Cyber Neon',
      a: [0.5, 0.5, 0.5],
      b: [0.9, 0.9, 0.9],
      c: [1.0, 1.0, 1.0],
      d: [0.0, 0.33, 0.67]
    },
    {
      name: 'Cosmic Sunset',
      a: [0.5, 0.5, 0.5],
      b: [0.5, 0.5, 0.5],
      c: [1.0, 1.0, 1.0],
      d: [0.8, 0.7, 0.2]
    },
    {
      name: 'Aurora',
      a: [0.5, 0.5, 0.5],
      b: [0.5, 0.5, 0.5],
      c: [1.0, 1.0, 1.0],
      d: [0.4, 0.3, 0.2]
    },
    {
      name: 'Deep Ocean',
      a: [0.1, 0.2, 0.4],
      b: [0.2, 0.3, 0.4],
      c: [1.0, 1.0, 1.0],
      d: [0.6, 0.7, 0.8]
    },
    {
      name: 'Firestorm',
      a: [0.5, 0.5, 0.5],
      b: [0.5, 0.5, 0.5],
      c: [1.0, 1.0, 1.0],
      d: [0.0, 0.1, 0.2]
    },
    {
      name: 'Monochrome',
      a: [0.5, 0.5, 0.5],
      b: [0.5, 0.5, 0.5],
      c: [1.0, 1.0, 1.0],
      d: [0.0, 0.0, 0.0]
    },
    {
      name: 'Vaporwave',
      a: [0.5, 0.5, 0.5],
      b: [0.5, 0.5, 0.5],
      c: [1.0, 1.0, 1.0],
      d: [0.5, 0.8, 0.9]
    },
    {
      name: 'Synthwave',
      a: [0.5, 0.5, 0.5],
      b: [0.5, 0.5, 0.5],
      c: [1.0, 1.0, 1.0],
      d: [0.9, 0.9, 0.4]
    },
    {
      name: 'Rainbow',
      a: [0.5, 0.5, 0.5],
      b: [0.5, 0.5, 0.5],
      c: [1.0, 1.0, 1.0],
      d: [0.0, 0.33, 0.67]
    }
  ];

  const state = {
    index: 0,
    speed: 0.2, // cycling speed
    contrast: 1.0, // contrast multiplier
    cycling: false, // animated palette cycling
    cycleOffset: 0 // transient animated offset (NOT serialized; base phase lives in State)
  };

  function current() {
    return PALETTES[state.index];
  }

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
  function resetCycle() {
    state.cycleOffset = 0;
  }

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
      const r = Math.round(
        Util.clamp(p.a[0] + p.b[0] * Math.cos(6.28318530718 * (p.c[0] * t + p.d[0])), 0, 1) * 255
      );
      const g = Math.round(
        Util.clamp(p.a[1] + p.b[1] * Math.cos(6.28318530718 * (p.c[1] * t + p.d[1])), 0, 1) * 255
      );
      const b = Math.round(
        Util.clamp(p.a[2] + p.b[2] * Math.cos(6.28318530718 * (p.c[2] * t + p.d[2])), 0, 1) * 255
      );
      stops.push(`rgb(${r},${g},${b}) ${i * 12.5}%`);
    }
    return `linear-gradient(90deg, ${stops.join(', ')})`;
  }

  return {
    PALETTES,
    state,
    current,
    setIndex,
    tick,
    resetCycle,
    effectivePhase,
    sample,
    cssGradient,
    cssGradientFor
  };
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
    FRACTAL_TREE: Shaders.FRACTAL_TREE
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
      TEXTURE_DISPLAY: Shaders.TEXTURE_DISPLAY
    };
    if (!programCache[name]) {
      const src = map[name];
      if (!src) throw new Error('Unknown post-processing shader: ' + name);
      programCache[name] = GL.createProgram(Shaders.VERTEX, src, name);
    }
    return programCache[name];
  }

  function setMode(id) {
    currentModeId = id;
  }
  function getMode() {
    return currentModeId;
  }

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

    // Mode-specific uniforms.
    if (mode.shader === 'MANDELBULB') {
      GL.setUniform('u_cam_pos', params.camPos, prog);
      GL.setUniform('u_cam_target', params.camTarget, prog);
      GL.setUniform('u_power', params.power, prog);
    }
    if (mode.shader === 'FRACTAL_TREE') {
      GL.setUniform('u_cam_pos', params.camPos, prog);
      GL.setUniform('u_cam_target', params.camTarget, prog);
      GL.setUniform('u_growth', params.growth != null ? params.growth : 1.0, prog);
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
    setMode,
    getMode,
    renderFractal,
    getPostProgram,
    resetPrograms,
    getLsystemCanvas: () => lsystemCanvas
  };
})();

/* ============================================================
   LSystem — string-rewriting fractals drawn to a 2D canvas
   (Koch, Dragon, Tree, Plant). Rendered to a texture by the Engine.
   ============================================================ */
const LSystem = (() => {
  const SYSTEMS = {
    koch: { axiom: 'F--F--F', rules: { F: 'F+F--F+' }, angle: 60, iterations: 4, startAngle: 90 },
    dragon: {
      axiom: 'FX',
      rules: { X: 'X+YF+', Y: '-FX-Y' },
      angle: 90,
      iterations: 10,
      startAngle: 0
    },
    tree: {
      axiom: 'X',
      rules: { X: 'F+[[X]-X]-F[-FX]+X', F: 'FF' },
      angle: 25,
      iterations: 4,
      startAngle: 90
    },
    plant: {
      axiom: 'X',
      rules: { X: 'F[+X][-X]FX', F: 'FF' },
      angle: 25.7,
      iterations: 5,
      startAngle: 90
    }
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
    const angle = (system.angle * Math.PI) / 180;

    // Turtle pass in unit space, collecting segments grouped by depth.
    let x = 0,
      y = 0,
      dir = (system.startAngle * Math.PI) / 180;
    const stack = [];
    let depth = 0;
    const groups = {};
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (ch === 'F' || ch === 'G') {
        const nx = x + Math.cos(dir);
        const ny = y + Math.sin(dir);
        (groups[depth] = groups[depth] || []).push(x, y, nx, ny);
        x = nx;
        y = ny;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      } else if (ch === '+') dir += angle;
      else if (ch === '-') dir -= angle;
      else if (ch === '[') {
        stack.push(x, y, dir);
        depth++;
      } else if (ch === ']') {
        dir = stack.pop();
        y = stack.pop();
        x = stack.pop();
        depth--;
      }
    }
    if (minX === Infinity) return;

    // Fit to canvas with margin, centered.
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;
    const margin = 0.14;
    const scale = Math.min((width * (1 - 2 * margin)) / spanX, (height * (1 - 2 * margin)) / spanY);
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
  let trailsRead = null; // the buffer the composite pass samples
  let trailsWrite = null; // the buffer the feedback pass writes
  let width = 0;
  let height = 0;

  function resize(w, h) {
    width = w;
    height = h;
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
      const tmp = trailsRead;
      trailsRead = trailsWrite;
      trailsWrite = tmp;
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
   Interaction — mouse / touch / keyboard input
   ============================================================ */
const Interaction = (() => {
  // Handlers the App registers.
  let onPan = null;
  let onZoom = null;
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
    onFocus = handlers.onFocus || null;
    onAction = handlers.onAction || null;
  }

  function setEnabled(v) {
    pointerEnabled = v;
  }
  function setKeyboardEnabled(v) {
    keyboardEnabled = v;
  }

  function init(canvas) {
    // --- Mouse ---
    canvas.addEventListener('mousedown', (e) => {
      if (!pointerEnabled) return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging || !pointerEnabled) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      if (onPan) onPan(dx, dy);
    });
    window.addEventListener('mouseup', () => {
      dragging = false;
    });

    canvas.addEventListener(
      'wheel',
      (e) => {
        if (!pointerEnabled || !onZoom) return;
        e.preventDefault();
        const factor = Math.exp(-e.deltaY * 0.0015);
        onZoom(factor, e.clientX, e.clientY);
      },
      { passive: false }
    );

    // Double-click focuses and recenters on the point (not a plain zoom).
    canvas.addEventListener('dblclick', (e) => {
      if (!pointerEnabled || !onFocus) return;
      onFocus(e.clientX, e.clientY);
    });

    // --- Touch ---
    canvas.addEventListener(
      'touchstart',
      (e) => {
        if (!pointerEnabled) return;
        if (e.touches.length === 1) {
          dragging = true;
          lastX = e.touches[0].clientX;
          lastY = e.touches[0].clientY;
        } else if (e.touches.length === 2) {
          dragging = false;
          pinchDist = touchDist(e.touches);
        }
      },
      { passive: true }
    );

    canvas.addEventListener(
      'touchmove',
      (e) => {
        if (!pointerEnabled) return;
        e.preventDefault();
        if (e.touches.length === 1 && dragging) {
          const dx = e.touches[0].clientX - lastX;
          const dy = e.touches[0].clientY - lastY;
          lastX = e.touches[0].clientX;
          lastY = e.touches[0].clientY;
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
      },
      { passive: false }
    );

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
        case 'ArrowLeft':
          onAction('pan', [-step, 0]);
          break;
        case 'ArrowRight':
          onAction('pan', [step, 0]);
          break;
        case 'ArrowUp':
          onAction('pan', [0, -step]);
          break;
        case 'ArrowDown':
          onAction('pan', [0, step]);
          break;
        case '+':
        case '=':
          onAction('zoom', [1.2]);
          break;
        case '-':
        case '_':
          onAction('zoom', [1 / 1.2]);
          break;
        case ' ':
          e.preventDefault();
          onAction('pause');
          break;
        // App action keys: suppressed while a modal is open (focus is trapped
        // there) so they don't fire the action behind the dialog. Arrows, zoom,
        // and Space (pause) are intentionally left ungated.
        case 'r':
        case 'R':
          if (!UI.isAnyModalOpen()) onAction('randomize');
          break;
        case 'n':
        case 'N':
          if (!UI.isAnyModalOpen()) onAction('newworld');
          break;
        case 's':
        case 'S':
          if (!UI.isAnyModalOpen()) onAction('share');
          break;
        case 'e':
        case 'E':
          if (!UI.isAnyModalOpen()) onAction('export');
          break;
        case 'g':
        case 'G':
          if (!UI.isAnyModalOpen()) onAction('gallery');
          break;
        case 'a':
        case 'A':
          if (!UI.isAnyModalOpen()) onAction('audio');
          break;
        default:
          if (key >= '1' && key <= '9' && !UI.isAnyModalOpen())
            onAction('palette', [parseInt(key, 10) - 1]);
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
    s.center = [mode.center[0] + (rng() - 0.5) * 0.6, mode.center[1] + (rng() - 0.5) * 0.6];
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
    'mode',
    'seed',
    'palette',
    'palettePhase',
    'paletteSpeed',
    'cycling',
    'contrast',
    'iterations',
    'detail',
    'anim',
    'bloom',
    'trails',
    'aberration',
    'vignette',
    'fog',
    'power',
    'center',
    'zoom',
    'growth',
    'camAngle',
    'orbitRadius',
    'juliaPhase'
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
    juliaPhase: [0, 100]
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
      throw new Error('Malformed share code', { cause: e });
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj))
      throw new Error('Malformed share code');
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
      out[k] =
        k === 'seed' || k === 'iterations' || k === 'palette'
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
   Gallery — persist saved worlds (state + thumbnail) in
   localStorage. Favorites float to the top.
   ============================================================ */
const Gallery = (() => {
  const KEY = 'fractal-forge:gallery';
  const SCHEMA_VERSION = 1;
  const THUMB_W = 384,
    THUMB_H = 216;

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      // Support both the legacy bare-array format and the versioned envelope.
      const arr = Array.isArray(parsed)
        ? parsed
        : parsed && Array.isArray(parsed.items)
          ? parsed.items
          : [];
      return arr.filter((it) => it && typeof it === 'object' && it.id);
    } catch (e) {
      return [];
    }
  }

  // Persist a versioned envelope. Returns { ok, trimmed?, error? } so callers
  // can report honest success/failure instead of assuming it worked.
  function persist(items) {
    const write = (arr) =>
      localStorage.setItem(KEY, JSON.stringify({ v: SCHEMA_VERSION, items: arr }));
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
        } catch (e2) {
          /* keep trimming */
        }
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
      name: name || Fractals.get(State.get().mode).label + ' #' + (items.length + 1),
      createdAt: Date.now(),
      favorite: false,
      thumb: makeThumb(time),
      state: State.clone()
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

  function get(id) {
    return load().find((it) => it.id === id) || null;
  }

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
    try {
      localStorage.removeItem(KEY);
    } catch (e) {
      /* ignore */
    }
  }

  function count() {
    return load().length;
  }

  return { save, list, get, remove, toggleFavorite, restore, clear, count };
})();

/* ============================================================
   Audio — microphone-reactive mode. Analyzes the mic signal into
   bass / mid / treble bands and exposes a smoothed overall level
   that the render pipeline can modulate.
   ============================================================ */
// The module name intentionally shadows the built-in Audio constructor
// (the built-in is not used anywhere in this app).
const Audio = (() => {
  let ctx = null;
  let analyser = null;
  let stream = null;
  let freqData = null;
  let enabled = false;
  let level = 0; // smoothed overall level [0,1]
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
      treble: bandAvg(freqData, n * 0.5, n)
    };
    const overall = raw.bass * 0.5 + raw.mid * 0.35 + raw.treble * 0.15;
    // Smooth toward the target for a musical, non-jittery response.
    level += (overall - level) * 0.25;
    bands = raw;
    return { level, bands };
  }

  function isEnabled() {
    return enabled;
  }

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
  let w = 0,
    h = 0;
  let enabled = true;
  let reducedMotion = false;

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
        hue: 220 + Math.random() * 80
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
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    makeParticles();
  }

  function setEnabled(v) {
    enabled = v;
  }
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
      if (p.x < -5) p.x = w + 5;
      else if (p.x > w + 5) p.x = -5;
      if (p.y < -5) p.y = h + 5;
      else if (p.y > h + 5) p.y = -5;
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
    keyboard: true
  };
  let settings = Object.assign({}, defaults);

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) settings = Object.assign({}, defaults, JSON.parse(raw));
    } catch (e) {
      /* keep defaults */
    }
    // Respect the OS-level reduced-motion preference on first run.
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      settings.reducedMotion = true;
    }
  }

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch (e) {
      /* ignore */
    }
  }

  function get() {
    return Object.assign({}, settings);
  }
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
  let renderW = 0,
    renderH = 0;
  let audioBands = [0, 0, 0]; // [bass, mid, treble]

  const $ = (id) => document.getElementById(id);

  // ---------- Buffer management ----------
  function computeRenderSize() {
    return {
      w: Math.max(2, Math.floor(window.innerWidth * renderScale)),
      h: Math.max(2, Math.floor(window.innerHeight * renderScale))
    };
  }

  function rebuildBuffers() {
    const { w, h } = computeRenderSize();
    renderW = w;
    renderH = h;
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
      orbitRadius: Camera.getOrbitRadius()
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
      zoom: (window.innerHeight || 800) / m.span
    });
    if (m.iterations) State.set({ iterations: m.iterations });
    if (m.power) State.set({ power: m.power });
    // Per-mode 3D framing: the tree is viewed closer than the bulb, so set the
    // orbit radius from the registry (applyWorld then drives the camera from it).
    if (m.kind === 'gpu3d') State.set({ orbitRadius: m.orbitRadius || 3.0 });
  }

  function setMode(id) {
    if (!Fractals.get(id)) return;
    applyModeDefaults(id);
    startAutoGrow(); // replays growth for an lsystem (re)selection
    applyWorld();
    syncUrl();
  }

  function randomize() {
    const rng = Util.mulberry32((Date.now() ^ (Math.random() * 1e9)) >>> 0);
    Procedural.randomize(rng);
    startAutoGrow(); // replays growth while in an lsystem mode
    applyWorld();
    syncUrl();
  }

  function newWorld() {
    const rng = Util.mulberry32((Date.now() ^ (Math.random() * 1e9)) >>> 0);
    const id = Fractals.ORDER[Math.floor(rng() * Fractals.ORDER.length)];
    applyModeDefaults(id);
    Procedural.randomize(rng);
    startAutoGrow(); // replays growth if the new world is an lsystem
    applyWorld();
    UI.toast('Forged a new world', 'ok');
    syncUrl();
  }

  function setPalette(i) {
    ColorSystem.setIndex(i);
    State.set({ palette: i });
    UI.highlightPalette(i);
    UI.updateGradientBar();
    syncUrl();
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
        UI.toast(
          'Saved (storage full — removed ' +
            result.trimmed +
            ' oldest non-favorite' +
            (result.trimmed > 1 ? 's' : '') +
            ')',
          'info'
        );
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
      Audio.enable()
        .then(() => {
          if (btn) btn.setAttribute('aria-pressed', 'true');
          UI.toast('Audio reactive on — make some noise', 'ok');
        })
        .catch((e) => UI.toast('Mic unavailable: ' + e.message, 'error'));
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

  // ---------- L-system auto-growth ----------
  // When an lsystem mode is (re)selected — or randomized while in one — growth
  // animates 0 -> 1 over AUTO_GROW_SECONDS with ease-out, writing through
  // State.set like any other control (so Share/URL/export all observe it).
  // Transient: not in State defaults and never serialized. The growth slider
  // cancels it; reduced motion snaps straight to 1; pausing freezes it.
  const AUTO_GROW_SECONDS = 2.5;
  let autoGrow = { active: false, t: 0 };

  function easeOutGrowth(t) {
    const x = Util.clamp(t, 0, 1);
    return 1 - Math.pow(1 - x, 3);
  }

  function startAutoGrow() {
    const mode = Fractals.get(State.get().mode);
    if (!mode || mode.kind !== 'lsystem') return;
    if (A11y.get().reducedMotion) {
      // Reduced motion: no animation, snap to the final state.
      autoGrow.active = false;
      State.set({ growth: 1 });
      return;
    }
    autoGrow.active = true;
    autoGrow.t = 0;
    State.set({ growth: 0 });
  }

  function cancelAutoGrow() {
    autoGrow.active = false;
  }

  function syncGrowthSlider() {
    const el = document.getElementById('ms-growth');
    if (!el) return;
    const pct = Math.round((State.get().growth || 0) * 100);
    el.value = pct;
    if (el.parentElement && el.parentElement.querySelector) {
      const span = el.parentElement.querySelector('.val');
      if (span) span.textContent = pct + '%';
    }
  }

  function autoGrowTick(dt, paused, reduced) {
    if (!autoGrow.active) return;
    if (reduced) {
      // Reduced motion switched on mid-flight: snap to the final state.
      autoGrow.active = false;
      State.set({ growth: 1 });
      syncGrowthSlider();
      return;
    }
    if (paused) return; // paused: frozen in place; resume continues it
    autoGrow.t += dt / AUTO_GROW_SECONDS;
    const done = autoGrow.t >= 1;
    if (done) autoGrow.active = false;
    State.set({ growth: done ? 1 : easeOutGrowth(autoGrow.t) });
    syncGrowthSlider();
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
      // Share codes carry the world, not a moment: clear any paused clock so
      // the URL never keeps a stale moment after an import.
      State.set({ clock: 0 });
      applyWorld();
      UI.closeModal('modal-gallery');
      UI.toast('World imported', 'ok');
      syncUrl();
    } catch (e) {
      UI.toast('Invalid code: ' + e.message, 'error');
    }
  }

  let exporting = false;
  function exportAt(res) {
    if (exporting) return; // busy lock: one export at a time
    let w, h;
    if (res === 'current') {
      w = window.innerWidth;
      h = window.innerHeight;
    } else {
      const parts = res.split('x').map(Number);
      w = parts[0];
      h = parts[1];
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
    // The paused moment is the reproducible one: pin the clock into the URL
    // on pause (written once here, never per-frame) and drop it on resume.
    State.set({ clock: paused ? time : 0 });
    syncUrl();
    UI.toast(paused ? 'Paused' : 'Resumed', 'info');
  }

  function handleAction(action, arg) {
    switch (action) {
      case 'pan':
        Camera.pan(arg[0], arg[1]);
        syncCamera();
        break;
      case 'zoom':
        Camera.zoomCenter(arg[0]);
        syncCamera();
        break;
      case 'pause':
        togglePause();
        break;
      case 'randomize':
        randomize();
        break;
      case 'newworld':
        newWorld();
        break;
      case 'share':
        share();
        break;
      case 'export':
        UI.openModal('modal-export');
        break;
      case 'gallery':
        UI.renderGallery();
        UI.openModal('modal-gallery');
        break;
      case 'audio':
        toggleAudio();
        break;
      case 'palette':
        setPalette(arg[0]);
        break;
      default:
        break;
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
  function adaptQuality(dt, now, a11y) {
    const inst = 1 / Math.max(dt, 0.001);
    fpsSmooth = fpsSmooth * 0.9 + inst * 0.1;
    if (!a11y.adaptive) {
      if (qualityIndex !== 0) {
        qualityIndex = 0;
        setRenderScale(QUALITY_LEVELS[0]);
      }
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
    // Snapshot A11y once per frame so repeated reads below don't each build a
    // fresh Object.assign copy (behavior identical, fewer per-frame allocations).
    const a11y = A11y.get();
    // Reduced motion freezes time-based animation but keeps a static frame.
    const reduced = a11y.reducedMotion;
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
    autoGrowTick(dt, paused, reduced);
    // Phase 4/5a: while a 3D mode animates, the camera slowly orbits the
    // subject once the user's hands are off (touch() in the handlers below
    // pauses the drift for a grace window). This gives the 3D views a stable,
    // always-present motion cue (the sway/breathing is layered on top).
    if (
      (s.mode === 'mandelbulb' || s.mode === 'fractalTree3d') &&
      !paused &&
      !reduced &&
      s.anim > 0
    ) {
      Camera.autoOrbit(dt, now);
    }
    Ambient.tick(dt);
    adaptQuality(dt, now, a11y);
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
      highContrast: a11y.highContrast ? 1 : 0,
      camPos: Camera.camPos,
      camTarget: Camera.camTarget
    };

    Engine.renderFractal(baseFBO, renderW, renderH, params);
    Effects.render(baseFBO, params);

    if (Math.floor(now / 250) !== Math.floor((now - dt * 1000) / 250)) {
      UI.updateFps(fpsSmooth);
    }
  }

  // ---------- Init ----------
  function init() {
    // Restore a shared world from the URL before the first render. Invalid
    // values are dropped (defaults stay); a valid value always wins.
    const restored = State.parseURL(window.location && window.location.search);
    if (restored.changed) State.set(restored.partial);
    // A shared clock is a paused moment: seed the main-loop clock from it so
    // the link reproduces that exact frame (the app still animates forward
    // from there unless paused or reduced-motion).
    time = Math.max(0, Number(State.get().clock) || 0);

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
      }
    });
    A11y.load();
    applySettings();

    Camera.reset(State.get().mode);
    syncCamera();
    rebuildBuffers();

    Interaction.init(canvas);
    // A 3D mode (Mandelbulb, Fractal Tree) is driven by orbit, not 2D pan/zoom.
    const is3dMode = () => {
      const m = Fractals.get(State.get().mode);
      return !!m && m.kind === 'gpu3d';
    };
    Interaction.register({
      onPan: (dx, dy) => {
        if (is3dMode()) {
          Camera.touch();
          Camera.rotate3d(dx * 0.01);
        } else {
          Camera.pan(dx, dy);
        }
        syncCamera();
      },
      onZoom: (factor, x, y) => {
        if (is3dMode()) {
          Camera.touch();
          Camera.setOrbitRadius(Camera.getOrbitRadius() / factor);
        } else {
          Camera.zoomAt(factor, x, y);
        }
        syncCamera();
      },
      onFocus: (x, y) => {
        if (is3dMode()) {
          Camera.touch();
          Camera.setAngle(0);
          Camera.setOrbitRadius(Fractals.get(State.get().mode).orbitRadius || 3.0);
        } else {
          Camera.focusAt(x, y);
        }
        syncCamera();
      },
      onAction: handleAction
    });

    Ambient.init($('ambient-canvas'));

    UI.init({
      setMode,
      randomize,
      newWorld,
      share,
      toggleAudio,
      saveArtwork,
      cancelAutoGrow,
      galleryRestore,
      importCode,
      exportAt,
      onParam: () => syncUrl(),
      onSetting,
      onboarded: () => {
        try {
          localStorage.setItem('fractal-forge:onboarded', '1');
        } catch (e) {
          /* ignore */
        }
      }
    });
    UI.renderModeSpecific();
    if (restored.changed) UI.toast('Restored world from URL', 'info');

    window.addEventListener('resize', onResize);
    requestAnimationFrame(loop);
  }

  // ---------- Shareable URL ----------
  // Keep the address bar in sync with the shareable state. replaceState means
  // we never pollute the back/forward stack on every change. Best-effort:
  // some contexts (file://, tests) reject or lack history.
  function syncUrl() {
    try {
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, '', State.toQuery(State.get()));
      }
    } catch (e) {
      /* URL sync is cosmetic; never break a render for it */
    }
  }

  // Expose the live animation time so the export/thumbnail path can render
  // the exact on-screen composition instead of forcing time = 0.
  function getLiveTime() {
    return time;
  }

  return {
    init,
    setMode,
    randomize,
    newWorld,
    share,
    toggleAudio,
    saveArtwork,
    galleryRestore,
    importCode,
    exportAt,
    togglePause,
    getLiveTime,
    startAutoGrow,
    cancelAutoGrow,
    autoGrowTick,
    easeOutGrowth
  };
})();

/* ============================================================
   Boot
   ============================================================ */
// This file loads as an ES module, so expose the public API as browser
// globals (used by the Playwright suite and for console access).
globalThis.App = App;
globalThis.State = State;
globalThis.UI = UI;
globalThis.Exporter = Exporter;

// Re-exported for src/exporter.js and src/ui.js (circular imports; used
// at call time only).
export { GL, Effects, Engine, A11y, ColorSystem, Gallery };

function boot() {
  try {
    App.init();
  } catch (e) {
    console.error('FRACTAL FORGE failed to start:', e);
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;' +
      'color:#e5e7eb;font-family:system-ui,sans-serif;padding:2rem;text-align:center;background:#05060a';
    overlay.innerHTML =
      '<div><h2 style="margin:0 0 .5rem">FRACTAL FORGE could not start</h2>' +
      '<p style="margin:0;opacity:.8">' +
      (e && e.message ? e.message : 'Unknown error') +
      '. WebGL may be unavailable or blocked in this browser.</p></div>';
    document.body.appendChild(overlay);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
