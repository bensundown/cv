import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, can } from '../api';
import { Badge, ErrorBox } from '../components/ui';
import { useMe } from '../main';

export function VenuesPage() {
  const { me } = useMe();
  const nav = useNavigate();
  const [venues, setVenues] = useState<{ id: string; name: string; address: string | null; geometry_version: number | null; geometry_status: string | null }[]>([]);
  const [name, setName] = useState('');
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => {
    api.get<typeof venues>('/venues').then(setVenues, setErr);
  }, []);
  return (
    <div className="page stack">
      <div className="eyebrow">Venue intelligence</div>
      <h1>Venues</h1>
      <ErrorBox error={err} />
      <div className="alert info">
        Automated venue research from public sources is not built yet (Phase 2b). Add a venue, upload its official floor plan (PDF/PNG/JPEG), record where the document came from, then calibrate the scale from a known dimension. Uncalibrated plans are never used as dimensional references.
      </div>
      {can(me, 'venue.edit') && (
        <div className="card row">
          <input placeholder="Venue name, e.g. Sandton Convention Centre — Ballroom" value={name} onChange={(e) => setName(e.target.value)} style={{ minWidth: 420 }} />
          <button className="btn primary" disabled={!name.trim()} onClick={async () => { try { const v = await api.post<{ id: string }>('/venues', { name }); nav(`/venues/${v.id}`); } catch (e) { setErr(e); } }}>Add venue</button>
        </div>
      )}
      <div className="card">
        <table className="data">
          <thead><tr><th>Venue</th><th>Geometry</th><th>Status</th></tr></thead>
          <tbody>
            {venues.map((v) => (
              <tr key={v.id}>
                <td><Link to={`/venues/${v.id}`}>{v.name}</Link></td>
                <td>{v.geometry_version ? `v${v.geometry_version}` : 'none yet'}</td>
                <td><Badge s={v.geometry_status ?? 'UNKNOWN'} /></td>
              </tr>
            ))}
            {!venues.length && <tr><td colSpan={3} className="muted">No venues yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
