/* ============================================================
   Exporter — render the current world to an offscreen FBO at a
   fixed resolution, read the pixels back, and produce a PNG.

   Depends on modules still in script.js (GL, Effects, Engine, A11y);
   the circular import is safe because every reference is at call time.
   ============================================================ */
import { GL, Effects, Engine, A11y } from '../script.js';
import { Camera } from './camera.js';
import { State } from './state.js';

export const Exporter = (() => {
  // Render the current world to a 2D canvas at (w, h).
  // Preserves the on-screen framing by scaling zoom with height.
  function renderToCanvas(w, h, time) {
    w = Math.round(w);
    h = Math.round(h);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 16 || h < 16) {
      throw new Error('Invalid export dimensions');
    }
    const gl = GL.gl;
    const screenH = window.innerHeight || 800;
    const s = State.get();
    const exportZoom = s.zoom * (h / screenH);

    // Temporarily size the post pipeline to the export resolution.
    const prevW = window.innerWidth,
      prevH = window.innerHeight;
    let baseFBO = null,
      outFBO = null;
    Effects.resize(w, h);
    try {
      baseFBO = GL.createFBO(w, h);
      outFBO = GL.createFBO(w, h);

      const params = Object.assign({}, s, {
        zoom: exportZoom,
        time: time != null ? time : 0,
        audio: [0, 0, 0],
        highContrast: A11y.get().highContrast ? 1 : 0,
        camPos: Camera.camPos,
        camTarget: Camera.camTarget
      });

      Engine.renderFractal(baseFBO, w, h, params);
      Effects.render(baseFBO, params, outFBO);

      // Read pixels back (WebGL is bottom-up, so flip vertically).
      gl.bindFramebuffer(gl.FRAMEBUFFER, outFBO.fbo);
      const buf = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      const img = ctx.createImageData(w, h);
      const data = img.data;
      for (let y = 0; y < h; y++) {
        const srcRow = (h - 1 - y) * w * 4;
        const dstRow = y * w * 4;
        data.set(buf.subarray(srcRow, srcRow + w * 4), dstRow);
      }
      ctx.putImageData(img, 0, 0);

      return canvas;
    } finally {
      // Always clean up FBOs and restore pipeline sizing.
      if (baseFBO) GL.deleteFBO(baseFBO);
      if (outFBO) GL.deleteFBO(outFBO);
      Effects.resize(prevW, prevH);
    }
  }

  function renderToDataURL(w, h, time) {
    return renderToCanvas(w, h, time).toDataURL('image/png');
  }

  // Trigger a browser download of the current world at (w, h).
  function download(w, h, filename, time) {
    const url = renderToDataURL(w, h, time);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `fractal-forge-${w}x${h}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  return { renderToCanvas, renderToDataURL, download };
})();
