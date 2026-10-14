/* GLSL sanity check: balanced braces/parens, and every uniform referenced
   in a fragment shader is declared in it.
   Run with: node test/glsl-check.js  (or: npm test) */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');

// Minimal sandbox to load the Shaders module.
function makeEl(id) {
  return { id, style: {}, dataset: {}, children: [], hidden: false, value: '0', checked: false,
    textContent: '', innerHTML: '', appendChild(c) { this.children.push(c); return c; },
    removeChild() {}, remove() {}, addEventListener() {}, setAttribute() {}, getAttribute() { return null; },
    querySelector() { return makeEl('q'); }, querySelectorAll() { return []; }, getContext() { return null; },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } } };
}
const elements = {};
const doc = { readyState: 'complete', getElementById(id) { return elements[id] || (elements[id] = makeEl(id)); },
  querySelector() { return makeEl('q'); }, querySelectorAll() { return []; }, createElement(t) { return makeEl(t); },
  addEventListener() {}, body: makeEl('body'), documentElement: makeEl('html') };
const storage = {};
const ls = { getItem(k) { return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null; },
  setItem(k, v) { storage[k] = String(v); }, removeItem(k) { delete storage[k]; } };
const sb = { console, document: doc,
  window: { innerWidth: 1280, innerHeight: 800, addEventListener() {}, removeEventListener() {},
    matchMedia() { return { matches: false }; }, requestAnimationFrame() { return 0; }, cancelAnimationFrame() {},
    devicePixelRatio: 1, location: { href: 'http://localhost/' } },
  localStorage: ls, navigator: { clipboard: null, userAgent: 'node' },
  requestAnimationFrame() { return 0; }, cancelAnimationFrame() {},
  setTimeout, clearTimeout, setInterval, clearInterval, performance: { now: () => Date.now() },
  Date, Math, JSON, Object, Array, String, Number, Boolean, Float32Array, Uint8Array, Int32Array, Uint32Array,
  Promise, Symbol, Map, Set, RegExp, Error, TypeError, RangeError, parseInt, parseFloat, isNaN, isFinite,
  TextEncoder, TextDecoder,
  btoa(s) { return Buffer.from(s, 'binary').toString('base64'); }, atob(s) { return Buffer.from(s, 'base64').toString('binary'); } };
sb.window.localStorage = ls; sb.window.document = doc; sb.window.navigator = sb.navigator; sb.globalThis = sb;
const exp = '\n;globalThis.__S = Shaders;\n';
const ctx = vm.createContext(sb);
vm.runInContext(src + exp, ctx, { filename: 'script.js' });
const S = sb.__S;

let failures = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ok: ' + name); }
  else { failures++; console.error('  FAIL: ' + name + (extra ? ' — ' + extra : '')); }
}

const SHADERS = ['VERTEX', 'MANDELBROT', 'JULIA', 'BURNING_SHIP', 'NEWTON', 'SIERPINSKI',
  'COSMIC_NEBULA', 'DREAMSCAPE', 'NEURAL_BLOOM', 'QUANTUM_FIELD', 'MANDELBULB',
  'BRIGHT_PASS', 'BLUR', 'COMPOSITE', 'FEEDBACK', 'TEXTURE_DISPLAY'];

for (const name of SHADERS) {
  const code = S[name];
  if (typeof code !== 'string' || code.length === 0) { check(name + ' exists', false); continue; }

  // Strip comments and string literals before counting delimiters.
  const stripped = code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");

  const count = (ch) => (stripped.match(new RegExp('\\' + ch, 'g')) || []).length;
  const braces = count('{') - count('}');
  const parens = count('(') - count(')');
  check(name + ' balanced braces', braces === 0, `delta=${braces}`);
  check(name + ' balanced parens', parens === 0, `delta=${parens}`);

  // Every uniform referenced (u_xxx) must be declared.
  const declared = new Set((stripped.match(/uniform\s+[\w]+\s+(u_\w+)/g) || []).map((m) => m.split(/\s+/).pop()));
  const used = new Set((stripped.match(/\bu_\w+/g) || []));
  const missing = [...used].filter((u) => !declared.has(u));
  check(name + ' all uniforms declared', missing.length === 0, 'missing: ' + missing.join(', '));
}

// Regression guard: u_detail must be *used* by a fractal shader body, not
// merely declared (in COMMON) and set (in Engine). Before the Detail fix each
// fractal shader had exactly one u_detail (the declaration); wiring it into
// palette() yields two or more.
const FRACTAL = ['MANDELBROT', 'JULIA', 'BURNING_SHIP', 'NEWTON', 'SIERPINSKI',
  'COSMIC_NEBULA', 'DREAMSCAPE', 'NEURAL_BLOOM', 'QUANTUM_FIELD', 'MANDELBULB'];
const detailUsed = FRACTAL.some((n) => ((S[n] || '').match(/\bu_detail\b/g) || []).length >= 2);
check('u_detail is used by a fractal shader (Detail control wired)', detailUsed, 'no fractal shader references u_detail beyond its declaration');

console.log(failures === 0 ? '\nALL GLSL SANITY CHECKS PASSED' : `\n${failures} GLSL CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
