import { ENGINEERING_CATEGORIES, RELATIONSHIP_TYPES, SPEC_KEY_MAP, SPEC_KEYS } from '@sn/core';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { audit } from '../audit.js';
import { can, HttpError, requirePerm } from '../auth.js';
import { many, one, tx } from '../db.js';

const Status = z.enum(['VERIFIED', 'PROVISIONAL', 'ESTIMATED', 'UNKNOWN']);
const SourceZ = z.object({
  kind: z.enum(['manufacturer_doc', 'user_entry', 'user_confirmation', 'venue_doc', 'derived', 'name_parse', 'design_default', 'inventory_file', 'calibrated_plan', 'brief']),
  ref: z.string().max(500).optional(),
  url: z.string().url().max(1000).optional(),
  documentDate: z.string().max(40).optional(),
  licence: z.string().max(200).optional(),
  note: z.string().max(1000).optional(),
});

export async function equipmentRoutes(app: FastifyInstance, pool: pg.Pool) {
  app.get('/equipment/meta', async (req) => {
    requirePerm(req, 'inventory.read');
    return { specKeys: SPEC_KEYS, categories: ENGINEERING_CATEGORIES, relationshipTypes: RELATIONSHIP_TYPES };
  });

  app.get('/models', async (req) => {
    const u = requirePerm(req, 'inventory.read');
    return many(pool, 'SELECT id, manufacturer, model, variant, category, category_status, identity_status FROM product_model WHERE tenant_id=$1 ORDER BY category, model', [u.tenantId]);
  });

  app.get('/models/:id', async (req) => {
    const u = requirePerm(req, 'inventory.read');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const model = await one(pool, 'SELECT * FROM product_model WHERE id=$1 AND tenant_id=$2', [id, u.tenantId]);
    if (!model) throw new HttpError(404, 'Model not found');
    const specs = await many(pool, 'SELECT s.*, u.email AS entered_by_email FROM spec_value s LEFT JOIN app_user u ON u.id=s.entered_by WHERE product_model_id=$1 ORDER BY key, entered_at DESC', [id]);
    const relationships = await many(
      pool,
      `SELECT r.*, f.model AS from_model, t.model AS to_model FROM equipment_relationship r JOIN product_model f ON f.id=r.from_model_id LEFT JOIN product_model t ON t.id=r.to_model_id
       WHERE (r.from_model_id=$1 OR r.to_model_id=$1) AND r.superseded_at IS NULL ORDER BY r.created_at`,
      [id],
    );
    const items = await many(pool, `SELECT ii.id, ii.rms_id, si.product, si.product_group FROM inventory_item ii JOIN inventory_snapshot_item si ON si.item_id=ii.id JOIN inventory_snapshot s ON s.id=si.snapshot_id AND s.is_current WHERE ii.product_model_id=$1`, [id]);
    return { model, specs, relationships, items };
  });

  app.patch('/models/:id', async (req) => {
    const u = requirePerm(req, 'equipment.edit');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z.object({ manufacturer: z.string().max(100).nullable().optional(), category: z.enum(ENGINEERING_CATEGORIES).optional(), notes: z.string().max(2000).optional() }).parse(req.body);
    const r = await one(
      pool,
      `UPDATE product_model SET manufacturer=COALESCE($3, manufacturer), category=COALESCE($4, category), category_status=CASE WHEN $4::text IS NULL THEN category_status ELSE 'PROVISIONAL' END, notes=COALESCE($5, notes)
       WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [id, u.tenantId, b.manufacturer ?? null, b.category ?? null, b.notes ?? null],
    );
    if (!r) throw new HttpError(404, 'Model not found');
    await audit(pool, u, 'model.updated', 'product_model', id, b);
    return r;
  });

  /** Record a spec value (append-only; supersedes the current value for that key). */
  app.post('/models/:id/specs', async (req) => {
    const u = requirePerm(req, 'equipment.edit');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z.object({ key: z.string(), value: z.union([z.number().finite(), z.string().max(50)]).nullable(), status: Status, source: SourceZ }).parse(req.body);
    const def = SPEC_KEY_MAP.get(b.key);
    if (!def) throw new HttpError(400, `Unknown spec key ${b.key}`);
    const isEnum = def.kind === 'enum';
    if (b.value !== null && isEnum !== (typeof b.value === 'string')) throw new HttpError(422, isEnum ? `${b.key} takes one of: ${def.options!.join(', ')}` : `${b.key} must be a number`);
    if (isEnum && b.value !== null && !def.options!.includes(b.value as string)) throw new HttpError(422, `${b.key} must be one of: ${def.options!.join(', ')}`);
    if (b.status === 'VERIFIED') {
      if (!can(u, 'equipment.verify')) throw new HttpError(403, 'Only a technical reviewer or admin can mark a specification VERIFIED');
      if (!b.source.ref && !b.source.url) throw new HttpError(422, 'A VERIFIED specification needs a source reference or URL');
      if (!['manufacturer_doc', 'user_confirmation'].includes(b.source.kind)) throw new HttpError(422, 'VERIFIED specifications must come from manufacturer documentation or a recorded physical measurement');
    }
    if (typeof b.value === 'number' && b.value <= 0) throw new HttpError(422, 'Value must be positive');
    return tx(pool, async (c) => {
      const m = await one(c, 'SELECT 1 FROM product_model WHERE id=$1 AND tenant_id=$2', [id, u.tenantId]);
      if (!m) throw new HttpError(404, 'Model not found');
      await c.query('UPDATE spec_value SET superseded_at=now() WHERE product_model_id=$1 AND key=$2 AND superseded_at IS NULL', [id, b.key]);
      const row = await one(c, 'INSERT INTO spec_value(product_model_id, key, value_num, value_text, unit, status, source, entered_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [id, b.key, typeof b.value === 'number' ? b.value : null, typeof b.value === 'string' ? b.value : null, def.unit, b.value === null ? 'UNKNOWN' : b.status, JSON.stringify(b.source), u.id]);
      await audit(c, u, 'spec.recorded', 'product_model', id, { key: b.key, value: b.value, status: b.status, source: b.source });
      return row;
    });
  });

  app.post('/relationships', async (req) => {
    const u = requirePerm(req, 'equipment.edit');
    const b = z
      .object({
        type: z.enum(RELATIONSHIP_TYPES),
        fromModelId: z.string().uuid(),
        toModelId: z.string().uuid().nullable().optional(),
        toCategory: z.enum(ENGINEERING_CATEGORIES).nullable().optional(),
        quantity: z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('per_unit'), ratio: z.number().positive().max(1000) }),
          z.object({ kind: z.literal('per_n_units'), per: z.number().int().positive(), qty: z.number().int().positive(), rounding: z.literal('ceil') }),
          z.object({ kind: z.literal('fixed'), qty: z.number().int().positive() }),
          z.object({ kind: z.literal('none') }),
        ]),
        constraints: z.record(z.unknown()).default({}),
        evidence: z.array(SourceZ).default([]),
        status: Status,
      })
      .parse(req.body);
    if (!b.toModelId && !b.toCategory) throw new HttpError(400, 'Choose a target model or category');
    if (b.status === 'VERIFIED' && (!can(u, 'equipment.verify') || !b.evidence.some((e) => e.ref || e.url))) throw new HttpError(422, 'VERIFIED relationships need a technical reviewer and documented evidence');
    const ok = await one<{ n: number }>(pool, 'SELECT count(*)::int AS n FROM product_model WHERE tenant_id=$1 AND id = ANY($2)', [u.tenantId, [b.fromModelId, ...(b.toModelId ? [b.toModelId] : [])]]);
    if (ok!.n !== (b.toModelId ? 2 : 1)) throw new HttpError(404, 'Model not found');
    const row = await one<{ id: string }>(
      pool,
      `INSERT INTO equipment_relationship(tenant_id, type, from_model_id, to_model_id, to_category, quantity_rule, constraints, evidence, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [u.tenantId, b.type, b.fromModelId, b.toModelId ?? null, b.toCategory ?? null, JSON.stringify(b.quantity), JSON.stringify(b.constraints), JSON.stringify(b.evidence), b.status, u.id],
    );
    await audit(pool, u, 'relationship.created', 'equipment_relationship', row!.id, b);
    return row;
  });

  app.delete('/relationships/:id', async (req) => {
    const u = requirePerm(req, 'equipment.edit');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await pool.query('UPDATE equipment_relationship SET superseded_at=now() WHERE id=$1 AND tenant_id=$2', [id, u.tenantId]);
    await audit(pool, u, 'relationship.superseded', 'equipment_relationship', id);
    return { ok: true };
  });
}
