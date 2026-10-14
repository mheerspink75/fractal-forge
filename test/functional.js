/* Functional test: exercise the pure-JS logic (no WebGL/DOM needed).
   Run with: node test/functional.js  (or: npm test) */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');

function makeEl(id) {
  return {
    id, style: {}, dataset: {}, children: [], hidden: false, value: '0', checked: false,
    textContent: '', innerHTML: '', width: 0, height: 0,
    appendChild(c) { this.children.push(c); return c; },
    removeChild() {}, remove() {}, addEventListener() {}, removeEventListener() {},
    setAttribute() {}, getAttribute() { return null; },
    querySelector() { return makeEl('q'); }, querySelectorAll() { return []; },
    getContext() { return null; },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  };
}
const elements = {};
const documentMock = {
  readyState: 'complete',
  getElementById(id) { return elements[id] || (elements[id] = makeEl(id)); },
  querySelector() { return makeEl('q'); }, querySelectorAll() { return []; },
  createElement(tag) { return makeEl(tag); }, addEventListener() {}, removeEventListener() {},
  body: makeEl('body'), documentElement: makeEl('html'),
};
const storage = {};
const localStorageMock = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null; },
  setItem(k, v) { storage[k] = String(v); }, removeItem(k) { delete storage[k]; },
};
const sandbox = {
  console, document: documentMock,
  window: {
    innerWidth: 1280, innerHeight: 800, addEventListener() {}, removeEventListener() {},
    matchMedia() { return { matches: false }; }, requestAnimationFrame() { return 0; },
    cancelAnimationFrame() {}, devicePixelRatio: 1, location: { href: 'http://localhost/' },
  },
  localStorage: localStorageMock, navigator: { clipboard: null, userAgent: 'node' },
  requestAnimationFrame() { return 0; }, cancelAnimationFrame() {},
  setTimeout, clearTimeout, setInterval, clearInterval,
  performance: { now: () => Date.now() },
  Date, Math, JSON, Object, Array, String, Number, Boolean,
  Float32Array, Uint8Array, Int32Array, Uint32Array,
  Promise, Symbol, Map, Set, RegExp, Error, TypeError, RangeError,
  parseInt, parseFloat, isNaN, isFinite,
  TextEncoder, TextDecoder,
  btoa(s) { return Buffer.from(s, 'binary').toString('base64'); },
  atob(s) { return Buffer.from(s, 'base64').toString('binary'); },
};
sandbox.window.localStorage = localStorageMock;
sandbox.window.document = documentMock;
sandbox.window.navigator = sandbox.navigator;
sandbox.globalThis = sandbox;

const exportLine = '\n;globalThis.__m = { Util, GL, Shaders, ColorSystem, Fractals, Engine, LSystem, Effects, Camera, Interaction, State, Procedural, Share, Exporter, Gallery, Audio, Ambient, A11y, UI, App };\n';
const ctx = vm.createContext(sandbox);
vm.runInContext(src + exportLine, ctx, { filename: 'script.js' });
const M = sandbox.__m;

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; } else { fail++; console.error('  FAIL: ' + name); }
}
function throws(name, fn) {
  let threw = false;
  try { fn(); } catch (e) { threw = true; }
  check(name, threw);
}

console.log('--- Util ---');
{
  const a = M.Util.mulberry32(12345);
  const b = M.Util.mulberry32(12345);
  const seqA = [a(), a(), a()];
  const seqB = [b(), b(), b()];
  check('mulberry32 deterministic', JSON.stringify(seqA) === JSON.stringify(seqB));
  check('mulberry32 in [0,1)', seqA.every((v) => v >= 0 && v < 1));
  check('clamp', M.Util.clamp(5, 0, 3) === 3 && M.Util.clamp(-1, 0, 3) === 0 && M.Util.clamp(2, 0, 3) === 2);
  check('lerp', Math.abs(M.Util.lerp(0, 10, 0.5) - 5) < 1e-9);
  const enc = M.Util.b64urlEncode('hello world');
  check('b64url round-trip', M.Util.b64urlDecode(enc) === 'hello world');
  const packed = M.Util.packNumbers([1.5, -2.25, 3]);
  check('packNumbers round-trip', JSON.stringify(M.Util.unpackNumbers(packed)) === JSON.stringify([1.5, -2.25, 3]));
}

console.log('--- ColorSystem ---');
{
  for (let i = 0; i < M.ColorSystem.PALETTES.length; i++) {
    M.ColorSystem.setIndex(i);
    const rgb = M.ColorSystem.sample(0.5);
    check(`palette[${i}] sample valid`, Array.isArray(rgb) && rgb.length === 3 && rgb.every((v) => v >= 0 && v <= 255));
  }
  const g = M.ColorSystem.cssGradient();
  check('cssGradient is linear-gradient', g.startsWith('linear-gradient'));
  const g2 = M.ColorSystem.cssGradientFor(3);
  check('cssGradientFor valid', g2.startsWith('linear-gradient'));
}

console.log('--- Fractals (mode registry completeness) ---');
{
  check('14 modes', M.Fractals.ORDER.length === 14);
  const groups = new Set(M.Fractals.ORDER.map((id) => M.Fractals.get(id).group));
  check('4 groups', groups.size === 4);
  check('every mode has label', M.Fractals.ORDER.every((id) => !!M.Fractals.get(id).label));
  check('every gpu mode has a shader', M.Fractals.ORDER.filter((id) => M.Fractals.get(id).kind !== 'lsystem').every((id) => !!M.Fractals.get(id).shader));
  check('every lsystem mode has an lsystem def', M.Fractals.ORDER.filter((id) => M.Fractals.get(id).kind === 'lsystem').every((id) => !!M.Fractals.get(id).lsystem));
  check('every mode has a kind', M.Fractals.ORDER.every((id) => !!M.Fractals.get(id).kind));
  check('mandelbrot exists', !!M.Fractals.get('mandelbrot'));
  check('mandelbulb has power', M.Fractals.get('mandelbulb').power === 8);
  check('unknown mode returns undefined', M.Fractals.get('does-not-exist') === undefined);
}

console.log('--- LSystem ---');
{
  check('4 systems', Object.keys(M.LSystem.SYSTEMS).length === 4);
  for (const name of Object.keys(M.LSystem.SYSTEMS)) {
    const sys = M.LSystem.SYSTEMS[name];
    const s = M.LSystem.generate(sys, 3);
    check(`generate(${name}) non-empty string`, typeof s === 'string' && s.length > 0);
  }
}

console.log('--- State + Procedural (deterministic seeded generation) ---');
{
  const before = M.State.clone();
  const rng = M.Util.mulberry32(999);
  M.Procedural.randomize(rng);
  const after = M.State.clone();
  check('randomize changes state', JSON.stringify(before) !== JSON.stringify(after));
  check('state has mode', typeof after.mode === 'string');
  check('state has seed', typeof after.seed === 'number');
  // Same seed must produce the same randomized state (determinism).
  M.State.reset();
  M.Procedural.randomize(M.Util.mulberry32(999));
  const det1 = M.State.clone();
  M.State.reset();
  M.Procedural.randomize(M.Util.mulberry32(999));
  const det2 = M.State.clone();
  check('randomize is deterministic for a given seed', JSON.stringify(det1) === JSON.stringify(det2));
  const rng2 = M.Util.mulberry32(42);
  M.Procedural.mutate(rng2);
  const mutated = M.State.clone();
  check('mutate produces valid state', typeof mutated.mode === 'string' && typeof mutated.seed === 'number');
}

console.log('--- Share (encode/decode round-trip) ---');
{
  M.State.set({ mode: 'julia', seed: 424242, palette: 3, iterations: 128, bloom: 0.7, center: [0.1, -0.2], zoom: 250 });
  const code = M.Share.encode();
  check('code has FF- prefix', code.startsWith(M.Share.PREFIX));
  console.log('  (share code length: ' + code.length + ' chars)');
  check('code is compact (< 600 chars)', code.length < 600);
  M.State.reset();
  M.Share.apply(code);
  const s = M.State.get();
  check('round-trip mode', s.mode === 'julia');
  check('round-trip seed', s.seed === 424242);
  check('round-trip palette', s.palette === 3);
  check('round-trip iterations', s.iterations === 128);
  check('round-trip bloom', Math.abs(s.bloom - 0.7) < 1e-6);
  check('round-trip center', Math.abs(s.center[0] - 0.1) < 1e-6 && Math.abs(s.center[1] + 0.2) < 1e-6);
  check('round-trip zoom', Math.abs(s.zoom - 250) < 1e-6);
}

console.log('--- Share (invalid-code rejection) ---');
{
  throws('decode rejects non-string', () => M.Share.decode(123));
  throws('decode rejects empty', () => M.Share.decode(''));
  throws('decode rejects malformed base64', () => M.Share.decode('FF-!!!not-base64!!!'));
  throws('decode rejects non-object payload', () => M.Share.decode(M.Share.PREFIX + M.Util.b64urlEncode('["array"]')));
  throws('decode rejects unsupported version', () => M.Share.decode(M.Share.PREFIX + M.Util.b64urlEncode(JSON.stringify({ v: 999 }))));
  throws('apply rejects garbage', () => M.Share.apply('FF-@@@'));
}

console.log('--- Share (boundary validation and clamping) ---');
{
  const out = M.Share.sanitize({ zoom: 1e9, iterations: -5, power: 99, mode: 'nonexistent-mode', bloom: 5 });
  check('zoom clamped to max', out.zoom === 1e7);
  check('iterations clamped to min', out.iterations === 16);
  check('power clamped to max', out.power === 16);
  check('bloom clamped to max', out.bloom === 1);
  check('unknown mode dropped', out.mode === undefined);
  // Non-finite values are dropped, not coerced.
  const out2 = M.Share.sanitize({ zoom: NaN, seed: Infinity });
  check('NaN zoom dropped', out2.zoom === undefined);
  check('Infinity seed dropped', out2.seed === undefined);
  // Unknown keys are not copied (no prototype-pollution-style data).
  const out3 = M.Share.sanitize({ __proto__: { hacked: true }, zoom: 10 });
  check('unknown keys not copied', out3.hacked === undefined);

  // D5: the Iterations bounds the slider now exposes (min=16 max=4096) must be
  // preserved by sanitize, so a valid share code in the full range round-trips
  // to a slider value that matches the state (previously (16,32) and (2048,4096]
  // disagreed with the old slider min=32 max=2048).
  check('iterations 16 (min) survives', M.Share.sanitize({ iterations: 16 }).iterations === 16);
  check('iterations 31 (was below old slider min) survives', M.Share.sanitize({ iterations: 31 }).iterations === 31);
  check('iterations 3000 (was above old slider max) survives', M.Share.sanitize({ iterations: 3000 }).iterations === 3000);
  check('iterations 4096 (max) survives', M.Share.sanitize({ iterations: 4096 }).iterations === 4096);
  check('iterations 4097 clamps to 4096', M.Share.sanitize({ iterations: 4097 }).iterations === 4096);
  check('iterations 15 clamps to 16', M.Share.sanitize({ iterations: 15 }).iterations === 16);
}

console.log('--- A11y ---');
{
  M.A11y.set({ highContrast: true });
  check('A11y set/get', M.A11y.get().highContrast === true);
  M.A11y.reset();
  check('A11y reset', M.A11y.get().highContrast === false);
}

console.log('--- Gallery (localStorage + schema migration) ---');
{
  const result = M.Gallery.save('Test Art');
  const id = result && result.ok && result.item && result.item.id;
  check('save returns ok + item with id', !!id);
  check('list has 1', M.Gallery.list().length === 1);
  check('count is 1', M.Gallery.count() === 1);
  M.Gallery.toggleFavorite(id);
  check('favorite toggled', M.Gallery.get(id).favorite === true);
  check('restore applies state', M.Gallery.restore(id) === true);
  M.Gallery.remove(id);
  check('removed', M.Gallery.list().length === 0);

  // Schema migration: a legacy bare-array payload must still be readable.
  const legacy = [{ id: 'legacy-1', name: 'Old', createdAt: 1, favorite: false, thumb: '', state: { mode: 'mandelbrot', seed: 1 } }];
  localStorageMock.setItem('fractal-forge:gallery', JSON.stringify(legacy));
  check('legacy bare-array readable', M.Gallery.list().length === 1 && M.Gallery.get('legacy-1') !== null);
  // Corrupt JSON must not throw; it yields an empty list.
  localStorageMock.setItem('fractal-forge:gallery', '{not json');
  check('corrupt JSON yields empty list', M.Gallery.list().length === 0);
  localStorageMock.removeItem('fractal-forge:gallery');
}

console.log('--- Exporter (D4: export path honors live time) ---');
{
  // The export/thumbnail entry points must accept a time argument so callers
  // can supply the live frame time (default 0 keeps old callers working).
  check('renderToCanvas accepts a time param', M.Exporter.renderToCanvas.length >= 3);
  check('renderToDataURL accepts a time param', M.Exporter.renderToDataURL.length >= 3);
  check('download accepts a time param', M.Exporter.download.length >= 4);
  check('Gallery.save accepts a time param', M.Gallery.save.length >= 2);
  // App exposes the live time so the on-screen composition can be exported.
  check('App.getLiveTime is a function', typeof M.App.getLiveTime === 'function');
  check('App.getLiveTime returns a finite number (starts at 0)', Number.isFinite(M.App.getLiveTime()));
  // The old "always time 0" default must be gone from the export source.
  check('export path no longer forces time: s.time || 0', src.indexOf('time: s.time || 0') === -1);
}

console.log('--- Interaction (D10: action keys gated while a modal is open) ---');
{
  // Capture window keydown handlers so we can drive the keyboard gate directly.
  const keydowns = [];
  sandbox.window.addEventListener = (type, fn) => { if (type === 'keydown') keydowns.push(fn); };

  const actions = [];
  M.Interaction.register({ onAction: (a, d) => actions.push(a) });
  M.Interaction.init({ addEventListener() {} }); // mock canvas; only keydown matters

  const fire = (key) => keydowns.forEach((fn) => fn({ key, target: { tagName: 'BODY' }, preventDefault() {} }));

  check('isAnyModalOpen() false with no modal', M.UI.isAnyModalOpen() === false);

  // No modal open: action keys dispatch.
  actions.length = 0;
  fire('r');
  check('no modal: "r" (randomize) dispatches', actions.includes('randomize'));

  // Open a modal: action keys suppressed; arrows/zoom/space still work.
  M.UI.openModal('modal-settings');
  check('isAnyModalOpen() true with a modal', M.UI.isAnyModalOpen() === true);
  actions.length = 0;
  fire('r'); fire('e'); fire('s'); fire('g'); fire('1'); fire('9');
  check('modal open: action keys (r/e/s/g/1/9) suppressed', actions.length === 0);
  actions.length = 0;
  fire('ArrowLeft'); fire('+'); fire(' ');
  check('modal open: pan/zoom/space still dispatch',
    actions.includes('pan') && actions.includes('zoom') && actions.includes('pause'));

  // Close the modal: action keys dispatch again.
  M.UI.closeModal('modal-settings');
  check('isAnyModalOpen() false after close', M.UI.isAnyModalOpen() === false);
  actions.length = 0;
  fire('r');
  check('modal closed: "r" dispatches again', actions.includes('randomize'));
}

console.log(`\n${fail === 0 ? 'ALL FUNCTIONAL TESTS PASSED' : 'SOME TESTS FAILED'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
