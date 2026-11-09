/**
 * Sound Ninja Design Studio — page edition.
 * One self-contained page: no server, no login. The same deterministic engine (@sn/core) designs
 * everything; Claude (through the viewer's account) researches venues and reads free-text requests.
 */
import {
  applyBrief,
  applyOps,
  chooseScale,
  defaultParams,
  effectiveParams,
  generateDesign,
  interpretCommand,
  ledElevationDrawing,
  NO_LIMITS_POLICY,
  OWNER_GUIDELINE_POLICY,
  parseBrief,
  planDrawing,
  renderSvg,
  STRICT_POLICY,
  ENGINEERING_CATEGORIES,
  guessCategory,
  type Confidence,
  type DesignParams,
  type DesignResult,
  type EngineeringCategory,
  type StockPolicy,
  type VenueGeometry,
} from '@sn/core';
import { StrictMode, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Scene3D } from '../../web/src/components/Scene3D';
import { buildStock, itemKey, readInventoryFile, type InvEdits, type InventoryDoc, type InvRow } from './inventory';
import { aiCommand, getSample, researchVenue, type ResearchedRoom, type VenueResearch } from './research';
import { newId, openStore, useCapability, type Store } from './store';

// ---------- Types ---------------------------------------------------------------------------------
type PolicyName = 'nolimits' | 'guideline' | 'strict';
const POLICIES: Record<PolicyName, { label: string; policy: StockPolicy; help: string }> = {
  nolimits: { label: 'No limits', policy: NO_LIMITS_POLICY, help: 'Design what the event needs. Anything over recorded stock is flagged for hire or confirmation.' },
  guideline: { label: 'File quantities +20 %', policy: OWNER_GUIDELINE_POLICY, help: 'File quantities are a guideline; up to 20 % more may be used.' },
  strict: { label: 'Confirmed only', policy: STRICT_POLICY, help: 'Only quantities you have confirmed as owned.' },
};

interface Venue {
  id: string;
  name: string;
  location: string;
  room: string;
  lengthMm: number | null;
  widthMm: number | null;
  ceilingMm: number | null;
  dimsStatus: Confidence;
  ceilingStatus: Confidence;
  basis: string;
  stageWall: number; // 0-based
  research?: VenueResearch;
  updatedAt: string;
}
interface Rev {
  n: number;
  params: DesignParams;
  stageWall: number | null; // null = venue default
  summary: string;
  at: string;
}
interface Msg {
  role: 'user' | 'assistant';
  text: string;
  rev?: number;
}
interface Project {
  id: string;
  name: string;
  client: string;
  venueId: string;
  brief: string;
  revs: Rev[];
  messages: Msg[];
  updatedAt: string;
}

// ---------- Helpers -------------------------------------------------------------------------------
const m = (mm: number | null | undefined, d = 2) => (mm === null || mm === undefined ? '—' : `${(mm / 1000).toFixed(d)} m`);
const Badge = ({ s, title }: { s: string | null | undefined; title?: string }) => <span className={`badge st-${s ?? 'UNKNOWN'}`} title={title}>{(s ?? 'UNKNOWN').replace(/_/g, ' ')}</span>;
const confFromResearch = (c: ResearchedRoom['confidence']): Confidence => (c === 'documented' ? 'PROVISIONAL' : c === 'approximate' ? 'ESTIMATED' : 'UNKNOWN');
const errText = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e));

function roomFromResearch(r: ResearchedRoom, guests: number | null) {
  let L = r.lengthM ? r.lengthM * 1000 : null;
  let W = r.widthM ? r.widthM * 1000 : null;
  let status = confFromResearch(r.confidence);
  let basis = r.basis;
  if ((!L || !W) && r.areaM2) {
    L = Math.sqrt(r.areaM2 * 1.5) * 1000;
    W = (r.areaM2 * 1e6) / L;
    status = 'ESTIMATED';
    basis = `${basis ? basis + '; ' : ''}length × width estimated from ${r.areaM2} m² at a 3:2 ratio`;
  }
  if ((!L || !W) && (r.banquet || guests)) {
    const area = (r.banquet ?? guests ?? 0) * 1.6 + 150;
    L = Math.sqrt(area * 1.5) * 1000;
    W = (area * 1e6) / L;
    status = 'ESTIMATED';
    basis = `${basis ? basis + '; ' : ''}size estimated from ${r.banquet ? `banquet capacity ${r.banquet}` : `${guests} guests`} at ~1.6 m² per guest + 150 m² for stage and FOH`;
  }
  return { lengthMm: L ? Math.round(L / 100) * 100 : null, widthMm: W ? Math.round(W / 100) * 100 : null, dimsStatus: L && W ? status : ('UNKNOWN' as Confidence), ceilingMm: r.ceilingM ? Math.round(r.ceilingM * 1000) : null, ceilingStatus: r.ceilingM ? confFromResearch(r.confidence === 'unknown' ? 'approximate' : r.confidence) : ('UNKNOWN' as Confidence), basis };
}

const defaultWall = (L: number, W: number) => (W <= L ? 1 : 0); // back onto a short wall

function venueGeometry(v: Venue, stageWall: number | null): VenueGeometry {
  const L = v.lengthMm ?? 0;
  const W = v.widthMm ?? 0;
  const researched = !!v.research && v.basis !== 'Entered by hand';
  return {
    venueName: `${v.name}${v.room ? ` — ${v.room}` : ''}`,
    roomPolygon: [{ x: 0, y: 0 }, { x: L, y: 0 }, { x: L, y: W }, { x: 0, y: W }],
    roomStatus: v.dimsStatus,
    roomSource: { kind: researched ? 'venue_doc' : 'user_entry', ref: researched ? `AI venue research: ${v.basis || 'no basis given'}` : 'Room size entered by hand' },
    obstacles: [],
    ceilingHeight: v.ceilingMm ? { value: v.ceilingMm, status: v.ceilingStatus, source: { kind: researched ? 'venue_doc' : 'user_entry', ref: researched ? `AI venue research: ${v.basis}` : 'Entered by hand' } } : { value: null, status: 'UNKNOWN', source: { kind: 'derived', note: 'Ceiling height not known' } },
    stageWallIndex: stageWall ?? v.stageWall,
    calibrationStatus: v.dimsStatus,
    calibrationRelUncertainty: null,
  };
}

async function download(filename: string, data: string, type: string) {
  const d = await useCapability<{ save(o: { filename: string; data: Blob }): Promise<unknown> }>('downloads');
  if (!d) throw new Error('Downloads are only available when this page is open in Claude.');
  await d.save({ filename, data: new Blob([data], { type }) });
}

function bomCsv(res: DesignResult): string {
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['RMS ID', 'Product', 'Category', 'Purpose', 'Required', 'Allocated', 'Short', 'Over stock', 'Stock basis', 'File qty', 'Confirmed qty', 'Rate', 'Period'];
  const lines = res.bom.lines.map((l) => [l.rmsId, l.product, l.category, l.purpose, l.required, l.allocated, l.shortfall, l.overGuideline, l.stockBasis, l.qtyShown, l.qtyConfirmed, l.rentalRate, l.chargePeriod].map(q).join(','));
  return [head.map(q).join(','), ...lines].join('\r\n');
}

// ---------- App -----------------------------------------------------------------------------------
function useHash() {
  const [h, setH] = useState(() => location.hash.slice(1) || 'projects');
  useEffect(() => {
    const f = () => setH(location.hash.slice(1) || 'projects');
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  return [h, (v: string) => (location.hash = v)] as const;
}

function App() {
  const [store, setStore] = useState<Store | null>(null);
  const [inv, setInv] = useState<InventoryDoc | null>(null);
  const [edits, setEdits] = useState<InvEdits>({});
  const [policyName, setPolicyName] = useState<PolicyName>('nolimits');
  const [venues, setVenues] = useState<Venue[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [ai, setAi] = useState<boolean | null>(null);
  const [route, go] = useHash();

  useEffect(() => {
    void (async () => {
      const s = await openStore();
      const [meta, ed, settings, vs, ps] = await Promise.all([
        s.get<Omit<InventoryDoc, 'rows'> & { chunks: number }>('inventory/meta'),
        s.get<InvEdits>('inventory/edits'),
        s.get<{ policy?: PolicyName }>('settings/main'),
        s.list<Venue>('venues'),
        s.list<Project>('projects'),
      ]);
      if (meta) {
        const chunks = await Promise.all(Array.from({ length: meta.chunks }, (_, i) => s.get<InvRow[]>(`invchunks/c${i}`)));
        setInv({ fileName: meta.fileName, importedAt: meta.importedAt, issues: meta.issues, rows: chunks.flatMap((c) => c ?? []) });
      }
      setEdits(ed ?? {});
      if (settings?.policy && settings.policy in POLICIES) setPolicyName(settings.policy);
      setVenues(vs.map((v) => v.data).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      setProjects(ps.map((p) => p.data).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      setStore(s);
    })();
    void getSample().then((x) => setAi(!!x));
  }, []);

  const { stock, relationships } = useMemo(() => buildStock(inv, edits), [inv, edits]);

  const saveInventory = async (doc: InventoryDoc) => {
    if (!store) return;
    const size = 300;
    const chunks = Math.ceil(doc.rows.length / size);
    for (let i = 0; i < chunks; i++) await store.set(`invchunks/c${i}`, doc.rows.slice(i * size, (i + 1) * size));
    await store.set('inventory/meta', { fileName: doc.fileName, importedAt: doc.importedAt, issues: doc.issues, chunks });
    setInv(doc);
  };
  const saveEdits = async (e: InvEdits) => {
    setEdits(e);
    await store?.set('inventory/edits', e);
  };
  const savePolicy = async (p: PolicyName) => {
    setPolicyName(p);
    await store?.set('settings/main', { policy: p });
  };
  const saveVenue = async (v: Venue) => {
    const nv = { ...v, updatedAt: new Date().toISOString() };
    setVenues((vs) => [nv, ...vs.filter((x) => x.id !== v.id)]);
    await store?.set(`venues/${v.id}`, nv);
    return nv;
  };
  const deleteVenue = async (id: string) => {
    setVenues((vs) => vs.filter((x) => x.id !== id));
    await store?.del(`venues/${id}`);
  };
  const saveProject = async (p: Project) => {
    const np = { ...p, revs: p.revs.slice(-40), messages: p.messages.slice(-120), updatedAt: new Date().toISOString() };
    setProjects((ps) => [np, ...ps.filter((x) => x.id !== p.id)]);
    await store?.set(`projects/${p.id}`, np);
  };
  const deleteProject = async (id: string) => {
    setProjects((ps) => ps.filter((x) => x.id !== id));
    await store?.del(`projects/${id}`);
  };

  if (!store) return <div className="center-screen"><div className="loading">Opening the studio…</div></div>;
  const policy = POLICIES[policyName].policy;
  const ctx = { store, stock, relationships, policy, policyName, venues, projects, ai, inv, saveVenue, saveProject, deleteProject, deleteVenue, go };
  const pid = route.startsWith('p-') ? route.slice(2) : null;
  const project = pid ? projects.find((p) => p.id === pid) : null;

  return (
    <div className="shell">
      <header className="topbar">
        <a href="#projects" className="brand"><span className="mark">SOUND NINJA</span><span className="sub">Design Studio</span></a>
        <nav>
          <a href="#projects" className={route === 'projects' || pid ? 'active' : ''}>Projects</a>
          <a href="#venues" className={route === 'venues' ? 'active' : ''}>Venues</a>
          <a href="#inventory" className={route === 'inventory' ? 'active' : ''}>Inventory</a>
        </nav>
        <div className="who">
          <span className={`pill ${policyName === 'nolimits' ? 'on' : ''}`} title={POLICIES[policyName].help}>Stock: {POLICIES[policyName].label}</span>
          <span className="pill" title={store.kind === 'cloud' ? 'Saved with this page in Claude' : 'Saved in this browser only'}>{store.kind === 'cloud' ? 'Saved' : store.kind === 'browser' ? 'This browser' : 'Not saved'}</span>
        </div>
      </header>
      <main className="main">
        {pid && project && <Workspace key={project.id} project={project} {...ctx} />}
        {pid && !project && <div className="page"><div className="alert warn">That project no longer exists. <a href="#projects">Back to projects</a></div></div>}
        {route === 'projects' && <Projects {...ctx} />}
        {route === 'venues' && <Venues {...ctx} />}
        {route === 'inventory' && <Inventory inv={inv} edits={edits} saveInventory={saveInventory} saveEdits={saveEdits} policyName={policyName} savePolicy={savePolicy} stockCount={stock.length} />}
      </main>
    </div>
  );
}

type Ctx = {
  store: Store;
  stock: ReturnType<typeof buildStock>['stock'];
  relationships: ReturnType<typeof buildStock>['relationships'];
  policy: StockPolicy;
  policyName: PolicyName;
  venues: Venue[];
  projects: Project[];
  ai: boolean | null;
  inv: InventoryDoc | null;
  saveVenue: (v: Venue) => Promise<Venue>;
  saveProject: (p: Project) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  deleteVenue: (id: string) => Promise<void>;
  go: (h: string) => void;
};

// ---------- Projects ------------------------------------------------------------------------------
const SAMPLE_BRIEF = 'Gala dinner for 400 guests, rounds of 10. Stage 12 m wide with an LED wall 8 m × 4.5 m. Full sound with 4 handheld mics. Dramatic lighting with moving heads.';

function Projects(c: Ctx) {
  const [name, setName] = useState('');
  const [client, setClient] = useState('');
  const [venueId, setVenueId] = useState('');
  const [venueQuery, setVenueQuery] = useState('');
  const [brief, setBrief] = useState(SAMPLE_BRIEF);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const create = async () => {
    setErr(null);
    try {
      const b = parseBrief(brief);
      let params = applyBrief(defaultParams(), b);
      let venue = c.venues.find((v) => v.id === venueId) ?? null;
      if (!venue) {
        const q = venueQuery.trim();
        if (!q) throw new Error('Pick a venue or type a venue name to research.');
        setBusy(`Researching ${q}…`);
        let research: VenueResearch | undefined;
        try {
          research = await researchVenue(q, params.guests);
        } catch (e) {
          if (c.ai) throw e;
        }
        const room = research?.rooms.find((r) => (r.lengthM && r.widthM) || r.areaM2) ?? research?.rooms[0];
        const dims = room ? roomFromResearch(room, params.guests) : roomFromResearch({ name: 'Main room', lengthM: null, widthM: null, ceilingM: null, areaM2: null, banquet: null, theatre: null, confidence: 'unknown', basis: 'Venue not researched' }, params.guests ?? 300);
        venue = await c.saveVenue({ id: newId(), name: research?.venue || q, location: research?.location ?? '', room: room?.name ?? 'Main room', ...dims, stageWall: dims.lengthMm && dims.widthMm ? defaultWall(dims.lengthMm, dims.widthMm) : 1, ...(research ? { research } : {}), updatedAt: '' });
      }
      // Claude also reads the whole brief, so wording the pattern parser misses still lands.
      let aiNote = '';
      let wall: number | null = null;
      if (c.ai) {
        setBusy('Reading the brief…');
        try {
          const a = await aiCommand(`Set up the whole design for this client brief (only set what the brief asks for or clearly implies): ${brief}`, params, `Venue ${venue.name} ${venue.room}, ${m(venue.lengthMm, 1)} × ${m(venue.widthMm, 1)}, ceiling ${m(venue.ceilingMm, 1)}.`);
          const ops = a.ops.map((o) => (o.path === 'stageWall' && o.op === 'set' ? { ...o, value: Number(o.value) - 1 } : o));
          const applied = applyOps(params, ops);
          params = applied.params;
          wall = applied.stageWall ?? null;
          aiNote = ` ${a.reply}`;
        } catch {
          /* the pattern reading above still stands */
        }
      }
      setBusy('Designing…');
      const p: Project = {
        id: newId(),
        name: name.trim() || `${params.eventType ?? 'Event'} at ${venue.name}`,
        client: client.trim(),
        venueId: venue.id,
        brief,
        revs: [{ n: 1, params, stageWall: wall, summary: 'Initial design from brief', at: new Date().toISOString() }],
        messages: [
          { role: 'user', text: brief },
          { role: 'assistant', text: `Designed from the brief for ${venue.name}${venue.room ? ` (${venue.room}, ${m(venue.lengthMm, 1)} × ${m(venue.widthMm, 1)}, room size ${venue.dimsStatus.toLowerCase()})` : ''}. Read ${b.extracted.length} requirement(s) from the brief.${aiNote} Ask for any change in plain words.`, rev: 1 },
        ],
        updatedAt: '',
      };
      await c.saveProject(p);
      c.go(`p-${p.id}`);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page stack">
      <section className="card hero">
        <div className="eyebrow">New design</div>
        <h1>Brief to stage plan in one step</h1>
        <p className="muted">Name the venue and paste the brief. The studio researches the venue, picks the room, and designs staging, LED, sound, lighting and seating from your inventory.</p>
        <div className="grid2">
          <div>
            <div className="field"><label htmlFor="pv">Venue</label>
              <select id="pv" value={venueId} onChange={(e) => setVenueId(e.target.value)}>
                <option value="">Research a new venue…</option>
                {c.venues.map((v) => <option key={v.id} value={v.id}>{v.name}{v.room ? ` — ${v.room}` : ''}</option>)}
              </select>
            </div>
            {!venueId && <div className="field"><label htmlFor="pq">Venue name and city</label><input id="pq" value={venueQuery} onChange={(e) => setVenueQuery(e.target.value)} placeholder="e.g. Sandton Convention Centre, Johannesburg" /></div>}
            <div className="row">
              <div className="field" style={{ flex: 1 }}><label htmlFor="pn">Project name</label><input id="pn" value={name} onChange={(e) => setName(e.target.value)} placeholder="Optional" /></div>
              <div className="field" style={{ flex: 1 }}><label htmlFor="pc">Client</label><input id="pc" value={client} onChange={(e) => setClient(e.target.value)} placeholder="Optional" /></div>
            </div>
          </div>
          <div className="field"><label htmlFor="pb">Brief</label><textarea id="pb" value={brief} onChange={(e) => setBrief(e.target.value)} rows={7} /></div>
        </div>
        {err && <div className="alert error">{err}</div>}
        {!c.inv && <div className="alert info small">No inventory loaded yet: the design will list what is needed without stock. <a href="#inventory">Load your inventory</a>.</div>}
        {c.ai === false && !venueId && <div className="alert info small">Venue research works when this page is open in Claude. Here the room size is estimated from the guest count; correct it under Venues.</div>}
        <div className="row"><button className="btn primary" disabled={!!busy} onClick={create}>{busy ?? 'Research & design'}</button></div>
      </section>

      <section className="card">
        <h2>Projects</h2>
        {c.projects.length === 0 ? <p className="muted">No projects yet.</p> : (
          <div className="table-wrap"><table className="data">
            <thead><tr><th>Project</th><th>Venue</th><th>Revisions</th><th>Updated</th><th /></tr></thead>
            <tbody>{c.projects.map((p) => {
              const v = c.venues.find((x) => x.id === p.venueId);
              return <tr key={p.id}><td><a href={`#p-${p.id}`}><b>{p.name}</b></a>{p.client && <div className="small muted">{p.client}</div>}</td><td>{v ? `${v.name}${v.room ? ` — ${v.room}` : ''}` : <span className="muted">venue removed</span>}</td><td className="num">{p.revs.length}</td><td className="small">{new Date(p.updatedAt).toLocaleString('en-ZA')}</td><td><ConfirmButton label="Delete" onConfirm={() => c.deleteProject(p.id)} /></td></tr>;
            })}</tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}

function ConfirmButton({ label, onConfirm }: { label: string; onConfirm: () => void }) {
  const [ask, setAsk] = useState(false);
  return ask ? <span className="row nowrap"><button className="btn sm danger" onClick={() => { setAsk(false); onConfirm(); }}>Yes, {label.toLowerCase()}</button><button className="btn sm ghost" onClick={() => setAsk(false)}>Cancel</button></span> : <button className="btn sm ghost" onClick={() => setAsk(true)}>{label}</button>;
}

// ---------- Venues --------------------------------------------------------------------------------
function Venues(c: Ctx) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [stream, setStream] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(c.venues[0]?.id ?? null);

  const research = async (query: string, existing?: Venue) => {
    setBusy(true);
    setErr(null);
    setStream('');
    try {
      const r = await researchVenue(query, null, (t) => setStream(t.slice(-400)));
      const room = r.rooms.find((x) => (x.lengthM && x.widthM) || x.areaM2) ?? r.rooms[0];
      const dims = room ? roomFromResearch(room, null) : { lengthMm: null, widthMm: null, dimsStatus: 'UNKNOWN' as Confidence, ceilingMm: null, ceilingStatus: 'UNKNOWN' as Confidence, basis: '' };
      const v = await c.saveVenue({ ...(existing ?? { id: newId(), stageWall: 1, updatedAt: '' }), name: r.venue || query, location: r.location, room: room?.name ?? 'Main room', ...dims, stageWall: dims.lengthMm && dims.widthMm ? defaultWall(dims.lengthMm, dims.widthMm) : 1, research: r } as Venue);
      setOpen(v.id);
      setQ('');
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const addManual = async () => {
    const v = await c.saveVenue({ id: newId(), name: q.trim() || 'New venue', location: '', room: 'Main room', lengthMm: 30000, widthMm: 20000, ceilingMm: null, dimsStatus: 'PROVISIONAL', ceilingStatus: 'UNKNOWN', basis: 'Entered by hand', stageWall: 1, updatedAt: '' });
    setOpen(v.id);
    setQ('');
  };

  return (
    <div className="page stack">
      <section className="card">
        <div className="eyebrow">Venue research</div>
        <h1>Find a venue</h1>
        <p className="muted">Type a venue and city. Claude looks up its rooms, sizes and ceiling heights and says where each figure comes from. Every figure stays editable.</p>
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (q.trim()) void research(q.trim()); }}>
          <input id="vq" style={{ flex: 1, minWidth: 220 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. CTICC, Cape Town" />
          <button className="btn primary" disabled={busy || !q.trim() || c.ai === false}>{busy ? 'Researching…' : 'Research'}</button>
          <button type="button" className="btn" onClick={addManual}>Enter by hand</button>
        </form>
        {c.ai === false && <div className="alert info small" style={{ marginTop: 8 }}>Research runs through Claude, so it works when this page is open in Claude. You can still enter rooms by hand.</div>}
        {busy && stream && <pre className="stream">{stream}</pre>}
        {err && <div className="alert error" style={{ marginTop: 8 }}>{err}</div>}
      </section>
      {c.venues.map((v) => <VenueCard key={v.id} v={v} open={open === v.id} onToggle={() => setOpen(open === v.id ? null : v.id)} save={c.saveVenue} del={() => c.deleteVenue(v.id)} reresearch={() => research(`${v.name}${v.location ? `, ${v.location}` : ''}`, v)} busy={busy} />)}
    </div>
  );
}

function NumM({ id, value, onChange }: { id: string; value: number | null; onChange: (mm: number | null) => void }) {
  const [t, setT] = useState(value === null ? '' : String(value / 1000));
  useEffect(() => setT(value === null ? '' : String(value / 1000)), [value]);
  return <input id={id} inputMode="decimal" value={t} onChange={(e) => setT(e.target.value)} onBlur={() => { const n = Number(t.replace(',', '.')); onChange(t.trim() && Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : null); }} style={{ width: 90 }} />;
}

function VenueCard({ v, open, onToggle, save, del, reresearch, busy }: { v: Venue; open: boolean; onToggle: () => void; save: (v: Venue) => Promise<Venue>; del: () => void; reresearch: () => void; busy: boolean }) {
  const set = (patch: Partial<Venue>) => void save({ ...v, ...patch });
  return (
    <section className="card">
      <button className="venue-head" onClick={onToggle} aria-expanded={open}>
        <span><b>{v.name}</b>{v.location && <span className="muted"> · {v.location}</span>}<br /><span className="small">{v.room}: {m(v.lengthMm, 1)} × {m(v.widthMm, 1)}, ceiling {m(v.ceilingMm, 1)}</span></span>
        <span className="row nowrap"><Badge s={v.dimsStatus} title="Room size confidence" /><span className="chev">{open ? '−' : '+'}</span></span>
      </button>
      {open && (
        <div className="stack" style={{ marginTop: 12 }}>
          <div className="row">
            <div className="field"><label htmlFor={`rl-${v.id}`}>Length</label><NumM id={`rl-${v.id}`} value={v.lengthMm} onChange={(x) => set({ lengthMm: x, dimsStatus: 'PROVISIONAL', basis: 'Entered by hand' })} /></div>
            <div className="field"><label htmlFor={`rw-${v.id}`}>Width</label><NumM id={`rw-${v.id}`} value={v.widthMm} onChange={(x) => set({ widthMm: x, dimsStatus: 'PROVISIONAL', basis: 'Entered by hand' })} /></div>
            <div className="field"><label htmlFor={`rc-${v.id}`}>Ceiling</label><NumM id={`rc-${v.id}`} value={v.ceilingMm} onChange={(x) => set({ ceilingMm: x, ceilingStatus: x ? 'PROVISIONAL' : 'UNKNOWN' })} /></div>
            <div className="field"><label htmlFor={`sw-${v.id}`}>Stage against</label>
              <select id={`sw-${v.id}`} value={v.stageWall} onChange={(e) => set({ stageWall: Number(e.target.value) })}>
                <option value={0}>Wall 1 (along length)</option><option value={1}>Wall 2 (along width)</option><option value={2}>Wall 3 (along length)</option><option value={3}>Wall 4 (along width)</option>
              </select>
            </div>
            <div className="field"><label>Measured on site</label><button className="btn sm" onClick={() => set({ dimsStatus: 'VERIFIED', ceilingStatus: v.ceilingMm ? 'VERIFIED' : 'UNKNOWN', basis: 'Measured / confirmed on site' })}>Mark verified</button></div>
          </div>
          {v.basis && <div className="small"><b>Basis:</b> {v.basis}</div>}
          {v.research && (
            <>
              {v.research.summary && <p className="small">{v.research.summary}</p>}
              <div className="table-wrap"><table className="data small">
                <thead><tr><th>Room</th><th className="num">L × W</th><th className="num">Ceiling</th><th className="num">Area</th><th className="num">Banquet</th><th>Confidence</th><th /></tr></thead>
                <tbody>{v.research.rooms.map((r, i) => (
                  <tr key={i}>
                    <td><b>{r.name}</b><div className="muted">{r.basis}</div></td>
                    <td className="num">{r.lengthM ?? '—'} × {r.widthM ?? '—'} m</td>
                    <td className="num">{r.ceilingM ? `${r.ceilingM} m` : '—'}</td>
                    <td className="num">{r.areaM2 ? `${r.areaM2} m²` : '—'}</td>
                    <td className="num">{r.banquet ?? '—'}</td>
                    <td><Badge s={confFromResearch(r.confidence)} /></td>
                    <td><button className="btn sm" disabled={v.room === r.name} onClick={() => { const d = roomFromResearch(r, null); set({ room: r.name, ...d, stageWall: d.lengthMm && d.widthMm ? defaultWall(d.lengthMm, d.widthMm) : v.stageWall }); }}>{v.room === r.name ? 'Using' : 'Use'}</button></td>
                  </tr>
                ))}</tbody>
              </table></div>
              {v.research.notes.length > 0 && <div className="small"><b>Check on site:</b><ul>{v.research.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></div>}
            </>
          )}
          <div className="row"><button className="btn sm" disabled={busy} onClick={reresearch}>Research again</button><ConfirmButton label="Delete venue" onConfirm={del} /></div>
        </div>
      )}
    </section>
  );
}

// ---------- Inventory -----------------------------------------------------------------------------
function Inventory({ inv, edits, saveInventory, saveEdits, policyName, savePolicy, stockCount }: { inv: InventoryDoc | null; edits: InvEdits; saveInventory: (d: InventoryDoc) => Promise<void>; saveEdits: (e: InvEdits) => Promise<void>; policyName: PolicyName; savePolicy: (p: PolicyName) => Promise<void>; stockCount: number }) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const rows = useMemo(() => (inv?.rows ?? []).map((r) => ({ r, id: itemKey(r), cat: edits.category?.[itemKey(r)] ?? guessCategory(r.product, r.productGroup).category })), [inv, edits]);
  const shown = rows.filter((x) => (!q || `${x.r.product} ${x.r.rmsId ?? ''} ${x.r.productGroup ?? ''}`.toLowerCase().includes(q.toLowerCase())) && (!cat || x.cat === cat)).slice(0, 300);
  const cats = [...new Set(rows.map((x) => x.cat))].sort();

  const upload = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    setErr(null);
    try {
      await saveInventory(await readInventoryFile(f));
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page stack">
      <section className="card">
        <div className="eyebrow">Stock</div>
        <h1>Inventory</h1>
        <div className="spread">
          <div>{inv ? <><b>{inv.rows.length}</b> items from <b>{inv.fileName}</b> · loaded {new Date(inv.importedAt).toLocaleString('en-ZA')} · {stockCount} offered to designs</> : <span className="muted">No inventory loaded.</span>}</div>
          <label className="btn primary" htmlFor="invfile">{busy ? 'Reading…' : inv ? 'Replace inventory file' : 'Load inventory file'}</label>
          <input id="invfile" type="file" accept=".xlsx,.csv" hidden onChange={(e) => void upload(e.target.files?.[0])} />
        </div>
        {err && <div className="alert error" style={{ marginTop: 8 }}>{err}</div>}
        <div className="policy">
          {(Object.keys(POLICIES) as PolicyName[]).map((k) => (
            <button key={k} className={`policy-opt ${policyName === k ? 'on' : ''}`} onClick={() => void savePolicy(k)}>
              <b>{POLICIES[k].label}</b><span>{POLICIES[k].help}</span>
            </button>
          ))}
        </div>
      </section>
      {inv && (
        <section className="card">
          <div className="row">
            <input id="iq" placeholder="Search products" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
            <select id="ic" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All categories</option>{cats.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ').toLowerCase()}</option>)}</select>
          </div>
          <div className="table-wrap" style={{ marginTop: 10 }}><table className="data small">
            <thead><tr><th>Product</th><th>Category</th><th className="num">File qty</th><th className="num">Confirmed owned</th><th className="num">Rate</th><th>Use</th></tr></thead>
            <tbody>{shown.map(({ r, id, cat: c }) => (
              <tr key={id} className={edits.hidden?.[id] ? 'dim' : ''}>
                <td>{r.product}<div className="muted mono">{r.rmsId ?? `row ${r.row}`} · {r.productGroup ?? ''}</div></td>
                <td><select aria-label="Category" value={c} onChange={(e) => void saveEdits({ ...edits, category: { ...edits.category, [id]: e.target.value as EngineeringCategory } })}>{ENGINEERING_CATEGORIES.map((k) => <option key={k} value={k}>{k.replace(/_/g, ' ').toLowerCase()}</option>)}</select></td>
                <td className="num">{r.qtyShown ?? '—'}</td>
                <td className="num"><input aria-label="Confirmed owned quantity" inputMode="numeric" style={{ width: 70 }} defaultValue={edits.qtyConfirmed?.[id] ?? ''} onBlur={(e) => { const t = e.target.value.trim(); const n = Number(t); void saveEdits({ ...edits, qtyConfirmed: { ...edits.qtyConfirmed, [id]: t === '' || !Number.isInteger(n) || n < 0 ? null : n } }); }} /></td>
                <td className="num">{r.rentalRate ?? '—'}</td>
                <td><input type="checkbox" aria-label="Offer to designs" checked={!edits.hidden?.[id]} onChange={(e) => void saveEdits({ ...edits, hidden: { ...edits.hidden, [id]: !e.target.checked } })} /></td>
              </tr>
            ))}</tbody>
          </table></div>
          {rows.length > shown.length && <div className="small muted">Showing {shown.length} of {rows.length}. Search to narrow.</div>}
        </section>
      )}
    </div>
  );
}

// ---------- Workspace -----------------------------------------------------------------------------
function SvgView({ svg }: { svg: string }) {
  const [z, setZ] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const start = useRef<{ pan: { x: number; y: number }; z: number; mid: { x: number; y: number }; dist: number } | null>(null);
  const snap = () => {
    const p = [...pts.current.values()];
    const mid = p.length > 1 ? { x: (p[0]!.x + p[1]!.x) / 2, y: (p[0]!.y + p[1]!.y) / 2 } : p[0]!;
    start.current = { pan, z, mid, dist: p.length > 1 ? Math.hypot(p[0]!.x - p[1]!.x, p[0]!.y - p[1]!.y) : 0 };
  };
  return (
    <div className="viewport plan-svg" style={{ cursor: 'grab', touchAction: 'none' }}
      onWheel={(e) => setZ((v) => Math.min(12, Math.max(0.5, v * (e.deltaY < 0 ? 1.15 : 1 / 1.15))))}
      onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); snap(); }}
      onPointerMove={(e) => {
        if (!pts.current.has(e.pointerId) || !start.current) return;
        pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const p = [...pts.current.values()];
        const s0 = start.current;
        if (p.length > 1 && s0.dist > 0) {
          const mid = { x: (p[0]!.x + p[1]!.x) / 2, y: (p[0]!.y + p[1]!.y) / 2 };
          setZ(Math.min(12, Math.max(0.5, (s0.z * Math.hypot(p[0]!.x - p[1]!.x, p[0]!.y - p[1]!.y)) / s0.dist)));
          setPan({ x: s0.pan.x + mid.x - s0.mid.x, y: s0.pan.y + mid.y - s0.mid.y });
        } else setPan({ x: s0.pan.x + p[0]!.x - s0.mid.x, y: s0.pan.y + p[0]!.y - s0.mid.y });
      }}
      onPointerUp={(e) => { pts.current.delete(e.pointerId); if (pts.current.size) snap(); else start.current = null; }}
      onPointerCancel={(e) => { pts.current.delete(e.pointerId); start.current = null; }}
      onDoubleClick={() => { setZ(1); setPan({ x: 0, y: 0 }); }}>
      <div style={{ width: '100%', height: '100%', transform: `translate(${pan.x}px, ${pan.y}px) scale(${z})`, transformOrigin: 'center' }} dangerouslySetInnerHTML={{ __html: svg }} />
      <div className="overlay-note light">Scroll or pinch to zoom · drag to pan · double-tap to reset</div>
    </div>
  );
}

function Workspace(c: Ctx & { project: Project }) {
  const p = c.project;
  const venue = c.venues.find((v) => v.id === p.venueId) ?? null;
  const [revN, setRevN] = useState(p.revs.at(-1)!.n);
  const rev = p.revs.find((r) => r.n === revN) ?? p.revs.at(-1)!;
  const [tab, setTab] = useState<'plan' | '3d' | 'led'>('plan');
  const [side, setSide] = useState<'checks' | 'bom' | 'assumptions'>('bom');
  const [viewpoint, setViewpoint] = useState('overview');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const result = useMemo(() => {
    if (!venue || !venue.lengthMm || !venue.widthMm) return null;
    try {
      return generateDesign({ stockPolicy: c.policy, params: rev.params, venue: venueGeometry(venue, rev.stageWall), stock: c.stock, relationships: c.relationships });
    } catch (e) {
      console.error(e);
      return null;
    }
  }, [rev, venue, c.stock, c.relationships, c.policy]);

  useEffect(() => {
    const l = listRef.current;
    if (l) l.scrollTop = l.scrollHeight;
  }, [p.messages.length]);

  const planSvg = useMemo(() => {
    if (!result) return '';
    const d = planDrawing(result.scene);
    return renderSvg(d, chooseScale(d.extents, 400, 260), { background: '#fff' });
  }, [result]);
  const ledSvg = useMemo(() => {
    if (!result?.scene.ledPlan) return '';
    const d = ledElevationDrawing(result.scene, result.scene.ledPlan);
    return renderSvg(d, chooseScale(d.extents, 400, 200), { background: '#fff' });
  }, [result]);

  const send = async (msg: string) => {
    const t = msg.trim();
    if (!t || busy) return;
    setBusy(true);
    setText('');
    const messages: Msg[] = [...p.messages, { role: 'user', text: t }];
    await c.saveProject({ ...p, messages });
    let reply = '';
    let newRev: Rev | null = null;
    try {
      const cmd = interpretCommand(t);
      let ops = cmd.ops;
      let vp = cmd.viewpoint;
      reply = cmd.reply;
      // Claude reads every request when available (handles compound and loosely worded asks);
      // the deterministic pattern reader is the fallback and handles pure view switches.
      if (c.ai && !(vp && !ops.length)) {
        const ctxNote = venue ? `Venue ${venue.name} ${venue.room}, ${m(venue.lengthMm, 1)} × ${m(venue.widthMm, 1)}, ceiling ${m(venue.ceilingMm, 1)}. ${result ? `Current overall status ${result.validation.overall}; failing checks: ${result.validation.checks.filter((x) => x.result === 'FAIL').map((x) => x.message).join(' | ') || 'none'}.` : ''}` : '';
        const a = await aiCommand(t, rev.params, ctxNote).catch(() => null);
        if (a) {
        ops = a.ops.map((o) => (o.path === 'stageWall' && o.op === 'set' ? { ...o, value: Number(o.value) - 1 } : o));
        vp = a.viewpoint;
        reply = a.reply;
        }
      }
      if (vp) {
        setTab('3d');
        setViewpoint(vp);
      }
      if (ops.length) {
        const base = result ? effectiveParams(rev.params, result, ops.filter((o) => o.op === 'add').map((o) => o.path)) : rev.params;
        const applied = applyOps(base, ops);
        if (applied.errors.length && applied.errors.length === ops.length) reply = `I couldn't apply that: ${applied.errors.join('; ')}.`;
        else {
          newRev = { n: Math.max(...p.revs.map((r) => r.n)) + 1, params: applied.params, stageWall: applied.stageWall ?? rev.stageWall, summary: t, at: new Date().toISOString() };
          if (applied.errors.length) reply += ` (Skipped: ${applied.errors.join('; ')}.)`;
        }
      }
    } catch (e) {
      reply = c.ai === false ? `${interpretCommand(t).reply}` : `Something went wrong: ${errText(e)}`;
    }
    const next: Project = { ...p, revs: newRev ? [...p.revs, newRev] : p.revs, messages: [...messages, { role: 'assistant', text: reply + (newRev ? ` → R${newRev.n}` : ''), ...(newRev ? { rev: newRev.n } : {}) }] };
    await c.saveProject(next);
    if (newRev) setRevN(newRev.n);
    setBusy(false);
  };

  const exportFile = async (kind: 'csv' | 'svg' | 'json') => {
    if (!result) return;
    setNote(null);
    try {
      const base = `${p.name.replace(/[^\w-]+/g, '_')}_R${rev.n}`;
      if (kind === 'csv') await download(`${base}_equipment.csv`, bomCsv(result), 'text/csv');
      if (kind === 'svg') await download(`${base}_plan.svg`, planSvg, 'image/svg+xml');
      if (kind === 'json') await download(`${base}_scene.json`, JSON.stringify({ params: rev.params, result }, null, 1), 'application/json');
    } catch (e) {
      setNote(errText(e));
    }
  };

  const res = result;
  const stage = res?.scene.objects.find((o) => o.kind === 'stage');
  const checks = res?.validation.checks ?? [];
  const counts = (r: string) => checks.filter((x) => x.result === r).length;
  const over = res?.bom.lines.filter((l) => l.overGuideline > 0 || l.shortfall > 0) ?? [];

  return (
    <div className="workspace">
      <div className="card ws-chat">
        <div className="eyebrow">{venue ? `${venue.name}${venue.room ? ` — ${venue.room}` : ''}` : 'No venue'}</div>
        <h2 style={{ marginBottom: 2 }}>{p.name}</h2>
        <div className="small muted" style={{ marginBottom: 8 }}>{p.client || 'No client'} · {rev.params.mode} mode</div>
        <div className="scroll chat" ref={listRef}>
          {p.messages.map((msg, i) => (
            <div key={i} className={`msg ${msg.role}`}>
              {msg.text}
              {msg.rev && msg.rev !== rev.n && <div className="small" style={{ marginTop: 4 }}><button className="linkish" onClick={() => setRevN(msg.rev!)}>View R{msg.rev}</button></div>}
            </div>
          ))}
          {busy && <div className="msg assistant muted">Working…</div>}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); void send(text); }} style={{ marginTop: 8 }}>
          <textarea id="chat" rows={3} style={{ minHeight: 70 }} placeholder="e.g. make the stage 2 m wider and add two more moving heads" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(text); } }} />
          <div className="row" style={{ marginTop: 6 }}>
            <button className="btn primary sm" disabled={busy || !text.trim()}>{busy ? 'Working…' : 'Send'}</button>
            <select aria-label="Revision" value={rev.n} onChange={(e) => setRevN(Number(e.target.value))}>
              {[...p.revs].reverse().map((r) => <option key={r.n} value={r.n}>R{r.n} · {r.summary.slice(0, 40)}</option>)}
            </select>
          </div>
        </form>
      </div>

      <div className="card ws-view">
        <div className="spread">
          <div className="tabs" style={{ marginBottom: 0, borderBottom: 0 }}>
            <button className={tab === 'plan' ? 'on' : ''} onClick={() => setTab('plan')}>2D plan</button>
            <button className={tab === '3d' ? 'on' : ''} onClick={() => setTab('3d')}>3D</button>
            <button className={tab === 'led' ? 'on' : ''} onClick={() => setTab('led')} disabled={!res?.scene.ledPlan}>LED</button>
          </div>
          <div className="row">
            {tab === '3d' && res && <select aria-label="Viewpoint" value={viewpoint} onChange={(e) => setViewpoint(e.target.value)}>{res.scene.viewpoints.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select>}
            {res && <><button className="btn sm" onClick={() => void exportFile('csv')}>Equipment CSV</button><button className="btn sm" onClick={() => void exportFile('svg')}>Plan SVG</button><button className="btn sm" onClick={() => void exportFile('json')}>Scene JSON</button></>}
          </div>
        </div>
        {note && <div className="alert info small" style={{ margin: '6px 0' }}>{note}</div>}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', marginTop: 8 }}>
          {!res && <div className="alert warn">{venue ? <>The room size for {venue.name} is not known yet. <a href="#venues">Enter or research it under Venues</a>.</> : <>This project's venue was removed. <a href="#venues">Add a venue</a>.</>}</div>}
          {res && tab === 'plan' && <SvgView svg={planSvg} />}
          {res && tab === 'led' && <SvgView svg={ledSvg} />}
          {res && tab === '3d' && <div className="viewport dark"><Scene3D scene={res.scene} viewpoint={viewpoint} aesthetic={rev.params.aesthetic} /><div className="overlay-note">Geometry from the design engine · materials and lighting indicative</div></div>}
        </div>
        {res && stage && (
          <div className="row small facts">
            <span>Stage <b>{m(stage.size.x)} × {m(stage.size.y)} × {m(stage.size.z)}</b></span>
            {res.scene.ledPlan && <span>LED <b>{res.scene.ledPlan.cols} × {res.scene.ledPlan.rows} = {res.scene.ledPlan.cols * res.scene.ledPlan.rows} panels</b>{res.scene.ledPlan.resolution.value && <> · {res.scene.ledPlan.resolution.value.w} × {res.scene.ledPlan.resolution.value.h} px</>}</span>}
            <span>Tables <b>{res.scene.objects.filter((o) => o.kind === 'table').length}</b></span>
            {res.scene.objects.some((o) => o.kind === 'speaker') && <span>Audio <b>{res.scene.objects.filter((o) => o.kind === 'speaker' && o.meta?.role !== 'sub').length} tops + {res.scene.objects.filter((o) => o.meta?.role === 'sub').length} subs</b></span>}
            {res.scene.lightingPlan && <span>Lighting <b>{res.scene.objects.filter((o) => o.kind === 'light_fixture').length} fixtures</b></span>}
          </div>
        )}
      </div>

      <div className="card ws-side">
        {res && (
          <>
            <div className="spread">
              <div><div className="small muted">Overall R{rev.n}</div><Badge s={res.validation.overall} /></div>
              <div className="small row"><span>{counts('PASS')} pass</span><span className="fail">{counts('FAIL')} fail</span><span>{counts('WARN')} warn</span><span>{counts('HUMAN_REQUIRED')} sign-off</span></div>
            </div>
            {over.length > 0 && <div className="alert warn small" style={{ margin: '8px 0' }}><b>To hire or confirm:</b> {over.map((l) => `${l.product} ${l.shortfall ? `−${l.shortfall}` : `+${l.overGuideline}`}`).join(' · ')}</div>}
            <div className="small muted" style={{ margin: '6px 0' }}>{res.validation.notCertification}</div>
            <div className="tabs">
              <button className={side === 'bom' ? 'on' : ''} onClick={() => setSide('bom')}>Equipment</button>
              <button className={side === 'checks' ? 'on' : ''} onClick={() => setSide('checks')}>Checks</button>
              <button className={side === 'assumptions' ? 'on' : ''} onClick={() => setSide('assumptions')}>Assumptions</button>
            </div>
            <div className="scroll">
              {side === 'checks' && [...checks].sort((a, b) => ['FAIL', 'UNKNOWN', 'WARN', 'HUMAN_REQUIRED', 'PASS'].indexOf(a.result) - ['FAIL', 'UNKNOWN', 'WARN', 'HUMAN_REQUIRED', 'PASS'].indexOf(b.result)).map((x) => (
                <div key={x.id} className={`check r-${x.result}`}>
                  <div className="spread"><b className="small">{x.title}</b><Badge s={x.result} /></div>
                  <div className="small">{x.message}</div>
                </div>
              ))}
              {side === 'bom' && (
                <>
                  {c.stock.length === 0 && <div className="alert info small">No inventory loaded, so nothing is allocated. <a href="#inventory">Load your inventory</a>.</div>}
                  <div className="table-wrap"><table className="data small">
                    <thead><tr><th>Item</th><th className="num">Need</th><th className="num">Stock</th></tr></thead>
                    <tbody>{res.bom.lines.map((l, i) => (
                      <tr key={i}>
                        <td>{l.product}<div className="muted">{l.purpose}</div></td>
                        <td className="num"><b>{l.required}</b>{l.shortfall > 0 && <div className="fail">−{l.shortfall}</div>}</td>
                        <td className="num">{l.stockBasis === 'CONFIRMED' ? l.qtyConfirmed : l.stockBasis === 'FILE_GUIDELINE' ? l.qtyShown : '—'}{l.overGuideline > 0 && <div className="warnc">+{l.overGuideline} over</div>}</td>
                      </tr>
                    ))}</tbody>
                  </table></div>
                  {res.scene.lightingPlan?.patch && (
                    <>
                      <h3 style={{ marginTop: 12 }}>DMX patch</h3>
                      <div className="table-wrap"><table className="data small"><thead><tr><th>Fixture</th><th>Product</th><th className="num">U</th><th className="num">Addr</th></tr></thead>
                        <tbody>{res.scene.lightingPlan.patch.map((e) => <tr key={e.fixtureId}><td className="mono">{e.fixtureId.replace('light-', '')}</td><td>{e.product}</td><td className="num">{e.universe}</td><td className="num">{e.address}</td></tr>)}</tbody></table></div>
                    </>
                  )}
                  {res.bom.unresolved.length > 0 && <h3 style={{ marginTop: 12 }}>Not found in inventory</h3>}
                  {res.bom.unresolved.map((u) => <div key={u.id} className="check r-UNKNOWN small"><b>{u.description}</b><div>{u.reason}</div></div>)}
                  {res.bom.nonInventory.length > 0 && <h3 style={{ marginTop: 12 }}>Not Sound Ninja stock</h3>}
                  {res.bom.nonInventory.map((n, i) => <div key={i} className="small">{n.qty} × {n.description} <span className="muted">— {n.note}</span></div>)}
                  {res.bom.rentalSummary.byPeriod.length > 0 && <h3 style={{ marginTop: 12 }}>Indicative rental value</h3>}
                  {res.bom.rentalSummary.byPeriod.map((b, i) => <div key={i} className="small">{b.chargePeriod}: <b>R {b.total.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}</b> ({b.lines} lines)</div>)}
                </>
              )}
              {side === 'assumptions' && (
                <>
                  {res.assumptions.map((a) => <div key={a.id} className="check small"><Badge s={a.status} /> {a.text}</div>)}
                  {res.alternatives.length > 0 && <h3 style={{ marginTop: 12 }}>Alternatives</h3>}
                  {res.alternatives.map((a, i) => <div key={i} className="small">• {a}</div>)}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Root(): ReactNode {
  return <App />;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Root /></StrictMode>);
