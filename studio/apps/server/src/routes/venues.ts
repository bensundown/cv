import { calibrate, pageToPlan, validatePolygon, weakest, type CalibrationInput, type CalibrationResult, type Confidence } from '@sn/core';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { audit } from '../audit.js';
import { HttpError, requirePerm } from '../auth.js';
import type { StoredGeometry } from '../design.js';
import { many, one, tx } from '../db.js';
import { ALLOWED_MIME, detectMime, putFile, readFile } from '../storage.js';

const Status = z.enum(['VERIFIED', 'PROVISIONAL', 'ESTIMATED', 'UNKNOWN']);
const PtZ = z.object({ x: z.number().finite(), y: z.number().finite() });
const MeasureZ = z.object({ p1: PtZ, p2: PtZ, knownLengthMm: z.number().positive().max(1e6), knownToleranceMm: z.number().min(0).max(1e4), referenceStatus: Status, referenceNote: z.string().max(500) });

export async function venueRoutes(app: FastifyInstance, pool: pg.Pool) {
  app.get('/venues', async (req) => {
    const u = requirePerm(req, 'project.read');
    return many(
      pool,
      `SELECT v.id, v.name, v.address, v.created_at,
              (SELECT max(version) FROM venue_geometry_version g WHERE g.venue_id=v.id) AS geometry_version,
              (SELECT status FROM venue_geometry_version g WHERE g.venue_id=v.id ORDER BY version DESC LIMIT 1) AS geometry_status
       FROM venue v WHERE v.tenant_id=$1 ORDER BY v.name`,
      [u.tenantId],
    );
  });

  app.post('/venues', async (req) => {
    const u = requirePerm(req, 'venue.edit');
    const b = z.object({ name: z.string().min(1).max(200), address: z.string().max(500).optional(), notes: z.string().max(5000).optional() }).parse(req.body);
    const v = await one<{ id: string }>(pool, 'INSERT INTO venue(tenant_id, name, address, notes, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id', [u.tenantId, b.name, b.address ?? null, b.notes ?? null, u.id]);
    await audit(pool, u, 'venue.created', 'venue', v!.id, b);
    return v;
  });

  app.get('/venues/:id', async (req) => {
    const u = requirePerm(req, 'project.read');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const venue = await one(pool, 'SELECT * FROM venue WHERE id=$1 AND tenant_id=$2', [id, u.tenantId]);
    if (!venue) throw new HttpError(404, 'Venue not found');
    const sources = await many(pool, 'SELECT * FROM venue_source WHERE venue_id=$1 ORDER BY retrieved_at DESC', [id]);
    const plans = await many(pool, `SELECT p.*, s.file_id, s.title, f.mime_type FROM venue_plan p JOIN venue_source s ON s.id=p.source_id LEFT JOIN stored_file f ON f.id=s.file_id WHERE p.venue_id=$1 ORDER BY p.created_at DESC`, [id]);
    const geometry = await many(pool, 'SELECT g.*, u.email AS created_by_email FROM venue_geometry_version g LEFT JOIN app_user u ON u.id=g.created_by WHERE venue_id=$1 ORDER BY version DESC', [id]);
    return { venue, sources, plans, geometry };
  });

  /** Upload a floor plan (PDF/PNG/JPEG) as a venue source document. */
  app.post('/venues/:id/plans', async (req) => {
    const u = requirePerm(req, 'venue.edit');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const v = await one(pool, 'SELECT 1 FROM venue WHERE id=$1 AND tenant_id=$2', [id, u.tenantId]);
    if (!v) throw new HttpError(404, 'Venue not found');
    const file = await req.file();
    if (!file) throw new HttpError(400, 'No file uploaded');
    const fields = file.fields as Record<string, { value?: string } | undefined>;
    const buf = await file.toBuffer();
    const mime = detectMime(buf, file.filename);
    if (!ALLOWED_MIME.plan!.includes(mime)) throw new HttpError(415, 'Upload a PDF, PNG or JPEG plan');
    return tx(pool, async (c) => {
      const f = await putFile(c, u.tenantId, u.id, buf, file.filename, mime);
      const src = await one<{ id: string }>(
        c,
        `INSERT INTO venue_source(venue_id, kind, title, url, file_id, document_date, licence, status, notes, created_by)
         VALUES ($1,'upload',$2,$3,$4,$5,$6,'PROVISIONAL',$7,$8) RETURNING id`,
        [id, fields.title?.value || file.filename, fields.url?.value || null, f.id, fields.documentDate?.value || null, fields.licence?.value || null, fields.notes?.value || null, u.id],
      );
      const plan = await one<{ id: string }>(c, 'INSERT INTO venue_plan(venue_id, source_id, page_number) VALUES ($1,$2,$3) RETURNING id', [id, src!.id, Number(fields.page?.value ?? 1) || 1]);
      await audit(c, u, 'venue.plan.uploaded', 'venue_plan', plan!.id, { venueId: id, file: f.original_name, sha256: f.sha256 });
      return { planId: plan!.id, fileId: f.id };
    });
  });

  /** Calibrate a plan from known dimensions. The scale is computed server-side by the core engine. */
  app.put('/plans/:id/calibration', async (req) => {
    const u = requirePerm(req, 'venue.edit');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z.object({ reference: MeasureZ, checks: z.array(MeasureZ).max(10).default([]), clickUncertaintyPt: z.number().positive().max(50), pageWidthPt: z.number().positive(), pageHeightPt: z.number().positive() }).parse(req.body);
    for (const m of [b.reference, ...b.checks]) if (m.referenceStatus === 'VERIFIED' && m.referenceNote.trim().length < 3) throw new HttpError(422, 'A VERIFIED reference dimension needs a source note (e.g. “Official tech spec p.3: room length 54.0 m”)');
    const plan = await one(pool, 'SELECT p.id FROM venue_plan p JOIN venue v ON v.id=p.venue_id WHERE p.id=$1 AND v.tenant_id=$2', [id, u.tenantId]);
    if (!plan) throw new HttpError(404, 'Plan not found');
    let result: CalibrationResult;
    try {
      result = calibrate(b as CalibrationInput);
    } catch (e) {
      throw new HttpError(422, (e as Error).message);
    }
    await pool.query('UPDATE venue_plan SET calibration=$2, calibration_status=$3, page_width_pt=$4, page_height_pt=$5 WHERE id=$1', [id, JSON.stringify({ input: b, result }), result.status, b.pageWidthPt, b.pageHeightPt]);
    await audit(pool, u, 'venue.plan.calibrated', 'venue_plan', id, { mmPerPt: result.mmPerPt, status: result.status, conflict: result.conflict });
    return result;
  });

  /** Save a new venue geometry version, from a traced, calibrated plan or from typed room dimensions. */
  app.post('/venues/:id/geometry', async (req) => {
    const u = requirePerm(req, 'venue.edit');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z
      .object({
        planId: z.string().uuid().optional(),
        pagePolygonPt: z.array(PtZ).min(3).max(200).optional(),
        pageObstacles: z.array(z.object({ label: z.string().max(100), polygon: z.array(PtZ).min(3).max(50) })).max(200).default([]),
        rectangleMm: z.object({ widthMm: z.number().positive().max(500000), depthMm: z.number().positive().max(500000) }).optional(),
        roomStatus: Status.optional(),
        roomSourceNote: z.string().max(500).default(''),
        ceilingHeight: z.object({ valueMm: z.number().positive().max(100000).nullable(), status: Status, sourceNote: z.string().max(500).default('') }),
        defaultStageWall: z.number().int().min(0).default(0),
        note: z.string().max(500).optional(),
      })
      .parse(req.body);
    const venue = await one<{ id: string }>(pool, 'SELECT id FROM venue WHERE id=$1 AND tenant_id=$2', [id, u.tenantId]);
    if (!venue) throw new HttpError(404, 'Venue not found');
    if (b.ceilingHeight.valueMm !== null && b.ceilingHeight.status === 'UNKNOWN') throw new HttpError(422, 'A ceiling height was entered with status UNKNOWN. Choose ESTIMATED for a guess, or PROVISIONAL/VERIFIED with a source — or leave the value blank.');
    if (b.ceilingHeight.status === 'VERIFIED' && b.ceilingHeight.sourceNote.trim().length < 3) throw new HttpError(422, 'A VERIFIED ceiling height needs a source note');

    let geometry: StoredGeometry;
    let planId: string | null = null;
    const ceiling = b.ceilingHeight.valueMm === null
      ? { value: null, status: 'UNKNOWN' as Confidence, source: { kind: 'derived' as const, note: 'Ceiling height not provided' }, unit: 'mm' }
      : { value: b.ceilingHeight.valueMm, status: b.ceilingHeight.status, source: { kind: 'venue_doc' as const, ref: b.ceilingHeight.sourceNote || 'user entry' }, unit: 'mm' };
    if (b.planId && b.pagePolygonPt) {
      const plan = await one<{ id: string; calibration: { result: CalibrationResult } | null; calibration_status: Confidence; source_status: Confidence; title: string }>(
        pool,
        `SELECT p.id, p.calibration, p.calibration_status, s.status AS source_status, s.title FROM venue_plan p JOIN venue_source s ON s.id=p.source_id WHERE p.id=$1 AND p.venue_id=$2`,
        [b.planId, id],
      );
      if (!plan) throw new HttpError(404, 'Plan not found');
      if (!plan.calibration) throw new HttpError(422, 'Calibrate the plan scale before tracing geometry — an uncalibrated plan is not a dimensional reference.');
      const k = plan.calibration.result.mmPerPt;
      // Keep the traced vertex order: wall numbers (W1, W2, …) must match what the user drew.
      const poly = b.pagePolygonPt.map((p) => pageToPlan(p, k));
      const errs = validatePolygon(poly);
      if (errs.length) throw new HttpError(422, `Room outline invalid: ${errs.join('; ')}`);
      planId = plan.id;
      // Traced geometry can be no more certain than either the calibration or the source document itself.
      const roomStatus = weakest(plan.calibration_status, plan.source_status);
      geometry = {
        roomPolygonMm: poly,
        obstacles: b.pageObstacles.map((o, i) => ({ id: `o${i + 1}`, label: o.label || `Obstruction ${i + 1}`, polygon: o.polygon.map((p) => pageToPlan(p, k)) })),
        ceilingHeight: ceiling,
        roomStatus,
        roomSourceRef: `${plan.title} (traced, calibrated ${plan.calibration_status})${b.roomSourceNote ? ` — ${b.roomSourceNote}` : ''}`,
        calibrationStatus: plan.calibration_status,
        calibrationRelUncertainty: plan.calibration.result.relUncertainty,
        defaultStageWall: Math.min(b.defaultStageWall, poly.length - 1),
        pagePolygonPt: b.pagePolygonPt,
        pageObstaclesPt: b.pageObstacles,
      };
    } else if (b.rectangleMm) {
      const status = b.roomStatus ?? 'PROVISIONAL';
      if (status === 'VERIFIED' && b.roomSourceNote.trim().length < 3) throw new HttpError(422, 'VERIFIED room dimensions need a source note (official document reference)');
      const { widthMm: w, depthMm: d } = b.rectangleMm;
      geometry = {
        roomPolygonMm: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: d }, { x: 0, y: d }],
        obstacles: [],
        ceilingHeight: ceiling,
        roomStatus: status,
        roomSourceRef: b.roomSourceNote || 'Typed room dimensions',
        calibrationStatus: status,
        calibrationRelUncertainty: null,
        defaultStageWall: Math.min(b.defaultStageWall, 3),
      };
    } else throw new HttpError(400, 'Provide either a traced plan outline or rectangular room dimensions');

    const version = ((await one<{ v: number | null }>(pool, 'SELECT max(version) AS v FROM venue_geometry_version WHERE venue_id=$1', [id]))!.v ?? 0) + 1;
    const row = await one<{ id: string }>(pool, 'INSERT INTO venue_geometry_version(venue_id, plan_id, version, geometry, status, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [id, planId, version, JSON.stringify(geometry), geometry.roomStatus, b.note ?? null, u.id]);
    await audit(pool, u, 'venue.geometry.saved', 'venue', id, { version, status: geometry.roomStatus, ceiling: ceiling.status });
    return { id: row!.id, version, geometry };
  });

  /** Record provenance of a venue source document (official status, licence, date). */
  app.patch('/venue-sources/:id', async (req) => {
    const u = requirePerm(req, 'venue.edit');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z.object({ status: Status, title: z.string().max(300).optional(), url: z.string().url().max(1000).nullable().optional(), documentDate: z.string().max(20).nullable().optional(), licence: z.string().max(300).nullable().optional(), notes: z.string().max(2000).nullable().optional() }).parse(req.body);
    if (b.status === 'VERIFIED' && !(b.url || (b.notes && b.notes.trim().length >= 3))) throw new HttpError(422, 'Marking a source VERIFIED needs its origin: an official URL or a note on where it came from (e.g. “emailed by venue technical manager 2026-10-02”).');
    const r = await one(
      pool,
      `UPDATE venue_source s SET status=$3, title=COALESCE($4,title), url=COALESCE($5,url), document_date=COALESCE($6::date,document_date), licence=COALESCE($7,licence), notes=COALESCE($8,notes)
       FROM venue v WHERE s.id=$1 AND v.id=s.venue_id AND v.tenant_id=$2 RETURNING s.*`,
      [id, u.tenantId, b.status, b.title ?? null, b.url ?? null, b.documentDate ?? null, b.licence ?? null, b.notes ?? null],
    );
    if (!r) throw new HttpError(404, 'Source not found');
    await audit(pool, u, 'venue.source.updated', 'venue_source', id, b);
    return r;
  });

  /** Authenticated, tenant-scoped file download. */
  app.get('/files/:id', async (req, reply) => {
    const u = requirePerm(req, 'project.read');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const f = await one<{ storage_key: string; mime_type: string; original_name: string }>(pool, 'SELECT storage_key, mime_type, original_name FROM stored_file WHERE id=$1 AND tenant_id=$2', [id, u.tenantId]);
    if (!f) throw new HttpError(404, 'File not found');
    reply.header('Content-Type', f.mime_type).header('Content-Disposition', `inline; filename="${f.original_name.replace(/"/g, '')}"`).header('Cache-Control', 'private, max-age=300');
    return reply.send(await readFile(f));
  });
}
