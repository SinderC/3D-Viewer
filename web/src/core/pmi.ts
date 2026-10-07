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

function nominal(p: PmiItem, unit: UnitId): string | undefined {
  if (p.range) return `${amount(p.range[0], p, unit)} – ${amount(p.range[1], p, unit)}`;
  if (p.value) return amount(p.value[0], p, unit);
  return undefined;
}

/** One-line label for lists: type, value and datums. */
export function pmiLabel(p: PmiItem, unit: UnitId): string {
  if (p.kind === 'datum') return p.type;
  if (p.kind === 'note') return p.name || p.type;
  const parts = [p.type, nominal(p, unit), deviation(p, unit), p.datums?.length ? `| ${p.datums.join(' | ')}` : undefined];
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
    ['Datums', p.datums?.join(', ') || undefined],
    ['Faces', p.faces.length ? String(p.faces.length) : undefined],
  ];
  return rows.filter((r): r is [string, string] => r[1] !== undefined);
}
