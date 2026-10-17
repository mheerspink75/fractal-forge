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
      // Slow domain warp (bounded sinusoid; zero at u_time = 0, so the t=0
      // golden frame is unchanged).
      float tw = u_time * 0.08 * u_anim;
      c += vec2(0.02 * sin(tw), 0.02 * sin(0.7 * tw));
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
      // Gentle rotation drift (identity rotation at u_time = 0).
      float ang = u_time * 0.06 * u_anim;
      float sa = sin(ang), ca = cos(ang);
      c = mat2(ca, -sa, sa, ca) * c;
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
      // Slow rotation of the basin view (identity at u_time = 0).
      float ang = u_time * 0.05 * u_anim;
      float sa = sin(ang), ca = cos(ang);
      c = mat2(ca, -sa, sa, ca) * c;
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

    float mandelbulbDE(vec3 pos, float pw) {
      vec3 z = pos;
      float dr = 1.0;
      float r = 0.0;
      const float EPS = 1e-6;
      for (int i = 0; i < 12; i++) {
        r = length(z);
        if (r > 2.0) break;
        if (r < EPS) r = EPS;   // guard division by zero and log(0)
        float theta = acos(clamp(z.z / r, -1.0, 1.0)) * pw;
        float phi = atan(z.y, z.x) * pw;
        float zr = pow(r, pw);
        dr = pow(r, pw - 1.0) * pw * dr + 1.0;
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
      // Animation = the classic "breathing powerfractal" move: the power
      // oscillates with the clock. At u_anim = 0 (or t = 0) this is the
      // pure z^power Mandelbulb, so paused/shared frames stay static and
      // golden baselines are untouched.
      float power_eff = u_power + 0.5 * u_anim * sin(u_time * 0.1);
      for (int i = 0; i < 160; i++) {
        pos = ro + rd * t;
        dist = mandelbulbDE(pos, power_eff);
        if (dist < 0.0) dist = 0.0;   // guard against negative/NaN estimates
        t += min(dist, 0.5) * 0.85;  // cap the step to avoid tunneling
        if (t > 24.0 || dist < 0.0006) break;
      }

      vec3 col;
      if (dist < 0.0006) {
        vec2 e = vec2(1e-4, 0.0);
        vec3 n = normalize(vec3(
          mandelbulbDE(pos + e.xyy, power_eff) - mandelbulbDE(pos - e.xyy, power_eff),
          mandelbulbDE(pos + e.yxy, power_eff) - mandelbulbDE(pos - e.yxy, power_eff),
          mandelbulbDE(pos + e.yyx, power_eff) - mandelbulbDE(pos - e.yyx, power_eff)
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

  /* ---------------- 3D Fractal Tree (raymarched I-tree) ---------------- */
  // A self-similar branching tree: the unit trunk (a vertical segment, centered
  // at the origin) is recursively replaced by N outward-tilted, scaled copies at
  // its tip. The distance estimator walks the IFS "best branch" at each level
  // (a valid-enough bound for a conservative raymarch step) and traps the
  // distance to the trunk, so the result is the distance to the nearest branch
  // along the closest path.
  //
  // u_growth gates how many levels are drawn (trunk at 0 -> full canopy at 1),
  // porting the Phase-2 "grow into being" feel into 3D. u_seed offsets the
  // branch twist (D3: the seed reshapes the tree). A gentle u_time sway is
  // applied when u_anim > 0 (identity at u_anim=0 or t=0, so paused/shared
  // frames and golden baselines stay static).
  const FRACTAL_TREE =
    COMMON +
    `
    uniform vec3  u_cam_pos;
    uniform vec3  u_cam_target;
    uniform float u_growth;      // 0..1, how much of the canopy is drawn

    const int   MAXDEPTH     = 5;
    const int   BRANCHES     = 3;
    const float BRANCH_SCALE = 0.62;
    const float BRANCH_ANGLE = 0.62;   // rad, outward tilt of each limb
    const float BRANCH_RAD   = 0.20;   // limb tube radius (unit-trunk space)

    // Trunk = vertical segment (0,-0.5,0)-(0,0.5,0), so the tree is centered
    // at the origin and the default camera (looking at the origin) frames it.
    float trunkDist(vec3 p) {
      vec3 a = vec3(0.0, -0.5, 0.0);
      vec3 b = vec3(0.0, 0.5, 0.0);
      vec3 ab = b - a;
      vec3 ap = p - a;
      float h = clamp(dot(ap, ab), 0.0, 1.0);
      return length(ap - ab * h);
    }

    mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c,0.0,-s, 0.0,1.0,0.0, s,0.0,c); }
    mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0,0.0,0.0, 0.0,c,s, 0.0,-s,c); }

    float treeDE(vec3 p) {
      float d = 1e5;
      float s = 1.0;
      // Seed reshapes the tree (D3): each limb's twist scales with its index,
      // so different seeds produce genuinely different canopies (not just a
      // rotation). A gentle u_time sway is added when u_anim > 0.
      float twistSeed = 0.3 * u_seed;
      float sway = 0.3 * u_anim * sin(u_time * 0.5);
      for (int i = 0; i < MAXDEPTH; i++) {
        float fi = float(i);
        // Growth gate: always draw the trunk (i=0); draw level i only once the
        // canopy has grown past it. So the tree "grows into being" with u_growth.
        if (i == 0 || (fi + 0.5 < u_growth * float(MAXDEPTH))) {
          d = min(d, (trunkDist(p) - BRANCH_RAD) * s);
        }
        // Map p into the closest limb's local frame (best-branch IFS step).
        vec3 best = p;
        float bestD = 1e5;
        for (int b = 0; b < BRANCHES; b++) {
          float twist = 6.2831853 * float(b) / float(BRANCHES) + twistSeed * (float(b) + 1.0) + sway;
          vec3 q = p - vec3(0.0, 0.5, 0.0);  // to the trunk tip
          q = rotY(-twist) * q;              // undo twist
          q = rotX(-BRANCH_ANGLE) * q;       // undo outward tilt
          q = q / BRANCH_SCALE;              // undo scale
          float db = trunkDist(q);
          if (db < bestD) { bestD = db; best = q; }
        }
        p = best;
        s *= BRANCH_SCALE;
      }
      return d;
    }

    vec3 calcNormal(vec3 p) {
      vec2 e = vec2(1e-3, 0.0);
      return normalize(vec3(
        treeDE(p + e.xyy) - treeDE(p - e.xyy),
        treeDE(p + e.yxy) - treeDE(p - e.yxy),
        treeDE(p + e.yyx) - treeDE(p - e.yyx)
      ));
    }

    void main() {
      // Seed orbits the camera around the tree (u_cam_target), so the tree
      // always fills the frame and the seed only changes which side is seen.
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
      for (int i = 0; i < 80; i++) {
        pos = ro + rd * t;
        dist = treeDE(pos);
        if (dist < 0.0) dist = 0.0;
        t += min(dist, 0.4) * 0.7;   // conservative step (the DE is a heuristic bound)
        if (t > 30.0 || dist < 0.0012) break;
      }

      vec3 col;
      if (dist < 0.0012) {
        vec3 n = calcNormal(pos);
        vec3 lightDir = normalize(vec3(0.5, 0.8, -0.6));
        float diff = max(dot(n, lightDir), 0.0);
        float spec = pow(max(dot(reflect(-lightDir, n), rd), 0.0), 24.0);
        float fresnel = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
        // Woody gradient by height, tinted by the active palette (palettePhase).
        float h = clamp(pos.y + 0.5, 0.0, 1.0);
        vec3 wood = mix(vec3(0.42, 0.28, 0.15), vec3(0.62, 0.78, 0.38), h);
        vec3 base = mix(wood, palette(pos.y * 0.25 + u_palette_phase), 0.45);
        col = base * (0.22 + diff * 1.05) + spec * 0.5 + fresnel * base * 0.7;
      } else {
        col = vec3(0.015, 0.02, 0.04);
      }
      col *= 1.0 + u_audio.x * 0.3;
      gl_FragColor = vec4(applyContrast(col), 1.0);
    }
  `;

  /* ---------------- 3D Power Bulb (z^p powerfractal, raymarched) ---------------- */
  // The z^p 3D powerfractal family: a 3D extension of z -> z^p + c in which the
  // polar angle is preserved and the azimuth is multiplied by p (the
  // Mandelbulb multiplies both angles). At integer p the set carries the
  // classic p-fold spiky silhouette (p=3 is the default). Same raymarching
  // scheme as the Mandelbulb, with the same motion contract:
  //   u_power   — the exponent (per-mode default; slider 2..16)
  //   u_time/u_anim — the Phase-4 "breathing exponent" (identity at u_time=0)
  //   u_seed    — a bounded in-DE offset (D3: the seed reshapes the
  //               composition) plus the shared camera orbit
  const POWER_BULB =
    COMMON +
    `
    uniform vec3 u_cam_pos;
    uniform vec3 u_cam_target;
    uniform float u_power;

    float powerBulbDE(vec3 pos, float pw) {
      // Bounded seed-driven offset (D3): its DIRECTION rotates with u_seed and
      // breaks the shape's p-fold symmetry, so ANY seed change moves the
      // composition (a pure camera orbit could cancel at a symmetric angle).
      // The magnitude stays small so the subject remains comfortably in frame.
      float oa = 1.7 * u_seed;
      vec3 z = pos + vec3(sin(oa) * 0.12, 0.0, cos(oa) * 0.12);
      float dr = 1.0;
      float r = 0.0;
      const float EPS = 1e-6;
      for (int i = 0; i < 12; i++) {
        r = length(z);
        if (r > 2.0) break;
        if (r < EPS) r = EPS;   // guard division by zero and log(0)
        float theta = acos(clamp(z.z / r, -1.0, 1.0));
        float phi = atan(z.y, z.x) * pw;
        float zr = pow(r, pw);
        dr = pow(r, pw - 1.0) * pw * dr + 1.0;
        z = zr * vec3(sin(theta) * cos(phi), sin(theta) * sin(phi), cos(theta)) + pos;
      }
      r = max(r, EPS);
      dr = max(dr, EPS);
      return 0.5 * log(r) * r / dr;
    }

    void main() {
      // The seed orbits the camera AROUND the bulb (u_cam_target) about the
      // vertical axis, so the bulb always fills the frame and the seed changes
      // which side is seen (same framing scheme as the Mandelbulb).
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
      // Animation = the Phase-4 "breathing powerfractal" move: the power
      // oscillates with the clock. At u_anim = 0 (or u_time = 0) this is the
      // pure z^power shape, so paused/shared frames and golden baselines stay
      // static.
      float power_eff = u_power + 0.5 * u_anim * sin(u_time * 0.1);
      for (int i = 0; i < 160; i++) {
        pos = ro + rd * t;
        dist = powerBulbDE(pos, power_eff);
        if (dist < 0.0) dist = 0.0;   // guard against negative/NaN estimates
        t += min(dist, 0.5) * 0.85;  // cap the step to avoid tunneling
        if (t > 24.0 || dist < 0.0006) break;
      }

      vec3 col;
      if (dist < 0.0006) {
        vec2 e = vec2(1e-4, 0.0);
        vec3 n = normalize(vec3(
          powerBulbDE(pos + e.xyy, power_eff) - powerBulbDE(pos - e.xyy, power_eff),
          powerBulbDE(pos + e.yxy, power_eff) - powerBulbDE(pos - e.yxy, power_eff),
          powerBulbDE(pos + e.yyx, power_eff) - powerBulbDE(pos - e.yyx, power_eff)
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
    FRACTAL_TREE,
    POWER_BULB,
    BRIGHT_PASS,
    BLUR,
    COMPOSITE,
    FEEDBACK,
    TEXTURE_DISPLAY
  };
})();
