/* ============================================================
   Shaders — GLSL source (common chunks + per-mode + post-fx)
   ============================================================ */
export const Shaders = (() => {
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

  const MANDELBROT =
    COMMON +
    `
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

  const JULIA =
    COMMON +
    `
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

  const BURNING_SHIP =
    COMMON +
    `
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

  const NEWTON =
    COMMON +
    `
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

  const SIERPINSKI =
    COMMON +
    `
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

  const COSMIC_NEBULA =
    COMMON +
    `
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

  const DREAMSCAPE =
    COMMON +
    `
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

  const NEURAL_BLOOM =
    COMMON +
    `
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

  const QUANTUM_FIELD =
    COMMON +
    `
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

  const MANDELBULB =
    COMMON +
    `
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
      // The seed orbits the camera AROUND the bulb (u_cam_target) about the
      // vertical axis, so the bulb always fills the frame and the seed only
      // changes which side is seen.  (Rotating the look direction instead would
      // swing the fixed camera off-axis and blank the bulb out of view for most
      // seeds.)
      vec3 rel = u_cam_pos - u_cam_target;
      float sa = 0.4 * u_seed;
      float cs = cos(sa), sn = sin(sa);
      vec3 ro = u_cam_target + vec3(rel.x * cs + rel.z * sn, rel.y, -rel.x * sn + rel.z * cs);
      vec3 ww = normalize(u_cam_target - ro);
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
  const BRIGHT_PASS =
    POST_HEADER +
    `
    uniform float u_threshold;
    void main() {
      vec4 c = texture2D(u_texture, vUv);
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      float b = smoothstep(u_threshold, u_threshold + 0.6, l);
      gl_FragColor = vec4(c.rgb * b, 1.0);
    }
  `;

  // Separable Gaussian blur (direction via u_direction).
  const BLUR =
    POST_HEADER +
    `
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
  const COMPOSITE =
    POST_HEADER +
    `
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
  const FEEDBACK =
    POST_HEADER +
    `
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
  const TEXTURE_DISPLAY =
    POST_HEADER +
    `
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
    MANDELBROT,
    JULIA,
    BURNING_SHIP,
    NEWTON,
    SIERPINSKI,
    COSMIC_NEBULA,
    DREAMSCAPE,
    NEURAL_BLOOM,
    QUANTUM_FIELD,
    MANDELBULB,
    BRIGHT_PASS,
    BLUR,
    COMPOSITE,
    FEEDBACK,
    TEXTURE_DISPLAY
  };
})();
