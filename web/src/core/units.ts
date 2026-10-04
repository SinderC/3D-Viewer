// Display units for lengths. Geometry from the bridge is always in millimetres.

export type UnitId = 'mm' | 'cm' | 'm' | 'in' | 'ft' | 'ft-in';

export const UNITS: Record<UnitId, { label: string; perMm: number; digits: number }> = {
  mm: { label: 'mm', perMm: 1, digits: 3 },
  cm: { label: 'cm', perMm: 0.1, digits: 4 },
  m: { label: 'm', perMm: 0.001, digits: 6 },
  in: { label: 'in', perMm: 1 / 25.4, digits: 4 },
  ft: { label: 'ft', perMm: 1 / 304.8, digits: 5 },
  'ft-in': { label: 'ft-in', perMm: 1 / 25.4, digits: 0 },
};

// OCCT reports STEP unit names such as "MILLIMETRE", "INCH", "METRE", "CENTIMETRE", "FOOT".
export function fileUnit(name: string): UnitId {
  const n = name.toUpperCase();
  if (n.includes('INCH')) return 'in';
  if (n.includes('FOOT')) return 'ft';
  if (n.includes('CENTI')) return 'cm';
  if (n.includes('MILLI')) return 'mm';
  if (n.includes('METRE') || n.includes('METER')) return 'm';
  return 'mm';
}

export function formatLength(mm: number, unit: UnitId): string {
  if (unit === 'ft-in') return formatFeetInches(mm);
  const u = UNITS[unit];
  return `${(mm * u.perMm).toFixed(u.digits)} ${u.label}`;
}

// Architectural style, rounded to 1/16": 3' 4 9/16"
function formatFeetInches(mm: number): string {
  const sixteenths = Math.round((Math.abs(mm) / 25.4) * 16);
  const feet = Math.floor(sixteenths / (12 * 16));
  const inches = Math.floor(sixteenths / 16) % 12;
  let num = sixteenths % 16;
  let den = 16;
  while (num && num % 2 === 0) {
    num /= 2;
    den /= 2;
  }
  const frac = num ? `${num}/${den}` : '';
  const inchPart = `${inches || !frac ? inches : ''}${inches && frac ? ' ' : ''}${frac}"`;
  return `${mm < 0 ? '-' : ''}${feet ? `${feet}' ` : ''}${inchPart}`;
}
