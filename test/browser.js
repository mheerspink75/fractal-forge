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
const crypto = require('crypto');
const http = require('http');
const { spawn } = require('child_process');

const LOCAL_PORT = parseInt(process.env.PORT || '8123', 10);
const LOCAL_URL = 'http://127.0.0.1:' + LOCAL_PORT + '/';
const LIVE_URL = 'https://mheerspink75.github.io/fractal-forge/';

const GPU_MODES = [
  'mandelbrot', 'julia', 'burningShip', 'newton', 'sierpinski',
  'cosmicNebula', 'dreamscape', 'neuralBloom', 'quantumField', 'mandelbulb',
];
const TIME_MODE = 'dreamscape';      // uses u_time -> composition changes over time
const ACTION_KEYS = ['r', 'n', 's', 'e', 'g', 'a', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

const VIEWPORT = { width: 1280, height: 720 };
const GRID = 64;                    // downsample size for pixel comparisons
const MATCH_CAP = 45;               // screen-vs-export MAE must stay below this
const SEED_STEP = 7919;             // a prime offset that always changes the seed
const LAUNCH_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'];
const OVERLAYS = '.topbar,.panel-left,.panel-right,.statusbar,.fx-overlay,.onboarding';
const EVIDENCE_BASE = path.join(__dirname, '.evidence');

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  \u2713 ' + name + (detail ? '  \u2014 ' + detail : '')); }
  else { fail++; failures.push(name); console.error('  \u2717 FAIL: ' + name + (detail ? '  \u2014 ' + detail : '')); }
}

// ---------- pixel helpers ----------
const decode = (buf) => PNG.sync.read(buf);
function downsample(png, n) {
  const { width, height, data } = png;
  const out = new Float32Array(n * n * 3);
  for (let gy = 0; gy < n; gy++) {
    const y0 = Math.floor(gy * height / n), y1 = Math.max(y0 + 1, Math.ceil((gy + 1) * height / n));
    for (let gx = 0; gx < n; gx++) {
      const x0 = Math.floor(gx * width / n), x1 = Math.max(x0 + 1, Math.ceil((gx + 1) * width / n));
      let r = 0, g = 0, b = 0, c = 0;
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          const i = (y * width + x) * 4; r += data[i]; g += data[i + 1]; b += data[i + 2]; c++;
        }
      }
      const o = (gy * n + gx) * 3; out[o] = r / c; out[o + 1] = g / c; out[o + 2] = b / c;
    }
  }
  return out;
}
const mae = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
function frameStats(png) {
  const { data } = png; let sum = 0, sumSq = 0, c = 0;
  for (let i = 0; i < data.length; i += 16) { const v = (data[i] + data[i + 1] + data[i + 2]) / 3; sum += v; sumSq += v * v; c++; }
  const mean = sum / c; return { mean: Math.round(mean * 100) / 100, variance: Math.round((sumSq / c - mean * mean) * 100) / 100 };
}
// "valid" = not solid-black and not a flat NaN/broken image (has real tonal spread).
// A dark-but-correct 3D frame (e.g. Mandelbulb in black space) still has structure,
// so the spread (variance) is the real signal; the mean floor stays low.
const isValidFrame = (png) => { const s = frameStats(png); return s.variance > 20 && s.mean > 1; };
const sha = (buf) => crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12);

// ---------- browser helpers ----------
async function loadApp(page, url, evidenceDir) {
  await page.goto(url, { waitUntil: 'load', timeout: 90000 });
  await page.waitForTimeout(2500);
  // Dismiss onboarding so it never occludes or intercepts input.
  const start = await page.locator('#onboard-start').count();
  if (start) { try { await page.locator('#onboard-start').click(); } catch (e) { /* already gone */ } }
  await page.waitForTimeout(300);
}

async function capture(page, evidenceDir, name) {
  await page.evaluate((sel) => sel.split(',').forEach((s) => { const el = document.querySelector(s.trim()); if (el) el.style.display = 'none'; }), OVERLAYS);
  let buf;
  try { buf = await page.locator('#gl-canvas').first().screenshot({ type: 'png', timeout: 30000 }); }
  catch (e) { buf = await page.screenshot({ type: 'png' }); }
  await page.evaluate((sel) => sel.split(',').forEach((s) => { const el = document.querySelector(s.trim()); if (el) el.style.display = ''; }), OVERLAYS);
  if (evidenceDir) { fs.mkdirSync(evidenceDir, { recursive: true }); fs.writeFileSync(path.join(evidenceDir, name + '.png'), buf); }
  return buf;
}

async function getExportBuffer(page) {
  try {
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 40000 }),
      page.evaluate(() => App.exportAt('current')),
    ]);
    return { buf: fs.readFileSync(await dl.path()), via: 'download (App.exportAt)' };
  } catch (e) {
    const dataUrl = await page.evaluate(() => Exporter.renderToDataURL(window.innerWidth, window.innerHeight, App.getLiveTime()));
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) throw new Error('export produced no data URL: ' + String(dataUrl).slice(0, 60));
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
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const evidenceDir = path.join(evidenceBase, name);

  try {
    await loadApp(page, url, evidenceDir);

    // ---------- Boot & render ----------
    console.log('\n-- Boot & rendering --');
    const boot = await page.evaluate(() => ({
      booted: typeof App !== 'undefined' && typeof App.getLiveTime === 'function' && typeof State !== 'undefined',
      webgl: (() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl') || c.getContext('experimental-webgl')); } catch (e) { return false; } })(),
    }));
    ok('Boots: app initialized (App/State reachable)', boot.booted);
    ok('Boots: WebGL context available', boot.webgl);
    const bootFrame = await capture(page, evidenceDir, 'boot');
    const bs = frameStats(decode(bootFrame));
    ok('Boots: renders a non-blank fractal frame', isValidFrame(decode(bootFrame)), JSON.stringify(bs));

    // ---------- D3: seed drives every GPU mode ----------
    console.log('\n-- D3: seed drives every GPU mode --');
    // Freeze time + turn off cycling/trails so the ONLY thing that changes
    // between the two captures of a mode is the seed.
    await page.evaluate(() => { App.togglePause(); State.set({ cycling: false, trails: 0 }); });
    for (const id of GPU_MODES) {
      // The 3D Mandelbulb raymarch (~160 x 12 inner ops/pixel) is heavy under
      // software GL and needs a longer settle before its frame is complete.
      const settle = (id === 'mandelbulb') ? 2500 : 900;
      await page.evaluate((mid) => App.setMode(mid), id);
      await page.waitForTimeout(settle);
      const seedBefore = await page.evaluate(() => State.get().seed);
      const A = await capture(page, evidenceDir, 'd3-' + id + '-before');
      await page.evaluate((step) => { const s = State.get(); State.set({ seed: (s.seed + step) >>> 0 }); }, SEED_STEP);
      await page.waitForTimeout(settle);
      const B = await capture(page, evidenceDir, 'd3-' + id + '-after');
      ok('D3 ' + id + ': seed change alters the composition', sha(A) !== sha(B), 'seed ' + seedBefore + ' \u2192 ' + (((seedBefore + SEED_STEP) >>> 0)));
      const aStat = frameStats(decode(A)), bStat = frameStats(decode(B));
      ok('D3 ' + id + ': render stays stable (non-blank, not broken)', isValidFrame(decode(A)) && isValidFrame(decode(B)), 'A ' + JSON.stringify(aStat) + '  B ' + JSON.stringify(bStat));
    }
    await page.evaluate(() => App.togglePause());   // resume for D4

    // ---------- D4: export matches the on-screen composition ----------
    console.log('\n-- D4: export matches the screen at live time --');
    await page.evaluate((mode) => { State.set({ anim: 1.0, cycling: false, trails: 0 }); App.setMode(mode); }, TIME_MODE);
    await page.waitForTimeout(600);
    const liveT0 = await page.evaluate(() => App.getLiveTime());
    const frameA = await capture(page, evidenceDir, 'd4-start');      // starting composition
    await page.waitForTimeout(3000);                                    // let time advance
    await page.evaluate(() => App.togglePause());                       // freeze at live time T1
    await page.waitForTimeout(450);
    const liveT1 = await page.evaluate(() => App.getLiveTime());
    ok('D4: animation time advanced', liveT1 > liveT0, 't0=' + liveT0.toFixed(2) + 's t1=' + liveT1.toFixed(2) + 's');
    const frameB = await capture(page, evidenceDir, 'd4-screen');      // current on-screen frame
    const exp = await getExportBuffer(page);
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.writeFileSync(path.join(evidenceDir, 'd4-export.png'), exp.buf);
    const expPng = decode(exp.buf);
    ok('D4: export produced a valid PNG', isValidFrame(expPng) && expPng.width >= 16, exp.via + ' ' + expPng.width + '\u00d7' + expPng.height);
    const gA = downsample(decode(frameA), GRID);
    const gB = downsample(decode(frameB), GRID);
    const gE = downsample(expPng, GRID);
    const matchMAE = mae(gB, gE);   // current screen vs export  (should be LOW  -> matches)
    const startMAE = mae(gA, gE);   // start frame   vs export  (should be HIGHER -> live, not t=0)
    ok('D4: export matches the on-screen composition', matchMAE < MATCH_CAP, 'screenVsExport MAE=' + matchMAE.toFixed(1));
    ok('D4: export is the live frame, not the time=0 frame', matchMAE < startMAE, 'screenVsExport=' + matchMAE.toFixed(1) + '  startVsExport=' + startMAE.toFixed(1));

    // ---------- D10: action keys inert behind a modal ----------
    console.log('\n-- D10: action keys are inert behind a modal --');
    await page.evaluate(() => { UI.closeAllModals(); });
    await page.waitForTimeout(300);
    await page.locator('#btn-settings').click();
    await page.waitForTimeout(400);
    const openState = await page.evaluate(() => ({ anyOpen: UI.isAnyModalOpen(), hidden: document.getElementById('modal-settings').hidden }));
    ok('D10: settings modal is open (key gate active)', openState.anyOpen === true, 'isAnyModalOpen=' + openState.anyOpen);

    const before = await page.evaluate(() => ({ mode: State.get().mode, seed: State.get().seed, palette: State.get().palette, audio: document.getElementById('btn-audio').getAttribute('aria-pressed') }));
    for (const k of ACTION_KEYS) { await page.keyboard.press(k); await page.waitForTimeout(70); }
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => ({
      mode: State.get().mode, seed: State.get().seed, palette: State.get().palette,
      audio: document.getElementById('btn-audio').getAttribute('aria-pressed'),
      exportOpen: !document.getElementById('modal-export').hidden,
      galleryOpen: !document.getElementById('modal-gallery').hidden,
    }));
    const toasts = (await page.evaluate(() => document.getElementById('toast-stack').textContent)).trim();
    ok('D10: r/n did not randomize or forge (seed + mode unchanged)', after.seed === before.seed && after.mode === before.mode, 'seed ' + before.seed + ' \u2192 ' + after.seed);
    ok('D10: 1-9 did not change the palette', after.palette === before.palette, 'palette ' + before.palette + ' \u2192 ' + after.palette);
    ok('D10: e did not open the export modal', after.exportOpen === false);
    ok('D10: g did not open the gallery modal', after.galleryOpen === false);
    ok('D10: a did not toggle audio', after.audio === before.audio, 'aria-pressed ' + before.audio + ' \u2192 ' + after.audio);
    ok('D10: no action fired (no action toast shown)', !/Share code copied|Forged a new world|Mic unavailable|Audio reactive|World imported|Exported/i.test(toasts), toasts || '(no toasts)');

    // The non-gated controls must STILL work while the modal is open.  Focus the
    // modal container (not a button/checkbox) so Space/Arrows reach the app
    // handler rather than a native control activation.
    const focusModal = () => page.evaluate(() => { const m = document.querySelector('#modal-settings .modal'); m.setAttribute('tabindex', '-1'); m.focus(); });
    const zoomBefore = await page.evaluate(() => document.getElementById('status-zoom').textContent);
    await focusModal(); await page.keyboard.press('+'); await page.waitForTimeout(150);
    const zoomAfter = await page.evaluate(() => document.getElementById('status-zoom').textContent);
    ok('D10: "+" still zooms while modal open', zoomBefore !== zoomAfter, zoomBefore + ' \u2192 ' + zoomAfter);
    const centerBefore = await page.evaluate(() => State.get().center.slice());
    await focusModal(); await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(150);
    const centerAfter = await page.evaluate(() => State.get().center.slice());
    ok('D10: arrow keys still pan while modal open', JSON.stringify(centerBefore) !== JSON.stringify(centerAfter), JSON.stringify(centerBefore) + ' \u2192 ' + JSON.stringify(centerAfter));
    const toastPre = (await page.evaluate(() => document.getElementById('toast-stack').textContent)).trim();
    await focusModal(); await page.keyboard.press(' '); await page.waitForTimeout(200);
    const toastPost = (await page.evaluate(() => document.getElementById('toast-stack').textContent)).trim();
    ok('D10: Space still pauses while modal open', /Paused|Resumed/.test(toastPost) && toastPost !== toastPre, toastPost);

    // Close via Escape; the modal must close.
    await focusModal(); await page.keyboard.press('Escape'); await page.waitForTimeout(500);
    const closedState = await page.evaluate(() => ({ anyOpen: UI.isAnyModalOpen(), hidden: document.getElementById('modal-settings').hidden }));
    ok('D10: Escape closes the modal', closedState.anyOpen === false && closedState.hidden === true, 'isAnyModalOpen=' + closedState.anyOpen);

    // Control group: with NO modal open, the same key MUST act (proves the
    // suppression above is what was blocking it, not a dead key handler).
    await page.evaluate(() => { UI.closeAllModals(); });
    await page.waitForTimeout(200);
    const seedCtrlBefore = await page.evaluate(() => State.get().seed);
    await page.keyboard.press('r'); await page.waitForTimeout(400);
    const seedCtrlAfter = await page.evaluate(() => State.get().seed);
    ok('D10 control: with no modal, "r" DOES randomize (seed changes)', seedCtrlBefore !== seedCtrlAfter, 'seed ' + seedCtrlBefore + ' \u2192 ' + seedCtrlAfter);

    // Any real JS error raised during the run is itself a failure.
    const realErrors = errors.filter((e) => !/favicon/i.test(e));
    ok('No uncaught page/console errors during the run', realErrors.length === 0, realErrors.length ? realErrors.slice(0, 3).join(' | ') : '(none)');
  } finally {
    await browser.close();
  }
}

// ---------- local static server (self-contained npm run test:browser) ----------
function httpProbe(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject);
    req.setTimeout(1500, () => req.destroy(new Error('timeout')));
  });
}
async function ensureLocalServer(url) {
  try { await httpProbe(url); return null; } catch (e) { /* not up yet */ }
  const proc = spawn(process.execPath, [path.join(__dirname, 'serve.js'), String(LOCAL_PORT)], { stdio: 'ignore', detached: false });
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try { await httpProbe(url); return proc; } catch (e) { /* keep waiting */ }
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
      try { await runTarget(name, url, EVIDENCE_BASE); }
      catch (e) { fail++; failures.push(name + ': ' + e.message); console.error('  \u2717 Target ' + name + ' errored: ' + e.message); }
    }
  } finally {
    if (localServer) { try { localServer.kill('SIGTERM'); } catch (e) { /* ignore */ } }
  }
  console.log('\n==========================================');
  console.log('SUMMARY: ' + pass + ' passed, ' + fail + ' failed');
  if (failures.length) console.error('Failures:\n  - ' + failures.join('\n  - '));
  console.log(fail === 0 ? 'BROWSER CHECKS PASSED' : 'BROWSER CHECKS FAILED');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
