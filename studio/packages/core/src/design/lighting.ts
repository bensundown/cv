/**
 * Lighting rules: fixture roles, default counts, fixture selection from confirmed stock,
 * and DMX patching. Pure functions; the generator handles placement and allocation.
 *
 * Scope of this version: floor-mounted fixtures on the stage deck (upstage moving lights,
 * downstage washes). Front light, overhead positions and truss are NOT designed and are
 * reported as unresolved — never assumed.
 */
import { specText } from '../equipment/specs.js';
import type { Confidence } from '../provenance.js';
import type { DmxPatchEntry, StockItem } from './types.js';

export const FIXTURE_ROLES = ['MOVING_SPOT', 'MOVING_WASH', 'BEAM', 'WASH', 'PROFILE', 'PAR', 'STROBE'] as const;
export type FixtureRole = (typeof FIXTURE_ROLES)[number];

/** Role from a recorded `fixture_role` spec, else a keyword guess (ESTIMATED), else null. */
export function fixtureRole(item: Pick<StockItem, 'product' | 'specs'>): { role: FixtureRole | null; status: Confidence; note: string } {
  const recorded = specText(item.specs, 'fixture_role');
  if (recorded.value && (FIXTURE_ROLES as readonly string[]).includes(recorded.value)) {
    return { role: recorded.value as FixtureRole, status: recorded.status, note: 'Recorded fixture_role spec' };
  }
  const p = item.product.toLowerCase();
  const moving = /moving|\bmover\b|\bhead\b|robin|rogue|mac\b|pointe|sharpy|intimidator/.test(p);
  const guess = (role: FixtureRole | null) => ({ role, status: (role ? 'ESTIMATED' : 'UNKNOWN') as Confidence, note: role ? 'Guessed from product name keywords — record fixture_role to confirm' : 'No fixture role keyword in product name' });
  if (/\bbeam\b|sharpy/.test(p)) return guess('BEAM');
  if (/strobe|atomic/.test(p)) return guess('STROBE');
  if (/profile|ellipsoidal|leko|source four|\bers\b/.test(p)) return guess('PROFILE');
  if (moving && /wash/.test(p)) return guess('MOVING_WASH');
  if (moving) return guess('MOVING_SPOT');
  if (/\bwash\b|batten|led bar|pixel bar/.test(p)) return guess('WASH');
  if (/\bpar\b|par ?\d{2}|uplight/.test(p)) return guess('PAR');
  return guess(null);
}

export const UPSTAGE_ROLES: Record<'standard' | 'dramatic', FixtureRole[]> = {
  standard: ['MOVING_SPOT', 'MOVING_WASH', 'BEAM'],
  dramatic: ['BEAM', 'MOVING_SPOT', 'MOVING_WASH'],
};
export const DOWNSTAGE_ROLES: FixtureRole[] = ['WASH', 'PAR', 'MOVING_WASH'];

/** Design defaults (ESTIMATED): ~1 upstage mover per 2 m of stage width (×1.5 for dramatic); ~1 wash per 2.5 m. */
export function defaultCounts(stageWidthMm: number, look: 'standard' | 'dramatic'): { movingHeads: number; washes: number } {
  const base = Math.max(2, Math.round(stageWidthMm / 2000));
  return { movingHeads: look === 'dramatic' ? Math.round(base * 1.5) : base, washes: Math.max(2, Math.round(stageWidthMm / 2500)) };
}

/**
 * Choose one stock item for a group of fixtures. Roles are tried in preference order;
 * within a role the item with the most confirmed owned quantity wins (ties: product name).
 * Items with no confirmed quantity are only returned when nothing confirmed exists (so the
 * shortfall is reported against a real candidate).
 */
export function pickFixture(stock: StockItem[], roles: FixtureRole[], exclude: Set<string> = new Set()): { item: StockItem; role: FixtureRole; roleStatus: Confidence } | null {
  const lights = stock.filter((s) => s.category === 'LIGHTING_FIXTURE' && !exclude.has(s.itemId)).map((s) => ({ s, r: fixtureRole(s) }));
  for (const confirmedOnly of [true, false]) {
    for (const role of roles) {
      const c = lights
        .filter((x) => x.r.role === role && (!confirmedOnly || (x.s.qtyConfirmed ?? 0) > 0))
        .sort((a, b) => (b.s.qtyConfirmed ?? 0) - (a.s.qtyConfirmed ?? 0) || a.s.product.localeCompare(b.s.product));
      if (c[0]) return { item: c[0].s, role, roleStatus: c[0].r.status };
    }
  }
  return null;
}

/**
 * Sequential DMX patch: fixtures in order, never straddling a universe boundary.
 * Returns null if any footprint is unknown; throws on footprints larger than a universe.
 */
export function packDmx(fixtures: { fixtureId: string; itemId: string; product: string; footprint: number | null }[], universeSize = 512): DmxPatchEntry[] | null {
  if (fixtures.some((f) => f.footprint === null || !(f.footprint! > 0))) return null;
  const out: DmxPatchEntry[] = [];
  let universe = 1;
  let next = 1;
  for (const f of fixtures) {
    const fp = f.footprint!;
    if (fp > universeSize) throw new Error(`${f.product}: footprint ${fp} exceeds one universe`);
    if (next + fp - 1 > universeSize) {
      universe++;
      next = 1;
    }
    out.push({ fixtureId: f.fixtureId, itemId: f.itemId, product: f.product, universe, address: next, footprint: fp });
    next += fp;
  }
  return out;
}

export const universesUsed = (patch: DmxPatchEntry[]) => (patch.length ? Math.max(...patch.map((p) => p.universe)) : 0);
