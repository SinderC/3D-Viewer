// Display text for PMI items. Lengths come in mm and follow the chosen display unit; angles are degrees.
import type { Model, PmiItem, PmiKind, ToleranceModifier } from './model';
import { formatLength, type UnitId } from './units';

export const PMI_KINDS: Record<PmiKind, string> = {
  dimension: 'Dimensions',
  tolerance: 'Tolerances',
  datum: 'Datums',
  note: 'Notes',
};

// Frame symbol and name of each tolerance modifier (PMI RP Table 14). All around and all over are
// leader symbols, given in words.
const MODIFIERS: Record<ToleranceModifier, [symbol: string, name: string]> = {
  maximumMaterial: ['Ⓜ', 'maximum material'],
  leastMaterial: ['Ⓛ', 'least material'],
  anyCrossSection: ['ACS', 'any cross section'],
  commonZone: ['CZ', 'common zone'],
  eachRadialElement: ['EACH RADIAL ELEMENT', 'each radial element'],
  freeState: ['Ⓕ', 'free state'],
  lineElement: ['LE', 'line element'],
  majorDiameter: ['MD', 'major diameter'],
  minorDiameter: ['LD', 'minor diameter'],
  notConvex: ['NC', 'not convex'],
  pitchDiameter: ['PD', 'pitch diameter'],
  reciprocity: ['Ⓡ', 'reciprocity'],
  separate: ['SEP REQT', 'separate requirement'],
  statistical: ['<ST>', 'statistical'],
  tangentPlane: ['Ⓣ', 'tangent plane'],
  allAround: ['all around', 'all around'],
  allOver: ['all over', 'all over'],
};

// Unknown ids (from a newer producer) show as they are.
const symbol = (m: ToleranceModifier) => MODIFIERS[m]?.[0] ?? m;
const modifierName = (m: ToleranceModifier) => MODIFIERS[m]?.[1] ?? m;

const partition = <T>(list: T[], test: (v: T) => boolean): [T[], T[]] => [list.filter(test), list.filter((v) => !test(v))];

const ZONES = { diameter: 'Ø', spherical: 'SØ' };

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
  if (p.value) return (p.zone ? ZONES[p.zone] : '') + amount(p.value[0], p, unit) + (p.bound ? ` ${p.bound}` : '');
  return undefined;
}

/** One-line label for lists: type, value and datums; the name for items without a value (notes, JT PMI). */
export function pmiLabel(p: PmiItem, unit: UnitId): string {
  if (p.kind === 'datum') return p.type;
  if (p.kind === 'note' || !(p.value || p.range)) return p.name || p.type;
  const per = perUnit(p, unit);
  // Frame order: value, unequal displacement, unit basis, material modifier and its maximum, other
  // modifiers, projected zone
  const [material, others] = partition(p.modifiers ?? [], (m) => m === 'maximumMaterial' || m === 'leastMaterial');
  const parts = [
    p.type,
    nominal(p, unit),
    p.unequal && `Ⓤ ${formatLength(p.unequal[0], unit)}`,
    per && `/ ${per}`,
    ...material.map(symbol),
    p.maxValue && `${formatLength(p.maxValue[0], unit)} max`,
    ...others.map(symbol),
    p.projected && `Ⓟ ${formatLength(p.projected[0], unit)}`,
    deviation(p, unit),
    p.datums?.length ? `| ${p.datums.join(' | ')}` : undefined,
  ];
  return parts.filter(Boolean).join(' ');
}

export type ElementKind = 'face' | 'edge' | 'vertex';

/** A B-rep face, edge or vertex of a part instance: an index into its prototype's faceStarts, edgeStarts or vertices. */
export interface ElementRef {
  node: number;
  kind: ElementKind;
  index: number;
}

// Where PmiItem keeps the references to each kind: for part PMI, and per instance for assembly PMI.
const LISTS = {
  face: ['faces', 'nodeFaces'],
  edge: ['edges', 'nodeEdges'],
  vertex: ['vertices', 'nodeVertices'],
} as const;
const KINDS = Object.keys(LISTS) as ElementKind[];

/** The elements an item refers to: on every instance of its part, or for assembly PMI, on the instances it names. */
export function pmiElements(model: Model, p: PmiItem): ElementRef[] {
  const out: ElementRef[] = [];
  for (const kind of KINDS) {
    const [list, nodeList] = LISTS[kind];
    if (p.nodes) for (const [, node, ...indices] of p[nodeList] ?? []) for (const index of indices) out.push({ node, kind, index });
    else if (p.proto >= 0)
      for (const n of model.nodes) if (n.proto === p.proto) for (const index of p[list]) out.push({ node: n.id, kind, index });
  }
  return out;
}

/** Whether an item refers to the element. */
export function refersTo(model: Model, p: PmiItem, e: ElementRef): boolean {
  const [list, nodeList] = LISTS[e.kind];
  if (p.nodes) return !!p[nodeList]?.some(([, node, ...indices]) => node === e.node && indices.includes(e.index));
  return p.proto >= 0 && p.proto === model.nodes[e.node]?.proto && p[list].includes(e.index);
}

/** Elements of a kind the item refers to; for assembly PMI, under the first instance of its assembly. */
const count = (p: PmiItem, kind: ElementKind) => {
  const [list, nodeList] = LISTS[kind];
  return p.nodes
    ? (p[nodeList] ?? []).filter(([owner]) => owner === p.nodes![0]).reduce((n, [, , ...indices]) => n + indices.length, 0)
    : p[list].length;
};

/** Label/value rows for the info panel. */
export function pmiInfo(p: PmiItem, unit: UnitId): [string, string][] {
  const rows: [string, string | undefined][] = [
    ['Kind', PMI_KINDS[p.kind].replace(/s$/, '')],
    ['Type', p.type],
    ['Name', p.name || undefined],
    [p.range ? 'Limits' : p.bound ? 'Limit' : p.kind === 'tolerance' ? 'Tolerance' : 'Nominal', nominal(p, unit)],
    ['Deviation', deviation(p, unit)],
    ['Per unit', p.perUnit && `${perUnit(p, unit)} ${p.unitArea ? 'area' : 'length'}`],
    ['Modifiers', p.modifiers?.map(modifierName).join(', ') || undefined],
    ['Unequally disposed', p.unequal && formatLength(p.unequal[0], unit)],
    ['Projected zone', p.projected && formatLength(p.projected[0], unit)],
    ['Zone angle', p.runout && `${+p.runout[0].toFixed(4)}°`],
    ['Maximum', p.maxValue && formatLength(p.maxValue[0], unit)],
    ['Datums', p.datums?.join(', ') || undefined],
    ['Faces', count(p, 'face') ? String(count(p, 'face')) : undefined],
    ['Edges', count(p, 'edge') ? String(count(p, 'edge')) : undefined],
    ['Vertices', count(p, 'vertex') ? String(count(p, 'vertex')) : undefined],
  ];
  return rows.filter((r): r is [string, string] => r[1] !== undefined);
}
