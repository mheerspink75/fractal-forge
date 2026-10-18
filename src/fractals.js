/* ============================================================
   Fractals — mode registry + per-mode parameter sets
   ============================================================ */
export const Fractals = (() => {
  // Each mode maps to a shader source and a default parameter set.
  // `group` drives the left-panel grouping; `kind` drives the render path.
  const MODES = {
    mandelbrot: {
      label: 'Mandelbrot',
      group: 'classic',
      kind: 'gpu',
      shader: 'MANDELBROT',
      center: [-0.6, 0.0],
      span: 3.2,
      iterations: 256
    },
    julia: {
      label: 'Julia Set',
      group: 'classic',
      kind: 'gpu',
      shader: 'JULIA',
      center: [0.0, 0.0],
      span: 3.4,
      iterations: 256
    },
    burningShip: {
      label: 'Burning Ship',
      group: 'classic',
      kind: 'gpu',
      shader: 'BURNING_SHIP',
      center: [-0.5, 0.0],
      span: 3.4,
      iterations: 256
    },
    newton: {
      label: 'Newton',
      group: 'classic',
      kind: 'gpu',
      shader: 'NEWTON',
      center: [0.0, 0.0],
      span: 3.0,
      iterations: 64
    },
    sierpinski: {
      label: 'Sierpinski',
      group: 'classic',
      kind: 'gpu',
      shader: 'SIERPINSKI',
      center: [0.0, 0.0],
      span: 2.4,
      iterations: 256
    },
    cosmicNebula: {
      label: 'Cosmic Nebula',
      group: 'experimental',
      kind: 'gpu',
      shader: 'COSMIC_NEBULA',
      center: [0.0, 0.0],
      span: 2.0,
      iterations: 256
    },
    dreamscape: {
      label: 'Dreamscape',
      group: 'experimental',
      kind: 'gpu',
      shader: 'DREAMSCAPE',
      center: [0.0, 0.0],
      span: 2.0,
      iterations: 256
    },
    neuralBloom: {
      label: 'Neural Bloom',
      group: 'experimental',
      kind: 'gpu',
      shader: 'NEURAL_BLOOM',
      center: [0.0, 0.0],
      span: 2.0,
      iterations: 256
    },
    quantumField: {
      label: 'Quantum Field',
      group: 'experimental',
      kind: 'gpu',
      shader: 'QUANTUM_FIELD',
      center: [0.0, 0.0],
      span: 2.0,
      iterations: 256
    },
    koch: {
      label: 'Koch Snowflake',
      group: 'structural',
      kind: 'lsystem',
      lsystem: 'koch',
      center: [0.0, 0.0],
      span: 2.0,
      iterations: 256
    },
    dragon: {
      label: 'Dragon Curve',
      group: 'structural',
      kind: 'lsystem',
      lsystem: 'dragon',
      center: [0.0, 0.0],
      span: 2.0,
      iterations: 256
    },
    tree: {
      label: 'Fractal Tree',
      group: 'structural',
      kind: 'lsystem',
      lsystem: 'tree',
      center: [0.0, 0.0],
      span: 2.0,
      iterations: 256
    },
    plant: {
      label: 'Plant Growth',
      group: 'structural',
      kind: 'lsystem',
      lsystem: 'plant',
      center: [0.0, 0.0],
      span: 2.0,
      iterations: 256
    },
    mandelbulb: {
      label: 'Mandelbulb',
      group: '3d',
      kind: 'gpu3d',
      shader: 'MANDELBULB',
      center: [0.0, 0.0],
      span: 2.0,
      iterations: 256,
      power: 8
    },
    fractalTree3d: {
      label: 'Fractal Tree 3D',
      group: '3d',
      kind: 'gpu3d',
      shader: 'FRACTAL_TREE',
      center: [0.0, 0.0],
      span: 2.0,
      iterations: 256,
      // The tree is taller/narrower than the bulb; frame it a touch closer so
      // the canopy fills the view at both fresh seeds (In-frame requirement).
      orbitRadius: 2.4
    },
    powerBulb: {
      label: 'Power Bulb',
      group: '3d',
      kind: 'gpu3d',
      shader: 'POWER_BULB',
      center: [0.0, 0.0],
      span: 2.0,
      iterations: 256,
      // Classic bulb silhouette (p=3) is the default exponent; the Power
      // slider (2–16) drives it. Framed at the standard 3D orbit radius.
      power: 3,
      orbitRadius: 3.0
    }
  };

  const ORDER = [
    'mandelbrot',
    'julia',
    'burningShip',
    'newton',
    'sierpinski',
    'cosmicNebula',
    'dreamscape',
    'neuralBloom',
    'quantumField',
    'koch',
    'dragon',
    'tree',
    'plant',
    'mandelbulb',
    'fractalTree3d',
    'powerBulb'
  ];

  function get(id) {
    return MODES[id];
  }
  function list(group) {
    return ORDER.filter((id) => MODES[id].group === group);
  }

  return { MODES, ORDER, get, list };
})();
