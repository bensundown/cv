import { describe, expect, it } from 'vitest';
import { applyOps, defaultParams, generateDesign, guessCategory, interpretCommand, OWNER_GUIDELINE_POLICY, parseNameHints, type SpecSheet, type StockItem } from '../src/index.js';
import { ballroom, deck, stockItem } from './fixtures.js';

const mm = (key: string, value: number): SpecSheet => ({ [key]: { key, value, unit: 'mm', status: 'ESTIMATED', source: { kind: 'name_parse' } } });
const acc = (id: string, product: string, qty: number, specs: SpecSheet): StockItem => stockItem({ itemId: id, product, category: 'STAGE_ACCESSORY', qtyShown: qty, qtyConfirmed: null, specs });
const legRange = stockItem({ itemId: 'leg', product: 'Leg 600-900mm', category: 'STAGE_LEG', qtyShown: 300, qtyConfirmed: null, specs: { ...mm('leg_height_min_mm', 600), ...mm('leg_height_max_mm', 900) } });
const stock = () => [
  { ...deck(null), qtyShown: 60 },
  legRange,
  acc('adj', 'ALUSTAGE ADJUSTABLE STAGE STAIRS 600MM – 1000MM', 2, { ...mm('stair_height_min_mm', 600), ...mm('stair_height_max_mm', 1000) }),
  acc('s900', 'StagePlus 900mm Steps', 2, mm('stair_height_mm', 900)),
  acc('srail', 'ALUSTAGE ALUMINIUM HANDRAIL FOR SM STAIRS', 8, {}),
  acc('r2', 'ALUSTAGE ALUMINIUM HANDRAIL 2M', 8, mm('rail_length_mm', 2000)),
  acc('r1', 'ALUSTAGE ALUMINIUM HANDRAIL 1M', 8, mm('rail_length_mm', 1000)),
];
const params = () => {
  const p = defaultParams();
  p.stage.widthMm = 12000;
  p.stage.depthMm = 6000;
  p.led.enabled = false;
  return p;
};

describe('stair & rail hints', () => {
  it('parses stair heights and rail lengths from names', () => {
    expect(guessCategory('ALUSTAGE ADJUSTABLE STAGE STAIRS 600MM – 1000MM', 'Staging').category).toBe('STAGE_ACCESSORY');
    expect(parseNameHints('ALUSTAGE ADJUSTABLE STAGE STAIRS 600MM – 1000MM', 'STAGE_ACCESSORY')).toEqual({ stairHeightMinMm: 600, stairHeightMaxMm: 1000 });
    expect(parseNameHints('StagePlus 900mm Steps', 'STAGE_ACCESSORY')).toEqual({ stairHeightMm: 900 });
    expect(parseNameHints('ALUSTAGE ALUMINIUM HANDRAIL 2M', 'STAGE_ACCESSORY')).toEqual({ railLengthMm: 2000 });
  });
});

describe('stage access in the design', () => {
  it('places front + side stairs matched to the stage height, with stair handrails and edge protection', () => {
    const r = generateDesign({ params: params(), venue: ballroom(), stock: stock(), relationships: [], stockPolicy: OWNER_GUIDELINE_POLICY });
    expect(r.scene.objects.find((o) => o.kind === 'stage')!.size.z).toBe(900);
    const stairs = r.scene.objects.filter((o) => o.meta?.type === 'stairs');
    expect(stairs.map((s) => s.meta!.slot)).toEqual(['front-left', 'side-right']);
    expect(stairs.every((s) => s.itemId === 'adj')).toBe(true); // adjustable AluStage preferred (has matching rails)
    const bom = Object.fromEntries(r.bom.lines.map((l) => [l.itemId, l.allocated]));
    expect(bom.srail).toBe(4);
    // Edge: rear 12 m = 6 × 2 m; sides 6 m (left) + 5 m (right, 1 m stair opening) → 3×2 m + 2×2 m + 1×1 m
    expect(bom.r2).toBeGreaterThan(0);
    // 23 m of edge: 2 m rails until their stock (8 + 20 %) runs out, then 1 m rails — no shortfall.
    expect(r.bom.lines.filter((l) => l.itemId === 'r1' || l.itemId === 'r2').every((l) => l.shortfall === 0)).toBe(true);
    expect(r.validation.checks.find((c) => c.id === 'stage.access')!.result).toBe('PASS');
    expect(r.validation.checks.find((c) => c.id === 'stage.edge')!.result).toBe('HUMAN_REQUIRED');
    expect(r.validation.humanApprovalsRequired).toContain('Stage edge protection');
  });
  it('low stages get no edge protection by default; commands change stairs and rails', () => {
    const p = params();
    p.stage.heightMm = 600;
    const low = generateDesign({ params: { ...p, stage: { ...p.stage, edgeProtectionAboveMm: 700 } }, venue: ballroom(), stock: stock(), relationships: [], stockPolicy: OWNER_GUIDELINE_POLICY });
    expect(low.validation.checks.some((c) => c.id === 'stage.edge')).toBe(false);
    const three = applyOps(params(), interpretCommand('3 stairs').ops).params;
    expect(three.stage.stairs).toBe(3);
    const r3 = generateDesign({ params: three, venue: ballroom(), stock: stock(), relationships: [], stockPolicy: OWNER_GUIDELINE_POLICY });
    expect(r3.scene.objects.filter((o) => o.meta?.type === 'stairs')).toHaveLength(3); // 2 adjustable + 1 StagePlus 900
    const none = applyOps(params(), interpretCommand('no stairs and no edge protection').ops).params;
    const r0 = generateDesign({ params: none, venue: ballroom(), stock: stock(), relationships: [], stockPolicy: OWNER_GUIDELINE_POLICY });
    expect(r0.scene.objects.some((o) => o.kind === 'stage_accessory')).toBe(false);
  });
  it('flags stair clashes with the PA', () => {
    const p = params();
    p.audio.enabled = true;
    const st = [...stock(), stockItem({ itemId: 'pt', product: 'FBT X Lite 115A Speaker', category: 'SPEAKER_POINT_SOURCE', qtyShown: 4, qtyConfirmed: null })];
    p.stage.stairs = 4;
    const r = generateDesign({ params: p, venue: ballroom(), stock: st, relationships: [], stockPolicy: OWNER_GUIDELINE_POLICY });
    expect(r.validation.checks.find((c) => c.id === 'stage.access')).toBeTruthy();
  });
});
