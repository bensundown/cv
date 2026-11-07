import type { SpecKeyDef } from '@sn/core';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, can } from '../api';
import { Badge, ErrorBox, STATUS_OPTIONS } from '../components/ui';
import { useMe } from '../main';

interface Spec { id: string; key: string; value_num: number | null; unit: string; status: string; source: { kind: string; ref?: string; url?: string; note?: string }; entered_at: string; superseded_at: string | null; entered_by_email: string | null }
interface Rel { id: string; type: string; from_model_id: string; from_model: string; to_model: string | null; to_category: string | null; quantity_rule: Record<string, unknown>; status: string; evidence: { ref?: string; url?: string; note?: string }[] }
interface Model { id: string; manufacturer: string | null; model: string; category: string; category_status: string; identity_status: string; notes: string | null }
interface Meta { specKeys: SpecKeyDef[]; categories: string[]; relationshipTypes: string[] }

export function EquipmentPage() {
  const { id } = useParams();
  const { me } = useMe();
  const [d, setD] = useState<{ model: Model; specs: Spec[]; relationships: Rel[]; items: { id: string; rms_id: string; product: string; product_group: string }[] } | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [models, setModels] = useState<{ id: string; model: string; category: string }[]>([]);
  const [err, setErr] = useState<unknown>(null);
  const [form, setForm] = useState({ key: '', value: '', status: 'PROVISIONAL', kind: 'manufacturer_doc', ref: '', url: '', note: '' });
  const [rel, setRel] = useState({ type: 'REQUIRES', target: '', ratio: '4', status: 'PROVISIONAL', ref: '' });
  const load = () => api.get<NonNullable<typeof d>>(`/models/${id}`).then(setD, setErr);
  useEffect(() => {
    void load();
    api.get<Meta>('/equipment/meta').then(setMeta);
    api.get<typeof models>('/models').then(setModels);
  }, [id]);
  if (!d || !meta) return <div className="page"><ErrorBox error={err} /></div>;
  const current = d.specs.filter((s) => !s.superseded_at);
  const relevant = meta.specKeys.filter((k) => k.categories.includes(d.model.category as never));
  const editable = can(me, 'equipment.edit');

  const saveSpec = async () => {
    setErr(null);
    try {
      await api.post(`/models/${id}/specs`, { key: form.key, value: form.value === '' ? null : Number(form.value), status: form.status, source: { kind: form.kind, ...(form.ref ? { ref: form.ref } : {}), ...(form.url ? { url: form.url } : {}), ...(form.note ? { note: form.note } : {}) } });
      setForm({ ...form, value: '', ref: '', url: '', note: '' });
      await load();
    } catch (e) {
      setErr(e);
    }
  };
  const saveRel = async () => {
    setErr(null);
    try {
      const isCat = rel.target.startsWith('cat:');
      await api.post('/relationships', {
        type: rel.type,
        fromModelId: id,
        ...(isCat ? { toCategory: rel.target.slice(4) } : { toModelId: rel.target }),
        quantity: rel.ratio ? { kind: 'per_unit', ratio: Number(rel.ratio) } : { kind: 'none' },
        status: rel.status,
        evidence: rel.ref ? [{ kind: 'manufacturer_doc', ref: rel.ref }] : [],
      });
      await load();
    } catch (e) {
      setErr(e);
    }
  };

  return (
    <div className="page stack">
      <div>
        <div className="eyebrow">Equipment knowledge base</div>
        <h1>{d.model.model}</h1>
        <div className="row small">
          <span>Manufacturer: <b>{d.model.manufacturer ?? 'not identified'}</b></span>
          <span>Category: <b>{d.model.category}</b> <Badge s={d.model.category_status} /></span>
          <span>Model identity: <Badge s={d.model.identity_status} /></span>
        </div>
        {editable && (
          <div className="row" style={{ marginTop: 8 }}>
            <select value={d.model.category} onChange={async (e) => { await api.patch(`/models/${id}`, { category: e.target.value }); await load(); }}>
              {meta.categories.map((c) => <option key={c}>{c}</option>)}
            </select>
            <span className="small muted">Correct the engineering category if the keyword guess is wrong. The original product group is never changed.</span>
          </div>
        )}
      </div>
      <ErrorBox error={err} />
      <div className="grid2">
        <div className="card">
          <h2>Specifications</h2>
          <p className="small muted">Values parsed from product names are ESTIMATED hints only. Enter datasheet values with their source; only a technical reviewer can mark a value VERIFIED. Never copy values from a different variant.</p>
          <table className="data">
            <thead><tr><th>Spec</th><th className="num">Value</th><th>Status</th><th>Source</th></tr></thead>
            <tbody>
              {relevant.map((k) => {
                const s = current.find((x) => x.key === k.key);
                return (
                  <tr key={k.key}>
                    <td>{k.label}<div className="small muted mono">{k.key}</div></td>
                    <td className="num">{s?.value_num ?? '—'} {s ? k.unit : ''}</td>
                    <td><Badge s={s?.status ?? 'UNKNOWN'} /></td>
                    <td className="small">{s ? <>{s.source.kind}{s.source.ref ? ` · ${s.source.ref}` : ''}{s.source.url && <> · <a href={s.source.url} target="_blank" rel="noreferrer noopener">link</a></>}</> : <span className="muted">needed for: {k.requiredFor.join(', ')}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {editable && (
            <div className="stack" style={{ marginTop: 12 }}>
              <h3>Record a value</h3>
              <div className="row">
                <select value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })}>
                  <option value="">Spec…</option>
                  {meta.specKeys.map((k) => <option key={k.key} value={k.key}>{k.label} ({k.unit})</option>)}
                </select>
                <input type="number" placeholder="Value" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} style={{ width: 120 }} />
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  {STATUS_OPTIONS.filter((s) => s !== 'VERIFIED' || can(me, 'equipment.verify')).map((s) => <option key={s}>{s}</option>)}
                </select>
                <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                  <option value="manufacturer_doc">Manufacturer document</option>
                  <option value="user_confirmation">Physical measurement</option>
                  <option value="user_entry">Other / unverified entry</option>
                </select>
              </div>
              <div className="row">
                <input placeholder="Source reference (document, page)" value={form.ref} onChange={(e) => setForm({ ...form, ref: e.target.value })} style={{ flex: 1 }} />
                <input placeholder="URL" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} style={{ flex: 1 }} />
                <button className="btn primary sm" disabled={!form.key} onClick={saveSpec}>Save</button>
              </div>
            </div>
          )}
          <details style={{ marginTop: 12 }}>
            <summary className="small">History ({d.specs.length} entries)</summary>
            <table className="data small">
              <tbody>
                {d.specs.map((s) => (
                  <tr key={s.id} style={{ opacity: s.superseded_at ? 0.55 : 1 }}>
                    <td className="mono">{s.key}</td><td className="num">{s.value_num}</td><td>{s.status}</td><td>{s.source.kind} {s.source.ref}</td><td>{s.entered_by_email ?? 'import'}</td><td>{new Date(s.entered_at).toLocaleDateString('en-ZA')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
        <div className="card">
          <h2>Relationships</h2>
          <table className="data">
            <thead><tr><th>Type</th><th>Target</th><th>Quantity</th><th>Status</th><th /></tr></thead>
            <tbody>
              {d.relationships.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.from_model_id === id ? r.type : `← ${r.type}`}</td>
                  <td>{r.from_model_id === id ? r.to_model ?? `any ${r.to_category}` : r.from_model}</td>
                  <td className="small mono">{JSON.stringify(r.quantity_rule)}</td>
                  <td><Badge s={r.status} /></td>
                  <td>{editable && <button className="btn sm ghost" onClick={async () => { await api.del(`/relationships/${r.id}`); await load(); }}>Remove</button>}</td>
                </tr>
              ))}
              {!d.relationships.length && <tr><td colSpan={5} className="muted">No relationships recorded. The design engine reports dependent checks (legs, mounting, processor compatibility) as assumptions or UNKNOWN until these exist.</td></tr>}
            </tbody>
          </table>
          {editable && (
            <div className="stack" style={{ marginTop: 12 }}>
              <h3>Add relationship</h3>
              <div className="row">
                <select value={rel.type} onChange={(e) => setRel({ ...rel, type: e.target.value })}>{meta.relationshipTypes.map((t) => <option key={t}>{t}</option>)}</select>
                <select value={rel.target} onChange={(e) => setRel({ ...rel, target: e.target.value })} style={{ maxWidth: 280 }}>
                  <option value="">Target…</option>
                  <optgroup label="Any model in category">{meta.categories.map((c) => <option key={c} value={`cat:${c}`}>any {c}</option>)}</optgroup>
                  <optgroup label="Specific model">{models.filter((x) => x.id !== id).map((x) => <option key={x.id} value={x.id}>{x.model} ({x.category})</option>)}</optgroup>
                </select>
                <input type="number" placeholder="Qty per unit" value={rel.ratio} onChange={(e) => setRel({ ...rel, ratio: e.target.value })} style={{ width: 110 }} title="Required target units per unit of this model (blank = no quantity rule)" />
                <select value={rel.status} onChange={(e) => setRel({ ...rel, status: e.target.value })}>{STATUS_OPTIONS.map((s) => <option key={s}>{s}</option>)}</select>
              </div>
              <div className="row">
                <input placeholder="Evidence (manual section, test record)" value={rel.ref} onChange={(e) => setRel({ ...rel, ref: e.target.value })} style={{ flex: 1 }} />
                <button className="btn primary sm" disabled={!rel.target} onClick={saveRel}>Add</button>
              </div>
            </div>
          )}
          <h3 style={{ marginTop: 16 }}>Inventory records using this model</h3>
          <ul className="small">{d.items.map((i) => <li key={i.id}><span className="mono">{i.rms_id}</span> {i.product} — {i.product_group}</li>)}</ul>
        </div>
      </div>
    </div>
  );
}
