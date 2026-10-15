/* Golden-image baseline generator (64x64 downsample grid, MAE space).
   Warms the context, then saves the canonical scene's 64x64 RGB grid as JSON.
   Run: node test/make-golden.cjs   (writes test/golden/mandelbrot-424242.json) */
const { chromium } = require('playwright');
const { PNG } = require('pngjs');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 8199;
const QUERY = '?fractal=mandelbrot&seed=424242&palette=2&time=0&iterations=512';
const GRID = 64;
const OVERLAYS = '.topbar,.panel-left,.panel-right,.statusbar,.fx-overlay,.onboarding';

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
  const url = 'http://127.0.0.1:' + PORT + '/' + QUERY;

  async function grab() {
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    await page.evaluate((sel) =>
      sel.split(',').forEach((s) => {
        const el = document.querySelector(s.trim());
        if (el) el.style.display = 'none';
      })
    , OVERLAYS);
    const buf = await page.locator('#gl-canvas').first().screenshot({ type: 'png' });
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
  console.log('warm-vs-warm MAE spread =', spread.toFixed(3));

  fs.writeFileSync(
    path.join(__dirname, 'golden', 'mandelbrot-424242.json'),
    JSON.stringify({ scene: QUERY, grid: GRID, values: Array.from(g2) })
  );
  console.log('golden written: test/golden/mandelbrot-424242.json');
  await browser.close();
  server.kill();
  process.exit(0);
})().catch((e) => {
  console.error('GEN FAILED', e);
  process.exit(1);
});
