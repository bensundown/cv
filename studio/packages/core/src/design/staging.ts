/**
 * Stage deck tiling. Deterministic search over one deck type (both orientations),
 * or a primary deck type plus one filler strip. Requires exact fit (±0.5 mm).
 */
import { isMultiple, LENGTH_EPSILON_MM } from '../units.js';

export interface DeckOption {
  itemId: string;
  widthMm: number; // long side
  depthMm: number; // short side
  available: number; // confirmed quantity
}

export interface PlacedDeck {
  itemId: string;
  /** Local stage coordinates (mm): x from stage left edge, y from stage rear edge; deck centre. */
  cx: number;
  cy: number;
  w: number; // extent along stage width
  d: number; // extent along stage depth
}

export interface TilingResult {
  exact: boolean;
  decks: PlacedDeck[];
  counts: Record<string, number>;
  withinStock: boolean;
}

function grid(itemId: string, w: number, d: number, W: number, D: number, y0: number): PlacedDeck[] {
  const out: PlacedDeck[] = [];
  const nx = Math.round(W / w);
  const ny = Math.round(D / d);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) out.push({ itemId, cx: w * (i + 0.5), cy: y0 + d * (j + 0.5), w, d });
  return out;
}

function countBy(decks: PlacedDeck[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const d of decks) c[d.itemId] = (c[d.itemId] ?? 0) + 1;
  return c;
}

const orientations = (o: DeckOption) =>
  o.widthMm === o.depthMm ? [[o.widthMm, o.depthMm]] : [[o.widthMm, o.depthMm], [o.depthMm, o.widthMm]];

/**
 * Find a tiling for a W × D stage. Candidates are scored by: within stock, fewest deck
 * types, fewest decks. Returns null when no exact tiling exists with these deck sizes.
 */
export function tileStage(W: number, D: number, options: DeckOption[], preferredItemId: string | null = null): TilingResult | null {
  const candidates: TilingResult[] = [];
  const ok = (decks: PlacedDeck[]) => {
    const counts = countBy(decks);
    const withinStock = Object.entries(counts).every(([id, n]) => n <= (options.find((o) => o.itemId === id)?.available ?? 0));
    candidates.push({ exact: true, decks, counts, withinStock });
  };
  for (const o of options) {
    for (const [w, d] of orientations(o)) {
      if (isMultiple(W, w!) && isMultiple(D, d!)) ok(grid(o.itemId, w!, d!, W, D, 0));
    }
  }
  // Primary grid + one filler strip at the rear (rows of a second type).
  for (const p of options) {
    for (const [pw, pd] of orientations(p)) {
      if (!isMultiple(W, pw!)) continue;
      for (const f of options) {
        if (f.itemId === p.itemId) continue;
        for (const [fw, fd] of orientations(f)) {
          if (!isMultiple(W, fw!)) continue;
          for (let nf = 1; nf * fd! < D - LENGTH_EPSILON_MM; nf++) {
            const rest = D - nf * fd!;
            if (isMultiple(rest, pd!)) ok([...grid(f.itemId, fw!, fd!, W, nf * fd!, 0), ...grid(p.itemId, pw!, pd!, W, rest, nf * fd!)]);
          }
        }
      }
    }
  }
  if (!candidates.length) return null;
  const score = (c: TilingResult) => {
    const types = Object.keys(c.counts).length;
    const pref = preferredItemId && c.counts[preferredItemId] ? 0 : 1;
    return [c.withinStock ? 0 : 1, pref, types, c.decks.length];
  };
  candidates.sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sa[i]! - sb[i]!;
    return 0;
  });
  return candidates[0]!;
}

/** Nearby stage sizes that tile exactly with a single deck type (for redesign suggestions). */
export function nearbyTileableSizes(W: number, D: number, options: DeckOption[]): { widthMm: number; depthMm: number; itemId: string; decks: number }[] {
  const out: { widthMm: number; depthMm: number; itemId: string; decks: number }[] = [];
  for (const o of options) {
    for (const [w, d] of orientations(o)) {
      for (const nx of [Math.floor(W / w!), Math.ceil(W / w!)]) {
        for (const ny of [Math.floor(D / d!), Math.ceil(D / d!)]) {
          if (nx < 1 || ny < 1 || nx * ny > o.available) continue;
          out.push({ widthMm: nx * w!, depthMm: ny * d!, itemId: o.itemId, decks: nx * ny });
        }
      }
    }
  }
  const seen = new Set<string>();
  return out
    .filter((s) => (seen.has(`${s.widthMm}x${s.depthMm}`) ? false : (seen.add(`${s.widthMm}x${s.depthMm}`), true)))
    .sort((a, b) => Math.abs(a.widthMm - W) + Math.abs(a.depthMm - D) - (Math.abs(b.widthMm - W) + Math.abs(b.depthMm - D)))
    .slice(0, 4);
}
