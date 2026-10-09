// Properties panel rows checking a part's validation properties (ISO 10303-203 Amd 1)
// against the geometry as loaded.
import type { Product } from './model';
import { UNITS, type UnitId } from './units';

/** Relative difference a validation property may have from the loaded geometry. */
export const TOLERANCE = 0.001;

type Dim = 1 | 2 | 3;
export type Row = [label: string, value: string, title?: string];

const mark = (ok: boolean) => (ok ? '✓' : '✗');
const unitOf = (unit: UnitId) => UNITS[unit === 'ft-in' ? 'in' : unit];
const label = (unit: UnitId, dim: Dim) => unitOf(unit).label + ['', '', '²', '³'][dim];
const number = (mm: number, unit: UnitId, dim: Dim) =>
  (mm * unitOf(unit).perMm ** dim).toLocaleString('en-US', { maximumSignificantDigits: 7 });

/** A length, area (dim 2) or volume (dim 3) given in mm^dim, in the display unit. */
export function formatMeasure(mm: number, unit: UnitId, dim: Dim): string {
  return `${number(mm, unit, dim)} ${label(unit, dim)}`;
}

/** Extents along X, Y and Z, e.g. "120 × 80 × 25 mm". */
export function formatSize(size: number[], unit: UnitId): string {
  return `${size.map((v) => number(v, unit, 1)).join(' × ')} ${label(unit, 1)}`;
}

const notComputed = (stated: string) => `${stated} in the file; not computed for tessellated geometry`;

// The stated value after its check mark (first, so a long value cannot hide it); the tooltip has
// both values and their difference.
function measureRow(name: string, [file, computed]: [number, number?], unit: UnitId, dim: 2 | 3): Row {
  const stated = formatMeasure(file, unit, dim);
  if (computed === undefined) return [name, stated, notComputed(stated)];
  const diff = file ? (computed - file) / file : computed;
  const pct = `${diff >= 0 ? '+' : ''}${(diff * 100).toFixed(4)} %`;
  return [name, `${mark(Math.abs(diff) <= TOLERANCE)} ${stated}`, `File ${stated}, computed ${formatMeasure(computed, unit, dim)} (${pct})`];
}

// Checked against a length typical of the part: the cube root of its volume.
function centroidRow(c: number[], volume: number | undefined, unit: UnitId): Row {
  const point = (p: number[]) => `${p.map((v) => number(v, unit, 1)).join(', ')} ${label(unit, 1)}`;
  const stated = point(c.slice(0, 3));
  if (c.length < 6) return ['Centroid', stated, notComputed(stated)];
  const distance = Math.hypot(c[0] - c[3], c[1] - c[4], c[2] - c[5]);
  const verdict = volume ? `${mark(distance <= TOLERANCE * Math.cbrt(volume))} ` : '';
  return ['Centroid', verdict + stated, `File ${stated}, computed ${point(c.slice(3))} (${formatMeasure(distance, unit, 1)} apart)`];
}

/** Rows checking the part's validation properties: volume, surface area and centroid. */
export function validationInfo(p: Product, unit: UnitId): Row[] {
  const rows: Row[] = [];
  if (p.volume) rows.push(measureRow('Volume', p.volume, unit, 3));
  if (p.area) rows.push(measureRow('Surface area', p.area, unit, 2));
  if (p.centroid) rows.push(centroidRow(p.centroid, p.volume?.[0], unit));
  return rows;
}

/** How many rows failed their check, or undefined when no row was checked. */
export function failures(rows: Row[]): number | undefined {
  const checked = rows.filter(([, value]) => value.startsWith(`${mark(true)} `) || value.startsWith(`${mark(false)} `));
  return checked.length ? checked.filter(([, value]) => value.startsWith(mark(false))).length : undefined;
}

/** Value and tooltip for a count loaded from the file, checked against the count the file states. */
export function countInfo(loaded: number, stated: number): [string, string] {
  return [`${mark(loaded === stated)} ${loaded}`, `The file states ${stated}`];
}
