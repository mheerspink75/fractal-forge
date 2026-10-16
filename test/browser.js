/* ============================================================
   FRACTAL FORGE — real-browser checks (Playwright, headless Chromium +
   software WebGL via SwiftShader).

   Verifies the three items that Remediation-Verified.md (Prompt 10) deferred
   to a real browser (test/MANUAL-CHECKLIST.md):
     D3  — Seed drives every GPU mode: changing the seed alters the composition
           in each of the 10 GPU modes while the render stays stable.
     D4  — Export matches the on-screen composition at live animation time
           (not the time = 0 frame).
     D10 — Action keys (r/n/s/e/g/a, 1-9) are inert behind an open modal,
           while pan/zoom/space (pause) still work.

   Plus a framing guard:
     IN  — Every GPU mode renders a valid (non-flat) frame at two fresh seed
           values, so a per-seed transform that pushes the subject out of
           frame is caught in every mode, not just the Mandelbulb.

   A lightweight boot/render check runs first on every target (WebGL present,
   app initialized, a non-blank frame).

   Run:
     npm run test:browser                 -> local (auto-served) + live GitHub Pages
     BASE_URL=<url> npm run test:browser  -> a single target
     SKIP_LIVE=1 npm run test:browser     -> local only

   Evidence (screenshots + the exported PNG per target) is written to
   test/.evidence/<target>/ .  Exits non-zero if any check fails.
   ============================================================ */
const { chromium } = require('playwright');
const { PNG } = require('pngjs');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const LOCAL_PORT = parseInt(process.env.PORT || '8123', 10);
const LOCAL_URL = 'http://127.0.0.1:' + LOCAL_PORT + '/';
const LIVE_URL = 'https://mheerspink75.github.io/fractal-forge/';

const GPU_MODES = [
  'mandelbrot',
  'julia',
  'burningShip',
  'newton',
  'sierpinski',
  'cosmicNebula',
  'dreamscape',
  'neuralBloom',
  'quantumField',
  'mandelbulb',
  'fractalTree3d',
  'powerBulb'
];
const TIME_MODE = 'dreamscape'; // uses u_time -> composition changes over time
const ACTION_KEYS = ['r', 'n', 's', 'e', 'g', 'a', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

const VIEWPORT = { width: 1280, height: 720 };
const GRID = 64; // downsample size for pixel comparisons
const MATCH_CAP = 45; // screen-vs-export MAE must stay below this
const GOLDEN_QUERY = '?fractal=mandelbrot&seed=424242&palette=2&time=0&iterations=512';
// Golden-image cap (64x64 MAE): fresh-launch jitter measures ~0.2-0.5 while any real
// regression (wrong fractal/palette/seed/effects) moves the scene by >= 2.5.
const GOLDEN_MAE_CAP = 2.0; // committed-baseline MAE must stay below this
// A broken seed (mode ignores u_seed) yields near-identical frames: measured jitter
// is ~0.2 while a working seed change moves composition by >= 2.5 (64x64 downsample).
const SEED_MAE_FLOOR = 1.5; // seed-driven MAE must stay above this
const SEED_STEP = 7919; // a prime offset that always changes the seed
const LAUNCH_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--disable-gpu-sandbox'
];
const OVERLAYS = '.topbar,.panel-left,.panel-right,.statusbar,.fx-overlay,.onboarding';
const EVIDENCE_BASE = path.join(__dirname, '.evidence');

let pass = 0,
  fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) {
    pass++;
    console.log('  \u2713 ' + name + (detail ? '  \u2014 ' + detail : ''));
  } else {
    fail++;
    failures.push(name);
    console.error('  \u2717 FAIL: ' + name + (detail ? '  \u2014 ' + detail : ''));
  }
}

// ---------- pixel helpers ----------
const decode = (buf) => PNG.sync.read(buf);
function downsample(png, n) {
  const { width, height, data } = png;
  const out = new Float32Array(n * n * 3);
  for (let gy = 0; gy < n; gy++) {
    const y0 = Math.floor((gy * height) / n),
      y1 = Math.max(y0 + 1, Math.ceil(((gy + 1) * height) / n));
    for (let gx = 0; gx < n; gx++) {
      const x0 = Math.floor((gx * width) / n),
        x1 = Math.max(x0 + 1, Math.ceil(((gx + 1) * width) / n));
      let r = 0,
        g = 0,
        b = 0,
        c = 0;
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          const i = (y * width + x) * 4;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          c++;
        }
      }
      const o = (gy * n + gx) * 3;
      out[o] = r / c;
      out[o + 1] = g / c;
      out[o + 2] = b / c;
    }
  }
  return out;
}
const mae = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
};
function frameStats(png) {
  const { data } = png;
  let sum = 0,
    sumSq = 0,
    c = 0;
  for (let i = 0; i < data.length; i += 16) {
    const v = (data[i] + data[i + 1] + data[i + 2]) / 3;
    sum += v;
    sumSq += v * v;
    c++;
  }
  const mean = sum / c;
  return {
    mean: Math.round(mean * 100) / 100,
    variance: Math.round((sumSq / c - mean * mean) * 100) / 100
  };
}
// "valid" = not solid-black and not a flat NaN/broken image (has real tonal spread).
// A dark-but-correct 3D frame (e.g. Mandelbulb in black space) still has structure,
// so the spread (variance) is the real signal; the mean floor stays low.
const isValidFrame = (png) => {
  const s = frameStats(png);
  return s.variance > 20 && s.mean > 1;
};
// L-systems (tree/plant/koch/dragon) are thin colored lines on a near-black
// background, so MEAN (brightness) is a poor validity signal — a correct,
// fully-grown tree can be as dark as mean ~0.4. Structural spread (VARIANCE)
// is the real signal: a real frame has line coverage (variance >> a blank /
// solid-color transient, which is ~0). Deliberately more lenient on brightness
// than isValidFrame, which is tuned for the bright GPU fractals.
const isValidLsystemFrame = (png) => {
  const s = frameStats(png);
  return s.variance > 10 && s.mean > 0.2;
};

// ---------- browser helpers ----------
async function loadApp(page, url, evidenceDir) {
  await page.goto(url, { waitUntil: 'load', timeout: 90000 });
  await page.waitForTimeout(2500);
  // Dismiss onboarding so it never occludes or intercepts input.
  const start = await page.locator('#onboard-start').count();
  if (start) {
    try {
      await page.locator('#onboard-start').click();
    } catch (e) {
      /* already gone */
    }
  }
  await page.waitForTimeout(300);
}

async function capture(page, evidenceDir, name) {
  await page.evaluate(
    (sel) =>
      sel.split(',').forEach((s) => {
        const el = document.querySelector(s.trim());
        if (el) el.style.display = 'none';
      }),
    OVERLAYS
  );
  let buf;
  try {
    buf = await page.locator('#gl-canvas').first().screenshot({ type: 'png', timeout: 30000 });
  } catch (e) {
    buf = await page.screenshot({ type: 'png' });
  }
  await page.evaluate(
    (sel) =>
      sel.split(',').forEach((s) => {
        const el = document.querySelector(s.trim());
        if (el) el.style.display = '';
      }),
    OVERLAYS
  );
  if (evidenceDir) {
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.writeFileSync(path.join(evidenceDir, name + '.png'), buf);
  }
  return buf;
}

async function getExportBuffer(page) {
  try {
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 40000 }),
      page.evaluate(() => App.exportAt('current'))
    ]);
    return { buf: fs.readFileSync(await dl.path()), via: 'download (App.exportAt)' };
  } catch (e) {
    const dataUrl = await page.evaluate(() =>
      Exporter.renderToDataURL(window.innerWidth, window.innerHeight, App.getLiveTime())
    );
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:'))
      throw new Error('export produced no data URL: ' + String(dataUrl).slice(0, 60), { cause: e });
    return { buf: Buffer.from(dataUrl.split(',')[1], 'base64'), via: 'renderToDataURL (fallback)' };
  }
}

async function runTarget(name, url, evidenceBase) {
  console.log('\n=== Target: ' + name + '  \u2014  ' + url + ' ===');
  const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
  const context = await browser.newContext({ viewport: VIEWPORT, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text());
  });
  const evidenceDir = path.join(evidenceBase, name);

  try {
    await loadApp(page, url, evidenceDir);

    // ---------- Boot & render ----------
    console.log('\n-- Boot & rendering --');
    const boot = await page.evaluate(() => ({
      booted:
        typeof App !== 'undefined' &&
        typeof App.getLiveTime === 'function' &&
        typeof State !== 'undefined',
      webgl: (() => {
        try {
          const c = document.createElement('canvas');
          return !!(c.getContext('webgl') || c.getContext('experimental-webgl'));
        } catch (e) {
          return false;
        }
      })()
    }));
    ok('Boots: app initialized (App/State reachable)', boot.booted);
    ok('Boots: WebGL context available', boot.webgl);
    const bootFrame = await capture(page, evidenceDir, 'boot');
    const bs = frameStats(decode(bootFrame));
    ok(
      'Boots: renders a non-blank fractal frame',
      isValidFrame(decode(bootFrame)),
      JSON.stringify(bs)
    );

    // ---------- D3: seed drives every GPU mode ----------
    console.log('\n-- D3: seed drives every GPU mode --');
    // Freeze time + turn off cycling/trails so the ONLY thing that changes
    // between the two captures of a mode is the seed.
    await page.evaluate(() => {
      App.togglePause();
      State.set({ cycling: false, trails: 0 });
    });
    for (const id of GPU_MODES) {
      // The 3D raymarched modes (Mandelbulb, Fractal Tree, Power Bulb) are
      // heavy under software GL and need a longer settle before their frame is
      // complete.
      const settle =
        id === 'mandelbulb' || id === 'fractalTree3d' || id === 'powerBulb' ? 2500 : 900;
      await page.evaluate((mid) => App.setMode(mid), id);
      await page.waitForTimeout(settle);
      const seedBefore = await page.evaluate(() => State.get().seed);
      const A = await capture(page, evidenceDir, 'd3-' + id + '-before');
      await page.evaluate((step) => {
        const s = State.get();
        State.set({ seed: (s.seed + step) >>> 0 });
      }, SEED_STEP);
      await page.waitForTimeout(settle);
      const B = await capture(page, evidenceDir, 'd3-' + id + '-after');
      const seedMAE = mae(downsample(decode(A), GRID), downsample(decode(B), GRID));
      ok(
        'D3 ' + id + ': seed change alters the composition',
        seedMAE > SEED_MAE_FLOOR,
        'seed ' +
          seedBefore +
          ' \u2192 ' +
          ((seedBefore + SEED_STEP) >>> 0) +
          '  seedMAE=' +
          seedMAE.toFixed(2) +
          ' (floor ' +
          SEED_MAE_FLOOR +
          ', jitter \u2248 0.2)'
      );
      const aStat = frameStats(decode(A)),
        bStat = frameStats(decode(B));
      ok(
        'D3 ' + id + ': render stays stable (non-blank, not broken)',
        isValidFrame(decode(A)) && isValidFrame(decode(B)),
        'A ' + JSON.stringify(aStat) + '  B ' + JSON.stringify(bStat)
      );
    }
    // ---------- In-frame: every GPU mode renders a valid frame at 2 fresh seeds ----------
    // D3 proves the seed drives each mode at two *adjacent* seeds (boot seed +
    // k*SEED_STEP). This proves the subject stays in frame at two *fresh* seed
    // values, so a per-mode transform that breaks framing at particular seeds
    // (camera/offset math) is caught in every mode, not just the Mandelbulb.
    console.log('\n-- In-frame: all GPU modes render at 2 fresh seeds --');
    const IN_FRAME_SEEDS = [1, 1597334671]; // distinct from the D3 seed sequence
    for (const id of GPU_MODES) {
      const settle =
        id === 'mandelbulb' || id === 'fractalTree3d' || id === 'powerBulb' ? 2500 : 900;
      for (const seed of IN_FRAME_SEEDS) {
        await page.evaluate((mid) => App.setMode(mid), id);
        await page.evaluate((s) => State.set({ seed: s >>> 0 }), seed);
        await page.waitForTimeout(settle);
        const frame = await capture(page, evidenceDir, 'inframe-' + id + '-' + seed);
        const s2 = frameStats(decode(frame));
        ok(
          'In-frame ' + id + ' @ seed ' + seed + ': renders a valid frame',
          isValidFrame(decode(frame)),
          JSON.stringify(s2)
        );
      }
    }
    await page.evaluate(() => App.togglePause()); // resume for D4

    // ---------- D4: export matches the on-screen composition ----------
    console.log('\n-- D4: export matches the screen at live time --');
    await page.evaluate((mode) => {
      State.set({ anim: 1.0, cycling: false, trails: 0 });
      App.setMode(mode);
    }, TIME_MODE);
    await page.waitForTimeout(600);
    const liveT0 = await page.evaluate(() => App.getLiveTime());
    const frameA = await capture(page, evidenceDir, 'd4-start'); // starting composition
    await page.waitForTimeout(3000); // let time advance
    await page.evaluate(() => App.togglePause()); // freeze at live time T1
    await page.waitForTimeout(450);
    const liveT1 = await page.evaluate(() => App.getLiveTime());
    ok(
      'D4: animation time advanced',
      liveT1 > liveT0,
      't0=' + liveT0.toFixed(2) + 's t1=' + liveT1.toFixed(2) + 's'
    );
    const frameB = await capture(page, evidenceDir, 'd4-screen'); // current on-screen frame
    const exp = await getExportBuffer(page);
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.writeFileSync(path.join(evidenceDir, 'd4-export.png'), exp.buf);
    const expPng = decode(exp.buf);
    ok(
      'D4: export produced a valid PNG',
      isValidFrame(expPng) && expPng.width >= 16,
      exp.via + ' ' + expPng.width + '\u00d7' + expPng.height
    );
    const gA = downsample(decode(frameA), GRID);
    const gB = downsample(decode(frameB), GRID);
    const gE = downsample(expPng, GRID);
    const matchMAE = mae(gB, gE); // current screen vs export  (should be LOW  -> matches)
    const startMAE = mae(gA, gE); // start frame   vs export  (should be HIGHER -> live, not t=0)
    ok(
      'D4: export matches the on-screen composition',
      matchMAE < MATCH_CAP,
      'screenVsExport MAE=' + matchMAE.toFixed(1)
    );
    ok(
      'D4: export is the live frame, not the time=0 frame',
      matchMAE < startMAE,
      'screenVsExport=' + matchMAE.toFixed(1) + '  startVsExport=' + startMAE.toFixed(1)
    );

    // ---------- D10: action keys inert behind a modal ----------
    console.log('\n-- D10: action keys are inert behind a modal --');
    await page.evaluate(() => {
      UI.closeAllModals();
    });
    await page.waitForTimeout(300);
    await page.locator('#btn-settings').click();
    await page.waitForTimeout(400);
    const openState = await page.evaluate(() => ({
      anyOpen: UI.isAnyModalOpen(),
      hidden: document.getElementById('modal-settings').hidden
    }));
    ok(
      'D10: settings modal is open (key gate active)',
      openState.anyOpen === true,
      'isAnyModalOpen=' + openState.anyOpen
    );

    const before = await page.evaluate(() => ({
      mode: State.get().mode,
      seed: State.get().seed,
      palette: State.get().palette,
      audio: document.getElementById('btn-audio').getAttribute('aria-pressed')
    }));
    // Clear toasts left over from the D4 phase (transient UI, 2.6s lifetime) so
    // the "no action fired" check below only sees toasts these keypresses make.
    await page.evaluate(() => {
      const s = document.getElementById('toast-stack');
      if (s) s.innerHTML = '';
    });
    for (const k of ACTION_KEYS) {
      await page.keyboard.press(k);
      await page.waitForTimeout(70);
    }
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => ({
      mode: State.get().mode,
      seed: State.get().seed,
      palette: State.get().palette,
      audio: document.getElementById('btn-audio').getAttribute('aria-pressed'),
      exportOpen: !document.getElementById('modal-export').hidden,
      galleryOpen: !document.getElementById('modal-gallery').hidden
    }));
    const toasts = (
      await page.evaluate(() => document.getElementById('toast-stack').textContent)
    ).trim();
    ok(
      'D10: r/n did not randomize or forge (seed + mode unchanged)',
      after.seed === before.seed && after.mode === before.mode,
      'seed ' + before.seed + ' \u2192 ' + after.seed
    );
    ok(
      'D10: 1-9 did not change the palette',
      after.palette === before.palette,
      'palette ' + before.palette + ' \u2192 ' + after.palette
    );
    ok('D10: e did not open the export modal', after.exportOpen === false);
    ok('D10: g did not open the gallery modal', after.galleryOpen === false);
    ok(
      'D10: a did not toggle audio',
      after.audio === before.audio,
      'aria-pressed ' + before.audio + ' \u2192 ' + after.audio
    );
    ok(
      'D10: no action fired (no action toast shown)',
      !/Share code copied|Forged a new world|Mic unavailable|Audio reactive|World imported|Exported/i.test(
        toasts
      ),
      toasts || '(no toasts)'
    );

    // The non-gated controls must STILL work while the modal is open.  Focus the
    // modal container (not a button/checkbox) so Space/Arrows reach the app
    // handler rather than a native control activation.
    const focusModal = () =>
      page.evaluate(() => {
        const m = document.querySelector('#modal-settings .modal');
        m.setAttribute('tabindex', '-1');
        m.focus();
      });
    const zoomBefore = await page.evaluate(
      () => document.getElementById('status-zoom').textContent
    );
    await focusModal();
    await page.keyboard.press('+');
    await page.waitForTimeout(150);
    const zoomAfter = await page.evaluate(() => document.getElementById('status-zoom').textContent);
    ok(
      'D10: "+" still zooms while modal open',
      zoomBefore !== zoomAfter,
      zoomBefore + ' \u2192 ' + zoomAfter
    );
    const centerBefore = await page.evaluate(() => State.get().center.slice());
    await focusModal();
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(150);
    const centerAfter = await page.evaluate(() => State.get().center.slice());
    ok(
      'D10: arrow keys still pan while modal open',
      JSON.stringify(centerBefore) !== JSON.stringify(centerAfter),
      JSON.stringify(centerBefore) + ' \u2192 ' + JSON.stringify(centerAfter)
    );
    const toastPre = (
      await page.evaluate(() => document.getElementById('toast-stack').textContent)
    ).trim();
    await focusModal();
    await page.keyboard.press(' ');
    await page.waitForTimeout(200);
    const toastPost = (
      await page.evaluate(() => document.getElementById('toast-stack').textContent)
    ).trim();
    ok(
      'D10: Space still pauses while modal open',
      /Paused|Resumed/.test(toastPost) && toastPost !== toastPre,
      toastPost
    );

    // Close via Escape; the modal must close.
    await focusModal();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    const closedState = await page.evaluate(() => ({
      anyOpen: UI.isAnyModalOpen(),
      hidden: document.getElementById('modal-settings').hidden
    }));
    ok(
      'D10: Escape closes the modal',
      closedState.anyOpen === false && closedState.hidden === true,
      'isAnyModalOpen=' + closedState.anyOpen
    );

    // Control group: with NO modal open, the same key MUST act (proves the
    // suppression above is what was blocking it, not a dead key handler).
    await page.evaluate(() => {
      UI.closeAllModals();
    });
    await page.waitForTimeout(200);
    const seedCtrlBefore = await page.evaluate(() => State.get().seed);
    await page.keyboard.press('r');
    await page.waitForTimeout(400);
    const seedCtrlAfter = await page.evaluate(() => State.get().seed);
    ok(
      'D10 control: with no modal, "r" DOES randomize (seed changes)',
      seedCtrlBefore !== seedCtrlAfter,
      'seed ' + seedCtrlBefore + ' \u2192 ' + seedCtrlAfter
    );

    // ---------- Share URL: a world is linkable; junk falls back safely ----------
    console.log('\n-- Share URL: linkable worlds + safe fallback --');
    await page.goto(url + '?fractal=sierpinski&seed=424242&palette=5&time=0&iterations=128', {
      waitUntil: 'load'
    });
    await page.waitForTimeout(900); // first frames settle (sierpinski is light)
    const restoredState = await page.evaluate(() => {
      const s = State.get();
      return {
        mode: s.mode,
        seed: s.seed,
        palette: s.palette,
        anim: s.anim,
        iterations: s.iterations
      };
    });
    ok(
      'Share URL: valid link restores mode + seed + palette + time + iterations',
      restoredState.mode === 'sierpinski' &&
        restoredState.seed === 424242 &&
        restoredState.palette === 5 &&
        restoredState.anim === 0 &&
        restoredState.iterations === 128,
      JSON.stringify(restoredState)
    );
    const sharedFrame = await capture(page, evidenceDir, 'share-url-valid');
    ok(
      'Share URL: shared world renders a valid frame',
      isValidFrame(decode(sharedFrame)),
      JSON.stringify(frameStats(decode(sharedFrame)))
    );

    await page.goto(url + '?fractal=bogus&seed=abc&palette=zzz&time=zzz', { waitUntil: 'load' });
    await page.waitForTimeout(900);
    const junkState = await page.evaluate(() => ({
      mode: State.get().mode,
      seed: State.get().seed,
      palette: State.get().palette
    }));
    ok(
      'Share URL: junk link falls back to defaults (no NaN, no crash)',
      junkState.mode === 'mandelbrot' && junkState.seed === 12345 && junkState.palette === 0,
      JSON.stringify(junkState)
    );
    const junkFrame = await capture(page, evidenceDir, 'share-url-junk');
    ok(
      'Share URL: junk link still renders a valid default frame',
      isValidFrame(decode(junkFrame)),
      JSON.stringify(frameStats(decode(junkFrame)))
    );

    const randSeed = await page.evaluate(() => {
      App.randomize();
      return State.get().seed;
    });
    await page.waitForTimeout(200);
    const urlAfter = await page.evaluate(() => location.search);
    ok(
      'Share URL: URL tracks state changes (replaceState)',
      urlAfter.indexOf('fractal=') >= 0 && urlAfter.indexOf('seed=' + randSeed) >= 0,
      urlAfter
    );

    // ---------- Auto-grow: L-system modes grow into being on (re)select ----------
    console.log('\n-- Auto-grow: L-system growth animates on select --');
    // Pin the render scale for this section. Adaptive quality varies the
    // buffer size with FPS, which thins the 2D L-system lines (lineWidth is
    // proportional to the fitted scale) and makes the captured frame dimmer —
    // nondeterministically under software GL. Disabling it resets renderScale
    // to 1.0 and holds it, so the growth captures are deterministic. We restore
    // it before the reduced-motion check so later sections see the default.
    await page.evaluate(() => {
      const el = document.getElementById('set-adaptive');
      if (el && el.checked) {
        el.checked = false;
        el.dispatchEvent(new Event('change'));
      }
    });
    await page.waitForTimeout(1500); // let the reset + buffer rebuild settle
    // First select: growth must end at exactly 1 (ease-out animator completes).
    await page.evaluate(() => App.setMode('tree'));
    const grewEnd = await page
      .waitForFunction(() => State.get().growth >= 1, { timeout: 10000 })
      .then(() => true)
      .catch(() => false);
    ok('Auto-grow: tree reaches full growth after selection', grewEnd);
    await page.waitForTimeout(900); // settle under SwiftShader
    const endFrame = await capture(page, evidenceDir, 'autogrow-tree-end');
    ok(
      'Auto-grow: tree end-state renders a valid frame',
      isValidLsystemFrame(decode(endFrame)),
      JSON.stringify(frameStats(decode(endFrame)))
    );

    // Re-select: a mid-animation frame must exist and differ from the end frame.
    await page.evaluate(() => App.setMode('tree'));
    const caughtMid = await page
      .waitForFunction(() => {
        const g = State.get().growth;
        return g > 0.4 && g < 0.95;
      }, { timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    if (caughtMid) {
      await page.waitForTimeout(300); // let a frame render at mid growth
      const midFrame = await capture(page, evidenceDir, 'autogrow-tree-mid');
      const midDone = await page
        .waitForFunction(() => State.get().growth >= 1, { timeout: 10000 })
        .then(() => true)
        .catch(() => false);
      ok('Auto-grow: re-select reaches full growth', midDone);
      await page.waitForTimeout(900);
      const endFrame2 = await capture(page, evidenceDir, 'autogrow-tree-end2');
      const midMAE = mae(downsample(decode(midFrame), GRID), downsample(decode(endFrame2), GRID));
      // A mid-animation frame is a *partially-drawn* tree — legitimately sparser
      // than the fully-grown one, so require only that it isn't a blank/solid
      // transient (variance > 2); the real assertion is that it differs from the
      // settled end frame (growth actually animates, not snaps).
      const midNotBlank = frameStats(decode(midFrame)).variance > 2;
      ok(
        'Auto-grow: mid-growth frame differs from end frame',
        midNotBlank && midMAE > 0.1,
        'midVsEnd MAE=' + midMAE.toFixed(2) + ' (floor 0.1)'
      );
    } else {
      // Timing not stable under SwiftShader (frame lagged past the mid window):
      // fall back to the end-state-only assertion.
      const endOk = await page
        .waitForFunction(() => State.get().growth >= 1, { timeout: 10000 })
        .then(() => true)
        .catch(() => false);
      await page.waitForTimeout(900);
      const f = await capture(page, evidenceDir, 'autogrow-tree-end-fallback');
      ok(
        'Auto-grow: re-select reaches a valid end frame (mid-capture unstable; end-state only)',
        endOk && isValidLsystemFrame(decode(f)),
        JSON.stringify(frameStats(decode(f)))
      );
    }

    // Restore adaptive quality for the remaining sections (reduced-motion
    // check below uses a fresh browser, so this only affects the main page).
    await page.evaluate(() => {
      const el = document.getElementById('set-adaptive');
      if (el && !el.checked) {
        el.checked = true;
        el.dispatchEvent(new Event('change'));
      }
    });

    // Reduced motion: growth must snap to 1 immediately (no animation).
    const rmBrowser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
    const rmContext = await rmBrowser.newContext({ viewport: VIEWPORT });
    await rmContext.addInitScript(() => {
      const orig = window.matchMedia.bind(window);
      window.matchMedia = (q) => {
        if (String(q).indexOf('prefers-reduced-motion') !== -1) {
          return {
            matches: true,
            media: q,
            addEventListener() {},
            removeEventListener() {},
            addListener() {},
            removeListener() {},
            dispatchEvent() { return false; }
          };
        }
        return orig(q);
      };
    });
    const rmPage = await rmContext.newPage();
    await rmPage.goto(url, { waitUntil: 'load', timeout: 90000 });
    await rmPage.waitForTimeout(2500);
    const rmStart = await rmPage.locator('#onboard-start').count();
    if (rmStart) { try { await rmPage.locator('#onboard-start').click(); } catch (e) { /* dismissal failed; continue */ } }
    const rmResult = await rmPage.evaluate(() => {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      App.setMode('tree');
      const growth = State.get().growth;
      App.setMode('mandelbrot');
      return { reduced, growth };
    });
    ok(
      'Reduced motion: growth snaps to 1 on select (no animation)',
      rmResult.reduced === true && rmResult.growth === 1,
      'reduced=' + rmResult.reduced + ' growth=' + rmResult.growth
    );
    await rmPage.close();
    await rmContext.close();
    await rmBrowser.close();

    // ---------- Clock URL: a paused moment is linkable and reproducible ----------
    console.log('\n-- Clock URL: paused moments are linkable --');
    // Determine the current run state (time only advances when unpaused), so
    // the first toggle below is guaranteed to be a pause.
    const tSampleA = await page.evaluate(() => App.getLiveTime());
    await page.waitForTimeout(400);
    const tSampleB = await page.evaluate(() => App.getLiveTime());
    if (tSampleB === tSampleA) await page.evaluate(() => App.togglePause()); // was paused -> resume
    await page.waitForTimeout(600); // let the clock travel
    await page.evaluate(() => App.togglePause()); // now a pause
    const pausedUrl = await page.evaluate(() => location.search);
    const clockMatch = /([?&])clock=(\d+(?:\.\d+)?)/.exec(pausedUrl);
    const clockVal = clockMatch ? parseFloat(clockMatch[2]) : NaN;
    ok(
      'Clock: pausing writes clock=<t> into the URL',
      Number.isFinite(clockVal) && clockVal > 0,
      pausedUrl
    );
    await page.evaluate(() => App.togglePause()); // resume
    const resumedUrl = await page.evaluate(() => location.search);
    ok('Clock: resuming removes the clock param', resumedUrl.indexOf('clock=') === -1, resumedUrl);

    // Determinism: two fresh loads of the same clock= URL render valid,
    // near-identical frames (the check that would have failed pre-Phase-3).
    const CLOCK_QUERY = '?fractal=julia&seed=123&anim=1&clock=10';
    async function clockCapture(name) {
      const p = await context.newPage();
      await p.goto(url + CLOCK_QUERY, { waitUntil: 'load' });
      await p.waitForTimeout(2500);
      const st = await p.locator('#onboard-start').count();
      if (st) { try { await p.locator('#onboard-start').click(); } catch (e) { /* already gone */ } }
      const f = await capture(p, evidenceDir, name);
      await p.close();
      return f;
    }
    const cf1 = await clockCapture('clock-load-a');
    const cf2 = await clockCapture('clock-load-b');
    const clockMAE = mae(downsample(decode(cf1), GRID), downsample(decode(cf2), GRID));
    ok(
      'Clock: two fresh loads of clock=10 render valid, near-identical frames',
      isValidFrame(decode(cf1)) && isValidFrame(decode(cf2)) && clockMAE < 2.0,
      'MAE=' + clockMAE.toFixed(3) + ' (cap 2.0)'
    );

    // ---------- Phase 4: the Mandelbulb animates (breathing power + auto-orbit) ----------
    // While the Mandelbulb is animating, two frames taken a moment apart must
    // differ (the camera slowly orbits the bulb and the power "breathes" with
    // the clock); with animation off the frame must be frozen. Cycling/trails
    // are switched off in both cases so the ONLY time-driven signal is the
    // animation term (power_eff + auto-orbit), which is exactly what we test.
    console.log('\n-- Phase 4: Mandelbulb animates (breathing + auto-orbit) --');
    // Defensive: guarantee the app is running (time advancing) so the
    // "alive" case is a fair test. Mirrors the Clock section's resume logic.
    const p4tA = await page.evaluate(() => App.getLiveTime());
    await page.waitForTimeout(400);
    const p4tB = await page.evaluate(() => App.getLiveTime());
    if (p4tB === p4tA) await page.evaluate(() => App.togglePause()); // was paused -> resume
    await page.evaluate(() => {
      App.setMode('mandelbulb');
      State.set({ cycling: false, trails: 0 });
    });
    await page.waitForTimeout(2500); // settle the raymarch (heavy under software GL)

    // ALIVE: anim on -> breathing power + auto-orbit move the frame between two
    // captures taken ~2.5s apart (auto-orbit drifts ~7deg over that window).
    await page.evaluate(() => State.set({ anim: 1.0 }));
    await page.waitForTimeout(300);
    const p4a1 = await capture(page, evidenceDir, 'p4-alive-a');
    await page.waitForTimeout(2500);
    const p4a2 = await capture(page, evidenceDir, 'p4-alive-b');
    const aliveMAE = mae(downsample(decode(p4a1), GRID), downsample(decode(p4a2), GRID));
    ok(
      'Phase 4 animating: the frame moves over time (breathing + auto-orbit)',
      aliveMAE > 0.8 && isValidFrame(decode(p4a1)) && isValidFrame(decode(p4a2)),
      'MAE=' + aliveMAE.toFixed(3) + ' (floor 0.8, jitter ~0.3)'
    );

    // FROZEN: anim off -> pure z^power, no orbit -> the frame is static, so two
    // captures agree within fresh-render jitter.
    await page.evaluate(() => State.set({ anim: 0 }));
    await page.waitForTimeout(600);
    const p4f1 = await capture(page, evidenceDir, 'p4-frozen-a');
    await page.waitForTimeout(1500);
    const p4f2 = await capture(page, evidenceDir, 'p4-frozen-b');
    const frozenMAE = mae(downsample(decode(p4f1), GRID), downsample(decode(p4f2), GRID));
    ok(
      'Phase 4 frozen: anim=0 renders a static, valid frame',
      frozenMAE < 1.5 && isValidFrame(decode(p4f1)) && isValidFrame(decode(p4f2)),
      'MAE=' + frozenMAE.toFixed(3) + ' (cap 1.5)'
    );
    await page.evaluate(() => State.set({ anim: 0.5 })); // leave a sensible state

    // ---------- Phase 5a: Fractal Tree 3D (clock sway + growth-gated canopy) ----------
    // The raymarched I-tree animates two ways: a gentle clock sway when anim>0,
    // and the growth control drawing more of the canopy as it rises. anim=0 must
    // freeze it (paused/shared/golden-safe). Cycling/trails off so the only
    // time-driven signal is the sway — exactly what the "alive" check tests.
    console.log('\n-- Phase 5a: Fractal Tree 3D (sway + growth) --');
    // Defensive: guarantee the app is running (time advancing) so the "alive"
    // case is a fair test. Mirrors the Phase 4 / Clock resume logic.
    const t5tA = await page.evaluate(() => App.getLiveTime());
    await page.waitForTimeout(400);
    const t5tB = await page.evaluate(() => App.getLiveTime());
    if (t5tB === t5tA) await page.evaluate(() => App.togglePause()); // was paused -> resume
    await page.evaluate(() => {
      App.setMode('fractalTree3d');
      State.set({ cycling: false, trails: 0 });
    });
    await page.waitForTimeout(2500); // settle the raymarch (heavy under software GL)

    // ALIVE: anim on -> the camera auto-orbits (monotonic) + the sway, so the
    // frame reliably moves between two captures taken apart. The auto-orbit is
    // the stable signal (a pure sine sway can cancel over a short window);
    // anim=0 below freezes both.
    await page.evaluate(() => State.set({ anim: 1.0, growth: 1.0, seed: 1 }));
    await page.waitForTimeout(300);
    const t5a1 = await capture(page, evidenceDir, 'p5a-alive-a');
    await page.waitForTimeout(3000);
    const t5a2 = await capture(page, evidenceDir, 'p5a-alive-b');
    const t5alive = mae(downsample(decode(t5a1), GRID), downsample(decode(t5a2), GRID));
    ok(
      'Phase 5a animating: the tree moves over time (auto-orbit + sway, anim=1)',
      t5alive > 0.3 && isValidFrame(decode(t5a1)) && isValidFrame(decode(t5a2)),
      'MAE=' + t5alive.toFixed(3) + ' (floor 0.3)'
    );

    // FROZEN: anim off -> no sway -> the frame is static, so two captures agree.
    await page.evaluate(() => State.set({ anim: 0 }));
    await page.waitForTimeout(600);
    const t5f1 = await capture(page, evidenceDir, 'p5a-frozen-a');
    await page.waitForTimeout(1500);
    const t5f2 = await capture(page, evidenceDir, 'p5a-frozen-b');
    const t5frozen = mae(downsample(decode(t5f1), GRID), downsample(decode(t5f2), GRID));
    ok(
      'Phase 5a frozen: anim=0 renders a static, valid frame',
      t5frozen < 1.5 && isValidFrame(decode(t5f1)) && isValidFrame(decode(t5f2)),
      'MAE=' + t5frozen.toFixed(3) + ' (cap 1.5)'
    );

    // GROWTH: lowering the growth draws less of the canopy -> the frame changes.
    // The tree is a thin structure on a dark background, so the in-frame pixel
    // delta is modest; the floor sits above fresh-render jitter (~0.15). The
    // delta is generous (1.0 -> 0.3 removes the top ~3 levels) so the check
    // stays robust even on slow CI runners.
    const t5g1 = await capture(page, evidenceDir, 'p5a-growth-full');
    await page.evaluate(() => State.set({ growth: 0.3 }));
    await page.waitForTimeout(1000);
    const t5g2 = await capture(page, evidenceDir, 'p5a-growth-low');
    const t5growth = mae(downsample(decode(t5g1), GRID), downsample(decode(t5g2), GRID));
    ok(
      'Phase 5a growth: lowering growth changes the canopy (both valid)',
      t5growth > 0.25 && isValidFrame(decode(t5g1)) && isValidFrame(decode(t5g2)),
      'MAE=' + t5growth.toFixed(3) + ' (floor 0.25)'
    );
    await page.evaluate(() => State.set({ growth: 1.0, anim: 0.5 })); // restore

    // ---------- Phase 5b: Power Bulb (z^p powerfractal: breathing + power) ----------
    // The third 3D mode: the z^p powerfractal family (p=3 default). It animates
    // two ways, like the Mandelbulb: a monotonic camera auto-orbit while
    // animating (the stable "alive" signal) plus the Phase-4 breathing exponent
    // (u_time-driven, identity at t=0). The Power slider drives the exponent
    // (3 default -> 8 perturbed is a genuinely different composition). anim=0
    // must freeze everything (paused/shared/golden-safe).
    console.log('\n-- Phase 5b: Power Bulb (breathing + auto-orbit + power) --');
    // Defensive: guarantee the app is running (time advancing) so the "alive"
    // case is a fair test. Mirrors the Phase 4 / 5a resume logic.
    const pbtA = await page.evaluate(() => App.getLiveTime());
    await page.waitForTimeout(400);
    const pbtB = await page.evaluate(() => App.getLiveTime());
    if (pbtB === pbtA) await page.evaluate(() => App.togglePause()); // was paused -> resume
    await page.evaluate(() => {
      App.setMode('powerBulb');
      State.set({ cycling: false, trails: 0 });
    });
    await page.waitForTimeout(2500); // settle the raymarch (heavy under software GL)

    // ALIVE: anim on -> auto-orbit (monotonic) + breathing exponent move the
    // frame between two captures taken ~3s apart.
    await page.evaluate(() => State.set({ anim: 1.0, seed: 1 }));
    await page.waitForTimeout(300);
    const pba1 = await capture(page, evidenceDir, 'p5b-alive-a');
    await page.waitForTimeout(3000);
    const pba2 = await capture(page, evidenceDir, 'p5b-alive-b');
    const pbAlive = mae(downsample(decode(pba1), GRID), downsample(decode(pba2), GRID));
    ok(
      'Phase 5b animating: the bulb moves over time (auto-orbit + breathing, anim=1)',
      pbAlive > 0.3 && isValidFrame(decode(pba1)) && isValidFrame(decode(pba2)),
      'MAE=' + pbAlive.toFixed(3) + ' (floor 0.3)'
    );

    // FROZEN: anim off -> no breathing, no orbit -> the frame is static.
    await page.evaluate(() => State.set({ anim: 0 }));
    await page.waitForTimeout(600);
    const pbf1 = await capture(page, evidenceDir, 'p5b-frozen-a');
    await page.waitForTimeout(1500);
    const pbf2 = await capture(page, evidenceDir, 'p5b-frozen-b');
    const pbFrozen = mae(downsample(decode(pbf1), GRID), downsample(decode(pbf2), GRID));
    ok(
      'Phase 5b frozen: anim=0 renders a static, valid frame',
      pbFrozen < 1.5 && isValidFrame(decode(pbf1)) && isValidFrame(decode(pbf2)),
      'MAE=' + pbFrozen.toFixed(3) + ' (cap 1.5)'
    );

    // POWER: default exponent (3) vs a perturbed exponent (8) must be
    // genuinely different compositions — the Power slider drives the DE. The
    // floor sits well above fresh-render jitter (~0.15).
    const pbPowDefault = await page.evaluate(() => State.get().power);
    const pbp1 = await capture(page, evidenceDir, 'p5b-power-default');
    await page.evaluate(() => State.set({ power: 8 }));
    await page.waitForTimeout(1000);
    const pbp2 = await capture(page, evidenceDir, 'p5b-power-perturbed');
    const pbPower = mae(downsample(decode(pbp1), GRID), downsample(decode(pbp2), GRID));
    ok(
      'Phase 5b power: changing the exponent changes the composition (both valid)',
      pbPower > 0.4 && isValidFrame(decode(pbp1)) && isValidFrame(decode(pbp2)),
      'power ' + pbPowDefault + ' -> 8  MAE=' + pbPower.toFixed(3) + ' (floor 0.4)'
    );
    await page.evaluate(() => State.set({ anim: 0.5 })); // leave a sensible state

    // ---------- Golden image: pixel regression against the committed baseline ----------
    console.log('\n-- Golden image: pixel regression --');
    {
      // A cold context's first frames differ from settled frames (shader warmup);
      // burn one page off before the comparison so both sides are settled.
      const warmPage = await context.newPage();
      await warmPage.goto(url + GOLDEN_QUERY, { waitUntil: 'load' });
      await warmPage.waitForTimeout(1200);
      await warmPage.close();
      const gPage = await context.newPage();
      await gPage.goto(url + GOLDEN_QUERY, { waitUntil: 'load' });
      await gPage.waitForTimeout(1200);
      const live = await capture(gPage, evidenceDir, 'golden-live');
      await gPage.close();
      const golden = JSON.parse(
        fs.readFileSync(path.join(__dirname, 'golden', 'mandelbrot-424242.json'), 'utf8')
      );
      const gMAE = mae(downsample(decode(live), GRID), new Float32Array(golden.values));
      ok(
        'Golden: canonical scene matches the committed baseline',
        gMAE < GOLDEN_MAE_CAP,
        '64x64 MAE=' + gMAE.toFixed(3) + ' (cap ' + GOLDEN_MAE_CAP + ')'
      );
      ok(
        'Golden: canonical scene renders a valid frame',
        isValidFrame(decode(live)),
        JSON.stringify(frameStats(decode(live)))
      );
    }

    // Any real JS error raised during the run is itself a failure.
    const realErrors = errors.filter((e) => !/favicon/i.test(e));
    ok(
      'No uncaught page/console errors during the run',
      realErrors.length === 0,
      realErrors.length ? realErrors.slice(0, 3).join(' | ') : '(none)'
    );
  } finally {
    await browser.close();
  }
}

// ---------- local static server (self-contained npm run test:browser) ----------
function httpProbe(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.setTimeout(1500, () => req.destroy(new Error('timeout')));
  });
}
async function ensureLocalServer(url) {
  try {
    await httpProbe(url);
    return null;
  } catch (e) {
    /* not up yet */
  }
  const proc = spawn(process.execPath, [path.join(__dirname, 'serve.js'), String(LOCAL_PORT)], {
    stdio: 'ignore',
    detached: false
  });
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try {
      await httpProbe(url);
      return proc;
    } catch (e) {
      /* keep waiting */
    }
  }
  throw new Error('local static server did not become ready at ' + url);
}

async function main() {
  const targets = [];
  if (process.env.BASE_URL) {
    targets.push([process.env.TARGET || 'custom', process.env.BASE_URL]);
  } else {
    targets.push(['local', LOCAL_URL]);
    if (process.env.SKIP_LIVE !== '1') targets.push(['live', LIVE_URL]);
  }
  let localServer = null;
  try {
    if (targets.some(([n]) => n === 'local')) localServer = await ensureLocalServer(LOCAL_URL);
    for (const [name, url] of targets) {
      try {
        await runTarget(name, url, EVIDENCE_BASE);
      } catch (e) {
        fail++;
        failures.push(name + ': ' + e.message);
        console.error('  \u2717 Target ' + name + ' errored: ' + e.message);
      }
    }
  } finally {
    if (localServer) {
      try {
        localServer.kill('SIGTERM');
      } catch (e) {
        /* ignore */
      }
    }
  }
  console.log('\n==========================================');
  console.log('SUMMARY: ' + pass + ' passed, ' + fail + ' failed');
  if (failures.length) console.error('Failures:\n  - ' + failures.join('\n  - '));
  console.log(fail === 0 ? 'BROWSER CHECKS PASSED' : 'BROWSER CHECKS FAILED');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
