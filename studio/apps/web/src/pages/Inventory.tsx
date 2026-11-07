import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, can } from '../api';
import { Badge, ErrorBox } from '../components/ui';
import { useMe } from '../main';

export interface InvRow {
  itemId: string;
  rmsId: string | null;
  product: string;
  productGroup: string | null;
  qtyShown: number | null;
  qtyShownRaw: string | null;
  rentalRate: number | null;
  currency: string | null;
  chargePeriod: string | null;
  dataFlag: string | null;
  issues: string[];
  inSourceFile: boolean;
  sourceRow: number | null;
  modelId: string | null;
  category: string;
  categoryStatus: string;
  qtyConfirmed: number | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
  confirmBasis: string | null;
  specCount: number;
  duplicateOf: string | null;
  duplicateOfProduct: string | null;
  duplicateNote: string | null;
}
interface Snap {
  id: string;
  version: number;
  kind: string;
  note: string | null;
  is_current: boolean;
  created_at: string;
  created_by: string;
  file_name: string | null;
  items: number;
}

const ISSUE_LABEL: Record<string, string> = {
  QTY_BLANK: 'qty blank',
  QTY_ZERO: 'qty 0',
  QTY_NOT_NUMERIC: 'qty not a number',
  QTY_NOT_INTEGER: 'qty fractional',
  QTY_NEGATIVE: 'qty negative',
  RATE_ZERO: 'rate 0',
  RATE_BLANK: 'rate blank',
  RATE_NOT_NUMERIC: 'rate not a number',
  RMS_ID_BLANK: 'no RMS ID',
  POSSIBLE_DUPLICATE_PRODUCT: 'possible duplicate',
  POSSIBLE_NEAR_DUPLICATE: 'possible duplicate',
  QTY_UNIT_OF_MEASURE: 'qty in m²/m?',
  DATA_FLAG_PRESENT: 'data flag',
  CHARGE_PERIOD_BLANK: 'period blank',
};

const isDupFlagged = (r: InvRow) => r.issues.includes('POSSIBLE_DUPLICATE_PRODUCT') || r.issues.includes('POSSIBLE_NEAR_DUPLICATE');

export function InventoryPage() {
  const { me } = useMe();
  const nav = useNavigate();
  const [data, setData] = useState<{ snapshot: { id: string; version: number } | null; rows: InvRow[] } | null>(null);
  const [snaps, setSnaps] = useState<Snap[]>([]);
  const [err, setErr] = useState<unknown>(null);
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('');
  const [filter, setFilter] = useState<'all' | 'unconfirmed' | 'confirmed' | 'mismatch' | 'issues' | 'notinfile' | 'duplicates'>('all');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [basis, setBasis] = useState('');
  const [attest, setAttest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [policy, setPolicy] = useState<{ useFileQuantities: boolean; headroomPct: number } | null>(null);

  const load = async () => {
    try {
      setData(await api.get('/inventory'));
      setSnaps(await api.get('/inventory/snapshots'));
      setPolicy(await api.get('/settings/stock-policy'));
    } catch (e) {
      setErr(e);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const rows = data?.rows ?? [];
  const groups = useMemo(() => [...new Set(rows.map((r) => r.productGroup ?? '(none)'))].sort(), [rows]);
  const shown = rows.filter((r) => {
    if (q && !`${r.product} ${r.rmsId ?? ''} ${r.category}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (group && (r.productGroup ?? '(none)') !== group) return false;
    if (filter === 'unconfirmed') return r.qtyConfirmed === null;
    if (filter === 'confirmed') return r.qtyConfirmed !== null;
    if (filter === 'mismatch') return r.qtyConfirmed !== null && r.qtyShown !== null && r.qtyConfirmed !== r.qtyShown;
    if (filter === 'issues') return r.issues.length > 0;
    if (filter === 'notinfile') return !r.inSourceFile;
    if (filter === 'duplicates') return isDupFlagged(r) || !!r.duplicateOf;
    return true;
  });
  const confirmed = rows.filter((r) => r.qtyConfirmed !== null).length;
  const dupCandidates = rows.filter((r) => isDupFlagged(r) && !r.duplicateOf);
  const markDup = async (r: InvRow, ofItemId: string | null) => {
    setErr(null);
    try {
      await api.post(`/inventory/items/${r.itemId}/duplicate`, { ofItemId, note: ofItemId ? 'Marked from inventory page' : undefined });
      await load();
    } catch (e) {
      setErr(e);
    }
  };
  const canConfirm = can(me, 'inventory.confirm_qty');

  const onUpload = async (f: File) => {
    setErr(null);
    setBusy(true);
    try {
      const r = await api.upload<{ importId: string }>('/inventory/imports', f, f.name);
      nav(`/inventory/imports/${r.importId}`);
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  const submitConfirm = async (payload: { items?: { itemId: string; qtyOwned: number }[]; acceptShownFor?: string[] }) => {
    setErr(null);
    try {
      await api.post('/inventory/confirmations', { basis, ...payload });
      setSel(new Set());
      setEdits({});
      await load();
    } catch (e) {
      setErr(e);
    }
  };

  const editedItems = Object.entries(edits)
    .filter(([, v]) => v.trim() !== '')
    .map(([itemId, v]) => ({ itemId, qtyOwned: Number(v) }));

  return (
    <div className="page stack">
      <div className="spread">
        <div>
          <div className="eyebrow">Inventory management</div>
          <h1>Equipment inventory {data?.snapshot && <span className="muted">· snapshot v{data.snapshot.version}</span>}</h1>
        </div>
        {can(me, 'equipment.edit') && data?.snapshot && (
          <button className="btn" title="Fill missing specs from the researched manufacturer spec library (never overrides values you entered)" onClick={async () => { try { const r = await api.post<{ models: number; written: number }>('/equipment/spec-library/apply'); alert(`Spec library: ${r.written} value(s) on ${r.models} model(s).`); await load(); } catch (e) { setErr(e); } }}>
            Apply spec library
          </button>
        )}
        {can(me, 'inventory.import') && (
          <label className="btn primary" style={{ display: 'inline-flex', alignItems: 'center', margin: 0, color: '#fff' }}>
            {busy ? 'Reading…' : 'Upload inventory file (.xlsx / .csv)'}
            <input type="file" accept=".xlsx,.csv" hidden onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} />
          </label>
        )}
      </div>
      <ErrorBox error={err} />
      {!data?.snapshot && (
        <div className="alert info">
          No inventory yet. Upload your Current RMS export (e.g. <span className="mono">SNI_Inventory_List_2026-11-03.xlsx</span>). The importer reads the <b>Inventory</b> worksheet, keeps every original value, and shows a preview before anything is applied.
        </div>
      )}
      {data?.snapshot && (
        <>
          <div className="alert warn">
            <div className="spread">
              <div>
                <b>Stock policy:</b>{' '}
                {policy?.useFileQuantities ? (
                  <>file quantities (Current RMS <i>available to rent</i>) are used as <b>availability guidelines</b>, with up to <b>{policy.headroomPct} %</b> more allowed. Units over the file figure are flagged on every design. Confirmed owned quantities are hard limits.</>
                ) : (
                  <>only <b>confirmed owned</b> quantities are allocated; file quantities are ignored.</>
                )}{' '}
                {confirmed} of {rows.length} items have a confirmed quantity.
              </div>
              {policy && canConfirm && (
                <div className="row">
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center', margin: 0, color: 'inherit' }}>
                    <input type="checkbox" style={{ minHeight: 0 }} checked={policy.useFileQuantities} onChange={async (e) => { try { setPolicy(await api.put('/settings/stock-policy', { ...policy, useFileQuantities: e.target.checked })); } catch (x) { setErr(x); } }} />
                    Use file quantities
                  </label>
                  <label style={{ margin: 0, color: 'inherit' }}>
                    headroom{' '}
                    <input type="number" min={0} max={100} style={{ width: 64 }} value={policy.headroomPct} disabled={!policy.useFileQuantities} onChange={(e) => setPolicy({ ...policy, headroomPct: Number(e.target.value) })} onBlur={async () => { try { setPolicy(await api.put('/settings/stock-policy', policy)); } catch (x) { setErr(x); } }} /> %
                  </label>
                </div>
              )}
            </div>
          </div>
          <div className="card">
            <div className="row" style={{ marginBottom: 10 }}>
              <input placeholder="Search product, RMS ID, category…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 260 }} />
              <select value={group} onChange={(e) => setGroup(e.target.value)}>
                <option value="">All product groups ({groups.length})</option>
                {groups.map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </select>
              <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
                <option value="all">All items</option>
                <option value="unconfirmed">Quantity not confirmed</option>
                <option value="confirmed">Quantity confirmed</option>
                <option value="mismatch">Confirmed ≠ file qty</option>
                <option value="issues">Has data-quality issues</option>
                <option value="notinfile">Kept but missing from latest file</option>
                <option value="duplicates">Possible / marked duplicates</option>
              </select>
              <span className="muted small">{shown.length} shown</span>
            </div>
            {canConfirm && (sel.size > 0 || editedItems.length > 0) && (
              <div className="alert info" style={{ marginBottom: 10 }}>
                <div className="row">
                  <input placeholder="Basis, e.g. “Physical stock count 2026-11-05”" value={basis} onChange={(e) => setBasis(e.target.value)} style={{ minWidth: 320 }} />
                  <label style={{ margin: 0, display: 'flex', gap: 6, alignItems: 'center', color: 'inherit' }}>
                    <input type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} style={{ minHeight: 0 }} />I confirm these are quantities <b>owned</b> by Sound Ninja, not just available to rent.
                  </label>
                </div>
                <div className="row" style={{ marginTop: 8 }}>
                  {sel.size > 0 && (
                    <button className="btn sm primary" disabled={!attest || basis.length < 3} onClick={() => submitConfirm({ acceptShownFor: [...sel] })}>
                      Accept file qty as owned for {sel.size} selected
                    </button>
                  )}
                  {editedItems.length > 0 && (
                    <button className="btn sm primary" disabled={!attest || basis.length < 3} onClick={() => submitConfirm({ items: editedItems })}>
                      Save {editedItems.length} entered quantit{editedItems.length > 1 ? 'ies' : 'y'}
                    </button>
                  )}
                </div>
              </div>
            )}
            <div style={{ maxHeight: 'calc(100vh - 360px)', overflow: 'auto' }}>
              <table className="data">
                <thead>
                  <tr>
                    {canConfirm && (
                      <th>
                        <input type="checkbox" aria-label="Select all shown" style={{ minHeight: 0 }} onChange={(e) => setSel(e.target.checked ? new Set(shown.filter((r) => r.qtyShown !== null && Number.isInteger(r.qtyShown) && r.qtyShown > 0).map((r) => r.itemId)) : new Set())} />
                      </th>
                    )}
                    <th>RMS ID</th>
                    <th>Product</th>
                    <th>Product group (source)</th>
                    <th>Engineering category</th>
                    <th className="num">File qty</th>
                    <th className="num">Confirmed owned</th>
                    <th className="num">Rate</th>
                    <th>Period</th>
                    <th>Data quality</th>
                    <th className="num">Specs</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.itemId}>
                      {canConfirm && (
                        <td>
                          <input type="checkbox" style={{ minHeight: 0 }} aria-label={`Select ${r.product}`} checked={sel.has(r.itemId)} disabled={r.qtyShown === null || !Number.isInteger(r.qtyShown) || r.qtyShown <= 0} title={r.qtyShown === 0 ? 'File shows 0 available — enter the owned quantity explicitly' : undefined} onChange={(e) => { const s = new Set(sel); e.target.checked ? s.add(r.itemId) : s.delete(r.itemId); setSel(s); }} />
                        </td>
                      )}
                      <td className="mono">{r.rmsId ?? <Badge s="UNKNOWN" />}</td>
                      <td>
                        {r.modelId ? <Link to={`/equipment/${r.modelId}`}>{r.product}</Link> : r.product}
                        {!r.inSourceFile && <div className="small muted">Not in latest file — kept for review</div>}
                        {r.duplicateOf ? (
                          <div className="small" style={{ color: 'var(--st-estimated)' }}>
                            Duplicate of “{r.duplicateOfProduct ?? 'another record'}” — excluded from designs{' '}
                            {canConfirm && <button className="btn sm ghost" onClick={() => markDup(r, null)}>Undo</button>}
                          </div>
                        ) : (
                          canConfirm && isDupFlagged(r) && (
                            <div className="small">
                              <select defaultValue="" onChange={(e) => e.target.value && markDup(r, e.target.value)} style={{ minHeight: 28, fontSize: 12 }} aria-label={`Mark ${r.product} as duplicate`}>
                                <option value="">Same equipment as…</option>
                                {dupCandidates.filter((x) => x.itemId !== r.itemId).map((x) => <option key={x.itemId} value={x.itemId}>{x.product} ({x.productGroup ?? '—'}, file qty {x.qtyShown ?? 'blank'})</option>)}
                              </select>
                            </div>
                          )
                        )}
                      </td>
                      <td>{r.productGroup ?? '—'}</td>
                      <td>
                        <span className="small">{r.category}</span> <Badge s={r.categoryStatus} />
                      </td>
                      <td className="num" title="Provisional: Current RMS available-to-rent figure">
                        {r.qtyShown ?? <span className="muted">{r.qtyShownRaw ?? 'blank'}</span>}
                      </td>
                      <td className="num">
                        {canConfirm ? (
                          <input type="number" min={0} step={1} style={{ width: 80, textAlign: 'right' }} placeholder={r.qtyConfirmed === null ? 'not set' : ''} value={edits[r.itemId] ?? (r.qtyConfirmed ?? '')} onChange={(e) => setEdits({ ...edits, [r.itemId]: e.target.value })} title={r.confirmedBy ? `Confirmed by ${r.confirmedBy} (${r.confirmBasis})` : 'Not confirmed'} />
                        ) : (
                          r.qtyConfirmed ?? <Badge s="UNKNOWN" />
                        )}
                        {r.qtyConfirmed !== null && r.qtyShown !== null && r.qtyConfirmed !== r.qtyShown && <div className="small" style={{ color: 'var(--st-estimated)' }}>≠ file</div>}
                      </td>
                      <td className="num">{r.rentalRate === null ? '—' : `R ${r.rentalRate.toFixed(2)}`}</td>
                      <td>{r.chargePeriod ?? '—'}</td>
                      <td>
                        {r.issues.filter((i) => ISSUE_LABEL[i]).map((i) => (
                          <span key={i} className={`badge ${i.startsWith('RATE') || i === 'DATA_FLAG_PRESENT' ? 'st-info' : 'st-warning'}`} style={{ marginRight: 4 }} title={i === 'DATA_FLAG_PRESENT' ? r.dataFlag ?? '' : i}>
                            {ISSUE_LABEL[i]}
                          </span>
                        ))}
                      </td>
                      <td className="num">{r.specCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      {snaps.length > 0 && (
        <div className="card">
          <h2>Snapshot history</h2>
          <table className="data">
            <thead>
              <tr>
                <th>Version</th>
                <th>Type</th>
                <th>Source file</th>
                <th className="num">Items</th>
                <th>By</th>
                <th>When</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {snaps.map((s) => (
                <tr key={s.id}>
                  <td>
                    v{s.version} {s.is_current && <span className="badge st-info">current</span>}
                  </td>
                  <td>{s.kind}{s.note ? ` — ${s.note}` : ''}</td>
                  <td className="mono">{s.file_name ?? '—'}</td>
                  <td className="num">{s.items}</td>
                  <td>{s.created_by}</td>
                  <td>{new Date(s.created_at).toLocaleString('en-ZA')}</td>
                  <td>
                    {!s.is_current && can(me, 'inventory.import') && (
                      <button className="btn sm" onClick={async () => { if (confirm(`Roll back to v${s.version}? This creates a new snapshot; history is kept.`)) { try { await api.post(`/inventory/snapshots/${s.id}/rollback`); await load(); } catch (e) { setErr(e); } } }}>
                        Roll back to this
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
