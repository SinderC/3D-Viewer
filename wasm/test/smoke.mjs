// Loads every STEP file under samples/ through the WASM bridge and reports per-file stats.
// Usage: node wasm/test/smoke.mjs [dir-or-file ...]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import createOcctViewer from '../build/occt-viewer.js';

const root = new URL('../../samples', import.meta.url).pathname;
const targets = process.argv.length > 2 ? process.argv.slice(2) : [root];

function* stepFiles(p) {
  if (statSync(p).isDirectory()) {
    for (const e of readdirSync(p).sort()) yield* stepFiles(join(p, e));
  } else if (/^\.(stp|step)$/i.test(extname(p))) {
    yield p;
  }
}

function apOf(schema) {
  if (/AP242/i.test(schema)) return 'AP242';
  if (/AUTOMOTIVE_DESIGN/i.test(schema)) return 'AP214';
  if (/AP203|CONFIG_CONTROL_DESIGN/i.test(schema)) return 'AP203';
  return '?';
}

const occt = await createOcctViewer();
const rows = [];
let failed = 0;

for (const target of targets) {
  for (const file of stepFiles(target)) {
    const t0 = performance.now();
    const res = occt.readStep(readFileSync(file), {}, undefined);
    const ms = Math.round(performance.now() - t0);
    const row = { file: basename(file), ms };
    if (res.error) {
      Object.assign(row, { status: 'FAIL', note: res.error });
    } else {
      const model = JSON.parse(res.json);
      const tris = model.protos.reduce((n, p) => n + p.indices[1] / 3, 0);
      const edges = model.protos.reduce((n, p) => n + p.edges[1] / 6, 0);
      const ok = tris > 0 && model.nodes.length > 0 && res.geometry.byteLength > 0;
      Object.assign(row, {
        status: ok ? 'ok' : 'FAIL',
        ap: apOf(model.schema),
        unit: model.fileUnit,
        nodes: model.nodes.length,
        protos: model.protos.length,
        tris,
        edges,
        colors: model.colors.length,
      });
    }
    if (row.status !== 'ok') failed++;
    rows.push(row);
  }
}

console.table(rows);
console.log(`${rows.length - failed}/${rows.length} passed`);
process.exit(failed ? 1 : 0);
