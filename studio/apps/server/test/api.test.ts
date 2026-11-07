/**
 * API integration tests against a real PostgreSQL database (TEST_DATABASE_URL).
 * All inventory data here is SYNTHETIC test data, not Sound Ninja stock.
 */
import ExcelJS from 'exceljs';
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgres://sn:sn@127.0.0.1:5432/sound_ninja_test';
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-storage-'));

let app: FastifyInstance;
let pool: pg.Pool;
let cookie = '';

const HEADER = ['RMS ID', 'Product', 'Product group', "Qty shown ('available to rent')", 'Rental rate (R)', 'Charge period', 'Data flag'];
async function xlsx(rows: unknown[][], sheet = 'Inventory'): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Notes').addRow(['Synthetic test workbook']);
  const ws = wb.addWorksheet(sheet);
  ws.addRow(HEADER);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const V1 = [
  ['2001', 'Leyard 2.6mm 500 x 500mm LED Panel', 'LED Screens', 150, 250, 'Day', null],
  ['2002', 'Novastar VX600', 'LED Processing', 2, 1500, 'Day', null],
  ['2003', 'AluStage Deck 2m x 1m', 'Staging', 60, 300, 'Day', null],
  ['2004', 'AluStage Leg 1m', 'Staging', 300, 0, 'Day', null],
  ['2005', 'FBT Muse 210LA', 'Audio', 0, 900, 'Day', null],
  ['2006', 'Old Mirror Ball', 'Lighting', 1, 50, 'Day', null],
];

function multipart(field: string, filename: string, buf: Buffer, contentType: string, extra: Record<string, string> = {}) {
  const boundary = '----sntest' + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(extra)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`), buf, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

const req = async (method: string, url: string, body?: unknown, extraHeaders: Record<string, string> = {}, ck = cookie) => {
  const r = await app.inject({ method: method as 'GET', url, headers: { cookie: ck, 'x-sn-request': '1', ...extraHeaders }, ...(body !== undefined ? { payload: body as string } : {}) });
  return { status: r.statusCode, json: () => r.json(), body: r.rawPayload, headers: r.headers };
};

async function upload(url: string, filename: string, buf: Buffer, type: string, extra: Record<string, string> = {}) {
  const m = multipart('file', filename, buf, type, extra);
  const r = await app.inject({ method: 'POST', url, headers: { cookie, 'x-sn-request': '1', ...m.headers }, payload: m.payload });
  return { status: r.statusCode, json: () => r.json() };
}

function planPdf(): Promise<Buffer> {
  return new Promise((res) => {
    const d = new PDFDocument({ size: 'A3', layout: 'landscape' });
    const chunks: Buffer[] = [];
    d.on('data', (c: Buffer) => chunks.push(c));
    d.on('end', () => res(Buffer.concat(chunks)));
    d.rect(100, 100, 400, 300).stroke(); // synthetic room: 400 × 300 pt
    d.end();
  });
}

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: TEST_DB });
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  const { migrate } = await import('../src/migrate.js');
  await migrate(pool, () => undefined);
  const { buildApp } = await import('../src/app.js');
  app = await buildApp(pool);
});
afterAll(async () => {
  await app?.close();
  await pool?.end();
});

describe('auth & security', () => {
  it('first-run setup creates the admin once', async () => {
    expect((await req('GET', '/api/setup/status')).json()).toMatchObject({ needsSetup: true });
    const r = await app.inject({ method: 'POST', url: '/api/setup', headers: { 'x-sn-request': '1' }, payload: { email: 'admin@example.test', name: 'Admin', password: 'correct horse battery' } });
    expect(r.statusCode).toBe(200);
    cookie = String(r.headers['set-cookie']).split(';')[0]!;
    expect(String(r.headers['set-cookie'])).toMatch(/HttpOnly/i);
    expect(String(r.headers['set-cookie'])).toMatch(/SameSite=Strict/i);
    const again = await app.inject({ method: 'POST', url: '/api/setup', headers: { 'x-sn-request': '1' }, payload: { email: 'x@example.test', name: 'X', password: 'correct horse battery' } });
    expect(again.statusCode).toBe(409);
  });
  it('rejects unauthenticated and CSRF-less requests', async () => {
    expect((await req('GET', '/api/inventory', undefined, {}, '')).status).toBe(401);
    const r = await app.inject({ method: 'POST', url: '/api/venues', headers: { cookie }, payload: { name: 'X' } });
    expect(r.statusCode).toBe(403);
  });
  it('enforces role permissions', async () => {
    expect((await req('POST', '/api/users', { email: 'viewer@example.test', name: 'V', password: 'viewer password 1', role: 'viewer' })).status).toBe(200);
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'x-sn-request': '1' }, payload: { email: 'viewer@example.test', password: 'viewer password 1' } });
    const vc = String(login.headers['set-cookie']).split(';')[0]!;
    expect((await req('GET', '/api/inventory', undefined, {}, vc)).status).toBe(200);
    const m = multipart('file', 'inv.xlsx', await xlsx(V1), 'application/octet-stream');
    const r = await app.inject({ method: 'POST', url: '/api/inventory/imports', headers: { cookie: vc, 'x-sn-request': '1', ...m.headers }, payload: m.payload });
    expect(r.statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'x-sn-request': '1' }, payload: { email: 'viewer@example.test', password: 'wrong' } })).statusCode).toBe(401);
  });
});

let snapshot1 = '';
describe('inventory import lifecycle', () => {
  it('stages an import with preview, then applies it as snapshot v1', async () => {
    const up = await upload('/api/inventory/imports', 'SNI_test.xlsx', await xlsx(V1), 'application/octet-stream');
    expect(up.status).toBe(200);
    const imp = (await req('GET', `/api/inventory/imports/${up.json().importId}`)).json();
    expect(imp.status).toBe('staged');
    expect(imp.sheet_name).toBe('Inventory');
    expect(imp.diff.summary.added).toBe(6);
    expect(imp.parse_result.issues.map((i: { code: string }) => i.code)).toEqual(expect.arrayContaining(['QTY_ZERO', 'RATE_ZERO']));
    expect((await req('GET', '/api/inventory')).json().snapshot).toBeNull(); // nothing applied yet
    const ap = await req('POST', `/api/inventory/imports/${up.json().importId}/apply`, {});
    expect(ap.json()).toMatchObject({ version: 1, created: 6 });
    snapshot1 = ap.json().snapshotId;
    const inv = (await req('GET', '/api/inventory')).json();
    expect(inv.rows).toHaveLength(6);
    const led = inv.rows.find((r: { rmsId: string }) => r.rmsId === '2001');
    expect(led.category).toBe('LED_PANEL');
    expect(led.qtyConfirmed).toBeNull(); // provisional until confirmed
    expect(led.specCount).toBeGreaterThanOrEqual(3); // name-parsed hints (ESTIMATED)
  });

  it('a corrupt file fails without touching the current inventory', async () => {
    const up = await upload('/api/inventory/imports', 'broken.xlsx', Buffer.from('PK\u0003\u0004 not really a zip'), 'application/octet-stream');
    expect(up.status).toBe(422);
    const inv = (await req('GET', '/api/inventory')).json();
    expect(inv.snapshot.version).toBe(1);
  });

  it('a file with duplicate RMS IDs cannot be applied', async () => {
    const up = await upload('/api/inventory/imports', 'dup.xlsx', await xlsx([...V1, ['2001', 'Dup', 'X', 1, 1, 'Day', null]]), 'application/octet-stream');
    expect((await req('POST', `/api/inventory/imports/${up.json().importId}/apply`, {})).status).toBe(422);
  });

  it('re-upload: detects changes, renames, removals; keep vs retire; confirmations survive', async () => {
    const items = (await req('GET', '/api/inventory')).json().rows as { itemId: string; rmsId: string }[];
    const id = (rms: string) => items.find((r) => r.rmsId === rms)!.itemId;
    // Confirm owned quantities (attestation).
    const conf = await req('POST', '/api/inventory/confirmations', { basis: 'Synthetic test count', acceptShownFor: [id('2001'), id('2002'), id('2003'), id('2004')] });
    expect(conf.json()).toEqual({ confirmed: 4 });
    const v2 = V1.filter((r) => r[0] !== '2005' && r[0] !== '2006').map((r) => (r[0] === '2002' ? ['2002', 'Novastar VX600 Pro-test', 'LED Processing', 3, 1500, 'Day', null] : r));
    v2.push(['2007', 'Novastar VX1000', 'LED Processing', 1, 2000, 'Day', null]);
    const up = await upload('/api/inventory/imports', 'v2.csv', Buffer.from([HEADER, ...v2].map((r) => r.map((c) => (c === null ? '' : String(c))).join(',')).join('\n')), 'text/csv');
    const imp = (await req('GET', `/api/inventory/imports/${up.json().importId}`)).json();
    expect(imp.diff.summary).toMatchObject({ added: 1, renamed: 1, removal_proposed: 2 });
    const ap = await req('POST', `/api/inventory/imports/${up.json().importId}/apply`, { removals: { [id('2005')]: 'keep', [id('2006')]: 'retire' } });
    expect(ap.json()).toMatchObject({ version: 2, kept: 1, retired: 1, created: 1 });
    const inv = (await req('GET', '/api/inventory')).json();
    expect(inv.rows.map((r: { rmsId: string }) => r.rmsId).sort()).toEqual(['2001', '2002', '2003', '2004', '2005', '2007']);
    const muse = inv.rows.find((r: { rmsId: string }) => r.rmsId === '2005');
    expect(muse.inSourceFile).toBe(false);
    const vx = inv.rows.find((r: { rmsId: string }) => r.rmsId === '2002');
    expect(vx.itemId).toBe(id('2002')); // stable identity across rename
    expect(vx.qtyConfirmed).toBe(2); // confirmation preserved; file now shows 3 (flagged in UI)
  });

  it('rollback creates a new snapshot equal to the old one', async () => {
    const r = await req('POST', `/api/inventory/snapshots/${snapshot1}/rollback`, {});
    expect(r.json().version).toBe(3);
    const inv = (await req('GET', '/api/inventory')).json();
    expect(inv.rows).toHaveLength(6);
    expect(inv.rows.some((x: { rmsId: string }) => x.rmsId === '2006')).toBe(true);
    const snaps = (await req('GET', '/api/inventory/snapshots')).json();
    expect(snaps.map((s: { version: number }) => s.version)).toEqual([3, 2, 1]);
  });
});

describe('equipment specs provenance', () => {
  it('VERIFIED specs need a source; values are append-only', async () => {
    const inv = (await req('GET', '/api/inventory')).json();
    const vx = inv.rows.find((r: { rmsId: string }) => r.rmsId === '2002');
    const bad = await req('POST', `/api/models/${vx.modelId}/specs`, { key: 'output_ports', value: 6, status: 'VERIFIED', source: { kind: 'manufacturer_doc' } });
    expect(bad.status).toBe(422);
    for (const [key, value] of [['total_pixel_capacity', 3_900_000], ['output_ports', 6], ['pixels_per_port', 650_000], ['max_width_px', 10240], ['max_height_px', 8192]] as const) {
      const ok = await req('POST', `/api/models/${vx.modelId}/specs`, { key, value, status: 'PROVISIONAL', source: { kind: 'manufacturer_doc', ref: 'SYNTHETIC test value' } });
      expect(ok.status).toBe(200);
    }
    const m = (await req('GET', `/api/models/${vx.modelId}`)).json();
    const ports = m.specs.filter((s: { key: string; superseded_at: string | null }) => s.key === 'output_ports' && !s.superseded_at);
    expect(ports).toHaveLength(1); // one current value; older ones kept as history
    expect(ports[0].source.ref).toBe('SYNTHETIC test value');
  });
  it('the spec library filled the processor on import and never overrides a person’s entry', async () => {
    const inv = (await req('GET', '/api/inventory')).json();
    const vx = inv.rows.find((r: { rmsId: string }) => r.rmsId === '2002');
    const m = (await req('GET', `/api/models/${vx.modelId}`)).json();
    const lib = m.specs.filter((s: { source: { ref: string } }) => s.source.ref?.startsWith('Spec library'));
    expect(lib.length).toBeGreaterThanOrEqual(5);
    expect((await req('POST', '/api/equipment/spec-library/apply')).status).toBe(200);
    const after = (await req('GET', `/api/models/${vx.modelId}`)).json();
    const cur = after.specs.find((s: { key: string; superseded_at: string | null }) => s.key === 'output_ports' && !s.superseded_at);
    expect(cur.source.ref).toBe('SYNTHETIC test value');
  });

  it('enumerated specs (fixture_role) accept only listed values', async () => {
    const inv = (await req('GET', '/api/inventory')).json();
    const ball = inv.rows.find((r: { rmsId: string }) => r.rmsId === '2006');
    const src = { kind: 'user_entry', ref: 'SYNTHETIC' };
    expect((await req('POST', `/api/models/${ball.modelId}/specs`, { key: 'fixture_role', value: 'DISCO', status: 'PROVISIONAL', source: src })).status).toBe(422);
    expect((await req('POST', `/api/models/${ball.modelId}/specs`, { key: 'fixture_role', value: 4, status: 'PROVISIONAL', source: src })).status).toBe(422);
    expect((await req('POST', `/api/models/${ball.modelId}/specs`, { key: 'fixture_role', value: 'PAR', status: 'PROVISIONAL', source: src })).json().value_text).toBe('PAR');
  });
});

describe('stock policy', () => {
  it('defaults to the owner guideline policy and can be changed (audited)', async () => {
    expect((await req('GET', '/api/settings/stock-policy')).json()).toEqual({ useFileQuantities: true, headroomPct: 20 });
    expect((await req('PUT', '/api/settings/stock-policy', { useFileQuantities: true, headroomPct: 150 })).status).toBe(400);
    expect((await req('PUT', '/api/settings/stock-policy', { useFileQuantities: false, headroomPct: 0 })).json()).toEqual({ useFileQuantities: false, headroomPct: 0 });
    expect((await req('PUT', '/api/settings/stock-policy', { useFileQuantities: true, headroomPct: 20 })).status).toBe(200);
  });
});

describe('duplicates and bulk rules', () => {
  it('marks a duplicate, blocks confirming it, and can undo', async () => {
    const rows = (await req('GET', '/api/inventory')).json().rows as { itemId: string; rmsId: string; duplicateOf: string | null }[];
    const keep = rows.find((r) => r.rmsId === '2004')!;
    const dup = rows.find((r) => r.rmsId === '2006')!;
    expect((await req('POST', `/api/inventory/items/${dup.itemId}/duplicate`, { ofItemId: dup.itemId })).status).toBe(422);
    expect((await req('POST', `/api/inventory/items/${dup.itemId}/duplicate`, { ofItemId: keep.itemId, note: 'same item' })).status).toBe(200);
    expect((await req('GET', '/api/inventory')).json().rows.find((r: { rmsId: string }) => r.rmsId === '2006').duplicateOf).toBe(keep.itemId);
    expect((await req('POST', '/api/inventory/confirmations', { basis: 'test', items: [{ itemId: dup.itemId, qtyOwned: 1 }] })).status).toBe(422);
    expect((await req('POST', `/api/inventory/items/${keep.itemId}/duplicate`, { ofItemId: rows.find((r) => r.rmsId === '2001')!.itemId })).status).toBe(422); // has dependants
    expect((await req('POST', `/api/inventory/items/${dup.itemId}/duplicate`, { ofItemId: null })).status).toBe(200);
  });
  it('creates a rule for every model in a category, once', async () => {
    const body = { type: 'REQUIRES', fromCategory: 'STAGE_DECK', toCategory: 'STAGE_LEG', quantity: { kind: 'per_unit', ratio: 4 }, status: 'PROVISIONAL', evidence: [{ kind: 'user_confirmation', ref: 'Owner instruction (test)' }] };
    expect((await req('POST', '/api/relationships/bulk', body)).json().created).toBe(1);
    expect((await req('POST', '/api/relationships/bulk', body)).json().created).toBe(0);
  });
});

let venueId = '';
let projectId = '';
let rev1 = '';
describe('venue plan, calibration and geometry', () => {
  it('uploads a PDF plan, refuses tracing before calibration, then calibrates', async () => {
    venueId = (await req('POST', '/api/venues', { name: 'Synthetic Hall' })).json().id;
    const up = await upload(`/api/venues/${venueId}/plans`, 'plan.pdf', await planPdf(), 'application/pdf', { title: 'Synthetic plan' });
    expect(up.status).toBe(200);
    const { planId } = up.json();
    const room = [{ x: 100, y: 100 }, { x: 500, y: 100 }, { x: 500, y: 400 }, { x: 100, y: 400 }];
    const early = await req('POST', `/api/venues/${venueId}/geometry`, { planId, pagePolygonPt: room, ceilingHeight: { valueMm: 7000, status: 'PROVISIONAL', sourceNote: 'test' } });
    expect(early.status).toBe(422);
    const cal = await req('PUT', `/api/plans/${planId}/calibration`, {
      reference: { p1: { x: 100, y: 100 }, p2: { x: 500, y: 100 }, knownLengthMm: 40000, knownToleranceMm: 20, referenceStatus: 'VERIFIED', referenceNote: 'Synthetic: 40.0 m dimension string' },
      checks: [{ p1: { x: 100, y: 100 }, p2: { x: 100, y: 400 }, knownLengthMm: 30000, knownToleranceMm: 20, referenceStatus: 'VERIFIED', referenceNote: 'Synthetic: 30.0 m' }],
      clickUncertaintyPt: 0.5,
      pageWidthPt: 1190.55,
      pageHeightPt: 841.89,
    });
    expect(cal.json()).toMatchObject({ mmPerPt: 100, status: 'VERIFIED' });
    const geo = await req('POST', `/api/venues/${venueId}/geometry`, { planId, pagePolygonPt: room, ceilingHeight: { valueMm: 7000, status: 'PROVISIONAL', sourceNote: 'test' }, defaultStageWall: 3 });
    expect(geo.status).toBe(200);
    // Source document is still PROVISIONAL, so traced geometry is PROVISIONAL even with a VERIFIED scale.
    expect(geo.json().geometry.roomStatus).toBe('PROVISIONAL');
    expect(geo.json().geometry.roomPolygonMm[1]).toEqual({ x: 50000, y: -10000 });
  });
});

describe('project workflow', () => {
  it('creates a project from a brief and generates revision 1', async () => {
    const r = await req('POST', '/api/projects', {
      name: 'Synthetic Gala',
      venueId,
      brief: 'Premium corporate gala for 500 guests. I need a 12 m x 6 m stage, a 6 m x 3 m LED wall, FOH and a black-and-gold aesthetic.',
    });
    expect(r.status).toBe(200);
    projectId = r.json().id;
    rev1 = r.json().revisionId;
    const rev = (await req('GET', `/api/revisions/${rev1}`)).json();
    expect(rev.number).toBe(1);
    expect(rev.result.scene.objects.filter((o: { kind: string }) => o.kind === 'led_cabinet')).toHaveLength(72);
    const led = rev.result.bom.lines.find((l: { rmsId: string }) => l.rmsId === '2001');
    expect(led.allocated).toBe(72);
    expect(rev.result.validation.checks.find((c: { id: string }) => c.id === 'led.processor').result).toBe('PASS');
    expect(rev.inputs).toBeUndefined(); // frozen inputs are stored but not shipped to clients
  });

  it('conversational revision creates a new immutable revision', async () => {
    const m = await req('POST', `/api/projects/${projectId}/messages`, { text: 'Make the stage 2 metres wider.' });
    expect(m.json().revisionId).toBeTruthy();
    const r2 = (await req('GET', `/api/revisions/${m.json().revisionId}`)).json();
    expect(r2.number).toBe(2);
    expect(r2.result.scene.objects.find((o: { kind: string }) => o.kind === 'stage').size.x).toBe(14000);
    const r1 = (await req('GET', `/api/revisions/${rev1}`)).json();
    expect(r1.result.scene.objects.find((o: { kind: string }) => o.kind === 'stage').size.x).toBe(12000);
    const unsupported = await req('POST', `/api/projects/${projectId}/messages`, { text: 'Change the LED to a curved concept.' });
    expect(unsupported.json()).toMatchObject({ revisionId: null, recognised: false });
  });

  it('historical revisions keep their inventory snapshot after stock changes', async () => {
    const before = (await req('GET', `/api/revisions/${rev1}`)).json();
    const up = await upload('/api/inventory/imports', 'v4.xlsx', await xlsx(V1.map((r) => (r[0] === '2001' ? ['2001', r[1], r[2], 10, r[4], r[5], r[6]] : r))), 'application/octet-stream');
    await req('POST', `/api/inventory/imports/${up.json().importId}/apply`, {});
    const after = (await req('GET', `/api/revisions/${rev1}`)).json();
    expect(after.inventory_snapshot_id).toBe(before.inventory_snapshot_id);
    expect(after.result).toEqual(before.result);
  });

  it('exports a vector PDF, CSV schedule and scene JSON', async () => {
    const pdf = await req('GET', `/api/revisions/${rev1}/export.pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
    const csv = await req('GET', `/api/revisions/${rev1}/export/bom.csv`);
    expect(csv.body.toString()).toContain('Leyard 2.6mm 500 x 500mm LED Panel');
    const scene = (await req('GET', `/api/revisions/${rev1}/export/scene.json`)).json();
    expect(scene.units).toBe('mm');
  });

  it('records human approvals without changing the design status', async () => {
    const r = await req('POST', `/api/revisions/${rev1}/approvals`, { discipline: 'Electrical approval', decision: 'comment', comment: 'Needs distro plan' });
    expect(r.status).toBe(200);
    const rev = (await req('GET', `/api/revisions/${rev1}`)).json();
    expect(rev.approvals).toHaveLength(1);
    expect(rev.overall_status).not.toBe('VERIFIED');
  });

  it('writes an audit trail', async () => {
    const a = (await req('GET', '/api/audit?limit=200')).json();
    const actions = new Set(a.map((x: { action: string }) => x.action));
    for (const k of ['inventory.snapshot.created', 'inventory.qty.confirmed', 'inventory.snapshot.rollback', 'venue.plan.calibrated', 'design.revision.created', 'revision.exported']) expect(actions).toContain(k);
  });
});
