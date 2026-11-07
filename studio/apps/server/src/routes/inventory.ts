import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { HttpError, requirePerm } from '../auth.js';
import { many, one } from '../db.js';
import { applyImport, confirmQuantities, listInventory, rollbackTo, stageImport } from '../inventory.js';
import { ALLOWED_MIME, detectMime, putFile } from '../storage.js';

export async function inventoryRoutes(app: FastifyInstance, pool: pg.Pool) {
  app.get('/inventory', async (req) => {
    const u = requirePerm(req, 'inventory.read');
    const q = z.object({ snapshotId: z.string().uuid().optional() }).parse(req.query);
    return listInventory(pool, u.tenantId, q.snapshotId);
  });

  app.get('/inventory/snapshots', async (req) => {
    const u = requirePerm(req, 'inventory.read');
    return many(
      pool,
      `SELECT s.id, s.version, s.kind, s.note, s.is_current, s.created_at, u.email AS created_by, f.original_name AS file_name,
              (SELECT count(*)::int FROM inventory_snapshot_item i WHERE i.snapshot_id=s.id) AS items
       FROM inventory_snapshot s LEFT JOIN app_user u ON u.id=s.created_by
       LEFT JOIN inventory_import im ON im.id=s.import_id LEFT JOIN stored_file f ON f.id=im.file_id
       WHERE s.tenant_id=$1 ORDER BY s.version DESC`,
      [u.tenantId],
    );
  });

  app.post('/inventory/imports', async (req) => {
    const u = requirePerm(req, 'inventory.import');
    const file = await req.file();
    if (!file) throw new HttpError(400, 'No file uploaded');
    const buf = await file.toBuffer();
    const mime = detectMime(buf, file.filename);
    if (!ALLOWED_MIME.inventory!.includes(mime) || !/\.(xlsx|csv)$/i.test(file.filename)) throw new HttpError(415, 'Upload an .xlsx or .csv inventory file');
    const stored = await putFile(pool, u.tenantId, u.id, buf, file.filename, mime);
    const id = await stageImport(pool, u, stored.id, buf, mime);
    return { importId: id };
  });

  app.get('/inventory/imports/:id', async (req) => {
    const u = requirePerm(req, 'inventory.read');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const imp = await one(
      pool,
      `SELECT im.id, im.status, im.sheet_name, im.parse_result, im.diff, im.error, im.created_at, im.applied_snapshot_id, f.original_name AS file_name, f.sha256
       FROM inventory_import im JOIN stored_file f ON f.id=im.file_id WHERE im.id=$1 AND im.tenant_id=$2`,
      [id, u.tenantId],
    );
    if (!imp) throw new HttpError(404, 'Import not found');
    return imp;
  });

  app.post('/inventory/imports/:id/apply', async (req) => {
    const u = requirePerm(req, 'inventory.import');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z
      .object({ removals: z.record(z.enum(['keep', 'retire'])).optional(), nameMatches: z.record(z.boolean()).optional(), note: z.string().max(500).optional() })
      .parse(req.body ?? {});
    return applyImport(pool, u, id, b);
  });

  app.post('/inventory/imports/:id/discard', async (req) => {
    const u = requirePerm(req, 'inventory.import');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await pool.query(`UPDATE inventory_import SET status='discarded' WHERE id=$1 AND tenant_id=$2 AND status='staged'`, [id, u.tenantId]);
    return { ok: true };
  });

  app.post('/inventory/snapshots/:id/rollback', async (req) => {
    const u = requirePerm(req, 'inventory.import');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return rollbackTo(pool, u, id);
  });

  /** Attest owned quantities. Either explicit quantities, or "accept the file quantity" for listed items. */
  app.post('/inventory/confirmations', async (req) => {
    const u = requirePerm(req, 'inventory.confirm_qty');
    const b = z
      .object({
        basis: z.string().min(3).max(300),
        items: z.array(z.object({ itemId: z.string().uuid(), qtyOwned: z.number().int().min(0).max(1_000_000) })).optional(),
        acceptShownFor: z.array(z.string().uuid()).max(5000).optional(),
      })
      .parse(req.body);
    const items = [...(b.items ?? [])];
    if (b.acceptShownFor?.length) {
      const { rows } = await listInventory(pool, u.tenantId);
      for (const id of b.acceptShownFor) {
        const r = rows.find((x) => x.itemId === id);
        if (!r) throw new HttpError(404, `Item ${id} is not in the current inventory`);
        if (r.qtyShown === null || !Number.isInteger(r.qtyShown) || r.qtyShown <= 0) throw new HttpError(422, `“${r.product}” has no positive file quantity to accept (blank, zero or fractional) — enter the owned quantity explicitly`);
        items.push({ itemId: id, qtyOwned: r.qtyShown });
      }
    }
    if (!items.length) throw new HttpError(400, 'Nothing to confirm');
    return confirmQuantities(pool, u, items, b.basis);
  });

  app.get('/inventory/items/:id/history', async (req) => {
    const u = requirePerm(req, 'inventory.read');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const confirmations = await many(pool, `SELECT qc.qty_owned, qc.basis, qc.confirmed_at, qc.superseded_at, u.email FROM quantity_confirmation qc JOIN app_user u ON u.id=qc.confirmed_by JOIN inventory_item i ON i.id=qc.item_id WHERE qc.item_id=$1 AND i.tenant_id=$2 ORDER BY qc.confirmed_at DESC`, [id, u.tenantId]);
    const snapshots = await many(pool, `SELECT s.version, si.product, si.product_group, si.qty_shown, si.rental_rate, si.charge_period, si.in_source_file, si.source_row FROM inventory_snapshot_item si JOIN inventory_snapshot s ON s.id=si.snapshot_id WHERE si.item_id=$1 AND s.tenant_id=$2 ORDER BY s.version DESC`, [id, u.tenantId]);
    return { confirmations, snapshots };
  });
}
