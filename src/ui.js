/* ============================================================
   UI — DOM bindings: panels, sliders, buttons, toasts, modals.
   Reads/writes State directly; delegates orchestration to App.
   ============================================================ */
import { ColorSystem, Gallery, A11y } from './main.js';
import { Camera } from './camera.js';
import { Fractals } from './fractals.js';
import { State } from './state.js';

export const UI = (() => {
  const $ = (id) => document.getElementById(id);
  let actions = {}; // App-provided callbacks
  let pendingConfirm = null; // callback for the confirm modal

  // ---------- Toasts ----------
  function toast(msg, type) {
    const stack = $('toast-stack');
    if (!stack) return;
    let cls = 'toast';
    if (type === 'ok' || type === 'success') cls += ' success';
    else if (type === 'error') cls += ' error';
    const el = document.createElement('div');
    el.className = cls;
    el.textContent = msg;
    stack.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    }, 2600);
  }

  // ---------- Modals ----------
  // Full modal behavior: focus moves in on open, is trapped while open,
  // Escape closes, focus returns to the opener, and the background is inert.
  const modalStack = []; // open modal ids, topmost last
  const focusStack = []; // element focused before each modal opened
  let trapBound = false;

  const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function focusableIn(root) {
    return Array.from(root.querySelectorAll(FOCUSABLE)).filter(
      (el) => el.getClientRects().length > 0
    );
  }

  function setInert(on) {
    const targets = [
      document.querySelector('.topbar'),
      document.querySelector('.panel-left'),
      document.querySelector('.panel-right'),
      document.querySelector('.statusbar'),
      document.querySelector('.onboarding')
    ];
    targets.forEach((el) => {
      if (el && 'inert' in el) el.inert = on;
    });
  }

  function topModal() {
    return modalStack[modalStack.length - 1] || null;
  }

  // True while at least one modal is open; used to gate keyboard action keys
  // so they don't fire the app action behind an open dialog.
  function isAnyModalOpen() {
    return modalStack.length > 0;
  }

  function trapFocus(e) {
    const id = topModal();
    if (!id) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeModal(id);
      return;
    }
    if (e.key !== 'Tab') return;
    const m = $(id);
    if (!m) return;
    const focusables = focusableIn(m);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === m)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function openModal(id) {
    const m = $(id);
    if (!m) return;
    focusStack.push(document.activeElement);
    modalStack.push(id);
    if (modalStack.length === 1) {
      setInert(true);
      if (!trapBound) {
        document.addEventListener('keydown', trapFocus);
        trapBound = true;
      }
    }
    m.hidden = false;
    requestAnimationFrame(() => {
      m.classList.add('open');
      const focusables = focusableIn(m);
      (focusables[0] || m).focus();
    });
  }

  function closeModal(id) {
    const m = $(id);
    if (!m) return;
    m.classList.remove('open');
    const idx = modalStack.lastIndexOf(id);
    if (idx !== -1) {
      const wasTop = idx === modalStack.length - 1;
      modalStack.splice(idx, 1);
      const prev = focusStack.splice(idx, 1)[0];
      if (wasTop && prev && typeof prev.focus === 'function') prev.focus();
    }
    if (modalStack.length === 0) {
      setInert(false);
      if (trapBound) {
        document.removeEventListener('keydown', trapFocus);
        trapBound = false;
      }
    }
    setTimeout(() => {
      m.hidden = true;
    }, 200);
  }

  function closeAllModals() {
    ['modal-gallery', 'modal-export', 'modal-settings', 'modal-help'].forEach(closeModal);
  }

  // ---------- Onboarding ----------
  function hideOnboarding() {
    const el = $('onboarding');
    if (!el) return;
    el.classList.add('hide');
    setTimeout(() => {
      el.hidden = true;
    }, 500);
  }

  // ---------- Status bar ----------
  function updateStatus() {
    const s = State.get();
    const mode = Fractals.get(s.mode);
    const modeEl = $('status-mode');
    if (modeEl) modeEl.textContent = mode.label;
    const seedEl = $('status-seed');
    if (seedEl) seedEl.textContent = 'seed ' + String(s.seed).padStart(8, '0');
  }
  function updateZoomStatus() {
    const el = $('status-zoom');
    if (el) el.textContent = (Camera.zoom / 100).toFixed(2) + '×';
  }
  function updateFps(fps) {
    const el = $('status-fps');
    if (el) el.textContent = Math.round(fps) + ' fps';
  }

  // ---------- Mode list ----------
  function populateModes() {
    const groups = { classic: [], experimental: [], structural: [], '3d': [] };
    for (const id of Fractals.ORDER) {
      const m = Fractals.get(id);
      (groups[m.group] || (groups[m.group] = [])).push(Object.assign({ id }, m));
    }
    const map = {
      classic: 'mode-list-classic',
      experimental: 'mode-list-experimental',
      structural: 'mode-list-structural',
      '3d': 'mode-list-3d'
    };
    for (const g of Object.keys(map)) {
      const container = $(map[g]);
      if (!container) continue;
      container.innerHTML = '';
      for (const m of groups[g] || []) {
        const btn = document.createElement('button');
        btn.className = 'mode-item';
        btn.dataset.mode = m.id;
        btn.setAttribute('aria-pressed', 'false');
        btn.innerHTML = `<span class="dot" aria-hidden="true"></span><span class="mode-name">${m.label}</span>`;
        btn.addEventListener('click', () => actions.setMode && actions.setMode(m.id));
        container.appendChild(btn);
      }
    }
    highlightMode(State.get().mode);
  }

  function highlightMode(id) {
    document.querySelectorAll('.mode-item').forEach((el) => {
      el.setAttribute('aria-pressed', String(el.dataset.mode === id));
    });
  }

  // ---------- Palette grid ----------
  function populatePalettes() {
    const grid = $('palette-grid');
    if (!grid) return;
    grid.innerHTML = '';
    ColorSystem.PALETTES.forEach((p, i) => {
      const sw = document.createElement('button');
      sw.className = 'palette-swatch';
      sw.dataset.index = i;
      sw.title = p.name;
      sw.setAttribute('aria-label', p.name);
      sw.setAttribute('aria-pressed', 'false');
      sw.style.background = ColorSystem.cssGradientFor(i);
      sw.addEventListener('click', () => actions.setPalette && actions.setPalette(i));
      grid.appendChild(sw);
    });
    highlightPalette(State.get().palette);
  }

  function highlightPalette(i) {
    document.querySelectorAll('.palette-swatch').forEach((el) => {
      el.setAttribute('aria-pressed', String(parseInt(el.dataset.index, 10) === i));
    });
  }

  function updateGradientBar() {
    const bar = $('gradient-bar');
    if (bar) bar.style.background = ColorSystem.cssGradient(State.get().palettePhase);
  }

  // ---------- Sliders ----------
  // Each slider maps to a State key with a value transform.
  const SLIDERS = [
    {
      id: 'grad-phase',
      key: 'palettePhase',
      scale: 0.001,
      val: null,
      fmt: (v) => Math.round(v * 1000)
    },
    {
      id: 'grad-speed',
      key: 'paletteSpeed',
      scale: 0.01,
      val: null,
      fmt: (v) => Math.round(v * 100)
    },
    {
      id: 'grad-contrast',
      key: 'contrast',
      scale: 0.01,
      val: null,
      fmt: (v) => Math.round(v * 100)
    },
    {
      id: 'ctl-iterations',
      key: 'iterations',
      scale: 1,
      val: 'val-iterations',
      fmt: (v) => Math.round(v)
    },
    { id: 'ctl-detail', key: 'detail', scale: 0.01, val: 'val-detail', fmt: (v) => v.toFixed(1) },
    { id: 'ctl-anim', key: 'anim', scale: 0.01, val: 'val-anim', fmt: (v) => Math.round(v * 100) },
    {
      id: 'ctl-bloom',
      key: 'bloom',
      scale: 0.01,
      val: 'val-bloom',
      fmt: (v) => Math.round(v * 100)
    },
    {
      id: 'ctl-trails',
      key: 'trails',
      scale: 0.01,
      val: 'val-trails',
      fmt: (v) => Math.round(v * 100)
    },
    {
      id: 'ctl-aberration',
      key: 'aberration',
      scale: 0.01,
      val: 'val-aberration',
      fmt: (v) => Math.round(v * 100)
    },
    {
      id: 'ctl-vignette',
      key: 'vignette',
      scale: 0.01,
      val: 'val-vignette',
      fmt: (v) => Math.round(v * 100)
    },
    { id: 'ctl-fog', key: 'fog', scale: 0.01, val: 'val-fog', fmt: (v) => Math.round(v * 100) }
  ];

  function bindSlider(def) {
    const el = $(def.id);
    if (!el) return;
    el.addEventListener('input', () => {
      const v = parseFloat(el.value) * def.scale;
      State.set({ [def.key]: v });
      if (def.val) {
        const ve = $(def.val);
        if (ve) ve.textContent = def.fmt(v);
      }
      if (def.key === 'contrast') updateGradientBar();
      if (def.key === 'palettePhase' || def.key === 'paletteSpeed') updateGradientBar();
      if (actions.onParam) actions.onParam(def.key, v);
    });
  }

  // Zoom slider uses a log mapping relative to the mode's base zoom.
  function bindZoomSlider() {
    const el = $('ctl-zoom');
    if (!el) return;
    el.addEventListener('input', () => {
      const v = parseFloat(el.value);
      const mode = Fractals.get(State.get().mode);
      const baseZoom = (window.innerHeight || 800) / mode.span;
      const zoom = baseZoom * Math.pow(10, (v - 20) / 20);
      State.set({ zoom });
      Camera.setZoom(zoom);
      const ve = $('val-zoom');
      if (ve) ve.textContent = (zoom / baseZoom).toFixed(2);
      updateZoomStatus();
      if (actions.onParam) actions.onParam('zoom', zoom);
    });
  }

  // Reflect current State into the sliders (after restore/randomize).
  function syncSliders() {
    const s = State.get();
    for (const def of SLIDERS) {
      const el = $(def.id);
      if (!el) continue;
      el.value = Math.round(s[def.key] / def.scale);
      if (def.val) {
        const ve = $(def.val);
        if (ve) ve.textContent = def.fmt(s[def.key]);
      }
    }
    // Zoom slider: invert the log mapping.
    const zEl = $('ctl-zoom');
    if (zEl) {
      const mode = Fractals.get(s.mode);
      const baseZoom = (window.innerHeight || 800) / mode.span;
      const ratio = s.zoom / baseZoom;
      zEl.value = Math.round(20 + 20 * Math.log10(ratio));
      const ve = $('val-zoom');
      if (ve) ve.textContent = ratio.toFixed(2);
    }
  }

  // ---------- Mobile drawer backdrop ----------
  // On small screens the side panels become overlay drawers. Show a backdrop
  // behind whichever panel is open so the user can tap outside to close it.
  function isMobileDrawer() {
    return window.matchMedia('(max-width: 720px)').matches;
  }
  function syncPanelBackdrop() {
    const bd = $('panel-backdrop');
    if (!bd) return;
    if (!isMobileDrawer()) {
      bd.classList.remove('show');
      return;
    }
    const anyOpen = ['panel-modes', 'panel-params'].some((id) => {
      const p = $(id);
      return p && !p.classList.contains('collapsed');
    });
    bd.classList.toggle('show', anyOpen);
  }

  // ---------- Buttons ----------
  function bindButtons() {
    const bind = (id, fn) => {
      const el = $(id);
      if (el) el.addEventListener('click', fn);
    };
    bind('btn-randomize', () => actions.randomize && actions.randomize());
    bind('btn-newworld', () => actions.newWorld && actions.newWorld());
    bind('btn-share', () => actions.share && actions.share());
    bind('btn-export', () => {
      openModal('modal-export');
    });
    bind('btn-gallery', () => {
      renderGallery();
      openModal('modal-gallery');
    });
    bind('btn-save', () => openSaveModal());
    bind('btn-audio', () => actions.toggleAudio && actions.toggleAudio());
    bind('btn-settings', () => {
      syncSettings();
      openModal('modal-settings');
    });
    bind('btn-cycle', () => {
      const s = State.get();
      const cycling = !s.cycling;
      State.set({ cycling });
      ColorSystem.state.cycling = cycling;
      const btn = $('btn-cycle');
      if (btn) btn.setAttribute('aria-pressed', String(cycling));
    });
    // Panel collapse (syncs the mobile drawer backdrop).
    bind('collapse-modes', () => {
      $('panel-modes').classList.toggle('collapsed');
      syncPanelBackdrop();
    });
    bind('collapse-params', () => {
      $('panel-params').classList.toggle('collapsed');
      syncPanelBackdrop();
    });
    // Mobile drawer backdrop: tap outside to close the open panel(s).
    const pbd = $('panel-backdrop');
    if (pbd)
      pbd.addEventListener('click', () => {
        ['panel-modes', 'panel-params'].forEach((id) => {
          const p = $(id);
          if (p) p.classList.add('collapsed');
        });
        syncPanelBackdrop();
      });
    // Onboarding.
    bind('onboard-start', () => {
      hideOnboarding();
      actions.onboarded && actions.onboarded();
    });
    bind('onboard-help', () => {
      hideOnboarding();
      openModal('modal-help');
    });
    // Modal close buttons + backdrop.
    document.querySelectorAll('.modal-close').forEach((btn) => {
      btn.addEventListener('click', () => closeModal(btn.dataset.close));
    });
    document.querySelectorAll('.modal-backdrop').forEach((bd) => {
      bd.addEventListener('click', (e) => {
        if (e.target === bd) closeModal(bd.id);
      });
    });
    // Import code.
    bind('btn-import-code', () => {
      const code = window.prompt('Paste a FRACTAL FORGE share code:');
      if (code && actions.importCode) actions.importCode(code);
    });
    // Save modal.
    bind('btn-save-cancel', () => closeModal('modal-save'));
    bind('btn-save-confirm', () => {
      const name = ($('save-name') || {}).value || '';
      if (actions.saveArtwork) actions.saveArtwork(name.trim());
    });
    // Confirm modal (used for destructive actions like delete).
    bind('btn-confirm-cancel', () => {
      pendingConfirm = null;
      closeModal('modal-confirm');
    });
    bind('btn-confirm-ok', () => {
      const fn = pendingConfirm;
      pendingConfirm = null;
      closeModal('modal-confirm');
      if (fn) fn();
    });
  }

  // Open the save modal with a sensible default name for the current world.
  function openSaveModal() {
    const input = $('save-name');
    if (input) {
      const mode = Fractals.get(State.get().mode);
      input.value = (mode ? mode.label : 'Artwork') + ' #' + (Gallery.count() + 1);
    }
    openModal('modal-save');
    if (input) {
      input.focus();
      input.select && input.select();
    }
  }

  // Show the confirm modal; `onConfirm` runs when the user accepts.
  function openConfirm(message, onConfirm) {
    const desc = $('confirm-desc');
    if (desc && message) desc.textContent = message;
    pendingConfirm = onConfirm;
    openModal('modal-confirm');
    const ok = $('btn-confirm-ok');
    if (ok) ok.focus();
  }

  // ---------- Gallery ----------
  const esc = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );

  function renderGallery() {
    const grid = $('gallery-grid');
    const empty = $('gallery-empty');
    if (!grid) return;
    const items = Gallery.list();
    grid.innerHTML = '';
    if (empty) empty.hidden = items.length > 0;
    for (const it of items) {
      const name = esc(it.name);
      const card = document.createElement('div');
      card.className = 'gallery-card';
      card.innerHTML = `
        ${it.thumb ? `<img src="${it.thumb}" alt="${name}" />` : ''}
        <div class="gc-meta"><span class="gc-name">${name}</span></div>
        <div class="gc-actions">
          <button class="gc-restore" aria-label="Restore ${name}">Restore</button>
          <button class="gc-fav" aria-pressed="${!!it.favorite}" aria-label="${it.favorite ? 'Unfavorite' : 'Favorite'} ${name}">${it.favorite ? '★' : '☆'}</button>
          <button class="gc-del" aria-label="Delete ${name}">✕</button>
        </div>`;
      card
        .querySelector('.gc-restore')
        .addEventListener('click', () => actions.galleryRestore && actions.galleryRestore(it.id));
      card.querySelector('.gc-fav').addEventListener('click', (e) => {
        e.stopPropagation();
        Gallery.toggleFavorite(it.id);
        renderGallery();
      });
      card.querySelector('.gc-del').addEventListener('click', (e) => {
        e.stopPropagation();
        openConfirm('Delete "' + it.name + '"? This cannot be undone.', () => {
          Gallery.remove(it.id);
          renderGallery();
        });
      });
      grid.appendChild(card);
    }
  }

  // ---------- Mode-specific controls ----------
  // Populate the mode-specific section for the active mode only.
  function renderModeSpecific() {
    const section = $('mode-specific');
    const body = $('mode-specific-body');
    const title = $('mode-specific-title');
    if (!section || !body) return;
    const mode = Fractals.get(State.get().mode);
    if (!mode) {
      section.hidden = true;
      return;
    }

    body.innerHTML = '';
    const addSlider = (id, label, min, max, step, value, onInput, fmt) => {
      const row = document.createElement('label');
      row.className = 'slider-row';
      const span = document.createElement('span');
      span.className = 'val';
      span.textContent = fmt(value);
      row.appendChild(document.createTextNode(label + ' '));
      row.appendChild(span);
      const input = document.createElement('input');
      input.type = 'range';
      input.id = id;
      input.min = min;
      input.max = max;
      input.step = step;
      input.value = value;
      input.setAttribute('aria-label', label);
      row.appendChild(input);
      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        span.textContent = fmt(v);
        onInput(v);
      });
      body.appendChild(row);
    };
    const addButton = (id, label, onClick) => {
      const btn = document.createElement('button');
      btn.className = 'btn btn-ghost';
      btn.id = id;
      btn.textContent = label;
      btn.addEventListener('click', onClick);
      body.appendChild(btn);
    };

    if (mode.shader === 'MANDELBULB' || mode.shader === 'POWER_BULB') {
      title.textContent = mode.label;
      addSlider(
        'ms-power',
        'Power',
        2,
        16,
        1,
        State.get().power,
        (v) => State.set({ power: v }),
        (v) => String(v)
      );
      addButton('ms-reset-cam', 'Reset camera', () => {
        Camera.setAngle(0);
        Camera.setPitch(mode.camPitch || 0);
        Camera.setOrbitRadius(mode.orbitRadius || 3.0);
        State.set({
          camAngle: 0,
          camPitch: mode.camPitch || 0,
          orbitRadius: mode.orbitRadius || 3.0
        });
      });
    } else if (mode.shader === 'FRACTAL_TREE') {
      title.textContent = mode.label;
      // Reuse the lsystem growth control: more of the canopy is drawn as it rises.
      addSlider(
        'ms-growth',
        'Growth',
        0,
        100,
        1,
        Math.round((State.get().growth || 1) * 100),
        (v) => State.set({ growth: v / 100 }),
        (v) => v + '%'
      );
      addButton('ms-reset-cam', 'Reset camera', () => {
        Camera.setAngle(0);
        Camera.setPitch(mode.camPitch || 0);
        Camera.setOrbitRadius(mode.orbitRadius || 3.0);
        State.set({
          camAngle: 0,
          camPitch: mode.camPitch || 0,
          orbitRadius: mode.orbitRadius || 3.0
        });
      });
    } else if (mode.kind === 'lsystem') {
      title.textContent = mode.label;
      addSlider(
        'ms-growth',
        'Growth',
        0,
        100,
        1,
        Math.round((State.get().growth || 1) * 100),
        (v) => {
          // Touching the slider is a live override: stop the auto-growth pass.
          if (actions.cancelAutoGrow) actions.cancelAutoGrow();
          State.set({ growth: v / 100 });
        },
        (v) => v + '%'
      );
    } else if (mode.shader === 'JULIA') {
      title.textContent = 'Julia Set';
      addSlider(
        'ms-julia',
        'Drift',
        0,
        1000,
        1,
        Math.round((State.get().juliaPhase || 0) * 1000),
        (v) => State.set({ juliaPhase: v / 1000 }),
        (v) => (v / 1000).toFixed(3)
      );
    } else {
      section.hidden = true;
      return;
    }
    section.hidden = false;
  }

  // ---------- Export ----------
  function bindExport() {
    document.querySelectorAll('.export-card').forEach((card) => {
      card.addEventListener('click', () => {
        const res = card.dataset.res;
        if (actions.exportAt) actions.exportAt(res);
      });
    });
  }

  function setExportProgress(pct, status) {
    const fill = $('export-fill');
    const prog = $('export-progress');
    const st = $('export-status');
    if (prog) prog.hidden = false;
    if (fill) fill.style.width = pct + '%';
    if (st) st.textContent = status;
  }

  // ---------- Settings ----------
  function syncSettings() {
    const s = A11y.get();
    const set = (id, v) => {
      const el = $(id);
      if (el) el.checked = !!v;
    };
    set('set-reduced-motion', s.reducedMotion);
    set('set-high-contrast', s.highContrast);
    set('set-adaptive', s.adaptive);
    set('set-keyboard', s.keyboard);
  }

  function bindSettings() {
    const bind = (id, key) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener('change', () => {
        A11y.set({ [key]: el.checked });
        if (actions.onSetting) actions.onSetting(key, el.checked);
      });
    };
    bind('set-reduced-motion', 'reducedMotion');
    bind('set-high-contrast', 'highContrast');
    bind('set-adaptive', 'adaptive');
    bind('set-keyboard', 'keyboard');
    const resetBtn = $('btn-reset');
    if (resetBtn)
      resetBtn.addEventListener('click', () => {
        if (window.confirm('Reset all settings and clear the gallery?')) {
          A11y.reset();
          Gallery.clear();
          syncSettings();
          toast('Settings reset', 'ok');
        }
      });
  }

  // ---------- Init ----------
  function init(a) {
    actions = a || {};
    populateModes();
    populatePalettes();
    updateGradientBar();
    SLIDERS.forEach(bindSlider);
    bindZoomSlider();
    bindButtons();
    bindExport();
    bindSettings();
    syncSliders();
    syncSettings();
    updateStatus();
    // On small screens start with both panels collapsed so the artwork is visible.
    if (isMobileDrawer()) {
      const pm = $('panel-modes');
      if (pm) pm.classList.add('collapsed');
      const pp = $('panel-params');
      if (pp) pp.classList.add('collapsed');
    }
    syncPanelBackdrop();
    // Keep the drawer backdrop in sync when crossing the mobile breakpoint.
    window.addEventListener('resize', syncPanelBackdrop);
    // Show onboarding only on first visit.
    try {
      $('onboarding').hidden = !!localStorage.getItem('fractal-forge:onboarded');
    } catch (e) {
      /* ignore */
    }
  }

  return {
    toast,
    openModal,
    closeModal,
    closeAllModals,
    openSaveModal,
    openConfirm,
    isAnyModalOpen,
    updateStatus,
    updateZoomStatus,
    updateFps,
    populateModes,
    highlightMode,
    populatePalettes,
    highlightPalette,
    updateGradientBar,
    renderGallery,
    setExportProgress,
    syncSliders,
    syncSettings,
    renderModeSpecific,
    init
  };
})();
