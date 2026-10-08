// Display text for PMI items. Lengths come in mm and follow the chosen display unit; angles are degrees.
import type { PmiItem, PmiKind } from './model';
import { formatLength, type UnitId } from './units';

export const PMI_KINDS: Record<PmiKind, string> = {
  dimension: 'Dimensions',
  tolerance: 'Tolerances',
  datum: 'Datums',
  note: 'Notes',
};

function amount(v: number, p: PmiItem, unit: UnitId): string {
  return p.angular ? `${+v.toFixed(4)}°` : formatLength(v, unit);
}

// Tolerance deviations as given: the lower one is a magnitude below nominal.
function deviation(p: PmiItem, unit: UnitId): string | undefined {
  if (!p.plusMinus) return undefined;
  const [lower, upper] = p.plusMinus.map(Math.abs);
  return lower === upper ? `± ${amount(upper, p, unit)}` : `+${amount(upper, p, unit)} / −${amount(lower, p, unit)}`;
}

// The length or area a tolerance applies per: 15 mm, Ø25 mm, 10 mm × 20 mm.
function perUnit(p: PmiItem, unit: UnitId): string | undefined {
  if (!p.perUnit) return undefined;
  const [a, b = a] = p.perUnit.map((v) => formatLength(v, unit));
  if (p.unitArea === 'circular') return `Ø${a}`;
  if (p.unitArea === 'square') return `${a} × ${a}`;
  if (p.unitArea === 'rectangular') return `${a} × ${b}`;
  return a;
}

function nominal(p: PmiItem, unit: UnitId): string | undefined {
  if (p.range) return `${amount(p.range[0], p, unit)} – ${amount(p.range[1], p, unit)}`;
  if (p.value) return amount(p.value[0], p, unit);
  return undefined;
}

/** One-line label for lists: type, value and datums; the name for items without a value (notes, JT PMI). */
export function pmiLabel(p: PmiItem, unit: UnitId): string {
  if (p.kind === 'datum') return p.type;
  if (p.kind === 'note' || !(p.value || p.range)) return p.name || p.type;
  const per = perUnit(p, unit);
  const parts = [
    p.type,
    nominal(p, unit),
    per && `/ ${per}`,
    deviation(p, unit),
    p.datums?.length ? `| ${p.datums.join(' | ')}` : undefined,
  ];
  return parts.filter(Boolean).join(' ');
}

/** Label/value rows for the info panel. */
export function pmiInfo(p: PmiItem, unit: UnitId): [string, string][] {
  const rows: [string, string | undefined][] = [
    ['Kind', PMI_KINDS[p.kind].replace(/s$/, '')],
    ['Type', p.type],
    ['Name', p.name || undefined],
    [p.range ? 'Limits' : p.kind === 'tolerance' ? 'Tolerance' : 'Nominal', nominal(p, unit)],
    ['Deviation', deviation(p, unit)],
    ['Per unit', p.perUnit && `${perUnit(p, unit)} ${p.unitArea ? 'area' : 'length'}`],
    ['Datums', p.datums?.join(', ') || undefined],
    ['Faces', p.faces.length ? String(p.faces.length) : undefined],
  ];
  return rows.filter((r): r is [string, string] => r[1] !== undefined);
}
