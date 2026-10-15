/* Loads the app's ES module graph (entry: script.js) and concatenates the
   files in dependency order with import/export syntax stripped, so the
   vm-based harnesses (functional/smoke/glsl-check) can run the real app
   source in a single script scope.

   The module style this relies on (keep it when editing src/*.js and
   script.js): imports are single-line `import { X } from './y.js';`, and
   exports are `export const X = ...` or `export { ... };`. */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function importSpecifiers(src) {
  const out = [];
  const re = /^\s*import\s+[\s\S]*?from\s+['"]([^'"]+)['"];?\s*$/gm;
  let m;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  return out;
}

function stripEsm(src) {
  return src
    .split('\n')
    .filter((line) => !/^\s*import\s/.test(line) && !/^\s*export\s*\{/.test(line))
    .map((line) => line.replace(/^export\s+/, ''))
    .join('\n');
}

function resolveSpec(fromRel, spec) {
  const base = path.posix.dirname(fromRel);
  return path.posix.normalize(base + '/' + spec.replace(/^\.\//, ''));
}

function loadAppSource(entry) {
  const seen = new Set();
  const parts = [];
  (function visit(rel) {
    if (seen.has(rel)) return;
    seen.add(rel);
    const src = read(rel);
    for (const spec of importSpecifiers(src)) visit(resolveSpec(rel, spec));
    parts.push(stripEsm(src));
  })(entry);
  return parts.join('\n;\n');
}

module.exports = { loadAppSource };
