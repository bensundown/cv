import type { InventoryDiff, ParseResult } from '@sn/core';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, can } from '../api';
import { Badge, ErrorBox } from '../components/ui';
import { useMe } from '../main';

interface Imp {
  id: string;
  status: string;
  sheet_name: string | null;
  parse_result: ParseResult & { sheetNames: string[] };
  diff: InventoryDiff;
  error: string | null;
  file_name: string;
  sha256: string;
}

const KIND_ORDER = ['removal_proposed', 'matched_by_name', 'renamed', 'changed', 'added', 'unchanged'] as const;
const KIND_LABEL: Record<string, string> = { added: 'New', unchanged: 'Unchanged', changed: 'Changed', renamed: 'Renamed (same RMS ID)', matched_by_name: 'Matched by name only — review', removal_proposed: 'Missing from file — proposed removal' };

export function ImportPreviewPage() {
  const { id } = useParams();
  const { me } = useMe();
  const nav = useNavigate();
  const [imp, setImp] = useState<Imp | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [removals, setRemovals] = useState<Record<string, 'keep' | 'retire'>>({});
  const [nameMatches, setNameMatches] = useState<Record<string, boolean>>({});
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    api.get<Imp>(`/inventory/imports/${id}`).then(setImp, setErr);
  }, [id]);
  if (!imp) return <div className="page"><ErrorBox error={err} /></div>;
  const pr = imp.parse_result;
  const m = pr.mapping;
  const errors = pr.issues.filter((i) => i.severity === 'error');
  const warnings = pr.issues.filter((i) => i.severity === 'warning');
  const infos = pr.issues.filter((i) => i.severity === 'info');
  const apply = async () => {
    setErr(null);
    try {
      await api.post(`/inventory/imports/${id}/apply`, { removals, nameMatches, note: note || undefined });
      nav('/inventory');
    } catch (e) {
      setErr(e);
    }
  };

  return (
    <div className="page stack">
      <div>
        <div className="eyebrow">Inventory upload preview</div>
        <h1>{imp.file_name}</h1>
        <div className="small muted mono">sha256 {imp.sha256.slice(0, 16)}… · worksheet “{imp.sheet_name}” of [{pr.sheetNames.join(', ')}] · status {imp.status}</div>
      </div>
      <ErrorBox error={err} />
      {imp.error && <div className="alert error">{imp.error}</div>}
      <div className="grid2">
        <div className="card">
          <h2>Detected columns</h2>
          {m ? (
            <dl className="kv">
              {Object.entries(m.fields).map(([f, i]) => (
                <div key={f} style={{ display: 'contents' }}>
                  <dt>{f}</dt>
                  <dd>“{m.headers[i as number]}” (column {(i as number) + 1})</dd>
                </div>
              ))}
              <dt>Header row</dt>
              <dd>{m.headerRowIndex + 1}</dd>
              <dt>Currency</dt>
              <dd>{m.currency ?? 'not stated — rates kept as numbers without currency'}</dd>
              {m.unmappedColumns.length > 0 && (
                <>
                  <dt>Preserved, unmapped</dt>
                  <dd>{m.unmappedColumns.map((c) => c.header).join(', ')}</dd>
                </>
              )}
            </dl>
          ) : (
            <p>No header row recognised.</p>
          )}
          <p className="small muted">{pr.records.length} records · {pr.blankRowsSkipped} blank rows skipped · every original cell is stored verbatim.</p>
        </div>
        <div className="card">
          <h2>Changes vs current inventory</h2>
          <div className="row">
            {KIND_ORDER.map((k) => (
              <span key={k} className="badge st-info">{KIND_LABEL[k]}: {imp.diff.summary[k]}</span>
            ))}
          </div>
          <h3 style={{ marginTop: 12 }}>Data quality</h3>
          <div className="row">
            <Badge s="error" /> {errors.length} blocking
            <Badge s="warning" /> {warnings.length} warnings
            <Badge s="info" /> {infos.length} notes
          </div>
          {pr.blocking && <div className="alert error" style={{ marginTop: 8 }}>This file cannot be applied until the blocking errors are fixed. The current inventory is unchanged.</div>}
        </div>
      </div>
      {pr.issues.length > 0 && (
        <div className="card">
          <h2>Issues</h2>
          <div style={{ maxHeight: 260, overflow: 'auto' }}>
            <table className="data">
              <thead>
                <tr><th>Severity</th><th>Row</th><th>RMS ID</th><th>Issue</th></tr>
              </thead>
              <tbody>
                {[...errors, ...warnings, ...infos].map((i, k) => (
                  <tr key={k}>
                    <td><Badge s={i.severity} /></td>
                    <td className="num">{i.rowNumber ?? ''}</td>
                    <td className="mono">{i.rmsId ?? ''}</td>
                    <td>{i.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="card">
        <div className="spread">
          <h2>Record changes</h2>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" style={{ minHeight: 0 }} checked={showUnchanged} onChange={(e) => setShowUnchanged(e.target.checked)} /> show unchanged
          </label>
        </div>
        <div style={{ maxHeight: 480, overflow: 'auto' }}>
          <table className="data">
            <thead>
              <tr><th>Change</th><th>Row</th><th>RMS ID</th><th>Product</th><th>Details</th><th>Decision</th></tr>
            </thead>
            <tbody>
              {[...imp.diff.changes]
                .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))
                .filter((c) => showUnchanged || c.kind !== 'unchanged')
                .map((c, k) => (
                  <tr key={k}>
                    <td><span className={`badge ${c.kind === 'removal_proposed' || c.kind === 'matched_by_name' ? 'st-warning' : 'st-info'}`}>{KIND_LABEL[c.kind]}</span></td>
                    <td className="num">{c.rowNumber ?? ''}</td>
                    <td className="mono">{c.rmsId ?? '—'}</td>
                    <td>{c.product}</td>
                    <td className="small">
                      {c.fields.map((f) => (
                        <div key={f.field}>{f.field}: <s>{String(f.before ?? '∅')}</s> → <b>{String(f.after ?? '∅')}</b></div>
                      ))}
                      {c.notes.map((n, i) => <div key={i} className="muted">{n}</div>)}
                    </td>
                    <td>
                      {c.kind === 'removal_proposed' && (
                        <select value={removals[c.itemId!] ?? 'keep'} onChange={(e) => setRemovals({ ...removals, [c.itemId!]: e.target.value as 'keep' | 'retire' })}>
                          <option value="keep">Keep (flag as not in file)</option>
                          <option value="retire">Retire from inventory</option>
                        </select>
                      )}
                      {c.kind === 'matched_by_name' && (
                        <select value={nameMatches[String(c.rowNumber)] ? 'same' : 'new'} onChange={(e) => setNameMatches({ ...nameMatches, [String(c.rowNumber)]: e.target.value === 'same' })}>
                          <option value="new">Treat as new item</option>
                          <option value="same">Same equipment as existing</option>
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
      {imp.status === 'staged' && can(me, 'inventory.import') && (
        <div className="card row">
          <input placeholder="Snapshot note (optional)" value={note} onChange={(e) => setNote(e.target.value)} style={{ minWidth: 320 }} />
          <button className="btn primary" disabled={pr.blocking} onClick={apply}>Apply as new inventory snapshot</button>
          <button className="btn" onClick={async () => { await api.post(`/inventory/imports/${id}/discard`); nav('/inventory'); }}>Discard</button>
          <span className="small muted">Applying keeps all history; you can roll back at any time. Confirmed owned quantities carry over by stable item.</span>
        </div>
      )}
    </div>
  );
}
