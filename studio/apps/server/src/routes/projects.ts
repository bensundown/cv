import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { audit } from '../audit.js';
import { HttpError, requirePerm } from '../auth.js';
import { createRevision, handleMessage, initialParams, latestRevision, type RevisionRow } from '../design.js';
import { many, one } from '../db.js';
import { buildPdf } from '../pdf.js';
import { detectMime, putFile, readFile } from '../storage.js';

const Uuid = z.object({ id: z.string().uuid() });

async function revisionFor(pool: pg.Pool, tenantId: string, id: string) {
  const r = await one<RevisionRow & { project_name: string; client: string | null; mode: string; inventory_version: number | null }>(
    pool,
    `SELECT r.*, p.name AS project_name, p.client, p.mode, s.version AS inventory_version FROM design_revision r JOIN project p ON p.id=r.project_id
     LEFT JOIN inventory_snapshot s ON s.id=r.inventory_snapshot_id WHERE r.id=$1 AND p.tenant_id=$2`,
    [id, tenantId],
  );
  if (!r) throw new HttpError(404, 'Revision not found');
  return r;
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  // Prevent CSV formula injection when opened in Excel.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export async function projectRoutes(app: FastifyInstance, pool: pg.Pool) {
  app.get('/projects', async (req) => {
    const u = requirePerm(req, 'project.read');
    return many(
      pool,
      `SELECT p.id, p.name, p.client, p.mode, p.created_at, v.name AS venue_name,
              (SELECT number FROM design_revision r WHERE r.project_id=p.id ORDER BY number DESC LIMIT 1) AS latest_revision,
              (SELECT overall_status FROM design_revision r WHERE r.project_id=p.id ORDER BY number DESC LIMIT 1) AS overall_status
       FROM project p LEFT JOIN venue v ON v.id=p.venue_id WHERE p.tenant_id=$1 ORDER BY p.created_at DESC`,
      [u.tenantId],
    );
  });

  /** Preview what the brief interpreter extracts, before creating a project. */
  app.post('/briefs/parse', async (req) => {
    requirePerm(req, 'project.read');
    const b = z.object({ brief: z.string().max(20000), mode: z.enum(['concept', 'technical']).default('concept') }).parse(req.body);
    return initialParams(b.brief, b.mode);
  });

  app.post('/projects', async (req) => {
    const u = requirePerm(req, 'project.edit');
    const b = z.object({ name: z.string().min(1).max(200), client: z.string().max(200).optional(), venueId: z.string().uuid(), brief: z.string().max(20000), mode: z.enum(['concept', 'technical']).default('concept') }).parse(req.body);
    const venue = await one(pool, 'SELECT 1 FROM venue WHERE id=$1 AND tenant_id=$2', [b.venueId, u.tenantId]);
    if (!venue) throw new HttpError(404, 'Venue not found');
    const p = (await one<{ id: string }>(pool, 'INSERT INTO project(tenant_id, name, client, brief, venue_id, mode, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [u.tenantId, b.name, b.client ?? null, b.brief, b.venueId, b.mode, u.id]))!;
    await audit(pool, u, 'project.created', 'project', p.id, { name: b.name });
    const { params, extraction } = initialParams(b.brief, b.mode);
    await pool.query('INSERT INTO project_message(project_id, role, text, user_id) VALUES ($1,$2,$3,$4)', [p.id, 'user', b.brief, u.id]);
    const rev = await createRevision(pool, u, p.id, { params, summary: 'Initial design from brief', parentId: null });
    const found = extraction.extracted.map((e) => `${e.path} = ${typeof e.value === 'number' && e.path.endsWith('Mm') ? `${(e.value as number) / 1000} m` : String(e.value)}`);
    const reply = [
      `Revision 1 generated — overall status ${rev.overall_status}.`,
      found.length ? `From the brief I took: ${found.join(', ')}.` : 'I could not extract dimensions from the brief; system defaults were used (see assumption register).',
      extraction.requests.length ? `Requested but not yet designed by this version: ${extraction.requests.filter((r) => r !== 'FOH position').join(', ') || 'none'}.` : '',
      extraction.venueName ? `Venue named in brief: “${extraction.venueName}” (the project uses the venue you selected).` : '',
    ].filter(Boolean).join(' ');
    await pool.query('INSERT INTO project_message(project_id, role, text, revision_id) VALUES ($1,$2,$3,$4)', [p.id, 'assistant', reply, rev.id]);
    return { id: p.id, revisionId: rev.id };
  });

  app.get('/projects/:id', async (req) => {
    const u = requirePerm(req, 'project.read');
    const { id } = Uuid.parse(req.params);
    const project = await one(pool, 'SELECT p.*, v.name AS venue_name FROM project p LEFT JOIN venue v ON v.id=p.venue_id WHERE p.id=$1 AND p.tenant_id=$2', [id, u.tenantId]);
    if (!project) throw new HttpError(404, 'Project not found');
    const revisions = await many(pool, 'SELECT id, number, parent_id, overall_status, change_summary, created_at, input_hash FROM design_revision WHERE project_id=$1 ORDER BY number', [id]);
    const messages = await many(pool, 'SELECT id, role, text, revision_id, created_at FROM project_message WHERE project_id=$1 ORDER BY created_at', [id]);
    return { project, revisions, messages };
  });

  app.get('/revisions/:id', async (req) => {
    const u = requirePerm(req, 'project.read');
    const { id } = Uuid.parse(req.params);
    const r = await revisionFor(pool, u.tenantId, id);
    const approvals = await many(pool, 'SELECT a.discipline, a.decision, a.comment, a.at, u.email FROM approval a JOIN app_user u ON u.id=a.user_id WHERE a.revision_id=$1 ORDER BY a.at', [id]);
    const renders = await many(pool, 'SELECT id, file_id, kind, viewpoint, created_at FROM render_output WHERE revision_id=$1 ORDER BY created_at DESC', [id]);
    const { inputs: _inputs, ...rest } = r;
    return { ...rest, approvals, renders };
  });

  app.post('/projects/:id/messages', async (req) => {
    const u = requirePerm(req, 'project.edit');
    const { id } = Uuid.parse(req.params);
    const b = z.object({ text: z.string().min(1).max(2000), fromRevisionId: z.string().uuid().optional() }).parse(req.body);
    const p = await one(pool, 'SELECT 1 FROM project WHERE id=$1 AND tenant_id=$2', [id, u.tenantId]);
    if (!p) throw new HttpError(404, 'Project not found');
    const r = await handleMessage(pool, u, id, b.text, b.fromRevisionId);
    return { reply: r.reply, revisionId: r.revision?.id ?? null, viewpoint: r.viewpoint, recognised: r.recognised };
  });

  /** Re-run the latest revision's intent against the current inventory/venue (e.g. after confirming stock). */
  app.post('/projects/:id/regenerate', async (req) => {
    const u = requirePerm(req, 'project.edit');
    const { id } = Uuid.parse(req.params);
    const p = await one(pool, 'SELECT 1 FROM project WHERE id=$1 AND tenant_id=$2', [id, u.tenantId]);
    if (!p) throw new HttpError(404, 'Project not found');
    const base = await latestRevision(pool, id);
    if (!base) throw new HttpError(422, 'No revision to regenerate');
    const rev = await createRevision(pool, u, id, { params: base.params, stageWall: base.stage_wall_index, summary: 'Regenerated with current inventory and venue data', parentId: base.id });
    await pool.query('INSERT INTO project_message(project_id, role, text, revision_id) VALUES ($1,$2,$3,$4)', [id, 'assistant', `Revision ${rev.number} regenerated against the current inventory and venue geometry — status ${rev.overall_status}.`, rev.id]);
    return { revisionId: rev.id };
  });

  app.post('/revisions/:id/approvals', async (req) => {
    const u = requirePerm(req, 'project.approve');
    const { id } = Uuid.parse(req.params);
    const b = z.object({ discipline: z.string().min(1).max(100), decision: z.enum(['approved', 'rejected', 'comment']), comment: z.string().max(2000).optional() }).parse(req.body);
    const r = await revisionFor(pool, u.tenantId, id);
    if (!r.result.validation.humanApprovalsRequired.includes(b.discipline)) throw new HttpError(400, 'Unknown approval discipline for this revision');
    await pool.query('INSERT INTO approval(revision_id, discipline, decision, comment, user_id) VALUES ($1,$2,$3,$4,$5)', [id, b.discipline, b.decision, b.comment ?? null, u.id]);
    await audit(pool, u, 'revision.approval', 'design_revision', id, b);
    return { ok: true };
  });

  /** Store a native real-time render (PNG captured in the browser from this revision's scene). */
  app.post('/revisions/:id/renders', async (req) => {
    const u = requirePerm(req, 'project.edit');
    const { id } = Uuid.parse(req.params);
    await revisionFor(pool, u.tenantId, id);
    const file = await req.file();
    if (!file) throw new HttpError(400, 'No file');
    const buf = await file.toBuffer();
    if (detectMime(buf, file.filename) !== 'image/png') throw new HttpError(415, 'Render must be a PNG');
    const fields = file.fields as Record<string, { value?: string } | undefined>;
    const f = await putFile(pool, u.tenantId, u.id, buf, `render-${id}.png`, 'image/png');
    const r = await one<{ id: string }>(pool, `INSERT INTO render_output(revision_id, file_id, kind, viewpoint, created_by) VALUES ($1,$2,'native_realtime',$3,$4) RETURNING id`, [id, f.id, fields.viewpoint?.value ?? null, u.id]);
    return { id: r!.id, fileId: f.id };
  });

  app.get('/revisions/:id/export.pdf', async (req, reply) => {
    const u = requirePerm(req, 'project.read');
    const { id } = Uuid.parse(req.params);
    const r = await revisionFor(pool, u.tenantId, id);
    const approvals = await many<{ discipline: string; decision: string; email: string; at: Date; comment: string | null }>(pool, 'SELECT a.discipline, a.decision, a.comment, a.at, u.email FROM approval a JOIN app_user u ON u.id=a.user_id WHERE a.revision_id=$1', [id]);
    const render = await one<{ storage_key: string }>(pool, 'SELECT f.storage_key FROM render_output ro JOIN stored_file f ON f.id=ro.file_id WHERE ro.revision_id=$1 ORDER BY ro.created_at DESC LIMIT 1', [id]);
    const pdf = await buildPdf(r.result, {
      projectName: r.project_name,
      client: r.client,
      revisionNumber: r.number,
      revisionDate: new Date(r.created_at).toISOString(),
      inputHash: r.input_hash,
      mode: r.params.mode,
      inventoryVersion: r.inventory_version,
      approvals: approvals.map((a) => ({ discipline: a.discipline, decision: a.decision, user: a.email, at: new Date(a.at).toISOString(), comment: a.comment })),
      renderPng: render ? await readFile(render) : null,
    });
    await audit(pool, u, 'revision.exported', 'design_revision', id, { format: 'pdf' });
    reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `attachment; filename="${r.project_name.replace(/[^\w\- ]/g, '_')}-R${r.number}.pdf"`);
    return reply.send(pdf);
  });

  app.get('/revisions/:id/export/bom.csv', async (req, reply) => {
    const u = requirePerm(req, 'project.read');
    const { id } = Uuid.parse(req.params);
    const r = await revisionFor(pool, u.tenantId, id);
    const head = ['RMS ID', 'Product', 'Original product group', 'Engineering category', 'Purpose', 'Required', 'Allocated (owned)', 'Shortfall', 'Confirmed owned qty', 'File qty shown (provisional)', 'Quantity basis', 'Rental rate', 'Currency', 'Charge period'];
    const lines = r.result.bom.lines.map((l) => [l.rmsId, l.product, l.productGroup, l.category, l.purpose, l.required, l.allocated, l.shortfall, l.qtyConfirmed ?? 'NOT CONFIRMED', l.qtyShown, l.quantityBasis, l.rentalRate, l.currency, l.chargePeriod]);
    const unresolved = r.result.bom.unresolved.map((x) => ['', `UNRESOLVED: ${x.description}`, '', '', x.reason, '', '', '', '', '', '', '', '', '']);
    const csv = [head, ...lines, ...unresolved].map((row) => row.map(csvCell).join(',')).join('\r\n');
    reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="${r.project_name.replace(/[^\w\- ]/g, '_')}-R${r.number}-equipment.csv"`);
    return reply.send('﻿' + csv);
  });

  app.get('/revisions/:id/export/scene.json', async (req, reply) => {
    const u = requirePerm(req, 'project.read');
    const { id } = Uuid.parse(req.params);
    const r = await revisionFor(pool, u.tenantId, id);
    reply.header('Content-Disposition', `attachment; filename="scene-R${r.number}.json"`);
    return { format: 'sound-ninja-scene', version: 1, units: 'mm', revision: r.number, inputHash: r.input_hash, params: r.params, scene: r.result.scene, bom: r.result.bom, validation: r.result.validation };
  });
}
