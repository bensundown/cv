/**
 * Source provenance and verification model.
 *
 * Every fact the system uses (a dimension, a quantity, a spec value, a venue
 * height) carries a confidence status and a source. Derived values inherit
 * the WEAKEST status of their inputs. See docs/05-provenance-model.md.
 */

export const CONFIDENCE_ORDER = ['VERIFIED', 'PROVISIONAL', 'ESTIMATED', 'UNKNOWN'] as const;
export type Confidence = (typeof CONFIDENCE_ORDER)[number];

export type SourceKind =
  | 'inventory_file' // a cell in an uploaded inventory snapshot
  | 'user_confirmation' // a named user attested to the value
  | 'user_entry' // a user typed the value (not necessarily verified)
  | 'manufacturer_doc' // manufacturer datasheet / manual
  | 'venue_doc' // official venue technical document
  | 'calibrated_plan' // measured from a scale-calibrated drawing
  | 'brief' // client brief
  | 'name_parse' // parsed from an inventory product name (hint only)
  | 'design_default' // a design rule-of-thumb chosen by the system
  | 'derived'; // calculated from other sourced values

export interface Source {
  kind: SourceKind;
  /** Human-readable reference (RMS ID, file name, page number, user email). */
  ref?: string;
  url?: string;
  documentDate?: string;
  licence?: string;
  note?: string;
}

export interface Sourced<T> {
  value: T | null;
  status: Confidence;
  source: Source;
  /** Unit of `value` when numeric. Internal lengths are always 'mm'. */
  unit?: string;
  /** Measurement uncertainty (±, same unit) where known. */
  tolerance?: number;
}

export function rank(c: Confidence): number {
  return CONFIDENCE_ORDER.indexOf(c);
}

/** The weakest (least certain) of the given statuses. Empty input → UNKNOWN. */
export function weakest(...statuses: Confidence[]): Confidence {
  if (statuses.length === 0) return 'UNKNOWN';
  return statuses.reduce((a, b) => (rank(b) > rank(a) ? b : a), 'VERIFIED' as Confidence);
}

export function sourced<T>(value: T | null, status: Confidence, source: Source, unit?: string): Sourced<T> {
  if (value === null || value === undefined) {
    return { value: null, status: 'UNKNOWN', source, ...(unit ? { unit } : {}) };
  }
  return { value, status, source, ...(unit ? { unit } : {}) };
}

export function unknown<T>(note: string, unit?: string): Sourced<T> {
  return { value: null, status: 'UNKNOWN', source: { kind: 'derived', note }, ...(unit ? { unit } : {}) };
}

export function isKnown<T>(s: Sourced<T> | undefined | null): s is Sourced<T> & { value: T } {
  return !!s && s.value !== null && s.value !== undefined && s.status !== 'UNKNOWN';
}

/** Combine sourced numeric inputs into a derived value with the weakest status. */
export function derive<T>(
  inputs: Sourced<unknown>[],
  compute: () => T,
  note: string,
  unit?: string,
): Sourced<T> {
  if (inputs.some((i) => !isKnown(i))) return unknown<T>(`Cannot compute: ${note} (missing input)`, unit);
  return {
    value: compute(),
    status: weakest(...inputs.map((i) => i.status)),
    source: { kind: 'derived', note },
    ...(unit ? { unit } : {}),
  };
}
