import type { CalibrationResult, Confidence, Pt } from '@sn/core';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, can } from '../api';
import { PlanCanvas, type PageInfo } from '../components/PlanCanvas';
import { Badge, ErrorBox, Field, m, STATUS_OPTIONS } from '../components/ui';
import { useMe } from '../main';

interface Measure { p1: Pt | null; p2: Pt | null; lengthM: string; tolMm: string; status: Confidence; note: string }
interface Plan { id: string; file_id: string; mime_type: string; title: string; page_number: number; calibration: { input: unknown; result: CalibrationResult } | null; calibration_status: string; source_id: string }
interface Source { id: string; title: string; status: string; url: string | null; document_date: string | null; licence: string | null; notes: string | null }
interface Geo { id: string; version: number; status: string; geometry: { roomPolygonMm: Pt[]; ceilingHeight: { value: number | null; status: string }; roomSourceRef: string; defaultStageWall: number }; created_at: string; created_by_email: string }

type Tool = 'none' | 'ref' | 'check' | 'room' | 'obstacle';
const emptyMeasure = (): Measure => ({ p1: null, p2: null, lengthM: '', tolMm: '10', status: 'VERIFIED', note: '' });
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

export function VenueEditor() {
  const { id } = useParams();
  const { me } = useMe();
  const [d, setD] = useState<{ venue: { name: string }; sources: Source[]; plans: Plan[]; geometry: Geo[] } | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [planIdx, setPlanIdx] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [page, setPage] = useState<PageInfo | null>(null);
  const [tool, setTool] = useState<Tool>('none');
  const [ref, setRef] = useState<Measure>(emptyMeasure());
  const [checks, setChecks] = useState<Measure[]>([]);
  const [room, setRoom] = useState<Pt[]>([]);
  const [obstacles, setObstacles] = useState<{ label: string; polygon: Pt[] }[]>([]);
  const [draftObs, setDraftObs] = useState<Pt[]>([]);
  const [cal, setCal] = useState<CalibrationResult | null>(null);
  const [ceil, setCeil] = useState({ m: '', status: 'UNKNOWN' as Confidence, note: '' });
  const [stageWall, setStageWall] = useState(0);
  const [rect, setRect] = useState({ w: '', d: '', status: 'PROVISIONAL' as Confidence, note: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const editable = can(me, 'venue.edit');

  const load = async () => {
    try {
      const r = await api.get<NonNullable<typeof d>>(`/venues/${id}`);
      setD(r);
      const p = r.plans[0];
      if (p?.calibration) setCal(p.calibration.result);
    } catch (e) {
      setErr(e);
    }
  };
  useEffect(() => {
    void load();
  }, [id]);
  if (!d) return <div className="page"><ErrorBox error={err} /></div>;
  const plan = d.plans[planIdx];
  const source = plan ? d.sources.find((s) => s.id === plan.source_id) : undefined;
  const clickTol = page ? 1.5 / page.pxPerPt : 1;
  const sw = page ? 1.5 / page.pxPerPt : 1; // overlay stroke width in pt

  const ortho = (p: Pt, prev: Pt | null | undefined, ev: React.MouseEvent): Pt => {
    if (!ev.shiftKey || !prev) return p;
    return Math.abs(p.x - prev.x) > Math.abs(p.y - prev.y) ? { x: p.x, y: prev.y } : { x: prev.x, y: p.y };
  };
  const onClick = (p0: Pt, ev: React.MouseEvent) => {
    if (tool === 'ref') {
      const p = ortho(p0, ref.p1, ev);
      setRef(!ref.p1 || ref.p2 ? { ...ref, p1: p, p2: null } : { ...ref, p2: p });
    } else if (tool === 'check') {
      const last = checks.at(-1);
      if (!last || last.p2) setChecks([...checks, { ...emptyMeasure(), p1: p0 }]);
      else setChecks([...checks.slice(0, -1), { ...last, p2: ortho(p0, last.p1, ev) }]);
    } else if (tool === 'room') setRoom([...room, ortho(p0, room.at(-1), ev)]);
    else if (tool === 'obstacle') setDraftObs([...draftObs, ortho(p0, draftObs.at(-1), ev)]);
  };

  const measureBody = (x: Measure) => ({ p1: x.p1, p2: x.p2, knownLengthMm: Number(x.lengthM) * 1000, knownToleranceMm: Number(x.tolMm) || 0, referenceStatus: x.status, referenceNote: x.note });
  const calibrateNow = async () => {
    setErr(null);
    try {
      const r = await api.put<CalibrationResult>(`/plans/${plan!.id}/calibration`, { reference: measureBody(ref), checks: checks.filter((c) => c.p2 && Number(c.lengthM) > 0).map(measureBody), clickUncertaintyPt: clickTol, pageWidthPt: page!.widthPt, pageHeightPt: page!.heightPt });
      setCal(r);
      await load();
    } catch (e) {
      setErr(e);
    }
  };
  const ceilingBody = () => ({ valueMm: ceil.m ? Number(ceil.m) * 1000 : null, status: ceil.m ? ceil.status : 'UNKNOWN', sourceNote: ceil.note });
  const saveGeometry = async () => {
    setErr(null);
    try {
      const r = await api.post<{ version: number }>(`/venues/${id}/geometry`, { planId: plan!.id, pagePolygonPt: room, pageObstacles: obstacles, ceilingHeight: ceilingBody(), defaultStageWall: stageWall });
      setMsg(`Saved venue geometry v${r.version}.`);
      await load();
    } catch (e) {
      setErr(e);
    }
  };
  const saveRect = async () => {
    setErr(null);
    try {
      const r = await api.post<{ version: number }>(`/venues/${id}/geometry`, { rectangleMm: { widthMm: Number(rect.w) * 1000, depthMm: Number(rect.d) * 1000 }, roomStatus: rect.status, roomSourceNote: rect.note, ceilingHeight: ceilingBody(), defaultStageWall: stageWall });
      setMsg(`Saved venue geometry v${r.version} from typed dimensions.`);
      await load();
    } catch (e) {
      setErr(e);
    }
  };
  const measureSvg = (x: Measure, color: string, label: string) =>
    x.p1 && (
      <g key={label}>
        <circle cx={x.p1.x} cy={x.p1.y} r={sw * 3} fill={color} />
        {x.p2 && (
          <>
            <line x1={x.p1.x} y1={x.p1.y} x2={x.p2.x} y2={x.p2.y} stroke={color} strokeWidth={sw * 2} />
            <circle cx={x.p2.x} cy={x.p2.y} r={sw * 3} fill={color} />
            <text x={(x.p1.x + x.p2.x) / 2} y={(x.p1.y + x.p2.y) / 2 - sw * 5} fontSize={sw * 10} fill={color} textAnchor="middle">
              {label}{cal && ` ${((dist(x.p1, x.p2) * cal.mmPerPt) / 1000).toFixed(2)} m`}
            </text>
          </>
        )}
      </g>
    );
  const scaledLen = (a: Pt, b: Pt) => (cal ? m(dist(a, b) * cal.mmPerPt) : '—');

  return (
    <div className="page stack">
      <div className="spread">
        <div>
          <div className="eyebrow">Venue</div>
          <h1>{d.venue.name}</h1>
        </div>
        {editable && (
          <label className="btn primary" style={{ margin: 0, color: '#fff' }}>
            Upload floor plan (PDF / PNG / JPEG)
            <input type="file" accept=".pdf,.png,.jpg,.jpeg" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { await api.upload(`/venues/${id}/plans`, f, f.name, { title: f.name }); setPlanIdx(0); await load(); } catch (x) { setErr(x); } }} />
          </label>
        )}
      </div>
      <ErrorBox error={err} />
      {msg && <div className="alert info">{msg}</div>}

      {d.geometry.length > 0 && (
        <div className="card">
          <h2>Geometry versions</h2>
          <table className="data">
            <thead><tr><th>Version</th><th>Status</th><th>Room</th><th>Ceiling</th><th>Source</th><th>By</th></tr></thead>
            <tbody>
              {d.geometry.map((g) => {
                const xs = g.geometry.roomPolygonMm.map((p) => p.x);
                const ys = g.geometry.roomPolygonMm.map((p) => p.y);
                return (
                  <tr key={g.id}>
                    <td>v{g.version}</td>
                    <td><Badge s={g.status} /></td>
                    <td>{g.geometry.roomPolygonMm.length} walls · extents {m(Math.max(...xs) - Math.min(...xs))} × {m(Math.max(...ys) - Math.min(...ys))}</td>
                    <td>{m(g.geometry.ceilingHeight.value)} <Badge s={g.geometry.ceilingHeight.status} /></td>
                    <td className="small">{g.geometry.roomSourceRef}</td>
                    <td className="small">{g.created_by_email} · {new Date(g.created_at).toLocaleDateString('en-ZA')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {plan && source && (
        <div className="card">
          <div className="spread">
            <h2>Plan: {plan.title}</h2>
            <div className="row">
              {d.plans.length > 1 && <select value={planIdx} onChange={(e) => setPlanIdx(Number(e.target.value))}>{d.plans.map((p, i) => <option key={p.id} value={i}>{p.title}</option>)}</select>}
              <span className="small">Calibration <Badge s={plan.calibration_status} /></span>
              <span className="small">Document <Badge s={source.status} /></span>
            </div>
          </div>
          {editable && (
            <details className="small" style={{ margin: '8px 0' }}>
              <summary>Document provenance (where did this plan come from?)</summary>
              <SourceForm source={source} onSaved={load} onError={setErr} />
            </details>
          )}
          <div className="row" style={{ margin: '8px 0' }}>
            {(['ref', 'check', 'room', 'obstacle'] as Tool[]).map((t) => (
              <button key={t} className={`btn sm ${tool === t ? 'primary' : ''}`} onClick={() => setTool(t)} disabled={!editable}>
                {{ ref: '1 · Reference dimension', check: '2 · Check dimension', room: '3 · Trace room outline', obstacle: '4 · Columns / obstructions' }[t as 'ref']}
              </button>
            ))}
            <span className="small muted">Shift-click = horizontal/vertical. Zoom</span>
            <select value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>{[0.5, 0.75, 1, 1.5, 2, 3].map((z) => <option key={z} value={z}>{z * 100}%</option>)}</select>
          </div>
          <div className="grid2" style={{ gridTemplateColumns: 'minmax(0,1fr) 360px' }}>
            <div style={{ overflow: 'auto', maxHeight: '70vh', border: '1px solid var(--sn-card-line)' }}>
              <PlanCanvas fileId={plan.file_id} mime={plan.mime_type} page={plan.page_number} zoom={zoom} onClick={onClick} onInfo={setPage}>
                {measureSvg(ref, '#E0144B', 'REF')}
                {checks.map((c, i) => measureSvg(c, '#1F4FC4', `CHK${i + 1}`))}
                {room.length > 0 && <polygon points={room.map((p) => `${p.x},${p.y}`).join(' ')} fill="rgba(250,33,88,.08)" stroke="#0C0C0C" strokeWidth={sw * 2} />}
                {room.map((p, i) => {
                  const q = room[(i + 1) % room.length]!;
                  return (
                    <g key={i}>
                      <circle cx={p.x} cy={p.y} r={sw * 3} fill="#0C0C0C" />
                      {room.length > 2 && <text x={(p.x + q.x) / 2} y={(p.y + q.y) / 2} fontSize={sw * 11} fill={i === stageWall ? '#E0144B' : '#0C0C0C'} fontWeight={800}>W{i + 1}</text>}
                    </g>
                  );
                })}
                {[...obstacles.map((o) => o.polygon), draftObs].map((poly, i) => poly.length > 0 && <polygon key={`o${i}`} points={poly.map((p) => `${p.x},${p.y}`).join(' ')} fill="rgba(0,0,0,.25)" stroke="#333" strokeWidth={sw} />)}
              </PlanCanvas>
            </div>
            <div className="stack">
              <div>
                <h3>1 · Reference dimension</h3>
                <p className="small muted">Click both ends of a dimension you know (ideally a printed dimension string from the official plan), then enter its true length.</p>
                <MeasureForm x={ref} set={setRef} />
              </div>
              <div>
                <h3>2 · Independent check (perpendicular)</h3>
                <p className="small muted">A second known dimension at right angles proves the scale is uniform. Without it the scale stays PROVISIONAL at best.</p>
                {checks.map((c, i) => <MeasureForm key={i} x={c} set={(v) => setChecks(checks.map((cc, j) => (j === i ? v : cc)))} />)}
                {checks.length > 0 && <button className="btn sm ghost" onClick={() => setChecks([])}>Clear checks</button>}
              </div>
              <button className="btn primary" disabled={!editable || !ref.p1 || !ref.p2 || !(Number(ref.lengthM) > 0)} onClick={calibrateNow}>Calibrate scale</button>
              {cal && (
                <div className="card" style={{ padding: 10 }}>
                  <dl className="kv">
                    <dt>Scale</dt><dd className="mono">{cal.mmPerPt.toFixed(3)} mm / pt</dd>
                    <dt>Uncertainty</dt><dd className="mono">±{(cal.relUncertainty * 100).toFixed(2)} % (1σ)</dd>
                    <dt>Status</dt><dd><Badge s={cal.status} /></dd>
                  </dl>
                  {cal.checks.map((c, i) => <div key={i} className="small">Check {i + 1}: measured {m(c.measuredMm)} vs {m(c.knownMm)} (Δ {Math.round(c.deviationMm)} mm, allowed ±{Math.round(c.allowedMm)}) <Badge s={c.pass ? 'PASS' : 'FAIL'} /></div>)}
                  {cal.notes.map((n, i) => <div key={i} className="small muted">{n}</div>)}
                </div>
              )}
              <div>
                <h3>3 · Room outline & 4 · obstructions</h3>
                <p className="small muted">Click the room corners in order. Wall W1 runs from corner 1 to corner 2.</p>
                <div className="small">{room.length} corners {room.length > 2 && cal && `· walls: ${room.map((p, i) => `W${i + 1} ${scaledLen(p, room[(i + 1) % room.length]!)}`).join(', ')}`}</div>
                <div className="row" style={{ marginTop: 6 }}>
                  <button className="btn sm" onClick={() => setRoom(room.slice(0, -1))} disabled={!room.length}>Undo corner</button>
                  <button className="btn sm" onClick={() => setRoom([])} disabled={!room.length}>Clear</button>
                  {draftObs.length > 2 && <button className="btn sm" onClick={() => { setObstacles([...obstacles, { label: `Column ${obstacles.length + 1}`, polygon: draftObs }]); setDraftObs([]); }}>Close obstruction</button>}
                  {obstacles.length > 0 && <span className="small">{obstacles.length} obstruction(s)</span>}
                </div>
              </div>
              <CeilingAndWall ceil={ceil} setCeil={setCeil} stageWall={stageWall} setStageWall={setStageWall} walls={Math.max(room.length, 4)} />
              <button className="btn primary" disabled={!editable || room.length < 3 || !cal} onClick={saveGeometry}>Save venue geometry from plan</button>
              {!cal && <div className="small muted">Calibrate first — tracing an uncalibrated plan is not allowed.</div>}
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <h2>No plan? Enter official room dimensions</h2>
        <p className="small muted">Use only dimensions from an official venue document. Rectangular rooms only; obstructions are not captured this way.</p>
        <div className="row">
          <Field label="Width (m)"><input type="number" value={rect.w} onChange={(e) => setRect({ ...rect, w: e.target.value })} /></Field>
          <Field label="Length (m)"><input type="number" value={rect.d} onChange={(e) => setRect({ ...rect, d: e.target.value })} /></Field>
          <Field label="Status"><select value={rect.status} onChange={(e) => setRect({ ...rect, status: e.target.value as Confidence })}>{STATUS_OPTIONS.map((s) => <option key={s}>{s}</option>)}</select></Field>
          <Field label="Source"><input placeholder="e.g. Venue tech spec PDF 2025, p.4" value={rect.note} onChange={(e) => setRect({ ...rect, note: e.target.value })} style={{ minWidth: 280 }} /></Field>
        </div>
        {!plan && <CeilingAndWall ceil={ceil} setCeil={setCeil} stageWall={stageWall} setStageWall={setStageWall} walls={4} />}
        <button className="btn" disabled={!editable || !(Number(rect.w) > 0 && Number(rect.d) > 0)} onClick={saveRect}>Save typed geometry</button>
      </div>
    </div>
  );
}

function MeasureForm({ x, set }: { x: Measure; set: (m: Measure) => void }) {
  return (
    <div className="row" style={{ alignItems: 'flex-end', marginBottom: 6 }}>
      <div style={{ width: 90 }}><label>Length (m)</label><input type="number" step="0.01" value={x.lengthM} onChange={(e) => set({ ...x, lengthM: e.target.value })} style={{ width: '100%' }} /></div>
      <div style={{ width: 70 }}><label>± mm</label><input type="number" value={x.tolMm} onChange={(e) => set({ ...x, tolMm: e.target.value })} style={{ width: '100%' }} /></div>
      <div><label>Status</label><select value={x.status} onChange={(e) => set({ ...x, status: e.target.value as Confidence })}>{STATUS_OPTIONS.map((s) => <option key={s}>{s}</option>)}</select></div>
      <div style={{ flex: 1, minWidth: 140 }}><label>Source of this dimension</label><input value={x.note} placeholder="Dimension string on plan, p.1" onChange={(e) => set({ ...x, note: e.target.value })} style={{ width: '100%' }} /></div>
      <span className="small muted">{x.p1 ? (x.p2 ? '2 points ✓' : '1 point') : 'click 2 points'}</span>
    </div>
  );
}

function CeilingAndWall({ ceil, setCeil, stageWall, setStageWall, walls }: { ceil: { m: string; status: Confidence; note: string }; setCeil: (c: { m: string; status: Confidence; note: string }) => void; stageWall: number; setStageWall: (n: number) => void; walls: number }) {
  return (
    <div className="row" style={{ alignItems: 'flex-end' }}>
      <div style={{ width: 110 }}><label>Ceiling height (m)</label><input type="number" step="0.1" placeholder="unknown" value={ceil.m} onChange={(e) => setCeil({ ...ceil, m: e.target.value, status: e.target.value && ceil.status === 'UNKNOWN' ? 'ESTIMATED' : !e.target.value ? 'UNKNOWN' : ceil.status })} style={{ width: '100%' }} /></div>
      <div><label>Status</label><select value={ceil.status} onChange={(e) => setCeil({ ...ceil, status: e.target.value as Confidence })}>{STATUS_OPTIONS.map((s) => <option key={s}>{s}</option>)}</select></div>
      <div style={{ flex: 1, minWidth: 140 }}><label>Ceiling source</label><input value={ceil.note} onChange={(e) => setCeil({ ...ceil, note: e.target.value })} style={{ width: '100%' }} /></div>
      <div><label>Default stage wall</label><select value={stageWall} onChange={(e) => setStageWall(Number(e.target.value))}>{Array.from({ length: walls }, (_, i) => <option key={i} value={i}>W{i + 1}</option>)}</select></div>
    </div>
  );
}

function SourceForm({ source, onSaved, onError }: { source: Source; onSaved: () => void; onError: (e: unknown) => void }) {
  const [f, setF] = useState({ status: source.status, url: source.url ?? '', documentDate: source.document_date?.slice(0, 10) ?? '', licence: source.licence ?? '', notes: source.notes ?? '' });
  return (
    <div className="row" style={{ alignItems: 'flex-end', marginTop: 8 }}>
      <div><label>Status</label><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{STATUS_OPTIONS.map((s) => <option key={s}>{s}</option>)}</select></div>
      <div style={{ flex: 1 }}><label>Official URL</label><input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} style={{ width: '100%' }} /></div>
      <div><label>Document date</label><input type="date" value={f.documentDate} onChange={(e) => setF({ ...f, documentDate: e.target.value })} /></div>
      <div><label>Licence / permission</label><input value={f.licence} onChange={(e) => setF({ ...f, licence: e.target.value })} /></div>
      <div style={{ flex: 1 }}><label>Origin notes</label><input value={f.notes} placeholder="Emailed by venue technical manager…" onChange={(e) => setF({ ...f, notes: e.target.value })} style={{ width: '100%' }} /></div>
      <button className="btn sm" onClick={async () => { try { await api.patch(`/venue-sources/${source.id}`, { status: f.status, url: f.url || null, documentDate: f.documentDate || null, licence: f.licence || null, notes: f.notes || null }); onSaved(); } catch (e) { onError(e); } }}>Save provenance</button>
    </div>
  );
}
