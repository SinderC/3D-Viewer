// Loads every supported model file under samples/ through the WASM bridge and reports per-file stats.
// Usage: node wasm/test/smoke.mjs [dir-or-file ...]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import createOcctViewer from '../build/occt-viewer.js';
import { isSupported, readerOf } from '../../web/src/core/formats.ts';

const root = new URL('../../samples', import.meta.url).pathname;
const targets = process.argv.length > 2 ? process.argv.slice(2) : [root];

function* modelFiles(p) {
  if (statSync(p).isDirectory()) {
    for (const e of readdirSync(p).sort()) yield* modelFiles(join(p, e));
  } else if (isSupported(p) && readerOf(p) === 'occt') { // glTF is read by three.js in the browser
    yield p;
  }
}

function apOf(schema) {
  if (/AP242/i.test(schema)) return 'AP242';
  if (/AUTOMOTIVE_DESIGN/i.test(schema)) return 'AP214';
  if (/AP203|CONFIG_CONTROL_DESIGN/i.test(schema)) return 'AP203';
  return '?';
}

// Fraction of mesh edges (after welding coincident vertices, ignoring zero-area triangles)
// not shared by exactly two triangles.
// Section caps need closed meshes, so this should be ~0 for solids.
function openEdgeRatio(geometry, proto) {
  const pos = new Float32Array(geometry, proto.positions[0], proto.positions[1]);
  const idx = new Uint32Array(geometry, proto.indices[0], proto.indices[1]);
  const weld = new Map();
  const id = (i) => {
    const key = `${pos[i * 3]},${pos[i * 3 + 1]},${pos[i * 3 + 2]}`;
    if (!weld.has(key)) weld.set(key, weld.size);
    return weld.get(key);
  };
  const ids = Array.from(idx, id);
  const edges = new Map();
  for (let t = 0; t < ids.length; t += 3) {
    if (ids[t] === ids[t + 1] || ids[t + 1] === ids[t + 2] || ids[t + 2] === ids[t]) continue; // zero-area
    for (const [a, b] of [[ids[t], ids[t + 1]], [ids[t + 1], ids[t + 2]], [ids[t + 2], ids[t]]]) {
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const n of edges.values()) if (n !== 2) open++;
  return edges.size ? open / edges.size : 0;
}

// Face / edge measurement arrays must line up with the triangles and segments they describe.
function measureStats(geometry, protos) {
  let planes = 0;
  let circles = 0;
  let measureOk = true;
  for (const p of protos) {
    const faceStarts = new Uint32Array(geometry, p.faceStarts[0], p.faceStarts[1]);
    const faceData = new Float64Array(geometry, p.faceData[0], p.faceData[1]);
    const edgeStarts = new Uint32Array(geometry, p.edgeStarts[0], p.edgeStarts[1]);
    const edgeData = new Float64Array(geometry, p.edgeData[0], p.edgeData[1]);
    measureOk &&= faceData.length === faceStarts.length * 7 && edgeData.length === edgeStarts.length * 9;
    measureOk &&= faceStarts[0] === 0 && (edgeStarts.length === 0 || edgeStarts[0] === 0);
    for (let i = 0; i < faceData.length; i += 7) if (faceData[i] === 1) planes++;
    for (let i = 0; i < edgeData.length; i += 9) {
      if (edgeData[i] === 2) circles++;
      measureOk &&= edgeData[i + 1] > 0;
    }
  }
  return { planes, circles, measureOk };
}

// Validation checks passed / made, as in web/src/core/product.ts: the file's volume, area and
// centroid within 0.1 %, and its stated PMI and view counts.
function validation(model) {
  const checks = [];
  for (const { volume, area, centroid } of model.products) {
    for (const [file, computed] of [volume, area].filter(Boolean)) if (computed !== undefined) checks.push(Math.abs(computed - file) <= 0.001 * file);
    if (centroid?.length === 6 && volume) {
      const d = Math.hypot(centroid[0] - centroid[3], centroid[1] - centroid[4], centroid[2] - centroid[5]);
      checks.push(d <= 0.001 * Math.cbrt(volume[0]));
    }
  }
  const { annotations, views } = model.counts;
  if (annotations !== undefined) checks.push(model.pmi.length === annotations);
  if (views !== undefined) checks.push(model.views.length === views);
  return checks.length ? `${checks.filter(Boolean).length}/${checks.length}` : '';
}

const occt = await createOcctViewer();
const rows = [];
let failed = 0;

for (const target of targets) {
  for (const file of modelFiles(target)) {
    const t0 = performance.now();
    const res = occt.readModel(readFileSync(file), basename(file), {}, undefined);
    const ms = Math.round(performance.now() - t0);
    const row = { file: basename(file), ms };
    if (res.error) {
      Object.assign(row, { status: 'FAIL', note: res.error });
    } else {
      const model = JSON.parse(res.json);
      const geometry = res.geometry.slice().buffer;
      const tris = model.protos.reduce((n, p) => n + p.indices[1] / 3, 0);
      const edges = model.protos.reduce((n, p) => n + p.edges[1] / 6, 0);
      const { planes, circles, measureOk } = measureStats(geometry, model.protos);
      const valid = validation(model);
      const [passed, checked = passed] = valid.split('/');
      const ok = tris > 0 && model.nodes.length > 0 && res.geometry.byteLength > 0 && measureOk && passed === checked;
      Object.assign(row, {
        status: ok ? 'ok' : 'FAIL',
        format: model.format === 'STEP' ? `STEP ${apOf(model.schema)}` : model.format,
        unit: model.fileUnit,
        nodes: model.nodes.length,
        protos: model.protos.length,
        tris,
        edges,
        colors: model.colors.length,
        planes,
        circles,
        pmi: model.pmi.length,
        views: model.views.length,
        valid,
        open: model.protos.map((p) => (openEdgeRatio(geometry, p) * 100).toFixed(1) + '%').join(' '),
      });
    }
    if (row.status !== 'ok') failed++;
    rows.push(row);
  }
}

console.table(rows);
console.log(`${rows.length - failed}/${rows.length} passed`);
process.exit(failed ? 1 : 0);
