/* Golden-image baseline generator (64x64 downsample grid, MAE space).
   Warms the context, then saves each scene's 64x64 RGB grid as JSON.
   Usage:
     node test/make-golden.cjs '<sceneJson>' ['<sceneJson>' ...]
   A scene is { "mode": "...", "seed": int, "palette": int, "iterations": int,
   "settle": ms (optional) }. With no args it regenerates the original 2D
   Mandelbrot baseline. Writes test/golden/<mode>-<seed>.json for each scene. */
const { chromium } = require('playwright');
const { PNG } = require('pngjs');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 8199;
const GRID = 64;
const OVERLAYS = '.topbar,.panel-left,.panel-right,.statusbar,.fx-overlay,.onboarding';

function parseScene(arg) {
  let s;
  try {
    s = JSON.parse(arg);
  } catch (e) {
    throw new Error('Bad scene JSON: ' + arg);
  }
  if (!s || typeof s.mode !== 'string') throw new Error('Scene needs a "mode": ' + arg);
  return {
    mode: s.mode,
    seed: s.seed != null ? s.seed : 424242,
    palette: s.palette != null ? s.palette : 2,
    iterations: s.iterations != null ? s.iterations : 256,
    // 3D raymarching (software GL) needs a longer settle than the 2D eval modes.
    settle: s.settle != null ? s.settle : 2500
  };
}
function sceneQuery(sc) {
  return (
    '?fractal=' + sc.mode +
    '&seed=' + sc.seed +
    '&palette=' + sc.palette +
    '&time=0&iterations=' + sc.iterations
  );
}
function sceneFile(sc) {
  return path.join(__dirname, 'golden', sc.mode + '-' + sc.seed + '.json');
}

const argv = process.argv.slice(2);
const DEFAULT_SCENE = { mode: 'mandelbrot', seed: 424242, palette: 2, iterations: 512, settle: 1200 };
function loadScenes() {
  // Preferred: `--scenes <file>` where the file holds a JSON array (or object)
  // of scene specs. This avoids shell-quoting pitfalls of inline JSON args.
  const i = argv.indexOf('--scenes');
  if (i !== -1 && argv[i + 1]) {
    let arr = JSON.parse(fs.readFileSync(argv[i + 1], 'utf8'));
    if (!Array.isArray(arr)) arr = [arr];
    return arr.map((s) => Object.assign({ seed: 424242, palette: 2, iterations: 256, settle: 2500 }, s));
  }
  const rest = argv.filter((a) => a.trim() !== '');
  return rest.length ? rest.map(parseScene) : [DEFAULT_SCENE];
}
const SCENES = loadScenes();

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

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, 'serve.js'), String(PORT)], {
    stdio: 'ignore'
  });
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-gpu-sandbox'
    ]
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });

  for (const sc of SCENES) {
    const query = sceneQuery(sc);
    const url = 'http://127.0.0.1:' + PORT + '/' + query;

    async function grab() {
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForTimeout(sc.settle);
      await page.evaluate((sel) =>
        sel.split(',').forEach((s) => {
          const el = document.querySelector(s.trim());
          if (el) el.style.display = 'none';
        })
      , OVERLAYS);
      // Mirror the browser.js capture path: 90 s ceiling (first page that
      // compiles a heavy 3D shader holds the SwiftShader main thread) + a
      // full-page fallback, so the element-stability wait can't sink a run.
      let buf;
      try {
        buf = await page.locator('#gl-canvas').first().screenshot({ type: 'png', timeout: 90000 });
      } catch (e) {
        buf = await page.screenshot({ type: 'png', timeout: 90000 });
      }
      await page.close();
      return downsample(PNG.sync.read(buf), GRID);
    }

    // Warm up (first frame is cold/shader-compiling), then capture a settled grid twice.
    await grab();
    const g1 = await grab();
    const g2 = await grab();
    let spread = 0;
    for (let i = 0; i < g1.length; i++) spread += Math.abs(g1[i] - g2[i]);
    spread /= g1.length;

    const file = sceneFile(sc);
    fs.writeFileSync(file, JSON.stringify({ scene: query, grid: GRID, values: Array.from(g2) }));
    console.log(
      'golden written: ' +
        path.relative(process.cwd(), file) +
        ' (scene ' + query + ', warm spread=' + spread.toFixed(3) + ')'
    );
  }
  await browser.close();
  server.kill();
  process.exit(0);
})().catch((e) => {
  console.error('GEN FAILED', e);
  process.exit(1);
});
