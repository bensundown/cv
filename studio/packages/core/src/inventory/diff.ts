/**
 * Snapshot diff: compares a confirmed inventory snapshot with a newly parsed file.
 * Matching priority: stable RMS ID → exact normalised name (flagged for review).
 * Items missing from the new file are PROPOSED removals, never silent deletions.
 */
import { normaliseProductName, type SourceRecord } from './parse.js';

export interface SnapshotItemLite {
  itemId: string; // stable inventory_item id
  rmsId: string | null;
  product: string;
  productGroup: string | null;
  qtyShown: number | null;
  rentalRate: number | null;
  chargePeriod: string | null;
  dataFlag: string | null;
}

export type ChangeKind = 'added' | 'unchanged' | 'changed' | 'renamed' | 'matched_by_name' | 'removal_proposed';

export interface FieldChange {
  field: 'product' | 'productGroup' | 'qtyShown' | 'rentalRate' | 'chargePeriod' | 'dataFlag';
  before: unknown;
  after: unknown;
}

export interface InventoryChange {
  kind: ChangeKind;
  itemId: string | null; // existing item when matched
  rmsId: string | null;
  product: string;
  rowNumber: number | null;
  fields: FieldChange[];
  notes: string[];
}

export interface InventoryDiff {
  changes: InventoryChange[];
  summary: Record<ChangeKind, number>;
}

const COMPARED: FieldChange['field'][] = ['productGroup', 'qtyShown', 'rentalRate', 'chargePeriod', 'dataFlag'];

function compare(prev: SnapshotItemLite, rec: SourceRecord): FieldChange[] {
  const out: FieldChange[] = [];
  if (prev.product !== rec.product) out.push({ field: 'product', before: prev.product, after: rec.product });
  for (const f of COMPARED) {
    const a = prev[f] ?? null;
    const b = rec[f] ?? null;
    if (a !== b) out.push({ field: f, before: a, after: b });
  }
  return out;
}

export function diffInventory(previous: SnapshotItemLite[], incoming: SourceRecord[]): InventoryDiff {
  const changes: InventoryChange[] = [];
  const prevById = new Map(previous.filter((p) => p.rmsId).map((p) => [p.rmsId!, p]));
  const matched = new Set<string>();
  const incomingIds = new Set(incoming.map((r) => r.rmsId).filter(Boolean) as string[]);

  const byName = new Map<string, SnapshotItemLite[]>();
  for (const p of previous) {
    const k = normaliseProductName(p.product);
    byName.set(k, [...(byName.get(k) ?? []), p]);
  }

  for (const rec of incoming) {
    const notes: string[] = [];
    let prev: SnapshotItemLite | undefined;
    let kind: ChangeKind;
    if (rec.rmsId && prevById.has(rec.rmsId) && !matched.has(prevById.get(rec.rmsId)!.itemId)) {
      prev = prevById.get(rec.rmsId)!;
    } else {
      // Name fallback: only when unambiguous and the candidate isn't claimed by its own RMS ID in the new file.
      const cands = (byName.get(normaliseProductName(rec.product)) ?? []).filter(
        (p) => !matched.has(p.itemId) && !(p.rmsId && incomingIds.has(p.rmsId)),
      );
      if (cands.length === 1) {
        prev = cands[0]!;
        notes.push(
          prev.rmsId && rec.rmsId
            ? `RMS ID changed from ${prev.rmsId} to ${rec.rmsId}? Matched by name only — confirm this is the same equipment.`
            : 'Matched by product name only (no shared RMS ID) — confirm this is the same equipment.',
        );
      } else if (cands.length > 1) {
        notes.push(`Ambiguous: ${cands.length} existing items share this name. Treated as new; review for duplicates.`);
      }
    }

    if (!prev) {
      kind = 'added';
      changes.push({ kind, itemId: null, rmsId: rec.rmsId, product: rec.product, rowNumber: rec.rowNumber, fields: [], notes });
      continue;
    }
    matched.add(prev.itemId);
    const fields = compare(prev, rec);
    const nameMatchedOnly = !(rec.rmsId && prev.rmsId === rec.rmsId);
    if (nameMatchedOnly) kind = 'matched_by_name';
    else if (fields.some((f) => f.field === 'product')) kind = 'renamed';
    else if (fields.length) kind = 'changed';
    else kind = 'unchanged';
    changes.push({ kind, itemId: prev.itemId, rmsId: rec.rmsId, product: rec.product, rowNumber: rec.rowNumber, fields, notes });
  }

  for (const p of previous) {
    if (!matched.has(p.itemId)) {
      changes.push({
        kind: 'removal_proposed',
        itemId: p.itemId,
        rmsId: p.rmsId,
        product: p.product,
        rowNumber: null,
        fields: [],
        notes: ['Not present in the new file. Choose to retire it or keep it in the inventory.'],
      });
    }
  }

  const summary = { added: 0, unchanged: 0, changed: 0, renamed: 0, matched_by_name: 0, removal_proposed: 0 } as Record<ChangeKind, number>;
  for (const c of changes) summary[c.kind]++;
  return { changes, summary };
}
