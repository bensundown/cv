/**
 * Units. All internal lengths are millimetres (number). Conversion happens only
 * at import/export boundaries, through the functions in this file.
 */

export type Mm = number;

export const MM_PER_M = 1000;
export const MM_PER_INCH = 25.4;
export const MM_PER_FOOT = 304.8;
export const MM_PER_PDF_POINT = 25.4 / 72;

const UNIT_FACTORS: Record<string, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: MM_PER_INCH,
  '"': MM_PER_INCH,
  ft: MM_PER_FOOT,
  "'": MM_PER_FOOT,
};

export function toMm(value: number, unit: keyof typeof UNIT_FACTORS | string): Mm {
  const f = UNIT_FACTORS[unit.toLowerCase()];
  if (f === undefined) throw new Error(`Unsupported length unit: ${unit}`);
  return value * f;
}

export function fromMm(mm: Mm, unit: string): number {
  const f = UNIT_FACTORS[unit.toLowerCase()];
  if (f === undefined) throw new Error(`Unsupported length unit: ${unit}`);
  return mm / f;
}

/** Parse a length such as "12 m", "500mm", "3.5m", "10'" into mm. Bare numbers need a default unit. */
export function parseLength(text: string, defaultUnit?: string): Mm | null {
  const m = text.trim().match(/^(-?\d+(?:[.,]\d+)?)\s*(mm|cm|m|in|ft|"|')?$/i);
  if (!m) return null;
  const n = Number(m[1]!.replace(',', '.'));
  const unit = m[2] ?? defaultUnit;
  if (!unit) return null;
  return toMm(n, unit);
}

/** Format mm as metres for display, never with more precision than given. */
export function fmtM(mm: Mm, decimals = 2): string {
  return `${(mm / 1000).toFixed(decimals)} m`;
}

export function fmtMm(mm: Mm): string {
  return `${Math.round(mm)} mm`;
}

/** Round to a stated precision (mm) to avoid claiming precision beyond the source. */
export function roundTo(mm: Mm, precisionMm: number): Mm {
  return Math.round(mm / precisionMm) * precisionMm;
}

/** Tolerance used when comparing lengths that should be integer multiples (floating point slack). */
export const LENGTH_EPSILON_MM = 0.5;

export function isMultiple(total: Mm, unit: Mm, eps = LENGTH_EPSILON_MM): boolean {
  if (unit <= 0) return false;
  const n = Math.round(total / unit);
  return n >= 1 && Math.abs(n * unit - total) <= eps;
}
