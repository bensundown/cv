/**
 * Deterministic design generator.
 *
 *   (DesignParams, VenueGeometry, StockItem[], relationships) → DesignResult
 *
 * The same inputs always produce the same scene, BOM and validation. The 2D plan,
 * 3D view, PDF and equipment list are all rendered from `result.scene` / `result.bom`.
 * AI may propose DesignParams; it never writes geometry or counts directly.
 */
import { edgesFrom, findEdge, requiredQuantity, type EquipmentRelationship } from '../equipment/relationships.js';
import { spec } from '../equipment/specs.js';
import {
  add,
  bounds,
  distToBoundary,
  dot,
  norm,
  pointInPolygon,
  polygonInside,
  polygonsOverlap,
  rayToBoundary,
  rectPolygon,
  scale,
  signedArea,
  sub,
  type Pt,
} from '../geometry/polygon.js';
import { type Confidence, type Source, type Sourced, weakest } from '../provenance.js';
import { fmtM } from '../units.js';
import { cabinetGrid, checkProcessor, dataChains, ledPower, nearestWallSizes, wallResolution } from './led.js';
import { defaultCounts, DOWNSTAGE_ROLES, packDmx, pickFixture, UPSTAGE_ROLES, universesUsed } from './lighting.js';
import { nearbyTileableSizes, tileStage, type DeckOption } from './staging.js';
import type {
  Assumption,
  BomLine,
  Check,
  DesignContext,
  DesignParams,
  DesignResult,
  LedPlan,
  LightingPlan,
  OverallStatus,
  SceneObject,
  StockItem,
  UnresolvedRequirement,
} from './types.js';

const DEFAULT: Source = { kind: 'design_default', note: 'System default — change if the brief or venue requires' };

export function defaultParams(): DesignParams {
  const d = (status: Confidence = 'ESTIMATED') => ({ status, source: DEFAULT });
  return {
    mode: 'concept',
    eventType: null,
    guests: null,
    aesthetic: null,
    stage: { widthMm: 8000, depthMm: 4000, heightMm: null, upstageClearanceMm: 1500, offsetAlongWallMm: 0, deckItemId: null },
    led: { enabled: true, widthMm: 6000, heightMm: 3000, bottomAboveStageMm: 0, setbackFromStageRearMm: 500, panelItemId: null, processorItemId: null },
    foh: { position: 'auto', widthMm: 3000, depthMm: 2000, rearClearanceMm: 1500 },
    seating: { style: 'rounds', seatsPerTable: 10, tableDiameterMm: 1800, pitchMm: 3300, frontClearanceMm: 3000, wallClearanceMm: 1000 },
    power: { voltageV: 230, circuitA: 16, planningFactor: 0.8 },
    lighting: { enabled: false, look: 'standard', movingHeads: null, stageWashes: null, consoleItemId: null },
    sources: {
      'stage.widthMm': d(),
      'stage.depthMm': d(),
      'stage.upstageClearanceMm': d(),
      'led.widthMm': d(),
      'led.heightMm': d(),
      'led.bottomAboveStageMm': d(),
      'led.setbackFromStageRearMm': d(),
      'foh.widthMm': d(),
      'foh.depthMm': d(),
      'seating.pitchMm': d(),
      'seating.tableDiameterMm': d(),
      'seating.frontClearanceMm': d(),
      'power.voltageV': d('PROVISIONAL'),
      'power.circuitA': d(),
      'power.planningFactor': d(),
    },
  };
}

/** Fill parameter groups added after a revision was stored (older revisions stay valid). */
export function normalizeParams(p: DesignParams): DesignParams {
  const d = defaultParams();
  return { ...d, ...p, lighting: { ...d.lighting, ...(p.lighting ?? {}) }, power: { ...d.power, ...(p.power ?? {}) }, sources: { ...(p.sources ?? {}) } };
}

/**
 * Pin values the engine chose (stage height from legs, default lighting counts) so that relative
 * revisions ("raise the stage 200 mm", "fewer moving heads") have an explicit base.
 */
export function effectiveParams(params: DesignParams, result: DesignResult, onlyPaths?: string[]): DesignParams {
  // Pin only what a relative change needs; unpinned defaults keep scaling with later edits
  // (e.g. a wider stage or a dramatic look still changes default fixture counts).
  const want = (path: string) => !onlyPaths || onlyPaths.includes(path);
  const p = normalizeParams(structuredClone(params));
  const stage = result.scene.objects.find((o) => o.kind === 'stage');
  if (want('stage.heightMm') && p.stage.heightMm === null && stage) p.stage.heightMm = stage.size.z;
  const count = (g: string) => result.scene.objects.filter((o) => o.kind === 'light_fixture' && o.meta?.group === g).length;
  if (want('lighting.movingHeads') && p.lighting.enabled && p.lighting.movingHeads === null) p.lighting.movingHeads = count('upstage');
  if (want('lighting.stageWashes') && p.lighting.enabled && p.lighting.stageWashes === null) p.lighting.stageWashes = count('downstage');
  return p;
}

const pStat = (p: DesignParams, key: string): Confidence => p.sources[key]?.status ?? 'ESTIMATED';
const pSourced = (p: DesignParams, key: string, value: number, unit?: string): Sourced<number> => ({
  value,
  status: pStat(p, key),
  source: p.sources[key]?.source ?? DEFAULT,
  ...(unit ? { unit } : {}),
});

/** Tracks allocation against CONFIRMED owned quantities only. */
class Allocator {
  private used = new Map<string, number>();
  lines: BomLine[] = [];
  constructor(private stock: StockItem[]) {}
  byId(id: string) {
    return this.stock.find((s) => s.itemId === id);
  }
  remaining(id: string): number {
    const it = this.byId(id);
    return Math.max(0, (it?.qtyConfirmed ?? 0) - (this.used.get(id) ?? 0));
  }
  require(itemId: string, qty: number, purpose: string, basis: Confidence): { allocated: number; shortfall: number } {
    const it = this.byId(itemId)!;
    const allocated = Math.min(qty, this.remaining(itemId));
    this.used.set(itemId, (this.used.get(itemId) ?? 0) + allocated);
    this.lines.push({
      itemId,
      rmsId: it.rmsId,
      product: it.product,
      productGroup: it.productGroup,
      category: it.category,
      purpose,
      required: qty,
      allocated,
      shortfall: qty - allocated,
      qtyConfirmed: it.qtyConfirmed,
      qtyShown: it.qtyShown,
      quantityBasis: basis,
      rentalRate: it.rentalRate,
      chargePeriod: it.chargePeriod,
      currency: it.currency,
    });
    return { allocated, shortfall: qty - allocated };
  }
}

const qtyNote = (it: StockItem | undefined) =>
  !it ? '' : it.qtyConfirmed === null ? ` (owned quantity not yet confirmed — 0 allocatable; file shows ${it.qtyShown ?? 'blank'})` : ` (confirmed owned: ${it.qtyConfirmed})`;

export function generateDesign(ctx: DesignContext): DesignResult {
  const { venue: V, stock, relationships: G } = ctx;
  const P = normalizeParams(ctx.params);
  const checks: Check[] = [];
  const assumptions: Assumption[] = [];
  const alternatives: string[] = [];
  const unresolved: UnresolvedRequirement[] = [];
  const objects: SceneObject[] = [];
  const alloc = new Allocator(stock);
  const roomPoly = V.roomPolygon;
  const roomStatus = weakest(V.roomStatus, V.calibrationStatus);

  // ---- Assumption register from parameter provenance ------------------------------------
  for (const [key, ps] of Object.entries(P.sources)) {
    if (ps.status !== 'VERIFIED' && ps.source.kind === 'design_default') {
      assumptions.push({ id: `param:${key}`, text: `${key} uses a design default`, status: ps.status, source: ps.source });
    }
  }
  if (V.ceilingHeight.status === 'UNKNOWN' || V.ceilingHeight.value === null) assumptions.push({ id: 'venue:ceiling', text: 'Ceiling height is unknown', status: 'UNKNOWN', source: V.ceilingHeight.source });
  assumptions.push({
    id: 'venue:plan',
    text: `Room outline from ${V.roomSource.ref ?? V.roomSource.kind}; calibration ${V.calibrationStatus}${V.calibrationRelUncertainty !== null ? ` (±${(V.calibrationRelUncertainty * 100).toFixed(2)} % scale, 1σ)` : ''}`,
    status: roomStatus,
    source: V.roomSource,
  });

  // ---- Venue checks --------------------------------------------------------------------
  checks.push({
    id: 'venue.geometry',
    title: 'Venue geometry source',
    discipline: 'venue',
    severity: 'hard',
    result: roomPoly.length >= 3 ? 'PASS' : 'FAIL',
    message: roomPoly.length >= 3 ? `Room outline with ${roomPoly.length} vertices; status ${roomStatus}` : 'No room outline',
    dataStatus: roomStatus,
    inputs: [
      { label: 'Room outline', status: V.roomStatus, note: V.roomSource.ref },
      { label: 'Plan calibration', status: V.calibrationStatus },
    ],
  });

  // ---- Stage frame -----------------------------------------------------------------------
  const nV = roomPoly.length;
  const wi = ((V.stageWallIndex % nV) + nV) % nV;
  const A = roomPoly[wi]!;
  const B = roomPoly[(wi + 1) % nV]!;
  const u = norm(sub(B, A));
  const inward: Pt = signedArea(roomPoly) > 0 ? { x: -u.y, y: u.x } : { x: u.y, y: -u.x };
  const origin = add(scale(add(A, B), 0.5), scale(u, P.stage.offsetAlongWallMm));
  const rotationDeg = (Math.atan2(u.y, u.x) * 180) / Math.PI;
  const W = (lx: number, ly: number): Pt => add(origin, add(scale(u, lx), scale(inward, ly)));
  const toLocal = (p: Pt) => ({ lx: dot(sub(p, origin), u), ly: dot(sub(p, origin), inward) });
  const rect = (lx: number, ly: number, w: number, d: number) => rectPolygon(W(lx, ly), w, d, rotationDeg);

  objects.push({ id: 'room', kind: 'room', label: V.venueName, position: { x: 0, y: 0, z: 0 }, rotationDeg: 0, size: { x: 0, y: 0, z: V.ceilingHeight.value ?? 0 }, polygon: roomPoly, status: roomStatus });
  for (const o of V.obstacles) {
    objects.push({ id: `obstacle-${o.id}`, kind: 'obstacle', label: o.label, position: { x: 0, y: 0, z: 0 }, rotationDeg: 0, size: { x: 0, y: 0, z: o.heightMm ?? V.ceilingHeight.value ?? 3000 }, polygon: o.polygon, status: roomStatus });
  }

  // ---- Stage -------------------------------------------------------------------------------
  const SW = P.stage.widthMm;
  const SD = P.stage.depthMm;
  const upc = P.stage.upstageClearanceMm;
  const stageFrontLy = upc + SD;
  const stagePoly = rect(0, upc + SD / 2, SW, SD);
  const stageInside = polygonInside(stagePoly, roomPoly);
  const stageHits = V.obstacles.filter((o) => polygonsOverlap(stagePoly, o.polygon));
  const stageDimStatus = weakest(pStat(P, 'stage.widthMm'), pStat(P, 'stage.depthMm'));
  checks.push({
    id: 'stage.fit',
    title: 'Stage fits the room and clears obstructions',
    discipline: 'staging',
    severity: 'hard',
    result: stageInside && !stageHits.length ? 'PASS' : 'FAIL',
    message: !stageInside
      ? `Stage ${fmtM(SW)} × ${fmtM(SD)} with ${fmtM(upc)} upstage clearance does not fit inside the room on wall ${wi + 1}`
      : stageHits.length
        ? `Stage overlaps: ${stageHits.map((o) => o.label).join(', ')}`
        : `Stage ${fmtM(SW)} × ${fmtM(SD)} fits on wall ${wi + 1}`,
    dataStatus: weakest(roomStatus, stageDimStatus),
    inputs: [
      { label: 'Room outline', status: roomStatus },
      { label: 'Stage size', status: stageDimStatus, note: P.sources['stage.widthMm']?.source.kind },
    ],
  });

  // Leg / height selection.
  // Legs are fixed-height (leg_height_mm) or adjustable (leg_height_min_mm … leg_height_max_mm).
  const legCands = stock
    .filter((s) => s.category === 'STAGE_LEG')
    .map((s) => {
      const fixed = spec(s.specs, 'leg_height_mm');
      const lo = spec(s.specs, 'leg_height_min_mm');
      const hi = spec(s.specs, 'leg_height_max_mm');
      if (lo.value !== null && hi.value !== null && hi.value >= lo.value) return { s, min: lo.value, max: hi.value, status: weakest(lo.status, hi.status) };
      if (fixed.value !== null) return { s, min: fixed.value, max: fixed.value, status: fixed.status };
      return null;
    })
    .filter((x): x is { s: StockItem; min: number; max: number; status: Confidence } => x !== null);
  const covers = (l: { min: number; max: number }, h: number) => h >= l.min - 1 && h <= l.max + 1;
  const legLabel = (l: { min: number; max: number }) => (l.min === l.max ? fmtM(l.min) : `${fmtM(l.min)}–${fmtM(l.max)}`);
  // Deck tiling.
  const deckOpts: (DeckOption & { s: StockItem; dimStatus: Confidence })[] = stock
    .filter((s) => s.category === 'STAGE_DECK')
    .map((s) => ({ s, w: spec(s.specs, 'deck_width_mm'), d: spec(s.specs, 'deck_depth_mm') }))
    .filter((x) => x.w.value !== null && x.d.value !== null)
    .map((x) => ({ itemId: x.s.itemId, widthMm: x.w.value!, depthMm: x.d.value!, available: x.s.qtyConfirmed ?? 0, s: x.s, dimStatus: weakest(x.w.status, x.d.status) }));
  const tiling = deckOpts.length ? tileStage(SW, SD, deckOpts, P.stage.deckItemId) : null;
  const deckCounts: Record<string, number> = tiling?.counts ?? {};

  // Leg rule per deck type: REQUIRES/REQUIRES_ONE_OF relationship, else the labelled 4-per-deck default.
  const legRuleFor = (deck: StockItem) => {
    const edges: EquipmentRelationship[] = deck.modelId
      ? [...edgesFrom(G, deck.modelId, 'REQUIRES'), ...edgesFrom(G, deck.modelId, 'REQUIRES_ONE_OF')].filter(
          (e) => e.to.category === 'STAGE_LEG' || legCands.some((l) => l.s.modelId && (e.to.modelId === l.s.modelId || e.to.oneOf?.includes(l.s.modelId))),
        )
      : [];
    const edge = edges[0];
    const cands = edge && (edge.to.modelId || edge.to.oneOf) ? legCands.filter((l) => l.s.modelId && (edge.to.modelId === l.s.modelId || edge.to.oneOf?.includes(l.s.modelId))) : legCands;
    return { edge, cands, rule: edge?.quantity ?? ({ kind: 'per_unit', ratio: 4 } as const) };
  };
  const legsNeeded = Object.entries(deckCounts).reduce((a, [id, n]) => a + requiredQuantity(legRuleFor(stock.find((x) => x.itemId === id)!).rule, n), 0);
  const ownedCovering = (h: number) => legCands.filter((l) => covers(l, h)).reduce((a, l) => a + (l.s.qtyConfirmed ?? 0), 0);

  let stageH = P.stage.heightMm;
  let stageHStatus: Confidence = stageH !== null ? pStat(P, 'stage.heightMm') : 'ESTIMATED';
  if (stageH === null) {
    if (legCands.length) {
      // Candidate heights: each leg's fixed height, range ends, and 1.0 m clamped into each range.
      const hs = [...new Set(legCands.flatMap((l) => [l.min, l.max, Math.min(Math.max(1000, l.min), l.max)]))];
      const byCloseness = [...hs].sort((a, b) => Math.abs(a - 1000) - Math.abs(b - 1000) || b - a);
      const ideal = byCloseness[0]!;
      const feasible = legsNeeded > 0 ? byCloseness.find((h) => ownedCovering(h) >= legsNeeded) : undefined;
      stageH = feasible ?? ideal;
      const used = legCands.filter((l) => covers(l, stageH!));
      stageHStatus = weakest('ESTIMATED', ...used.map((l) => l.status));
      assumptions.push({
        id: 'stage.height',
        text: feasible !== undefined
          ? `Stage height ${fmtM(stageH)}: the height closest to 1.0 m that confirmed owned legs can fully support (${legsNeeded} legs needed)`
          : `Stage height ${fmtM(stageH)} chosen from available leg heights (closest to 1.0 m); confirmed legs do not cover ${legsNeeded} legs at any height`,
        status: stageHStatus,
        source: DEFAULT,
      });
      if (feasible !== undefined && feasible !== ideal) {
        alternatives.push(`A ${fmtM(ideal)} stage needs ${legsNeeded} legs covering ${fmtM(ideal)}; only ${ownedCovering(ideal)} are confirmed — confirm or hire ${legsNeeded - ownedCovering(ideal)} more, or state the stage height in the brief.`);
      }
    } else {
      stageH = 1000;
      assumptions.push({ id: 'stage.height', text: 'Stage height 1.0 m assumed (no leg heights recorded)', status: 'ESTIMATED', source: DEFAULT });
    }
  }
  objects.push({
    id: 'stage',
    kind: 'stage',
    label: `Stage ${fmtM(SW)} × ${fmtM(SD)} × ${fmtM(stageH)}`,
    position: { ...W(0, upc + SD / 2), z: 0 },
    rotationDeg,
    size: { x: SW, y: SD, z: stageH },
    polygon: stagePoly,
    status: weakest(stageDimStatus, stageHStatus),
  });

  if (!deckOpts.length) {
    checks.push({ id: 'stage.decks', title: 'Stage decks from inventory', discipline: 'staging', severity: 'hard', result: 'UNKNOWN', message: 'No stage deck in the inventory has recorded deck dimensions (deck_width_mm / deck_depth_mm).', dataStatus: 'UNKNOWN', inputs: [] });
    unresolved.push({ id: 'stage.decks', description: `Stage decks for ${fmtM(SW)} × ${fmtM(SD)}`, reason: 'No deck dimensions recorded', candidates: stock.filter((s) => s.category === 'STAGE_DECK').map((s) => s.product) });
  } else if (!tiling) {
    const sizes = nearbyTileableSizes(SW, SD, deckOpts.map((o) => ({ ...o, available: o.available || Number.MAX_SAFE_INTEGER })));
    checks.push({ id: 'stage.decks', title: 'Stage decks from inventory', discipline: 'staging', severity: 'hard', result: 'FAIL', message: `${fmtM(SW)} × ${fmtM(SD)} cannot be built exactly from the recorded deck sizes.`, dataStatus: weakest(...deckOpts.map((o) => o.dimStatus)), inputs: deckOpts.map((o) => ({ label: o.s.product, status: o.dimStatus })) });
    for (const s of sizes) alternatives.push(`Stage ${fmtM(s.widthMm)} × ${fmtM(s.depthMm)} tiles exactly with ${s.decks} × ${stock.find((x) => x.itemId === s.itemId)?.product}`);
  } else {
    const deckThk = new Map(deckOpts.map((o) => [o.itemId, spec(o.s.specs, 'deck_thickness_mm').value ?? 100]));
    const supply = new Map<string, number>();
    for (const [id, n] of Object.entries(deckCounts)) supply.set(id, alloc.require(id, n, 'Stage decks', 'PROVISIONAL').allocated);
    tiling.decks.forEach((dk, i) => {
      const left = supply.get(dk.itemId)!;
      supply.set(dk.itemId, left - 1);
      const lx = dk.cx - SW / 2;
      const ly = upc + dk.cy;
      const t = deckThk.get(dk.itemId)!;
      objects.push({
        id: `deck-${i}`,
        kind: 'stage_deck',
        label: alloc.byId(dk.itemId)!.product,
        position: { ...W(lx, ly), z: stageH! - t },
        rotationDeg,
        size: { x: dk.w, y: dk.d, z: t },
        polygon: rect(lx, ly, dk.w, dk.d),
        itemId: dk.itemId,
        supply: left > 0 ? 'OWNED' : 'SHORTFALL',
        status: deckOpts.find((o) => o.itemId === dk.itemId)!.dimStatus,
      });
    });
    const short = Object.entries(deckCounts).filter(([id, n]) => n > (alloc.byId(id)!.qtyConfirmed ?? 0));
    const dStat = weakest(...Object.keys(deckCounts).map((id) => deckOpts.find((o) => o.itemId === id)!.dimStatus));
    checks.push({
      id: 'stage.decks',
      title: 'Stage decks from inventory',
      discipline: 'staging',
      severity: 'hard',
      result: short.length ? 'FAIL' : 'PASS',
      message:
        Object.entries(deckCounts)
          .map(([id, n]) => `${n} × ${alloc.byId(id)!.product}${qtyNote(alloc.byId(id))}`)
          .join('; ') + (short.length ? ' — insufficient confirmed stock' : ''),
      dataStatus: dStat,
      inputs: Object.keys(deckCounts).map((id) => ({ label: `${alloc.byId(id)!.product} dimensions`, status: deckOpts.find((o) => o.itemId === id)!.dimStatus })),
    });
    if (short.length) {
      const sizes = nearbyTileableSizes(SW, SD, deckOpts);
      for (const s of sizes) alternatives.push(`Stage ${fmtM(s.widthMm)} × ${fmtM(s.depthMm)} is buildable from confirmed stock (${s.decks} × ${alloc.byId(s.itemId)!.product})`);
    }

    // Legs per deck type (relationship graph first, design default otherwise).
    const legIssues: string[] = [];
    const legStatuses: Confidence[] = [];
    for (const [deckId, nDecks] of Object.entries(deckCounts)) {
      const deck = alloc.byId(deckId)!;
      const { edge, cands, rule: qtyRule } = legRuleFor(deck);
      const deckT = spec(deck.specs, 'deck_thickness_mm').value;
      const fits = cands.filter((l) => covers(l, stageH!) || (deckT !== null && covers(l, stageH! - deckT)));
      // Prefer fixed-height legs, then the leg with most confirmed stock; mix products that fit.
      const ordered = [...fits].sort((a, b) => (a.max - a.min) - (b.max - b.min) || (b.s.qtyConfirmed ?? 0) - (a.s.qtyConfirmed ?? 0));
      const match = ordered[0];
      if (!edge) {
        assumptions.push({ id: `legs:${deckId}`, text: `${deck.product}: 4 legs per deck assumed (no REQUIRES relationship recorded)`, status: 'ESTIMATED', source: DEFAULT });
      }
      if (!match) {
        legIssues.push(`No leg of height ${fmtM(stageH)} recorded for ${deck.product} (available: ${cands.map(legLabel).join(', ') || 'none'})`);
        unresolved.push({ id: `legs:${deckId}`, description: `Stage legs ${fmtM(stageH)} for ${nDecks} × ${deck.product}`, reason: 'No matching leg height with recorded spec', candidates: cands.map((c) => c.s.product) });
        legStatuses.push('UNKNOWN');
        continue;
      }
      const n = requiredQuantity(qtyRule, nDecks);
      const basis = edge ? edge.status : 'ESTIMATED';
      let left = n;
      for (const [k, l] of ordered.entries()) {
        const last = k === ordered.length - 1;
        const take = last ? left : Math.min(left, alloc.remaining(l.s.itemId));
        if (take <= 0) continue;
        const r = alloc.require(l.s.itemId, take, `Stage legs for ${deck.product}`, basis);
        legStatuses.push(weakest(basis, l.status));
        left -= r.allocated;
        if (r.shortfall) legIssues.push(`Short ${r.shortfall} legs for ${fmtM(stageH)} (${ordered.map((o) => `${o.s.product}${qtyNote(o.s)}`).join(', ')})${edge ? '' : ' — based on the ASSUMED 4 legs per deck; record the real leg rule (REQUIRES relationship) for this deck'}`);
        if (left <= 0) break;
      }
    }
    const legUnknown = legStatuses.includes('UNKNOWN');
    checks.push({
      id: 'stage.legs',
      title: 'Stage legs / height',
      discipline: 'staging',
      severity: 'hard',
      result: legUnknown ? 'UNKNOWN' : legIssues.length ? 'FAIL' : 'PASS',
      message: legIssues.length ? legIssues.join('; ') : `Legs allocated for stage height ${fmtM(stageH)}`,
      dataStatus: weakest(...legStatuses, stageHStatus),
      inputs: [{ label: 'Stage height', status: stageHStatus }],
    });
  }
  const deckRated = Object.keys(deckCounts).map((id) => spec(alloc.byId(id)!.specs, 'rated_load_kn_m2'));
  checks.push({
    id: 'stage.load',
    title: 'Stage load rating',
    discipline: 'safety',
    severity: 'hard',
    result: 'HUMAN_REQUIRED',
    message: deckRated.length && deckRated.every((r) => r.value !== null)
      ? `Recorded deck rating(s): ${deckRated.map((r) => `${r.value} kN/m² (${r.status})`).join(', ')}. Installation and loading must be approved by a competent person.`
      : 'Deck load rating not recorded. Stage loading must be assessed and approved by a competent person.',
    dataStatus: deckRated.length ? weakest(...deckRated.map((r) => r.status)) : 'UNKNOWN',
    inputs: [],
  });
  const hasAccess = stock.some((s) => s.category === 'STAGE_ACCESSORY' && /stair|step/i.test(s.product));
  checks.push({
    id: 'stage.access',
    title: 'Stage access (stairs / handrails / edge protection)',
    discipline: 'staging',
    severity: 'advisory',
    result: 'WARN',
    message: hasAccess
      ? 'Stair equipment exists in inventory but access is not yet laid out by the engine. Add stairs, handrails and edge protection before issue.'
      : 'No stair / access equipment identified in inventory. Stage access must be added (owned or hired).',
    dataStatus: 'UNKNOWN',
    inputs: [],
  });

  // ---- LED wall -----------------------------------------------------------------------------
  let ledPlan: LedPlan | null = null;
  if (P.led.enabled) {
    const LW = P.led.widthMm;
    const LH = P.led.heightMm;
    const ledDimStatus = weakest(pStat(P, 'led.widthMm'), pStat(P, 'led.heightMm'));
    const panels = stock
      .filter((s) => s.category === 'LED_PANEL')
      .map((s) => ({ s, cw: spec(s.specs, 'cabinet_width_mm'), ch: spec(s.specs, 'cabinet_height_mm'), pitch: spec(s.specs, 'pixel_pitch_mm') }))
      .filter((x) => x.cw.value !== null && x.ch.value !== null);
    const fitting = panels
      .map((x) => ({ ...x, grid: cabinetGrid(LW, LH, x.cw.value!, x.ch.value!) }))
      .filter((x) => x.grid !== null)
      .sort((a, b) => {
        const pref = (x: typeof a) => (P.led.panelItemId === x.s.itemId ? 0 : 1);
        const stockOk = (x: typeof a) => ((x.s.qtyConfirmed ?? 0) >= x.grid!.count ? 0 : 1);
        const outdoor = (x: typeof a) => (/outdoor/i.test(x.s.product) ? 1 : 0);
        return pref(a) - pref(b) || stockOk(a) - stockOk(b) || outdoor(a) - outdoor(b) || (a.pitch.value ?? 99) - (b.pitch.value ?? 99) || a.s.product.localeCompare(b.s.product);
      });
    if (!panels.length) {
      checks.push({ id: 'led.layout', title: 'LED cabinet layout', discipline: 'led', severity: 'hard', result: 'UNKNOWN', message: 'No LED panel in inventory has recorded cabinet dimensions.', dataStatus: 'UNKNOWN', inputs: [] });
      unresolved.push({ id: 'led.panels', description: `LED wall ${fmtM(LW)} × ${fmtM(LH)}`, reason: 'No cabinet dimensions recorded', candidates: stock.filter((s) => s.category === 'LED_PANEL').map((s) => s.product) });
    } else if (!fitting.length) {
      checks.push({ id: 'led.layout', title: 'LED cabinet layout', discipline: 'led', severity: 'hard', result: 'FAIL', message: `${fmtM(LW)} × ${fmtM(LH)} is not an exact multiple of any recorded cabinet size.`, dataStatus: ledDimStatus, inputs: panels.map((p) => ({ label: p.s.product, status: weakest(p.cw.status, p.ch.status) })) });
      for (const p of panels) for (const s of nearestWallSizes(LW, LH, p.cw.value!, p.ch.value!)) alternatives.push(`LED ${fmtM(s.widthMm)} × ${fmtM(s.heightMm)} = ${s.cabinets} × ${p.s.product}`);
    } else {
      const chosen = fitting[0]!;
      const grid = chosen.grid!;
      const panel = chosen.s;
      const cw = chosen.cw.value!;
      const chh = chosen.ch.value!;
      const cabStatus = weakest(chosen.cw.status, chosen.ch.status);
      const depth = spec(panel.specs, 'cabinet_depth_mm');
      const cabDepth = depth.value ?? 100;
      if (depth.value === null) assumptions.push({ id: 'led.depth', text: `${panel.product}: cabinet depth unknown; drawn as 100 mm`, status: 'UNKNOWN', source: DEFAULT });
      const r = alloc.require(panel.itemId, grid.count, `LED wall ${fmtM(LW)} × ${fmtM(LH)}`, cabStatus);
      checks.push({
        id: 'led.layout',
        title: 'LED cabinet layout',
        discipline: 'led',
        severity: 'hard',
        result: 'PASS',
        message: `${grid.cols} × ${grid.rows} = ${grid.count} cabinets of ${panel.product} (${cw} × ${chh} mm)`,
        dataStatus: weakest(cabStatus, ledDimStatus),
        inputs: [
          { label: 'Cabinet size', status: cabStatus, note: chosen.cw.source.kind },
          { label: 'Wall size', status: ledDimStatus },
        ],
      });
      checks.push({
        id: 'led.stock',
        title: 'LED cabinet quantity',
        discipline: 'inventory',
        severity: 'hard',
        result: r.shortfall ? 'FAIL' : 'PASS',
        message: r.shortfall ? `Needs ${grid.count}, ${r.allocated} allocatable${qtyNote(panel)}` : `${grid.count} allocated${qtyNote(panel)}`,
        dataStatus: panel.qtyConfirmed === null ? 'UNKNOWN' : 'VERIFIED',
        inputs: [{ label: 'Confirmed owned quantity', status: panel.qtyConfirmed === null ? 'UNKNOWN' : 'VERIFIED' }],
      });
      if (r.shortfall && (panel.qtyConfirmed ?? 0) >= grid.rows) {
        const cols = Math.floor((panel.qtyConfirmed ?? 0) / grid.rows);
        alternatives.push(`LED ${fmtM(cols * cw)} × ${fmtM(LH)} (${cols * grid.rows} cabinets) is achievable with confirmed ${panel.product} stock`);
      }

      // Cabinets in the scene.
      const ledLy = upc + P.led.setbackFromStageRearMm + cabDepth / 2;
      const z0 = stageH! + P.led.bottomAboveStageMm;
      let owned = r.allocated;
      const idOf = (c: number, rr: number) => `led-c${c}-r${rr}`;
      for (let c = 0; c < grid.cols; c++) {
        for (let rr = 0; rr < grid.rows; rr++) {
          const lx = -LW / 2 + cw * (c + 0.5);
          objects.push({
            id: idOf(c, rr),
            kind: 'led_cabinet',
            label: panel.product,
            position: { ...W(lx, ledLy), z: z0 + chh * rr },
            rotationDeg,
            size: { x: cw, y: cabDepth, z: chh },
            itemId: panel.itemId,
            supply: owned-- > 0 ? 'OWNED' : 'SHORTFALL',
            status: cabStatus,
            meta: { col: c, row: rr },
          });
        }
      }
      objects.push({ id: 'led-wall', kind: 'led_wall', label: `LED ${fmtM(LW)} × ${fmtM(LH)}`, position: { ...W(0, ledLy), z: z0 }, rotationDeg, size: { x: LW, y: cabDepth, z: LH }, polygon: rect(0, ledLy, LW, cabDepth), status: cabStatus });

      // Resolution (spec, else estimated from nominal pitch).
      let pxW = spec(panel.specs, 'pixels_w');
      let pxH = spec(panel.specs, 'pixels_h');
      if ((pxW.value === null || pxH.value === null) && chosen.pitch.value) {
        const est = (mm: number): Sourced<number> => ({ value: Math.round(mm / chosen.pitch.value!), status: weakest('ESTIMATED', chosen.pitch.status), source: { kind: 'derived', note: 'cabinet size ÷ nominal pixel pitch — verify against datasheet' } });
        if (pxW.value === null) pxW = est(cw);
        if (pxH.value === null) pxH = est(chh);
        assumptions.push({ id: 'led.pixels', text: `${panel.product}: pixels per cabinet estimated from nominal pitch (${pxW.value} × ${pxH.value})`, status: 'ESTIMATED', source: pxW.source });
      }
      const resolution = wallResolution(grid, pxW, pxH);

      // Processor.
      const procs = stock.filter((s) => s.category === 'LED_PROCESSOR' && (!P.led.processorItemId || s.itemId === P.led.processorItemId));
      const evals = procs.map((s) => ({
        s,
        res: checkProcessor(grid, pxW, pxH, {
          totalPixelCapacity: spec(s.specs, 'total_pixel_capacity'),
          outputPorts: spec(s.specs, 'output_ports'),
          pixelsPerPort: spec(s.specs, 'pixels_per_port'),
          maxWidthPx: spec(s.specs, 'max_width_px'),
          maxHeightPx: spec(s.specs, 'max_height_px'),
        }),
        cap: spec(s.specs, 'total_pixel_capacity').value ?? Infinity,
      }));
      const passing = evals.filter((e) => e.res.result === 'PASS' && (e.s.qtyConfirmed ?? 0) >= 1).sort((a, b) => a.cap - b.cap);
      const proc = passing[0] ?? null;
      let dataPorts: string[][] | null = null;
      if (proc) {
        alloc.require(proc.s.itemId, 1, 'LED processing', proc.res.status);
        if (proc.res.cabinetsPerPort) dataPorts = dataChains(grid, proc.res.cabinetsPerPort, idOf);
        checks.push({ id: 'led.processor', title: 'LED processor capacity', discipline: 'led', severity: 'hard', result: 'PASS', message: `${proc.s.product}: ${proc.res.portsNeeded} of ${spec(proc.s.specs, 'output_ports').value} ports, ${proc.res.cabinetsPerPort} cabinets per port`, dataStatus: proc.res.status, inputs: [{ label: 'Processor specs', status: proc.res.status }] });
      } else {
        const anyUnknown = evals.some((e) => e.res.result === 'UNKNOWN');
        const unconfirmedPass = evals.filter((e) => e.res.result === 'PASS' && (e.s.qtyConfirmed ?? 0) < 1);
        checks.push({
          id: 'led.processor',
          title: 'LED processor capacity',
          discipline: 'led',
          severity: 'hard',
          result: !evals.length ? 'UNKNOWN' : unconfirmedPass.length ? 'FAIL' : anyUnknown ? 'UNKNOWN' : 'FAIL',
          message: !evals.length
            ? 'No LED processor in inventory'
            : evals.map((e) => `${e.s.product}: ${e.res.result}${e.res.reasons.length ? ` — ${e.res.reasons.join('; ')}` : ''}${e.res.result === 'PASS' ? qtyNote(e.s) : ''}`).join(' | '),
          dataStatus: 'UNKNOWN',
          inputs: evals.map((e) => ({ label: e.s.product, status: e.res.status })),
        });
        unresolved.push({ id: 'led.processor', description: `LED processor for ${grid.count} × ${panel.product}`, reason: anyUnknown ? 'Processor capacity specs not recorded' : 'No owned processor passes capacity checks', candidates: evals.map((e) => e.s.product) });
      }

      // Panel ↔ processor compatibility (receiving-card / protocol).
      const compat = proc && panel.modelId && proc.s.modelId ? findEdge(G, panel.modelId, 'CONTROLLED_BY', proc.s.modelId) ?? findEdge(G, panel.modelId, 'COMPATIBLE_WITH', proc.s.modelId) ?? findEdge(G, proc.s.modelId, 'COMPATIBLE_WITH', panel.modelId) : undefined;
      checks.push({
        id: 'led.compat',
        title: 'LED panel / processor compatibility',
        discipline: 'led',
        severity: 'hard',
        result: compat ? 'PASS' : 'UNKNOWN',
        message: compat ? `Recorded ${compat.type} relationship (${compat.status})` : proc ? `No recorded compatibility between ${panel.product} and ${proc.s.product} (receiving card / protocol).` : 'No processor selected',
        dataStatus: compat?.status ?? 'UNKNOWN',
        inputs: [],
      });

      // Power.
      const pw = ledPower(grid.count, spec(panel.specs, 'max_power_w'), pSourced(P, 'power.voltageV', P.power.voltageV, 'V'), pSourced(P, 'power.circuitA', P.power.circuitA, 'A'), pSourced(P, 'power.planningFactor', P.power.planningFactor));
      checks.push({
        id: 'led.power',
        title: 'LED power estimate',
        discipline: 'led',
        severity: 'hard',
        result: pw.totalW.value === null ? 'UNKNOWN' : 'PASS',
        message:
          pw.totalW.value === null
            ? `Maximum power per cabinet not recorded for ${panel.product}`
            : `Max ${(pw.totalW.value / 1000).toFixed(1)} kW ≈ ${pw.totalA.value!.toFixed(0)} A @ ${P.power.voltageV} V single-phase equivalent; ${pw.circuits.value ?? '?'} × ${P.power.circuitA} A circuits at ${(P.power.planningFactor * 100).toFixed(0)} % planning load (${pw.cabinetsPerCircuit} cabinets/circuit). Preliminary — not an electrical design.`,
        dataStatus: pw.circuits.status,
        inputs: [
          { label: 'Cabinet max power', status: spec(panel.specs, 'max_power_w').status },
          { label: 'Supply assumptions', status: weakest(pStat(P, 'power.voltageV'), pStat(P, 'power.circuitA'), pStat(P, 'power.planningFactor')) },
        ],
      });

      // Mounting / ground support.
      const mounts = panel.modelId ? edgesFrom(G, panel.modelId, 'MOUNTS_TO') : [];
      if (!mounts.length) {
        checks.push({ id: 'led.mounting', title: 'LED mounting / ground support', discipline: 'led', severity: 'hard', result: 'UNKNOWN', message: `No MOUNTS_TO relationship recorded for ${panel.product}. Ground-stack or flying hardware cannot be selected.`, dataStatus: 'UNKNOWN', inputs: [] });
        unresolved.push({ id: 'led.mounting', description: `Mounting system for ${grid.count} × ${panel.product}`, reason: 'No verified mounting relationship', candidates: stock.filter((s) => s.category === 'LED_MOUNTING').map((s) => s.product) });
      } else {
        const msgs: string[] = [];
        let fail = false;
        for (const e of mounts) {
          const target = stock.find((s) => s.modelId && s.modelId === e.to.modelId);
          if (!target) {
            msgs.push('Mounting target not in inventory');
            fail = true;
            continue;
          }
          const units = e.constraints['per'] === 'column' ? grid.cols : grid.count;
          const n = requiredQuantity(e.quantity, units);
          const rr = alloc.require(target.itemId, n, 'LED mounting', e.status);
          msgs.push(`${n} × ${target.product}${rr.shortfall ? ` (short ${rr.shortfall})` : ''}`);
          if (rr.shortfall) fail = true;
        }
        checks.push({ id: 'led.mounting', title: 'LED mounting / ground support', discipline: 'led', severity: 'hard', result: fail ? 'FAIL' : 'PASS', message: msgs.join('; '), dataStatus: weakest(...mounts.map((m) => m.status)), inputs: [] });
      }

      // Ceiling clearance.
      const top = z0 + LH;
      const ceil: Sourced<number> = V.ceilingHeight.status === 'UNKNOWN' ? { ...V.ceilingHeight, value: null } : V.ceilingHeight;
      checks.push({
        id: 'led.ceiling',
        title: 'LED height vs ceiling',
        discipline: 'venue',
        severity: 'hard',
        result: ceil.value === null ? 'UNKNOWN' : top > ceil.value ? 'FAIL' : top > ceil.value - 500 ? 'WARN' : 'PASS',
        message: ceil.value === null ? `LED top at ${fmtM(top)} AFF; ceiling height unknown` : `LED top at ${fmtM(top)} AFF; ceiling ${fmtM(ceil.value)} (${ceil.status})`,
        dataStatus: weakest(ceil.status, stageHStatus, ledDimStatus),
        inputs: [{ label: 'Ceiling height', status: ceil.status, note: ceil.source.ref ?? ceil.source.kind }],
      });

      ledPlan = { panelItemId: panel.itemId, product: panel.product, cols: grid.cols, rows: grid.rows, cabinetWidthMm: cw, cabinetHeightMm: chh, resolution, dataPorts, processorItemId: proc?.s.itemId ?? null, powerTotalW: pw.totalW, circuits: pw.circuits };
    }
  }

  // ---- FOH -------------------------------------------------------------------------------------
  const avail = rayToBoundary(W(0, stageFrontLy), inward, roomPoly);
  let fohPoly: Pt[] | null = null;
  let fohLy = 0;
  if (avail === null) {
    checks.push({ id: 'foh.fit', title: 'FOH position', discipline: 'foh', severity: 'hard', result: 'FAIL', message: 'Could not find room depth in front of the stage', dataStatus: roomStatus, inputs: [] });
  } else {
    const fd = P.foh.depthMm;
    const back = avail - P.foh.rearClearanceMm - fd / 2;
    const dist = P.foh.position === 'back' ? back : P.foh.position === 'middle' ? avail * 0.5 : Math.min(back, Math.max(avail * 0.6, 8000));
    fohLy = stageFrontLy + dist;
    fohPoly = rect(0, fohLy, P.foh.widthMm, fd);
    const inside = polygonInside(fohPoly, roomPoly);
    const hits = V.obstacles.filter((o) => polygonsOverlap(fohPoly!, o.polygon));
    objects.push({ id: 'foh', kind: 'foh', label: 'FOH control position', position: { ...W(0, fohLy), z: 0 }, rotationDeg, size: { x: P.foh.widthMm, y: fd, z: 1000 }, polygon: fohPoly, supply: 'NOT_INVENTORY', status: roomStatus });
    checks.push({
      id: 'foh.fit',
      title: 'FOH position',
      discipline: 'foh',
      severity: 'hard',
      result: inside && !hits.length && dist > fd / 2 ? 'PASS' : 'FAIL',
      message: `FOH ${fmtM(P.foh.widthMm)} × ${fmtM(fd)} on the stage axis, ${fmtM(dist - fd / 2)} from the stage front (${P.foh.position})${hits.length ? `; overlaps ${hits.map((h) => h.label).join(', ')}` : ''}${!inside ? '; outside room' : ''}`,
      dataStatus: weakest(roomStatus, pStat(P, 'foh.widthMm')),
      inputs: [{ label: 'Room depth on axis', status: roomStatus }],
    });
  }

  // ---- Seating ----------------------------------------------------------------------------------
  const tables: Pt[] = [];
  if (P.seating.style === 'rounds' && P.guests) {
    const S = P.seating;
    const need = Math.ceil(P.guests / S.seatsPerTable);
    const footR = S.pitchMm / 2 - 150; // table + chairs footprint radius
    const fohKeepOut = fohPoly ? rect(0, fohLy, P.foh.widthMm + 2000, P.foh.depthMm + 2000) : null;
    const loc = roomPoly.map(toLocal);
    const minLx = Math.min(...loc.map((p) => p.lx));
    const maxLx = Math.max(...loc.map((p) => p.lx));
    const maxLy = Math.max(...loc.map((p) => p.ly));
    const cand: { lx: number; ly: number }[] = [];
    for (let ly = stageFrontLy + S.frontClearanceMm + S.pitchMm / 2; ly < maxLy; ly += S.pitchMm) {
      for (let lx = S.pitchMm / 2; lx < Math.max(-minLx, maxLx); lx += S.pitchMm) {
        for (const x of [lx, -lx]) {
          if (x < minLx || x > maxLx) continue;
          const c = W(x, ly);
          if (!pointInPolygon(c, roomPoly) || distToBoundary(c, roomPoly) < footR + S.wallClearanceMm) continue;
          const sq = rect(x, ly, footR * 2, footR * 2);
          if (V.obstacles.some((o) => polygonsOverlap(sq, o.polygon))) continue;
          if (fohKeepOut && polygonsOverlap(sq, fohKeepOut)) continue;
          cand.push({ lx: x, ly });
        }
      }
    }
    cand.sort((a, b) => a.ly - b.ly || Math.abs(a.lx) - Math.abs(b.lx) || a.lx - b.lx);
    cand.slice(0, need).forEach((c, i) => {
      const p = W(c.lx, c.ly);
      tables.push(p);
      objects.push({ id: `table-${i + 1}`, kind: 'table', label: `Table ${i + 1}`, position: { ...p, z: 0 }, rotationDeg, size: { x: S.tableDiameterMm, y: S.tableDiameterMm, z: 750 }, supply: 'NOT_INVENTORY', status: weakest(roomStatus, pStat(P, 'seating.pitchMm')), meta: { lx: c.lx, ly: c.ly, seats: S.seatsPerTable } });
    });
    const placed = Math.min(need, cand.length);
    checks.push({
      id: 'seating.capacity',
      title: 'Guest seating capacity',
      discipline: 'seating',
      severity: 'hard',
      result: placed >= need ? 'PASS' : 'FAIL',
      message: `${placed} of ${need} round tables (${S.seatsPerTable} seats, Ø${fmtM(S.tableDiameterMm, 1)}, ${fmtM(S.pitchMm, 1)} pitch) fit${placed < need ? ` — ${(need - placed) * S.seatsPerTable} guests unseated` : ''}`,
      dataStatus: weakest(roomStatus, pStat(P, 'seating.pitchMm'), P.sources['guests']?.status ?? 'ESTIMATED'),
      inputs: [{ label: 'Guest count', status: P.sources['guests']?.status ?? 'UNKNOWN' }],
    });

    // Viewing distance guideline (advisory rule of thumb: min distance in m ≈ pitch in mm).
    if (ledPlan && cand.length) {
      const pitch = spec(stock.find((s) => s.itemId === ledPlan!.panelItemId)?.specs, 'pixel_pitch_mm');
      const nearest = Math.min(...cand.slice(0, need).map((c) => c.ly - footR)) - (upc + P.led.setbackFromStageRearMm);
      if (pitch.value) {
        const ok = nearest / 1000 >= pitch.value;
        checks.push({ id: 'led.viewing', title: 'Closest viewing distance (guideline)', discipline: 'led', severity: 'advisory', result: ok ? 'PASS' : 'WARN', message: `Nearest guest ≈ ${fmtM(nearest, 1)} from LED; guideline minimum ≈ ${pitch.value.toFixed(1)} m for ${pitch.value} mm pitch (rule of thumb, not a specification)`, dataStatus: weakest('ESTIMATED', pitch.status), inputs: [] });
      }
    }
  }


  // ---- Lighting (floor-mounted on the stage deck; front light & truss not designed) ---------------
  let lightingPlan: LightingPlan | null = null;
  if (P.lighting.enabled) {
    const L = P.lighting;
    const defs = defaultCounts(SW, L.look);
    const wantMovers = L.movingHeads ?? defs.movingHeads;
    const wantWashes = L.stageWashes ?? defs.washes;
    if (L.movingHeads === null || L.stageWashes === null) {
      assumptions.push({ id: 'lighting.counts', text: `Lighting counts from design defaults for a ${fmtM(SW)} stage (${L.look}): ${wantMovers} upstage moving lights, ${wantWashes} downstage washes`, status: 'ESTIMATED', source: DEFAULT });
    }
    const ledObj = objects.find((o) => o.kind === 'led_wall');
    const upLy = Math.min((ledObj ? upc + P.led.setbackFromStageRearMm + ledObj.size.y : upc) + 600, upc + SD / 2);
    const downLy = stageFrontLy - 400;
    const span = Math.max(SW - 1000, 1000);
    const groups = [
      { key: 'upstage', label: 'Upstage moving lights', want: wantMovers, roles: UPSTAGE_ROLES[L.look], ly: upLy },
      { key: 'downstage', label: 'Downstage washes', want: wantWashes, roles: DOWNSTAGE_ROLES, ly: downLy },
    ];
    const used = new Set<string>();
    const fixtures: { fixtureId: string; itemId: string; product: string; footprint: number | null; power: ReturnType<typeof spec> }[] = [];
    const msgs: string[] = [];
    const lightStatus: Confidence[] = [];
    let missingGroup = false;
    let reduced = false;
    for (const g of groups) {
      if (g.want <= 0) continue;
      const pick = pickFixture(stock, g.roles, used);
      if (!pick) {
        missingGroup = true;
        msgs.push(`${g.label}: no fixture with a matching role (${g.roles.join(' / ')}) in inventory`);
        unresolved.push({ id: `lighting.${g.key}`, description: `${g.want} × ${g.label.toLowerCase()}`, reason: 'No inventory fixture identified for this role (record fixture_role on the equipment page)', candidates: stock.filter((s) => s.category === 'LIGHTING_FIXTURE').map((s) => s.product).slice(0, 12) });
        continue;
      }
      used.add(pick.item.itemId);
      const n = Math.min(g.want, alloc.remaining(pick.item.itemId));
      if (n < g.want) {
        reduced = true;
        if (n === 0) unresolved.push({ id: `lighting.${g.key}`, description: `${g.want} × ${pick.item.product}`, reason: `No confirmed owned stock${qtyNote(pick.item)}`, candidates: [pick.item.product] });
      }
      if (n > 0) alloc.require(pick.item.itemId, n, `Lighting — ${g.label.toLowerCase()}`, 'ESTIMATED');
      lightStatus.push(pick.roleStatus);
      msgs.push(`${g.label}: ${n}${n < g.want ? ` of ${g.want} requested` : ''} × ${pick.item.product} (${pick.role}${pick.roleStatus !== 'VERIFIED' ? `, role ${pick.roleStatus}` : ''})${n < g.want ? qtyNote(pick.item) : ''}`);
      for (let i = 0; i < n; i++) {
        const lx = -span / 2 + (span * (i + 0.5)) / n;
        const id = `light-${g.key}-${i + 1}`;
        objects.push({ id, kind: 'light_fixture', label: pick.item.product, position: { ...W(lx, g.ly), z: stageH! }, rotationDeg, size: { x: 400, y: 400, z: 600 }, itemId: pick.item.itemId, supply: 'OWNED', status: 'UNKNOWN', meta: { role: pick.role, group: g.key, lx, ly: g.ly } });
        fixtures.push({ fixtureId: id, itemId: pick.item.itemId, product: pick.item.product, footprint: spec(pick.item.specs, 'dmx_footprint_ch').value, power: spec(pick.item.specs, 'max_power_w') });
      }
    }
    if (fixtures.length) assumptions.push({ id: 'lighting.geometry', text: 'Fixture bodies drawn as 0.4 × 0.4 × 0.6 m placeholders (physical dimensions not recorded)', status: 'UNKNOWN', source: DEFAULT });
    checks.push({
      id: 'lighting.fixtures',
      title: 'Lighting fixtures from inventory',
      discipline: 'lighting',
      severity: 'hard',
      result: missingGroup && !fixtures.length ? 'UNKNOWN' : missingGroup || reduced ? 'WARN' : 'PASS',
      message: msgs.join(' · ') || 'No fixtures requested',
      dataStatus: lightStatus.length ? weakest('ESTIMATED', ...lightStatus) : 'UNKNOWN',
      inputs: [{ label: 'Counts', status: L.movingHeads === null ? 'ESTIMATED' : pStat(P, 'lighting.movingHeads') }],
    });
    if (reduced) alternatives.push('Lighting counts were reduced to confirmed owned stock; confirm more fixtures or accept an external hire recommendation for the difference.');

    // DMX patch & console.
    let patch: ReturnType<typeof packDmx> = null;
    let patchError: string | null = null;
    try {
      patch = packDmx(fixtures);
    } catch (e) {
      patchError = (e as Error).message;
    }
    const universes = patch ? universesUsed(patch) : null;
    const missingFp = [...new Set(fixtures.filter((f) => f.footprint === null).map((f) => f.product))];
    checks.push({
      id: 'lighting.dmx',
      title: 'DMX patch',
      discipline: 'lighting',
      severity: 'hard',
      result: !fixtures.length ? 'UNKNOWN' : patchError ? 'FAIL' : patch ? 'PASS' : 'UNKNOWN',
      message: patchError ?? (patch ? `${fixtures.length} fixtures, ${patch.reduce((a, p) => a + p.footprint, 0)} channels in ${universes} universe(s); fixtures never straddle a universe` : `DMX footprint (mode) not recorded for: ${missingFp.join(', ') || '—'}`),
      dataStatus: patch ? weakest(...fixtures.map((f) => (f.footprint !== null ? spec(stock.find((s) => s.itemId === f.itemId)!.specs, 'dmx_footprint_ch').status : 'UNKNOWN'))) : 'UNKNOWN',
      inputs: [],
    });
    const consoles = stock.filter((s) => s.category === 'LIGHTING_CONSOLE' && (!L.consoleItemId || s.itemId === L.consoleItemId));
    let consoleId: string | null = null;
    if (!fixtures.length) {
      /* nothing to control */
    } else if (!consoles.length) {
      checks.push({ id: 'lighting.console', title: 'Lighting console capacity', discipline: 'lighting', severity: 'hard', result: 'UNKNOWN', message: 'No lighting console identified in inventory', dataStatus: 'UNKNOWN', inputs: [] });
      unresolved.push({ id: 'lighting.console', description: 'Lighting console', reason: 'No LIGHTING_CONSOLE in inventory', candidates: [] });
    } else {
      const evals = consoles.map((c) => ({ c, u: spec(c.specs, 'dmx_universes') })).sort((a, b) => (a.u.value ?? Infinity) - (b.u.value ?? Infinity));
      const ok = universes !== null ? evals.find((e) => e.u.value !== null && e.u.value >= universes && alloc.remaining(e.c.itemId) >= 1) : undefined;
      if (ok) {
        consoleId = ok.c.itemId;
        alloc.require(ok.c.itemId, 1, 'Lighting control', ok.u.status);
      }
      const unknownCap = evals.filter((e) => e.u.value === null).map((e) => e.c.product);
      checks.push({
        id: 'lighting.console',
        title: 'Lighting console capacity',
        discipline: 'lighting',
        severity: 'hard',
        result: ok ? 'PASS' : universes === null || unknownCap.length ? 'UNKNOWN' : 'FAIL',
        message: ok
          ? `${ok.c.product}: ${universes} of ${ok.u.value} universes`
          : universes === null
            ? 'Universe count unknown until DMX footprints are recorded'
            : unknownCap.length
              ? `Output universes not recorded for: ${unknownCap.join(', ')}`
              : `No owned console with ≥ ${universes} universes (${evals.map((e) => `${e.c.product}: ${e.u.value}${qtyNote(e.c)}`).join('; ')})`,
        dataStatus: ok ? ok.u.status : 'UNKNOWN',
        inputs: [],
      });
      if (!ok) unresolved.push({ id: 'lighting.console', description: `Lighting console for ${universes ?? '?'} universe(s)`, reason: 'No owned console verified for the required universes', candidates: consoles.map((c) => c.product) });
    }
    if (universes) unresolved.push({ id: 'lighting.dmx-distribution', description: `DMX distribution: ${universes} universe(s) from FOH to stage`, reason: 'Cable runs, splitters/nodes and terminators are not scheduled by this version', candidates: stock.filter((s) => s.category === 'DMX_DISTRIBUTION').map((s) => s.product).slice(0, 8) });

    // Power (preliminary).
    const pwUnknown = fixtures.filter((f) => f.power.value === null);
    const totalW = pwUnknown.length || !fixtures.length
      ? { value: null, status: 'UNKNOWN' as Confidence, source: { kind: 'derived' as const, note: 'Fixture max power not recorded' }, unit: 'W' }
      : { value: fixtures.reduce((a, f) => a + f.power.value!, 0), status: weakest(...fixtures.map((f) => f.power.status)), source: { kind: 'derived' as const, note: 'Σ fixture max power' }, unit: 'W' };
    if (fixtures.length) {
      checks.push({
        id: 'lighting.power',
        title: 'Lighting power estimate',
        discipline: 'lighting',
        severity: 'hard',
        result: totalW.value === null ? 'UNKNOWN' : 'PASS',
        message: totalW.value === null ? `Max power not recorded for: ${[...new Set(pwUnknown.map((f) => f.product))].join(', ')}` : `Max ${(totalW.value / 1000).toFixed(1)} kW ≈ ${(totalW.value / P.power.voltageV).toFixed(0)} A @ ${P.power.voltageV} V. Preliminary — not an electrical design.`,
        dataStatus: totalW.status,
        inputs: [],
      });
      checks.push({ id: 'lighting.positions', title: 'Lighting positions & mounting', discipline: 'lighting', severity: 'advisory', result: 'WARN', message: 'Fixtures are floor-mounted on the stage deck and must be secured. Front light, overhead positions, truss and focus are not designed by this version.', dataStatus: 'ESTIMATED', inputs: [] });
      unresolved.push({ id: 'lighting.front-light', description: 'Front light for presenters', reason: 'Requires truss or stands — not designed by this version', candidates: [] });
    }
    lightingPlan = { look: L.look, patch, universes, consoleItemId: consoleId, totalPowerW: totalW };
  }

  // ---- Safety & scope -------------------------------------------------------------------------
  const human = [
    ['safety.structural', 'Structural / rigging approval', 'Any suspension, ground-support stability, LED stacking and venue structural capacity must be approved by a competent rigging/structural professional.'],
    ['safety.electrical', 'Electrical approval', 'Power figures are preliminary estimates. Distribution design and compliance must be approved by a qualified electrician.'],
    ['safety.crowd', 'Crowd safety, egress and fire', 'Emergency exits, egress widths, aisles and fire requirements have not been assessed. Venue and safety officer approval required.'],
  ] as const;
  for (const [id, title, message] of human) checks.push({ id, title, discipline: 'safety', severity: 'hard', result: 'HUMAN_REQUIRED', message, dataStatus: 'UNKNOWN', inputs: [] });
  for (const [id, title] of [
    ...(P.lighting.enabled ? [] : ([['scope.lighting', 'Lighting design']] as const)),
    ['scope.audio', 'Audio design'],
    ['scope.video', 'Video / camera signal path'],
    ['scope.truss', 'Truss & rigging layout'],
  ] as const) {
    const message = id === 'scope.lighting' ? 'Lighting is switched off for this design (say “add lighting” to include it).' : 'Not designed by this version of the engine (planned: Phase 3). Equipment for this discipline is not in the schedule.';
    checks.push({ id, title, discipline: 'scope', severity: 'advisory', result: 'UNKNOWN', message, dataStatus: 'UNKNOWN', inputs: [] });
  }

  // ---- Viewpoints -------------------------------------------------------------------------------
  const ledMid = { ...W(0, upc + P.led.setbackFromStageRearMm), z: (stageH ?? 1000) + P.led.bottomAboveStageMm + P.led.heightMm / 2 };
  const b = bounds(roomPoly);
  const viewpoints: DesignResult['scene']['viewpoints'] = [
    { id: 'overview', label: 'Overview', eye: { x: b.maxX + (b.maxX - b.minX) * 0.3, y: b.minY - (b.maxY - b.minY) * 0.4, z: Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.7 }, target: { ...W(0, stageFrontLy + 6000), z: 0 } },
  ];
  if (fohPoly) viewpoints.push({ id: 'foh', label: 'From FOH', eye: { ...W(0, fohLy), z: 1700 }, target: ledMid });
  if (tables.length) {
    const front = objects.filter((o) => o.kind === 'table').slice(0, 2);
    const t = front[0]!;
    viewpoints.push({ id: 'front-tables', label: 'From the front (VIP) tables', eye: { x: t.position.x, y: t.position.y, z: 1200 }, target: ledMid });
  }
  if (avail !== null) viewpoints.push({ id: 'rear', label: 'From the back of the room', eye: { ...W(0, stageFrontLy + avail - 1000), z: 1600 }, target: ledMid });

  // ---- BOM / rental summary -------------------------------------------------------------------
  const byPeriod = new Map<string, { chargePeriod: string; currency: string | null; total: number; lines: number }>();
  let excluded = 0;
  for (const l of alloc.lines) {
    if (l.allocated <= 0) continue;
    if (!l.rentalRate) {
      excluded++;
      continue;
    }
    const k = `${l.chargePeriod ?? '(unspecified)'}|${l.currency ?? ''}`;
    const e = byPeriod.get(k) ?? { chargePeriod: l.chargePeriod ?? '(unspecified)', currency: l.currency, total: 0, lines: 0 };
    e.total += l.allocated * l.rentalRate;
    e.lines++;
    byPeriod.set(k, e);
  }
  const nonInventory = tables.length ? [{ description: `Round tables Ø${fmtM(P.seating.tableDiameterMm, 1)} with ${P.seating.seatsPerTable} chairs`, qty: tables.length, note: 'Not Sound Ninja inventory — venue or third-party furniture' }] : [];
  if (fohPoly) nonInventory.push({ description: `FOH riser/area ${fmtM(P.foh.widthMm)} × ${fmtM(P.foh.depthMm)}`, qty: 1, note: 'Space allocation only; FOH equipment not yet designed' });

  // ---- Overall status ---------------------------------------------------------------------------
  const hard = checks.filter((c) => c.severity === 'hard' && c.result !== 'HUMAN_REQUIRED');
  let overall: OverallStatus;
  if (hard.some((c) => c.result === 'FAIL')) overall = 'FAILS_CHECKS';
  else if (hard.some((c) => c.result === 'UNKNOWN')) overall = 'INCOMPLETE';
  else {
    overall = weakest(...hard.map((c) => c.dataStatus));
    if (P.mode === 'concept' && overall === 'VERIFIED') overall = 'PROVISIONAL';
  }

  return {
    scene: {
      schemaVersion: 1,
      units: 'mm',
      venue: { name: V.venueName, roomPolygon: roomPoly, obstacles: V.obstacles, ceilingHeight: V.ceilingHeight },
      frame: { origin, u, n: inward, rotationDeg },
      objects,
      ledPlan,
      lightingPlan,
      viewpoints,
    },
    bom: {
      lines: alloc.lines,
      unresolved,
      nonInventory,
      rentalSummary: {
        byPeriod: [...byPeriod.values()],
        excludedZeroOrBlankRate: excluded,
        caveats: [
          'Indicative only: allocated quantity × listed rental rate, per charge period.',
          'Lines with a zero or blank rate are excluded — they are not free.',
          'VAT treatment of source rates is unknown. No discounts, labour, transport or hire-in costs included.',
        ],
      },
    },
    validation: {
      checks,
      overall,
      humanApprovalsRequired: human.map(([, t]) => t),
      notCertification:
        'This automatically generated design is not structural, electrical, rigging or crowd-safety certification. Safety-critical approval remains with competent human professionals.',
    },
    assumptions,
    alternatives: [...new Set(alternatives)],
  };
}
