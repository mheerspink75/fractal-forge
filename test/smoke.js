/* Smoke test: load the app module graph (entry src/main.js) in a mocked browser environment and verify
   every module IIFE executes and exposes its expected API.
   Run with: node test/smoke.js  (or: npm test) */
const vm = require('vm');
const { loadAppSource } = require('./load-app-source.js');

const src = loadAppSource('src/main.js');

// ---- Minimal browser mocks (enough for module *definition*, not rendering) ----
function makeEl(id) {
  return {
    id,
    style: {},
    dataset: {},
    children: [],
    hidden: false,
    value: '0',
    checked: false,
    textContent: '',
    innerHTML: '',
    appendChild(c) {
      this.children.push(c);
      return c;
    },
    removeChild(c) {
      this.children = this.children.filter((x) => x !== c);
    },
    remove() {},
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    getAttribute() {
      return null;
    },
    querySelector() {
      return makeEl('q');
    },
    querySelectorAll() {
      return [];
    },
    getContext() {
      return null;
    },
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() {
        return false;
      }
    }
  };
}
const elements = {};
const documentMock = {
  readyState: 'complete',
  getElementById(id) {
    return elements[id] || (elements[id] = makeEl(id));
  },
  querySelector() {
    return makeEl('q');
  },
  querySelectorAll() {
    return [];
  },
  createElement(tag) {
    return makeEl(tag);
  },
  addEventListener() {},
  body: makeEl('body'),
  documentElement: makeEl('html')
};
const storage = {};
const localStorageMock = {
  getItem(k) {
    return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null;
  },
  setItem(k, v) {
    storage[k] = String(v);
  },
  removeItem(k) {
    delete storage[k];
  }
};
const sandbox = {
  console,
  document: documentMock,
  window: {
    innerWidth: 1280,
    innerHeight: 800,
    addEventListener() {},
    removeEventListener() {},
    matchMedia() {
      return { matches: false };
    },
    requestAnimationFrame(cb) {
      return 0;
    },
    cancelAnimationFrame() {},
    devicePixelRatio: 1,
    location: { href: 'http://localhost/' }
  },
  localStorage: localStorageMock,
  navigator: { clipboard: null, userAgent: 'node' },
  requestAnimationFrame(cb) {
    return 0;
  },
  cancelAnimationFrame() {},
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  performance: { now: () => Date.now() },
  Date,
  Math,
  JSON,
  Object,
  Array,
  String,
  Number,
  Boolean,
  Float32Array,
  Uint8Array,
  Int32Array,
  Uint32Array,
  Promise,
  Symbol,
  Map,
  Set,
  RegExp,
  Error,
  TypeError,
  RangeError,
  parseInt,
  parseFloat,
  isNaN,
  isFinite,
  btoa(s) {
    return Buffer.from(s, 'binary').toString('base64');
  },
  atob(s) {
    return Buffer.from(s, 'base64').toString('binary');
  }
};
sandbox.window.localStorage = localStorageMock;
sandbox.window.document = documentMock;
sandbox.window.navigator = sandbox.navigator;
sandbox.window.requestAnimationFrame = sandbox.requestAnimationFrame;
sandbox.globalThis = sandbox;

// const/let top-level declarations don't attach to the sandbox, so append an
// explicit export of every module to globalThis for inspection.
const exportLine =
  '\n;globalThis.__modules = { Util, GL, Shaders, ColorSystem, Fractals, Engine, LSystem, Effects, Camera, Interaction, State, Procedural, Share, Exporter, Gallery, Audio, Ambient, A11y, UI, App };\n';
const ctx = vm.createContext(sandbox);
try {
  vm.runInContext(src + exportLine, ctx, { filename: 'src/main.js' });
} catch (e) {
  console.error('LOAD FAILED:', e && e.stack ? e.stack : e);
  process.exit(1);
}
const M = sandbox.__modules;
if (!M) {
  console.error('LOAD FAILED: modules not exported');
  process.exit(1);
}

// ---- Verify every module is defined and exposes its expected API ----
const expected = {
  Util: ['mulberry32', 'clamp', 'lerp', 'b64urlEncode', 'packNumbers', 'now'],
  GL: ['init', 'createProgram', 'createFBO', 'render', 'setUniform', 'resize', 'bindTexture'],
  Shaders: ['VERTEX', 'MANDELBROT', 'JULIA', 'MANDELBULB', 'COMPOSITE', 'FEEDBACK'],
  ColorSystem: ['PALETTES', 'current', 'setIndex', 'tick', 'sample', 'cssGradient'],
  Fractals: ['MODES', 'ORDER', 'get', 'list'],
  Engine: ['setMode', 'getMode', 'renderFractal', 'getPostProgram'],
  LSystem: ['SYSTEMS', 'generate', 'draw'],
  Effects: ['resize', 'render', 'clearTrails'],
  Camera: ['reset', 'pan', 'zoomAt', 'zoomCenter', 'setZoom'],
  Interaction: ['init', 'register', 'setEnabled'],
  State: ['defaults', 'set', 'get', 'reset', 'clone'],
  Procedural: ['randomize', 'mutate', 'blend'],
  Share: ['encode', 'decode', 'apply', 'PREFIX'],
  Exporter: ['renderToCanvas', 'renderToDataURL', 'download'],
  Gallery: ['save', 'list', 'get', 'remove', 'toggleFavorite', 'restore'],
  Audio: ['enable', 'disable', 'sample', 'isEnabled'],
  Ambient: ['init', 'resize', 'tick', 'setEnabled', 'setReducedMotion'],
  A11y: ['load', 'get', 'set', 'reset', 'defaults'],
  UI: ['toast', 'openModal', 'closeModal', 'renderGallery', 'syncSliders', 'init'],
  App: [
    'init',
    'setMode',
    'randomize',
    'newWorld',
    'share',
    'toggleAudio',
    'exportAt',
    'togglePause'
  ]
};

let failures = 0;
for (const [mod, fns] of Object.entries(expected)) {
  const m = M[mod];
  if (!m) {
    console.error(`MISSING MODULE: ${mod}`);
    failures++;
    continue;
  }
  for (const fn of fns) {
    if (typeof m[fn] === 'undefined') {
      console.error(`MISSING: ${mod}.${fn}`);
      failures++;
    }
  }
}

// Sanity: Fractals registry has 14 modes across 4 groups
const order = M.Fractals.ORDER;
const groups = new Set(order.map((id) => M.Fractals.get(id).group));
console.log(`Fractals: ${order.length} modes, groups=[${[...groups].join(', ')}]`);
console.log(`Palettes: ${M.ColorSystem.PALETTES.length}`);

if (failures === 0) {
  console.log('SMOKE TEST PASSED — all 20 modules defined with expected APIs');
} else {
  console.error(`SMOKE TEST FAILED — ${failures} problem(s)`);
  process.exit(1);
}
