import crypto from 'node:crypto';
import {
  applyBrief,
  applyOps,
  canonicalJson,
  defaultParams,
  effectiveParams,
  generateDesign,
  interpretCommand,
  parseBrief,
  type Confidence,
  type DesignContext,
  type DesignParams,
  type DesignResult,
  type EquipmentRelationship,
  type Obstacle,
  type Pt,
  type Sourced,
  type VenueGeometry,
} from '@sn/core';
import type pg from 'pg';
import { audit } from './audit.js';
import { HttpError, type SessionUser } from './auth.js';
import { many, one, tx, type Q } from './db.js';
import { stockForDesign } from './inventory.js';

/** Stored geometry JSON for a venue_geometry_version. */
export interface StoredGeometry {
  roomPolygonMm: Pt[];
  obstacles: Obstacle[];
  ceilingHeight: Sourced<number>;
  roomStatus: Confidence;
  roomSourceRef: string;
  calibrationStatus: Confidence;
  calibrationRelUncertainty: number | null;
  defaultStageWall: number;
  /** Page-space polygon (pt) when traced from a plan, for overlay. */
  pagePolygonPt?: Pt[];
  pageObstaclesPt?: { label: string; polygon: Pt[] }[];
}

export async function loadRelationships(q: Q, tenantId: string): Promise<EquipmentRelationship[]> {
  const rows = await many<{ id: string; type: string; from_model_id: string; to_model_id: string | null; to_category: string | null; to_one_of: string[] | null; quantity_rule: unknown; constraints: Record<string, unknown>; evidence: unknown[]; status: Confidence }>(
    q,
    'SELECT * FROM equipment_relationship WHERE tenant_id=$1 AND superseded_at IS NULL ORDER BY created_at',
    [tenantId],
  );
  return rows.map((r) => ({
    id: r.id,
    type: r.type as EquipmentRelationship['type'],
    fromModelId: r.from_model_id,
    to: { ...(r.to_model_id ? { modelId: r.to_model_id } : {}), ...(r.to_category ? { category: r.to_category as never } : {}), ...(r.to_one_of ? { oneOf: r.to_one_of } : {}) },
    quantity: r.quantity_rule as EquipmentRelationship['quantity'],
    constraints: r.constraints,
    evidence: r.evidence as EquipmentRelationship['evidence'],
    status: r.status,
  }));
}

export async function latestGeometry(q: Q, venueId: string) {
  return one<{ id: string; version: number; geometry: StoredGeometry; status: Confidence; venue_name: string }>(
    q,
    `SELECT g.id, g.version, g.geometry, g.status, v.name AS venue_name FROM venue_geometry_version g JOIN venue v ON v.id=g.venue_id
     WHERE g.venue_id=$1 ORDER BY g.version DESC LIMIT 1`,
    [venueId],
  );
}

function toVenue(name: string, g: StoredGeometry, stageWall: number): VenueGeometry {
  return {
    venueName: name,
    roomPolygon: g.roomPolygonMm,
    roomStatus: g.roomStatus,
    roomSource: { kind: g.calibrationStatus === 'UNKNOWN' ? 'user_entry' : 'calibrated_plan', ref: g.roomSourceRef },
    obstacles: g.obstacles,
    ceilingHeight: g.ceilingHeight,
    stageWallIndex: stageWall,
    calibrationStatus: g.calibrationStatus,
    calibrationRelUncertainty: g.calibrationRelUncertainty,
  };
}

export interface RevisionRow {
  id: string;
  project_id: string;
  number: number;
  parent_id: string | null;
  params: DesignParams;
  stage_wall_index: number;
  inventory_snapshot_id: string | null;
  venue_geometry_id: string | null;
  inputs: DesignContext;
  input_hash: string;
  result: DesignResult;
  overall_status: string;
  change_summary: string;
  created_at: string;
}

/** Build a frozen context from the CURRENT inventory/venue, run the engine, store an immutable revision. */
export async function createRevision(
  pool: pg.Pool,
  user: SessionUser,
  projectId: string,
  opts: { params: DesignParams; stageWall?: number; summary: string; parentId: string | null },
): Promise<RevisionRow> {
  return tx(pool, async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`project:${projectId}`]);
    const project = await one<{ id: string; venue_id: string | null; tenant_id: string }>(c, 'SELECT id, venue_id, tenant_id FROM project WHERE id=$1', [projectId]);
    if (!project || project.tenant_id !== user.tenantId) throw new HttpError(404, 'Project not found');
    if (!project.venue_id) throw new HttpError(422, 'Project has no venue');
    const geo = await latestGeometry(c, project.venue_id);
    if (!geo) throw new HttpError(422, 'The venue has no geometry yet. Upload and calibrate a plan, or enter the room dimensions.');
    const { snapshotId, stock } = await stockForDesign(c, user.tenantId);
    const relationships = await loadRelationships(c, user.tenantId);
    const stageWall = opts.stageWall ?? geo.geometry.defaultStageWall;
    const ctx: DesignContext = { params: opts.params, venue: toVenue(geo.venue_name, geo.geometry, stageWall), stock, relationships };
    const inputHash = crypto.createHash('sha256').update(canonicalJson(ctx)).digest('hex');
    const result = generateDesign(ctx);
    const number = ((await one<{ n: number | null }>(c, 'SELECT MAX(number) AS n FROM design_revision WHERE project_id=$1', [projectId]))!.n ?? 0) + 1;
    const row = (await one<RevisionRow>(
      c,
      `INSERT INTO design_revision(project_id, number, parent_id, params, stage_wall_index, inventory_snapshot_id, venue_geometry_id, inputs, input_hash, result, overall_status, change_summary, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [projectId, number, opts.parentId, JSON.stringify(opts.params), stageWall, snapshotId, geo.id, JSON.stringify(ctx), inputHash, JSON.stringify(result), result.validation.overall, opts.summary, user.id],
    ))!;
    await audit(c, user, 'design.revision.created', 'design_revision', row.id, { projectId, number, inputHash, overall: result.validation.overall });
    return row;
  });
}

export function initialParams(brief: string, mode: 'concept' | 'technical') {
  const extraction = parseBrief(brief);
  const params = applyBrief(defaultParams(), extraction);
  params.mode = mode;
  return { params, extraction };
}

export async function latestRevision(q: Q, projectId: string) {
  return one<RevisionRow>(q, 'SELECT * FROM design_revision WHERE project_id=$1 ORDER BY number DESC LIMIT 1', [projectId]);
}

/** Interpret a conversational message and, if it contains supported changes, create a new revision. */
export async function handleMessage(pool: pg.Pool, user: SessionUser, projectId: string, text: string, fromRevisionId?: string) {
  const base = fromRevisionId ? await one<RevisionRow>(pool, 'SELECT * FROM design_revision WHERE id=$1 AND project_id=$2', [fromRevisionId, projectId]) : await latestRevision(pool, projectId);
  if (!base) throw new HttpError(422, 'Project has no revision yet');
  await pool.query('INSERT INTO project_message(project_id, role, text, user_id) VALUES ($1,$2,$3,$4)', [projectId, 'user', text, user.id]);
  const cmd = interpretCommand(text);
  let revision: RevisionRow | null = null;
  let reply = cmd.reply;
  if (cmd.ops.length) {
    // Resolve engine-chosen values (stage height, default lighting counts) so relative changes have a base.
    const p = effectiveParams(base.params, base.result, cmd.ops.filter((o) => o.op === 'add').map((o) => o.path));
    const applied = applyOps(p, cmd.ops);
    if (applied.errors.length) reply = `I couldn't apply that: ${applied.errors.join('; ')}.`;
    else {
      revision = await createRevision(pool, user, projectId, { params: applied.params, ...(applied.stageWall !== undefined ? { stageWall: applied.stageWall } : { stageWall: base.stage_wall_index }), summary: text, parentId: base.id });
      reply = `${cmd.reply} Revision ${revision.number} status: ${revision.overall_status}.`;
    }
  }
  await pool.query('INSERT INTO project_message(project_id, role, text, revision_id) VALUES ($1,$2,$3,$4)', [projectId, 'assistant', reply, revision?.id ?? null]);
  return { reply, revision, viewpoint: cmd.viewpoint ?? null, recognised: cmd.recognised };
}
