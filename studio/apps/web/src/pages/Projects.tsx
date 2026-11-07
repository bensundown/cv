import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, can } from '../api';
import { Badge, ErrorBox, Field } from '../components/ui';
import { useMe } from '../main';

const EXAMPLE =
  'Design a premium corporate gala for 500 guests at the Sandton Convention Centre. I need a 12 m x 6 m stage, a 10 m x 3 m LED wall, intelligent lighting, professional sound, FOH and a luxurious black-and-gold aesthetic. Use our inventory.';

export function ProjectsPage() {
  const { me } = useMe();
  const [rows, setRows] = useState<{ id: string; name: string; client: string | null; venue_name: string | null; mode: string; latest_revision: number | null; overall_status: string | null; created_at: string }[]>([]);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => {
    api.get<typeof rows>('/projects').then(setRows, setErr);
  }, []);
  return (
    <div className="page stack">
      <div className="spread">
        <div>
          <div className="eyebrow">Design studio</div>
          <h1>Projects</h1>
        </div>
        {can(me, 'project.edit') && <Link className="btn primary" to="/projects/new" style={{ textDecoration: 'none' }}>New design from brief</Link>}
      </div>
      <ErrorBox error={err} />
      <div className="card">
        <table className="data">
          <thead><tr><th>Project</th><th>Client</th><th>Venue</th><th>Mode</th><th>Latest</th><th>Status</th><th>Created</th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td><Link to={`/projects/${p.id}`}>{p.name}</Link></td>
                <td>{p.client ?? '—'}</td>
                <td>{p.venue_name ?? '—'}</td>
                <td>{p.mode}</td>
                <td>{p.latest_revision ? `R${p.latest_revision}` : '—'}</td>
                <td><Badge s={p.overall_status} /></td>
                <td>{new Date(p.created_at).toLocaleDateString('en-ZA')}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7} className="muted">No projects yet. You need an imported inventory and a venue with geometry first.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function NewProjectPage() {
  const nav = useNavigate();
  const [venues, setVenues] = useState<{ id: string; name: string; geometry_version: number | null; geometry_status: string | null }[]>([]);
  const [f, setF] = useState({ name: '', client: '', venueId: '', brief: EXAMPLE, mode: 'concept' });
  const [preview, setPreview] = useState<{ extraction: { extracted: { path: string; value: unknown; text: string }[]; venueName: string | null; requests: string[] } } | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get<typeof venues>('/venues').then(setVenues, setErr);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => api.post<NonNullable<typeof preview>>('/briefs/parse', { brief: f.brief, mode: f.mode }).then(setPreview, () => undefined), 300);
    return () => clearTimeout(t);
  }, [f.brief, f.mode]);
  const usable = venues.filter((v) => v.geometry_version);
  const fmt = (p: string, v: unknown) => (typeof v === 'number' && p.endsWith('Mm') ? `${v / 1000} m` : String(v));

  return (
    <div className="page stack" style={{ maxWidth: 1100 }}>
      <div className="eyebrow">New design</div>
      <h1>Start from a client brief</h1>
      <ErrorBox error={err} />
      <div className="grid2">
        <div className="card">
          <Field label="Project name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Client gala 2027" /></Field>
          <Field label="Client"><input value={f.client} onChange={(e) => setF({ ...f, client: e.target.value })} /></Field>
          <Field label="Venue" hint={usable.length ? undefined : 'No venue has geometry yet — add one under Venues first.'}>
            <select value={f.venueId} onChange={(e) => setF({ ...f, venueId: e.target.value })}>
              <option value="">Choose venue…</option>
              {usable.map((v) => <option key={v.id} value={v.id}>{v.name} (geometry v{v.geometry_version}, {v.geometry_status})</option>)}
            </select>
          </Field>
          <Field label="Mode">
            <select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>
              <option value="concept">Concept — fast proposal, provisional assumptions allowed</option>
              <option value="technical">Technical — verified geometry required for VERIFIED status</option>
            </select>
          </Field>
          <Field label="Client brief"><textarea value={f.brief} onChange={(e) => setF({ ...f, brief: e.target.value })} rows={7} /></Field>
          <button className="btn primary" disabled={busy || !f.name || !f.venueId} onClick={async () => { setBusy(true); setErr(null); try { const r = await api.post<{ id: string }>('/projects', { ...f, client: f.client || undefined }); nav(`/projects/${r.id}`); } catch (e) { setErr(e); setBusy(false); } }}>
            {busy ? 'Designing…' : 'Generate design'}
          </button>
        </div>
        <div className="card">
          <h2>What the interpreter understood</h2>
          <p className="small muted">Rule-based interpretation (deterministic). Each value is recorded as PROVISIONAL with the brief text as evidence. Anything not found uses a labelled system default.</p>
          <table className="data">
            <tbody>
              {preview?.extraction.extracted.map((e, i) => (
                <tr key={i}><td className="mono">{e.path}</td><td><b>{fmt(e.path, e.value)}</b></td><td className="small muted">“{e.text}”</td></tr>
              ))}
            </tbody>
          </table>
          {preview?.extraction.venueName && <p className="small">Venue mentioned: <b>{preview.extraction.venueName}</b> — select the matching venue record.</p>}
          {!!preview?.extraction.requests.length && <p className="small">Also requested (not yet designed by this version): {preview.extraction.requests.join(', ')}.</p>}
        </div>
      </div>
    </div>
  );
}
