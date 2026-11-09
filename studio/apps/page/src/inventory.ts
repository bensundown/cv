/**
 * Inventory for the page edition: parse a workbook/CSV with the core parser, then build the
 * design engine's stock list (category, name hints, researched spec library, relationship library)
 * exactly as the server does on import.
 */
import {
  guessCategory,
  matchSpecLibrary,
  parseInventoryRows,
  parseNameHints,
  RELATIONSHIP_LIBRARY,
  SPEC_KEY_MAP,
  type EngineeringCategory,
  type EquipmentRelationship,
  type SpecSheet,
  type StockItem,
} from '@sn/core';
import { readXlsx } from './xlsx';

/** What we keep per inventory row (the source cells that matter to design). */
export interface InvRow {
  rmsId: string | null;
  product: string;
  productGroup: string | null;
  qtyShown: number | null;
  rentalRate: number | null;
  chargePeriod: string | null;
  currency: string | null;
  row: number;
}

/** Owner edits layered over the file (never written back into the file rows). */
export interface InvEdits {
  qtyConfirmed?: Record<string, number | null>;
  category?: Record<string, EngineeringCategory>;
  hidden?: Record<string, boolean>;
}

export interface InventoryDoc {
  fileName: string;
  importedAt: string;
  rows: InvRow[];
  issues: number;
}


export async function readInventoryFile(file: File): Promise<InventoryDoc> {
  let rows: unknown[][];
  if (/\.csv$/i.test(file.name)) {
    const text = (await file.text()).replace(/^﻿/, '');
    rows = text.split(/\r?\n/).map(splitCsvLine);
  } else {
    if (/\.xls$/i.test(file.name)) throw new Error('Old .xls files are not supported. Save it as .xlsx or .csv in Excel and load that.');
    rows = await readXlsx(await file.arrayBuffer());
  }
  const parsed = parseInventoryRows(rows);
  if (!parsed.mapping) throw new Error('Could not find a header row with a product column. The first rows should hold headings such as “Product”, “Quantity”, “Rate”.');
  return {
    fileName: file.name,
    importedAt: new Date().toISOString(),
    issues: parsed.issues.length,
    rows: parsed.records.map((r) => ({ rmsId: r.rmsId, product: r.product, productGroup: r.productGroup, qtyShown: r.qtyShown, rentalRate: r.rentalRate, chargePeriod: r.chargePeriod, currency: r.currency, row: r.rowNumber })),
  };
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (q) {
      if (ch === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') out.push(cur), (cur = '');
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const HINTS: [string, string][] = [
  ['pixelPitchMm', 'pixel_pitch_mm'],
  ['cabinetWidthMm', 'cabinet_width_mm'],
  ['cabinetHeightMm', 'cabinet_height_mm'],
  ['deckWidthMm', 'deck_width_mm'],
  ['deckDepthMm', 'deck_depth_mm'],
  ['legHeightMm', 'leg_height_mm'],
  ['legHeightMinMm', 'leg_height_min_mm'],
  ['legHeightMaxMm', 'leg_height_max_mm'],
  ['stairHeightMm', 'stair_height_mm'],
  ['stairHeightMinMm', 'stair_height_min_mm'],
  ['stairHeightMaxMm', 'stair_height_max_mm'],
  ['railLengthMm', 'rail_length_mm'],
];

export const itemKey = (r: InvRow) => r.rmsId ?? `row${r.row}`;
const modelKey = (product: string) => 'm:' + product.trim().toLowerCase().replace(/\s+/g, ' ');

export function specsFor(product: string, category: EngineeringCategory): SpecSheet {
  const sheet: SpecSheet = {};
  const h = parseNameHints(product, category) as Record<string, unknown>;
  for (const [hk, key] of HINTS) {
    const v = h[hk];
    if (typeof v !== 'number') continue;
    sheet[key] = { key, value: v, unit: 'mm', status: 'ESTIMATED', source: { kind: 'name_parse', ref: `Product name “${product}”`, note: `Parsed from inventory product name${h.unitInferred ? ' (unit not stated — metres inferred)' : ''} — confirm against the item or datasheet` } };
  }
  for (const e of matchSpecLibrary(product)) {
    for (const sp of e.specs) {
      sheet[sp.key] = { key: sp.key, value: sp.value, unit: SPEC_KEY_MAP.get(sp.key)?.unit ?? '', status: sp.status, source: { kind: 'manufacturer_doc', ref: `Spec library (${e.manufacturer} ${e.model}): ${sp.ref}`, url: sp.url, note: `${sp.note ? `${sp.note}. ` : ''}Researched 2026-11-07 — reviewer verification pending` } };
    }
  }
  return sheet;
}

export function buildStock(inv: InventoryDoc | null, edits: InvEdits): { stock: StockItem[]; relationships: EquipmentRelationship[] } {
  if (!inv) return { stock: [], relationships: [] };
  const stock: StockItem[] = [];
  for (const r of inv.rows) {
    const id = itemKey(r);
    if (edits.hidden?.[id]) continue;
    const category = edits.category?.[id] ?? guessCategory(r.product, r.productGroup).category;
    stock.push({
      itemId: id,
      rmsId: r.rmsId,
      product: r.product,
      productGroup: r.productGroup,
      category,
      modelId: modelKey(r.product),
      qtyConfirmed: edits.qtyConfirmed?.[id] ?? null,
      qtyShown: r.qtyShown,
      rentalRate: r.rentalRate,
      chargePeriod: r.chargePeriod,
      currency: r.currency,
      specs: specsFor(r.product, category),
    });
  }
  const models = [...new Map(stock.map((s) => [s.modelId!, s.product])).entries()];
  const relationships: EquipmentRelationship[] = [];
  for (const rel of RELATIONSHIP_LIBRARY) {
    const froms = models.filter(([, p]) => rel.from.test(p));
    const tos = models.filter(([, p]) => rel.to.test(p));
    for (const [f] of froms)
      for (const [t] of tos) {
        if (f === t) continue;
        relationships.push({
          id: `${rel.id}:${f}:${t}`,
          type: rel.type,
          fromModelId: f,
          to: { modelId: t },
          quantity: rel.quantity ?? { kind: 'none' },
          constraints: rel.constraints ?? {},
          evidence: [{ kind: 'user_confirmation', ref: rel.ref, note: `Relationship library: ${rel.id}` }],
          status: rel.status,
        });
      }
  }
  return { stock, relationships };
}
