import {
  diffInventory,
  matchSpecLibrary,
  RELATIONSHIP_LIBRARY,
  SPEC_KEY_MAP,
  guessCategory,
  guessManufacturer,
  parseInventoryRows,
  parseNameHints,
  type EngineeringCategory,
  type InventoryDiff,
  type ParseResult,
  type SnapshotItemLite,
  type SpecSheet,
  type StockItem,
} from '@sn/core';
import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import type pg from 'pg';
import { audit } from './audit.js';
import { HttpError, type SessionUser } from './auth.js';
import { many, one, tx, type Q } from './db.js';

export const MAX_ROWS = 20000;

function cellValue(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('result' in o) return cellValue(o.result);
    if ('richText' in o && Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((t) => t.text).join('');
    if ('text' in o) return o.text;
    if ('error' in o) return `#ERROR ${String(o.error)}`;
    return JSON.stringify(o);
  }
  return v;
}

export interface SheetData {
  sheetNames: string[];
  sheetName: string;
  rows: unknown[][];
}

/** Read an XLSX or CSV buffer into a 2D array. Prefers a worksheet named "Inventory". */
export async function readSpreadsheet(buf: Buffer, mime: string, preferredSheet = 'Inventory'): Promise<SheetData> {
  if (mime === 'text/csv' || mime === 'application/octet-stream') {
    const text = buf.toString('utf8').replace(/^﻿/, '');
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: false });
    if (parsed.data.length > MAX_ROWS) throw new HttpError(422, `File has more than ${MAX_ROWS} rows`);
    return { sheetNames: ['CSV'], sheetName: 'CSV', rows: parsed.data };
  }
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch (e) {
    throw new HttpError(422, `Could not read the Excel file: ${(e as Error).message}`);
  }
  const names = wb.worksheets.map((w) => w.name);
  const ws = wb.worksheets.find((w) => w.name.trim().toLowerCase() === preferredSheet.toLowerCase()) ?? wb.worksheets[0];
  if (!ws) throw new HttpError(422, 'Workbook contains no worksheets');
  if (ws.rowCount > MAX_ROWS) throw new HttpError(422, `Worksheet has more than ${MAX_ROWS} rows`);
  const rows: unknown[][] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const out: unknown[] = [];
    for (let c = 1; c <= Math.max(ws.columnCount, row.cellCount); c++) out.push(cellValue(row.getCell(c).value));
    rows.push(out);
  }
  return { sheetNames: names, sheetName: ws.name, rows };
}

export async function currentSnapshot(q: Q, tenantId: string) {
  return one<{ id: string; version: number }>(q, 'SELECT id, version FROM inventory_snapshot WHERE tenant_id=$1 AND is_current', [tenantId]);
}

async function snapshotLite(q: Q, snapshotId: string): Promise<SnapshotItemLite[]> {
  return many<SnapshotItemLite>(
    q,
    `SELECT item_id AS "itemId", rms_id AS "rmsId", product, product_group AS "productGroup", qty_shown AS "qtyShown",
            rental_rate AS "rentalRate", charge_period AS "chargePeriod", data_flag AS "dataFlag"
     FROM inventory_snapshot_item WHERE snapshot_id=$1`,
    [snapshotId],
  );
}

export async function stageImport(pool: pg.Pool, user: SessionUser, fileId: string, buf: Buffer, mime: string) {
  let sheet: SheetData;
  let parsed: ParseResult;
  try {
    sheet = await readSpreadsheet(buf, mime);
    parsed = parseInventoryRows(sheet.rows);
  } catch (e) {
    const imp = await one<{ id: string }>(pool, `INSERT INTO inventory_import(tenant_id, file_id, status, error, created_by) VALUES ($1,$2,'failed',$3,$4) RETURNING id`, [user.tenantId, fileId, (e as Error).message, user.id]);
    await audit(pool, user, 'inventory.import.failed', 'inventory_import', imp!.id, { error: (e as Error).message });
    throw e;
  }
  const cur = await currentSnapshot(pool, user.tenantId);
  const diff = diffInventory(cur ? await snapshotLite(pool, cur.id) : [], parsed.records);
  const imp = await one<{ id: string }>(
    pool,
    `INSERT INTO inventory_import(tenant_id, file_id, sheet_name, status, parse_result, diff, base_snapshot_id, created_by)
     VALUES ($1,$2,$3,'staged',$4,$5,$6,$7) RETURNING id`,
    [user.tenantId, fileId, sheet.sheetName, JSON.stringify({ ...parsed, sheetNames: sheet.sheetNames }), JSON.stringify(diff), cur?.id ?? null, user.id],
  );
  await audit(pool, user, 'inventory.import.staged', 'inventory_import', imp!.id, { records: parsed.records.length, issues: parsed.issues.length, summary: diff.summary });
  return imp!.id;
}

export interface ApplyDecisions {
  /** itemId → keep (carry forward, flagged not-in-file) or retire. Default: keep. */
  removals?: Record<string, 'keep' | 'retire'>;
  /** source row number → accept the name-only match (true) or treat as a new item (false). Default: false. */
  nameMatches?: Record<string, boolean>;
  note?: string;
}

const HINT_SPEC: [keyof ReturnType<typeof parseNameHints>, string, string][] = [
  ['pixelPitchMm', 'pixel_pitch_mm', 'mm'],
  ['cabinetWidthMm', 'cabinet_width_mm', 'mm'],
  ['cabinetHeightMm', 'cabinet_height_mm', 'mm'],
  ['deckWidthMm', 'deck_width_mm', 'mm'],
  ['deckDepthMm', 'deck_depth_mm', 'mm'],
  ['legHeightMm', 'leg_height_mm', 'mm'],
  ['legHeightMinMm', 'leg_height_min_mm', 'mm'],
  ['legHeightMaxMm', 'leg_height_max_mm', 'mm'],
];

/**
 * Apply researched library specs to one model. Replaces name-parsed hints; never overrides a value
 * a person entered (any other source kind). Returns the number of values written.
 */
export async function applySpecLibraryToModel(c: Q, modelId: string, product: string): Promise<number> {
  let n = 0;
  const entries = matchSpecLibrary(product);
  // Retract library values that the current library no longer gives this product (library corrections).
  const keep = new Set(entries.flatMap((e) => e.specs.map((sp) => sp.key)));
  const libRows = await many<{ id: string; key: string }>(c, `SELECT id, key FROM spec_value WHERE product_model_id=$1 AND superseded_at IS NULL AND source->>'ref' LIKE 'Spec library%'`, [modelId]);
  for (const r of libRows) if (!keep.has(r.key)) {
    await c.query('UPDATE spec_value SET superseded_at=now() WHERE id=$1', [r.id]);
    n++;
  }
  for (const e of entries) {
    await c.query('UPDATE product_model SET manufacturer=COALESCE(manufacturer, $2) WHERE id=$1', [modelId, e.manufacturer]);
    for (const sp of e.specs) {
      const cur = await one<{ id: string; source: { kind: string; ref?: string } }>(c, 'SELECT id, source FROM spec_value WHERE product_model_id=$1 AND key=$2 AND superseded_at IS NULL', [modelId, sp.key]);
      if (cur && cur.source.kind !== 'name_parse' && !(cur.source.ref ?? '').startsWith('Spec library')) continue; // keep human-entered values
      if (cur) await c.query('UPDATE spec_value SET superseded_at=now() WHERE id=$1', [cur.id]);
      const def = SPEC_KEY_MAP.get(sp.key);
      await c.query('INSERT INTO spec_value(product_model_id, key, value_num, value_text, unit, status, source) VALUES ($1,$2,$3,$4,$5,$6,$7)', [
        modelId,
        sp.key,
        typeof sp.value === 'number' ? sp.value : null,
        typeof sp.value === 'string' ? sp.value : null,
        def?.unit ?? '',
        sp.status,
        JSON.stringify({ kind: 'manufacturer_doc', ref: `Spec library (${e.manufacturer} ${e.model}): ${sp.ref}`, url: sp.url, note: `${sp.note ? `${sp.note}. ` : ''}Researched 2026-11-07 — reviewer verification pending` }),
      ]);
      n++;
    }
  }
  return n;
}

/** Create library relationships between matching models (idempotent). */
export async function applyRelationshipLibrary(c: Q, tenantId: string, rows: { id: string; product: string }[]): Promise<number> {
  let created = 0;
  for (const rel of RELATIONSHIP_LIBRARY) {
    const froms = rows.filter((r) => rel.from.test(r.product));
    const tos = rows.filter((r) => rel.to.test(r.product));
    for (const f of froms) {
      for (const t of tos) {
        if (f.id === t.id) continue;
        const exists = await one(c, 'SELECT 1 FROM equipment_relationship WHERE from_model_id=$1 AND to_model_id=$2 AND type=$3 AND superseded_at IS NULL', [f.id, t.id, rel.type]);
        if (exists) continue;
        await c.query(
          `INSERT INTO equipment_relationship(tenant_id, type, from_model_id, to_model_id, quantity_rule, constraints, evidence, status) VALUES ($1,$2,$3,$4,'{"kind":"none"}','{}',$5,$6)`,
          [tenantId, rel.type, f.id, t.id, JSON.stringify([{ kind: 'user_confirmation', ref: rel.ref, note: `Relationship library: ${rel.id}` }]), rel.status],
        );
        created++;
      }
    }
  }
  return created;
}

/** Apply the library to every model in the current inventory. */
export async function applySpecLibrary(pool: pg.Pool, user: SessionUser) {
  return tx(pool, async (c) => {
    const rows = await many<{ id: string; product: string }>(
      c,
      `SELECT DISTINCT pm.id, si.product FROM inventory_snapshot_item si JOIN inventory_snapshot s ON s.id=si.snapshot_id AND s.is_current
       JOIN inventory_item ii ON ii.id=si.item_id JOIN product_model pm ON pm.id=ii.product_model_id WHERE s.tenant_id=$1`,
      [user.tenantId],
    );
    let written = 0;
    let models = 0;
    for (const r of rows) {
      const n = await applySpecLibraryToModel(c, r.id, r.product);
      written += n;
      if (n) models++;
    }
    const relationships = await applyRelationshipLibrary(c, user.tenantId, rows);
    await audit(c, user, 'spec_library.applied', 'tenant', user.tenantId, { models, written, relationships });
    return { models, written, relationships };
  });
}

async function ensureModel(c: Q, tenantId: string, product: string, group: string | null, rmsId: string | null): Promise<string> {
  const cat = guessCategory(product, group);
  const manufacturer = guessManufacturer(product);
  const model = product.trim();
  await c.query(
    `INSERT INTO product_model(tenant_id, manufacturer, model, category, category_status, identity_status, notes)
     VALUES ($1,$2,$3,$4,$5,'PROVISIONAL',$6) ON CONFLICT (tenant_id, manufacturer, model, variant) DO NOTHING`,
    [tenantId, manufacturer, model, cat.category, cat.status, `Created from inventory record ${rmsId ?? '(no RMS ID)'}; ${cat.note}`],
  );
  const m = (await one<{ id: string; category: EngineeringCategory }>(
    c,
    `SELECT id, category FROM product_model WHERE tenant_id=$1 AND manufacturer IS NOT DISTINCT FROM $2 AND model=$3 AND variant=''`,
    [tenantId, manufacturer, model],
  ))!;
  const hints = parseNameHints(product, m.category);
  for (const [hk, key, unit] of HINT_SPEC) {
    const v = hints[hk];
    if (typeof v !== 'number') continue;
    await c.query(
      `INSERT INTO spec_value(product_model_id, key, value_num, unit, status, source)
       SELECT $1,$2,$3,$4,'ESTIMATED',$5 WHERE NOT EXISTS (SELECT 1 FROM spec_value WHERE product_model_id=$1 AND key=$2 AND superseded_at IS NULL)`,
      [m.id, key, v, unit, JSON.stringify({ kind: 'name_parse', ref: `Product name “${product}”`, note: `Parsed from inventory product name${hints.unitInferred ? ' (unit not stated — metres inferred)' : ''} — confirm against the item or datasheet` })],
    );
  }
  await applySpecLibraryToModel(c, m.id, product);
  return m.id;
}

export async function applyImport(pool: pg.Pool, user: SessionUser, importId: string, d: ApplyDecisions) {
  const imp = await one<{ status: string; parse_result: ParseResult; diff: InventoryDiff; base_snapshot_id: string | null; tenant_id: string }>(pool, 'SELECT * FROM inventory_import WHERE id=$1', [importId]);
  if (!imp || imp.tenant_id !== user.tenantId) throw new HttpError(404, 'Import not found');
  if (imp.status !== 'staged') throw new HttpError(409, `Import is ${imp.status}`);
  if (imp.parse_result.blocking) throw new HttpError(422, 'This file has blocking errors (see issues). Fix the file and upload again.');
  try {
    return await tx(pool, async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`inventory:${user.tenantId}`]);
      const cur = await currentSnapshot(c, user.tenantId);
      if ((cur?.id ?? null) !== imp.base_snapshot_id) throw new HttpError(409, 'The inventory changed since this file was previewed. Upload it again to get a fresh preview.');
      const version = ((await one<{ v: number }>(c, 'SELECT COALESCE(MAX(version),0) AS v FROM inventory_snapshot WHERE tenant_id=$1', [user.tenantId]))!.v ?? 0) + 1;
      if (cur) await c.query('UPDATE inventory_snapshot SET is_current=false WHERE id=$1', [cur.id]);
      const snap = (await one<{ id: string }>(
        c,
        `INSERT INTO inventory_snapshot(tenant_id, version, import_id, parent_snapshot_id, kind, note, is_current, created_by)
         VALUES ($1,$2,$3,$4,'import',$5,true,$6) RETURNING id`,
        [user.tenantId, version, importId, cur?.id ?? null, d.note ?? null, user.id],
      ))!;
      const byRow = new Map(imp.diff.changes.filter((x) => x.rowNumber !== null).map((x) => [x.rowNumber!, x]));
      let created = 0;
      for (const rec of imp.parse_result.records) {
        const ch = byRow.get(rec.rowNumber);
        let itemId: string | null = null;
        if (ch && ch.itemId && (ch.kind !== 'matched_by_name' || d.nameMatches?.[String(rec.rowNumber)])) {
          itemId = ch.itemId;
          if (ch.kind === 'matched_by_name' && rec.rmsId) await c.query('UPDATE inventory_item SET rms_id=$2, retired_at=NULL WHERE id=$1', [itemId, rec.rmsId]);
          else await c.query('UPDATE inventory_item SET retired_at=NULL WHERE id=$1', [itemId]);
        } else {
          // Re-activate a previously retired item with the same RMS ID rather than duplicating it.
          const existing = rec.rmsId ? await one<{ id: string }>(c, 'SELECT id FROM inventory_item WHERE tenant_id=$1 AND rms_id=$2', [user.tenantId, rec.rmsId]) : null;
          const modelId = await ensureModel(c, user.tenantId, rec.product, rec.productGroup, rec.rmsId);
          if (existing) {
            itemId = existing.id;
            await c.query('UPDATE inventory_item SET retired_at=NULL WHERE id=$1', [itemId]);
          } else {
            itemId = (await one<{ id: string }>(c, 'INSERT INTO inventory_item(tenant_id, rms_id, product_model_id) VALUES ($1,$2,$3) RETURNING id', [user.tenantId, rec.rmsId, modelId]))!.id;
            created++;
          }
        }
        await c.query(
          `INSERT INTO inventory_snapshot_item(snapshot_id, item_id, source_row, rms_id, product, product_group, qty_shown, qty_shown_raw, rental_rate, rental_rate_raw, currency, charge_period, data_flag, raw, issues, in_source_file)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,true)`,
          [snap.id, itemId, rec.rowNumber, rec.rmsId, rec.product, rec.productGroup, rec.qtyShown, rec.qtyShownRaw, rec.rentalRate, rec.rentalRateRaw, rec.currency, rec.chargePeriod, rec.dataFlag, JSON.stringify(rec.raw), rec.issues],
        );
      }
      let kept = 0;
      let retired = 0;
      for (const ch of imp.diff.changes.filter((x) => x.kind === 'removal_proposed')) {
        if (d.removals?.[ch.itemId!] === 'retire') {
          await c.query('UPDATE inventory_item SET retired_at=now() WHERE id=$1', [ch.itemId]);
          retired++;
        } else {
          await c.query(
            `INSERT INTO inventory_snapshot_item(snapshot_id, item_id, source_row, rms_id, product, product_group, qty_shown, qty_shown_raw, rental_rate, rental_rate_raw, currency, charge_period, data_flag, raw, issues, in_source_file)
             SELECT $1, item_id, NULL, rms_id, product, product_group, qty_shown, qty_shown_raw, rental_rate, rental_rate_raw, currency, charge_period, data_flag, raw, issues, false
             FROM inventory_snapshot_item WHERE snapshot_id=$2 AND item_id=$3`,
            [snap.id, cur!.id, ch.itemId],
          );
          kept++;
        }
      }
      const modelRows = await many<{ id: string; product: string }>(c, `SELECT DISTINCT ii.product_model_id AS id, si.product FROM inventory_snapshot_item si JOIN inventory_item ii ON ii.id=si.item_id WHERE si.snapshot_id=$1 AND ii.product_model_id IS NOT NULL`, [snap.id]);
      await applyRelationshipLibrary(c, user.tenantId, modelRows);
      await c.query(`UPDATE inventory_import SET status='applied', applied_snapshot_id=$2 WHERE id=$1`, [importId, snap.id]);
      await audit(c, user, 'inventory.snapshot.created', 'inventory_snapshot', snap.id, { version, importId, created, kept, retired });
      return { snapshotId: snap.id, version, created, kept, retired };
    });
  } catch (e) {
    if (!(e instanceof HttpError)) await pool.query(`UPDATE inventory_import SET error=$2 WHERE id=$1`, [importId, (e as Error).message]);
    throw e;
  }
}

/** Rollback = a NEW snapshot that copies an older one (history stays linear and auditable). */
export async function rollbackTo(pool: pg.Pool, user: SessionUser, snapshotId: string) {
  return tx(pool, async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`inventory:${user.tenantId}`]);
    const target = await one<{ id: string; version: number; tenant_id: string }>(c, 'SELECT * FROM inventory_snapshot WHERE id=$1', [snapshotId]);
    if (!target || target.tenant_id !== user.tenantId) throw new HttpError(404, 'Snapshot not found');
    const cur = await currentSnapshot(c, user.tenantId);
    if (cur?.id === target.id) throw new HttpError(409, 'That snapshot is already current');
    const version = (await one<{ v: number }>(c, 'SELECT MAX(version) AS v FROM inventory_snapshot WHERE tenant_id=$1', [user.tenantId]))!.v + 1;
    await c.query('UPDATE inventory_snapshot SET is_current=false WHERE tenant_id=$1', [user.tenantId]);
    const snap = (await one<{ id: string }>(c, `INSERT INTO inventory_snapshot(tenant_id, version, parent_snapshot_id, kind, note, is_current, created_by) VALUES ($1,$2,$3,'rollback',$4,true,$5) RETURNING id`, [user.tenantId, version, cur?.id ?? null, `Rollback to v${target.version}`, user.id]))!;
    await c.query(
      `INSERT INTO inventory_snapshot_item SELECT $1, item_id, source_row, rms_id, product, product_group, qty_shown, qty_shown_raw, rental_rate, rental_rate_raw, currency, charge_period, data_flag, raw, issues, in_source_file FROM inventory_snapshot_item WHERE snapshot_id=$2`,
      [snap.id, target.id],
    );
    await c.query('UPDATE inventory_item SET retired_at=NULL WHERE id IN (SELECT item_id FROM inventory_snapshot_item WHERE snapshot_id=$1)', [snap.id]);
    await audit(c, user, 'inventory.snapshot.rollback', 'inventory_snapshot', snap.id, { to: target.version, version });
    return { snapshotId: snap.id, version };
  });
}

export interface InventoryRow {
  itemId: string;
  rmsId: string | null;
  product: string;
  productGroup: string | null;
  qtyShown: number | null;
  qtyShownRaw: string | null;
  rentalRate: number | null;
  currency: string | null;
  chargePeriod: string | null;
  dataFlag: string | null;
  issues: string[];
  inSourceFile: boolean;
  sourceRow: number | null;
  modelId: string | null;
  manufacturer: string | null;
  category: EngineeringCategory;
  categoryStatus: string;
  qtyConfirmed: number | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
  confirmBasis: string | null;
  specCount: number;
  duplicateOf: string | null;
  duplicateOfProduct: string | null;
  duplicateNote: string | null;
}

export async function listInventory(q: Q, tenantId: string, snapshotId?: string): Promise<{ snapshot: { id: string; version: number } | null; rows: InventoryRow[] }> {
  const snap = snapshotId ? await one<{ id: string; version: number }>(q, 'SELECT id, version FROM inventory_snapshot WHERE id=$1 AND tenant_id=$2', [snapshotId, tenantId]) : await currentSnapshot(q, tenantId);
  if (!snap) return { snapshot: null, rows: [] };
  const rows = await many<InventoryRow>(
    q,
    `SELECT si.item_id AS "itemId", si.rms_id AS "rmsId", si.product, si.product_group AS "productGroup", si.qty_shown AS "qtyShown",
            si.qty_shown_raw AS "qtyShownRaw", si.rental_rate AS "rentalRate", si.currency, si.charge_period AS "chargePeriod",
            si.data_flag AS "dataFlag", si.issues, si.in_source_file AS "inSourceFile", si.source_row AS "sourceRow",
            pm.id AS "modelId", pm.manufacturer, COALESCE(pm.category,'OTHER') AS category, COALESCE(pm.category_status,'UNKNOWN') AS "categoryStatus",
            qc.qty_owned AS "qtyConfirmed", qc.confirmed_at AS "confirmedAt", u.email AS "confirmedBy", qc.basis AS "confirmBasis",
            (SELECT count(*) FROM spec_value sv WHERE sv.product_model_id=pm.id AND sv.superseded_at IS NULL)::int AS "specCount",
            ii.duplicate_of AS "duplicateOf", ii.duplicate_note AS "duplicateNote",
            (SELECT d.product FROM inventory_snapshot_item d WHERE d.snapshot_id=si.snapshot_id AND d.item_id=ii.duplicate_of) AS "duplicateOfProduct"
     FROM inventory_snapshot_item si
     JOIN inventory_item ii ON ii.id=si.item_id
     LEFT JOIN product_model pm ON pm.id=ii.product_model_id
     LEFT JOIN quantity_confirmation qc ON qc.item_id=si.item_id AND qc.superseded_at IS NULL
     LEFT JOIN app_user u ON u.id=qc.confirmed_by
     WHERE si.snapshot_id=$1
     ORDER BY si.product_group NULLS LAST, si.product`,
    [snap.id],
  );
  return { snapshot: snap, rows };
}

export async function confirmQuantities(pool: pg.Pool, user: SessionUser, items: { itemId: string; qtyOwned: number }[], basis: string) {
  if (!basis.trim()) throw new HttpError(400, 'A basis for the confirmation is required (e.g. "physical stock count 2026-11-05").');
  return tx(pool, async (c) => {
    const snap = await currentSnapshot(c, user.tenantId);
    for (const it of items) {
      if (!Number.isInteger(it.qtyOwned) || it.qtyOwned < 0) throw new HttpError(400, `Invalid quantity for ${it.itemId}`);
      const owned = await one<{ duplicate_of: string | null }>(c, 'SELECT duplicate_of FROM inventory_item WHERE id=$1 AND tenant_id=$2', [it.itemId, user.tenantId]);
      if (!owned) throw new HttpError(404, `Item ${it.itemId} not found`);
      if (owned.duplicate_of) throw new HttpError(422, 'This record is marked as a duplicate — confirm the quantity on the record you are keeping');
      await c.query('UPDATE quantity_confirmation SET superseded_at=now() WHERE item_id=$1 AND superseded_at IS NULL', [it.itemId]);
      await c.query('INSERT INTO quantity_confirmation(item_id, qty_owned, basis, snapshot_id, confirmed_by) VALUES ($1,$2,$3,$4,$5)', [it.itemId, it.qtyOwned, basis, snap?.id ?? null, user.id]);
    }
    await audit(c, user, 'inventory.qty.confirmed', 'inventory_item', null, { count: items.length, basis, items });
    return { confirmed: items.length };
  });
}

export async function markDuplicate(pool: pg.Pool, user: SessionUser, itemId: string, ofItemId: string | null, note: string | null) {
  return tx(pool, async (c) => {
    const item = await one<{ id: string }>(c, 'SELECT id FROM inventory_item WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [itemId, user.tenantId]);
    if (!item) throw new HttpError(404, 'Item not found');
    if (ofItemId) {
      if (ofItemId === itemId) throw new HttpError(422, 'An item cannot be a duplicate of itself');
      const target = await one<{ duplicate_of: string | null }>(c, 'SELECT duplicate_of FROM inventory_item WHERE id=$1 AND tenant_id=$2', [ofItemId, user.tenantId]);
      if (!target) throw new HttpError(404, 'Target item not found');
      if (target.duplicate_of) throw new HttpError(422, 'The target is itself marked as a duplicate — choose the record you are keeping');
      const dependants = await one<{ n: number }>(c, 'SELECT count(*)::int AS n FROM inventory_item WHERE duplicate_of=$1', [itemId]);
      if (dependants!.n) throw new HttpError(422, 'Other records are marked as duplicates of this one; un-mark them first');
    }
    await c.query('UPDATE inventory_item SET duplicate_of=$2, duplicate_note=$3, duplicate_marked_by=$4, duplicate_marked_at=now() WHERE id=$1', [itemId, ofItemId, ofItemId ? note : null, user.id]);
    await audit(c, user, ofItemId ? 'inventory.item.marked_duplicate' : 'inventory.item.unmarked_duplicate', 'inventory_item', itemId, { ofItemId, note });
    return { ok: true };
  });
}

export async function specsForModels(q: Q, modelIds: string[]): Promise<Map<string, SpecSheet>> {
  const map = new Map<string, SpecSheet>();
  if (!modelIds.length) return map;
  const rows = await many<{ product_model_id: string; key: string; value_num: number | null; value_text: string | null; unit: string; status: string; source: unknown }>(
    q,
    'SELECT product_model_id, key, value_num, value_text, unit, status, source FROM spec_value WHERE product_model_id = ANY($1) AND superseded_at IS NULL',
    [modelIds],
  );
  for (const r of rows) {
    const s = map.get(r.product_model_id) ?? {};
    s[r.key] = { key: r.key, value: r.value_num ?? r.value_text, unit: r.unit, status: r.status as never, source: r.source as never };
    map.set(r.product_model_id, s);
  }
  return map;
}

/** The design engine's view of the current inventory: confirmed quantities + specs. */
export async function stockForDesign(q: Q, tenantId: string): Promise<{ snapshotId: string | null; stock: StockItem[] }> {
  const { snapshot, rows: all } = await listInventory(q, tenantId);
  // Records marked as duplicates of another record are never offered to the design engine.
  const rows = all.filter((r) => !r.duplicateOf);
  const specs = await specsForModels(q, rows.map((r) => r.modelId).filter(Boolean) as string[]);
  return {
    snapshotId: snapshot?.id ?? null,
    stock: rows.map((r) => ({
      itemId: r.itemId,
      rmsId: r.rmsId,
      product: r.product,
      productGroup: r.productGroup,
      category: r.category,
      modelId: r.modelId,
      qtyConfirmed: r.qtyConfirmed,
      qtyShown: r.qtyShown,
      rentalRate: r.rentalRate,
      chargePeriod: r.chargePeriod,
      currency: r.currency,
      specs: r.modelId ? specs.get(r.modelId) ?? {} : {},
    })),
  };
}
