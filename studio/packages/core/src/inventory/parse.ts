/**
 * Inventory file parsing: header detection, column mapping, value parsing and
 * data-quality issues. Pure functions over a 2D array of cell values so the
 * same logic applies to XLSX and CSV. Original cell values are always kept.
 */

export type CanonicalField = 'rmsId' | 'product' | 'productGroup' | 'qtyShown' | 'rentalRate' | 'chargePeriod' | 'dataFlag';

export const REQUIRED_FIELDS: CanonicalField[] = ['product'];

/** Normalised header → field. Normalisation: lowercase, strip everything except a–z0–9. */
const HEADER_SYNONYMS: Record<CanonicalField, string[]> = {
  rmsId: ['rmsid', 'rmsproductid', 'productid', 'id', 'rms'],
  product: ['product', 'productname', 'name', 'item', 'itemname', 'description', 'equipment'],
  productGroup: ['productgroup', 'group', 'category', 'productcategory'],
  qtyShown: ['qtyshown', 'qtyshownavailabletorent', 'qty', 'quantity', 'available', 'availabletorent', 'qtyavailable', 'stock', 'qtyowned'],
  rentalRate: ['rentalrater', 'rentalrate', 'rate', 'rentalratezar', 'price', 'rentalprice'],
  chargePeriod: ['chargeperiod', 'period', 'rateperiod'],
  dataFlag: ['dataflag', 'flag', 'flags', 'notes', 'note'],
};

export const normHeader = (h: unknown): string =>
  String(h ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

export interface ColumnMapping {
  headerRowIndex: number; // 0-based index in the rows array
  fields: Partial<Record<CanonicalField, number>>; // field → column index
  headers: string[]; // original header strings
  unmappedColumns: { index: number; header: string }[];
  /** Currency inferred from the rate header, e.g. "Rental rate (R)" → ZAR. */
  currency: string | null;
}

function matchField(header: string): CanonicalField | null {
  const n = normHeader(header);
  if (!n) return null;
  for (const [field, syns] of Object.entries(HEADER_SYNONYMS) as [CanonicalField, string[]][]) {
    if (syns.includes(n)) return field;
  }
  // Prefix match for verbose headers such as "Qty shown ('available to rent')".
  if (n.startsWith('qtyshown') || n.startsWith('quantity')) return 'qtyShown';
  if (n.startsWith('rentalrate')) return 'rentalRate';
  if (n.startsWith('rmsid')) return 'rmsId';
  if (n.startsWith('productgroup')) return 'productGroup';
  if (n.startsWith('chargeperiod')) return 'chargePeriod';
  if (n.startsWith('dataflag')) return 'dataFlag';
  return null;
}

/** Scan the first rows for the best header row. */
export function detectColumns(rows: unknown[][], scanRows = 25): ColumnMapping | null {
  let best: ColumnMapping | null = null;
  let bestScore = 0;
  for (let r = 0; r < Math.min(rows.length, scanRows); r++) {
    const row = rows[r] ?? [];
    const fields: Partial<Record<CanonicalField, number>> = {};
    let score = 0;
    row.forEach((cell, i) => {
      const f = matchField(String(cell ?? ''));
      if (f && fields[f] === undefined) {
        fields[f] = i;
        score++;
      }
    });
    if (fields.product !== undefined && score > bestScore && score >= 2) {
      bestScore = score;
      const headers = row.map((c) => String(c ?? ''));
      const mapped = new Set(Object.values(fields));
      const rateHeader = fields.rentalRate !== undefined ? headers[fields.rentalRate]! : '';
      best = {
        headerRowIndex: r,
        fields,
        headers,
        unmappedColumns: headers.map((h, index) => ({ index, header: h })).filter((c) => !mapped.has(c.index) && c.header.trim() !== ''),
        currency: /\(\s*r\s*\)|zar|rand/i.test(rateHeader) ? 'ZAR' : null,
      };
    }
  }
  return best;
}

export type IssueSeverity = 'error' | 'warning' | 'info';
export type IssueCode =
  | 'NO_HEADER'
  | 'MISSING_REQUIRED_COLUMN'
  | 'PRODUCT_BLANK'
  | 'RMS_ID_BLANK'
  | 'RMS_ID_DUPLICATE'
  | 'QTY_BLANK'
  | 'QTY_ZERO'
  | 'QTY_NOT_NUMERIC'
  | 'QTY_NEGATIVE'
  | 'QTY_NOT_INTEGER'
  | 'RATE_BLANK'
  | 'RATE_ZERO'
  | 'RATE_NOT_NUMERIC'
  | 'CHARGE_PERIOD_BLANK'
  | 'POSSIBLE_DUPLICATE_PRODUCT'
  | 'POSSIBLE_NEAR_DUPLICATE'
  | 'QTY_UNIT_OF_MEASURE'
  | 'DATA_FLAG_PRESENT';

export interface Issue {
  code: IssueCode;
  severity: IssueSeverity;
  message: string;
  rowNumber?: number; // 1-based spreadsheet row number
  rmsId?: string | null;
}

export interface SourceRecord {
  /** 1-based row number in the source sheet (as a user would see it in Excel). */
  rowNumber: number;
  rmsId: string | null;
  product: string;
  productGroup: string | null;
  qtyShown: number | null;
  qtyShownRaw: string | null;
  rentalRate: number | null;
  rentalRateRaw: string | null;
  currency: string | null;
  chargePeriod: string | null;
  dataFlag: string | null;
  /** Every original cell keyed by its original header, verbatim. */
  raw: Record<string, unknown>;
  issues: IssueCode[];
}

export interface ParseResult {
  mapping: ColumnMapping | null;
  records: SourceRecord[];
  issues: Issue[];
  blankRowsSkipped: number;
  /** True when the file must not be applied as a snapshot until issues are resolved. */
  blocking: boolean;
}

const isBlank = (v: unknown) => v === null || v === undefined || String(v).trim() === '';

/**
 * Parse a number from a spreadsheet cell. Handles "R 1 200,00", "1,200.50", "350".
 * Returns NaN when the text is not a number.
 */
export function parseNumberCell(v: unknown): number {
  if (typeof v === 'number') return v;
  let s = String(v).trim().replace(/^r\s*/i, '').replace(/zar/i, '').replace(/[\s ]/g, '');
  if (s === '') return NaN;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) s = s.replace(/,/g, '');
  else if (hasComma) {
    const parts = s.split(',');
    s = parts.length === 2 && parts[1]!.length !== 3 ? s.replace(',', '.') : s.replace(/,/g, '');
  }
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}

export function normaliseProductName(name: string): string {
  return name
    .toLowerCase()
    .replace(/×/g, 'x')
    .replace(/[^a-z0-9.x]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseInventoryRows(rows: unknown[][]): ParseResult {
  const issues: Issue[] = [];
  const mapping = detectColumns(rows);
  if (!mapping) {
    issues.push({ code: 'NO_HEADER', severity: 'error', message: 'Could not find a header row containing a Product column and at least one other known column.' });
    return { mapping: null, records: [], issues, blankRowsSkipped: 0, blocking: true };
  }
  for (const f of REQUIRED_FIELDS) {
    if (mapping.fields[f] === undefined) issues.push({ code: 'MISSING_REQUIRED_COLUMN', severity: 'error', message: `Missing required column: ${f}` });
  }
  for (const f of ['rmsId', 'qtyShown'] as CanonicalField[]) {
    if (mapping.fields[f] === undefined) issues.push({ code: 'MISSING_REQUIRED_COLUMN', severity: 'warning', message: `Column not found: ${f}. Records cannot be matched/quantified reliably.` });
  }

  const get = (row: unknown[], f: CanonicalField) => (mapping.fields[f] === undefined ? undefined : row[mapping.fields[f]!]);
  const records: SourceRecord[] = [];
  let blankRowsSkipped = 0;

  for (let r = mapping.headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (row.every(isBlank)) {
      blankRowsSkipped++;
      continue;
    }
    const rowNumber = r + 1;
    const recIssues: IssueCode[] = [];
    const push = (code: IssueCode, severity: IssueSeverity, message: string, rmsId: string | null) => {
      recIssues.push(code);
      issues.push({ code, severity, message, rowNumber, rmsId });
    };
    const raw: Record<string, unknown> = {};
    mapping.headers.forEach((h, i) => {
      raw[h || `column_${i + 1}`] = row[i] ?? null;
    });

    const rmsRaw = get(row, 'rmsId');
    const rmsId = isBlank(rmsRaw) ? null : String(rmsRaw).trim().replace(/\.0+$/, '');
    const productRaw = get(row, 'product');
    const product = isBlank(productRaw) ? '' : String(productRaw).trim();
    if (!product) push('PRODUCT_BLANK', 'error', 'Product name is blank', rmsId);
    if (!rmsId && mapping.fields.rmsId !== undefined) push('RMS_ID_BLANK', 'warning', `No RMS ID for "${product}" — cannot be matched across imports by stable ID`, rmsId);

    const qRaw = get(row, 'qtyShown');
    let qtyShown: number | null = null;
    if (isBlank(qRaw)) push('QTY_BLANK', 'warning', `Quantity is blank for "${product}"`, rmsId);
    else {
      const n = parseNumberCell(qRaw);
      if (Number.isNaN(n)) push('QTY_NOT_NUMERIC', 'warning', `Quantity "${String(qRaw)}" is not a number for "${product}"`, rmsId);
      else {
        qtyShown = n;
        if (n === 0) push('QTY_ZERO', 'info', `Quantity shown is zero for "${product}"`, rmsId);
        if (n < 0) push('QTY_NEGATIVE', 'warning', `Quantity is negative for "${product}"`, rmsId);
        if (!Number.isInteger(n)) push('QTY_NOT_INTEGER', 'warning', `Quantity ${n} is not a whole number for "${product}"`, rmsId);
      }
    }

    const rRaw = get(row, 'rentalRate');
    let rentalRate: number | null = null;
    if (mapping.fields.rentalRate !== undefined) {
      if (isBlank(rRaw)) push('RATE_BLANK', 'info', `Rental rate is blank for "${product}"`, rmsId);
      else {
        const n = parseNumberCell(rRaw);
        if (Number.isNaN(n)) push('RATE_NOT_NUMERIC', 'warning', `Rental rate "${String(rRaw)}" is not a number for "${product}"`, rmsId);
        else {
          rentalRate = n;
          if (n === 0) push('RATE_ZERO', 'info', `Rental rate is zero for "${product}" (does not mean the item is free)`, rmsId);
        }
      }
    }
    const cp = get(row, 'chargePeriod');
    const chargePeriod = isBlank(cp) ? null : String(cp).trim();
    if (rentalRate !== null && !chargePeriod && mapping.fields.chargePeriod !== undefined) push('CHARGE_PERIOD_BLANK', 'info', `Charge period is blank for "${product}"`, rmsId);
    const df = get(row, 'dataFlag');
    const dataFlag = isBlank(df) ? null : String(df).trim();
    if (dataFlag) push('DATA_FLAG_PRESENT', 'info', `Source data flag on "${product}": ${dataFlag}`, rmsId);

    if (/\bper (m2|m²|sqm|square met(er|re)|met(er|re)|m|sheet|roll)\b|\(each\)/i.test(product)) {
      push('QTY_UNIT_OF_MEASURE', 'info', `“${product}”: quantity may be in m², metres or sheets rather than units — check before allocation`, rmsId);
    }
    const pg = get(row, 'productGroup');
    records.push({
      rowNumber,
      rmsId,
      product,
      productGroup: isBlank(pg) ? null : String(pg).trim(),
      qtyShown,
      qtyShownRaw: isBlank(qRaw) ? null : String(qRaw),
      rentalRate,
      rentalRateRaw: isBlank(rRaw) ? null : String(rRaw),
      currency: mapping.currency,
      chargePeriod,
      dataFlag,
      raw,
      issues: recIssues,
    });
  }

  // Duplicate RMS IDs — ambiguous identity, blocks application.
  const byId = new Map<string, SourceRecord[]>();
  for (const rec of records) if (rec.rmsId) byId.set(rec.rmsId, [...(byId.get(rec.rmsId) ?? []), rec]);
  for (const [id, recs] of byId) {
    if (recs.length > 1) {
      for (const rec of recs) {
        rec.issues.push('RMS_ID_DUPLICATE');
        issues.push({
          code: 'RMS_ID_DUPLICATE',
          severity: 'error',
          message: `RMS ID ${id} appears on rows ${recs.map((x) => x.rowNumber).join(', ')}`,
          rowNumber: rec.rowNumber,
          rmsId: id,
        });
      }
    }
  }
  // Possible duplicate products: same normalised name, different identity (incl. across groups).
  const byName = new Map<string, SourceRecord[]>();
  for (const rec of records) if (rec.product) byName.set(normaliseProductName(rec.product), [...(byName.get(normaliseProductName(rec.product)) ?? []), rec]);
  for (const recs of byName.values()) {
    const ids = new Set(recs.map((r) => r.rmsId ?? `row${r.rowNumber}`));
    if (recs.length > 1 && ids.size > 1) {
      const groups = [...new Set(recs.map((r) => r.productGroup ?? '(no group)'))];
      for (const rec of recs) {
        rec.issues.push('POSSIBLE_DUPLICATE_PRODUCT');
        issues.push({
          code: 'POSSIBLE_DUPLICATE_PRODUCT',
          severity: 'warning',
          message: `"${rec.product}" appears ${recs.length}× (rows ${recs.map((r) => r.rowNumber).join(', ')}; groups: ${groups.join(', ')})`,
          rowNumber: rec.rowNumber,
          rmsId: rec.rmsId,
        });
      }
    }
  }

  // Near-duplicates: same model token (e.g. "CQ-18T", "80kVA", "16000") and similar wording, same sizes.
  for (const [a, b] of findNearDuplicates(records)) {
    for (const [x, y] of [[a, b], [b, a]] as const) {
      if (x.issues.includes('POSSIBLE_DUPLICATE_PRODUCT')) continue;
      x.issues.push('POSSIBLE_NEAR_DUPLICATE');
      issues.push({ code: 'POSSIBLE_NEAR_DUPLICATE', severity: 'warning', message: `“${x.product}” (row ${x.rowNumber}, ${x.productGroup ?? 'no group'}) may be the same equipment as “${y.product}” (row ${y.rowNumber}, ${y.productGroup ?? 'no group'})`, rowNumber: x.rowNumber, rmsId: x.rmsId });
    }
  }

  return { mapping, records, issues, blankRowsSkipped, blocking: issues.some((i) => i.severity === 'error') };
}

const STOP = new Set(['the', 'and', 'with', 'for', 'of', 'per', 'each', 'regular', 'price', 'x', 'a', 'in', 'on', 'or', 'to']);
const DIM = /^\d+(\.\d+)?(mm|cm|m|mt|in|inch|ft|kg|w)$/;
/** Tokens that look like model numbers but describe generic features. */
const GENERIC_MODEL = new Set(['4k', '8k', '2k', '1080p', '720p', 'cat5e', 'cat6', '4in1', '3in1', '5in1', '6in1', 'ip65', 'ip44', 'rgbw', 'rgba']);
/** Words that distinguish variants of the same product (left/right hand, colour, indoor/outdoor, size class). */
const VARIANT_WORDS = new Set(['left', 'right', 'black', 'white', 'beige', 'grey', 'gray', 'silver', 'red', 'blue', 'yellow', 'gold', 'indoor', 'outdoor', 'small', 'medium', 'large', 'mini', 'single', 'double', 'mono', 'stereo']);

export function nameTokens(name: string): { words: Set<string>; models: Set<string>; dims: Set<string> } {
  const toks = name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/([a-z0-9])[-–]+(?=[a-z0-9])/g, '$1')
    .replace(/[^a-z0-9.]+/g, ' ')
    .split(' ')
    .map((t) => t.replace(/^\.+|\.+$/g, ''))
    .filter((t) => t && !STOP.has(t));
  const dims = new Set(toks.filter((t) => DIM.test(t)));
  const words = new Set(toks.filter((t) => !DIM.test(t)));
  const models = new Set([...words].filter((t) => !GENERIC_MODEL.has(t) && ((/\d/.test(t) && /[a-z]/.test(t)) || /^\d{3,}$/.test(t))));
  return { words, models, dims };
}

/** Pairs of records that are probably the same equipment under different names. Review hints only. */
export function findNearDuplicates<T extends { product: string }>(recs: T[]): [T, T][] {
  const tok = recs.map((r) => ({ r, t: nameTokens(r.product) }));
  const out: [T, T][] = [];
  for (let i = 0; i < tok.length; i++) {
    for (let j = i + 1; j < tok.length; j++) {
      const A = tok[i]!;
      const B = tok[j]!;
      if (normaliseProductName(A.r.product) === normaliseProductName(B.r.product)) continue; // exact-name case handled elsewhere
      if (![...A.t.models].some((x) => B.t.models.has(x))) continue;
      const sameDims = A.t.dims.size === B.t.dims.size && [...A.t.dims].every((d) => B.t.dims.has(d));
      if ((A.t.dims.size || B.t.dims.size) && !sameDims) continue; // different sizes → different items
      const va = [...A.t.words].filter((w) => VARIANT_WORDS.has(w)).sort().join();
      const vb = [...B.t.words].filter((w) => VARIANT_WORDS.has(w)).sort().join();
      if (va !== vb) continue; // explicit variants (left/right, colour, indoor/outdoor) are different items
      const inter = [...A.t.words].filter((w) => B.t.words.has(w)).length;
      const union = new Set([...A.t.words, ...B.t.words]).size;
      const contained = inter === Math.min(A.t.words.size, B.t.words.size); // one name fully inside the other
      if (union && (contained || inter / union > 0.4)) out.push([A.r, B.r]);
    }
  }
  return out;
}
