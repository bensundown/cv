import { describe, expect, it } from 'vitest';
import { applyBrief, applyOps, defaultCounts, defaultParams, effectiveParams, fixtureRole, generateDesign, interpretCommand, packDmx, parseBrief, pickFixture, type SpecSheet, type StockItem } from '../src/index.js';
import { ballroom, deck, ledPanel, leg, processor, stockItem } from './fixtures.js';

// SYNTHETIC test values only.
const sv = (key: string, value: number | string, unit: string): SpecSheet => ({ [key]: { key, value, unit, status: 'PROVISIONAL', source: { kind: 'manufacturer_doc', ref: 'SYNTHETIC' } } });
const fixture = (id: string, product: string, qty: number | null, fp: number | null = 16, w: number | null = 300): StockItem =>
  stockItem({ itemId: id, product, category: 'LIGHTING_FIXTURE', qtyConfirmed: qty, specs: { ...(fp !== null ? sv('dmx_footprint_ch', fp, 'ch') : {}), ...(w !== null ? sv('max_power_w', w, 'W') : {}) } });
const desk = (u: number | null, qty = 1) => stockItem({ itemId: 'desk', product: 'ChamSys MagicQ MQ80', category: 'LIGHTING_CONSOLE', qtyConfirmed: qty, specs: u === null ? {} : sv('dmx_universes', u, 'universes') });

describe('fixture roles', () => {
  it.each([
    ['Robe Robin 600 LEDWash', 'MOVING_WASH'],
    ['Chauvet Rogue R2 Spot', 'MOVING_SPOT'],
    ['Clay Paky Sharpy Beam', 'BEAM'],
    ['ADJ LED Par 64', 'PAR'],
    ['ETC Source Four Profile', 'PROFILE'],
    ['Martin Atomic Strobe', 'STROBE'],
    ['Generic LED Wash Batten', 'WASH'],
  ])('%s → %s (ESTIMATED)', (name, role) => {
    const r = fixtureRole({ product: name, specs: {} });
    expect(r.role).toBe(role);
    expect(r.status).toBe('ESTIMATED');
  });
  it('a recorded fixture_role spec wins over the name', () => {
    const r = fixtureRole({ product: 'Mystery Light', specs: sv('fixture_role', 'BEAM', 'role') });
    expect(r).toMatchObject({ role: 'BEAM', status: 'PROVISIONAL' });
  });
  it('prefers confirmed stock', () => {
    const p = pickFixture([fixture('a', 'Rogue R2 Spot moving head', null), fixture('b', 'Robin Spot moving head', 8)], ['MOVING_SPOT']);
    expect(p!.item.itemId).toBe('b');
  });
});

describe('DMX patch', () => {
  it('packs sequentially and never straddles a universe', () => {
    const fx = Array.from({ length: 20 }, (_, i) => ({ fixtureId: `f${i}`, itemId: 'x', product: 'X', footprint: 28 }));
    const p = packDmx(fx)!;
    expect(p[0]).toMatchObject({ universe: 1, address: 1 });
    expect(p[17]).toMatchObject({ universe: 1, address: 477 }); // 18 × 28 = 504 ≤ 512
    expect(p[18]).toMatchObject({ universe: 2, address: 1 });
    expect(p.every((e) => e.address + e.footprint - 1 <= 512)).toBe(true);
  });
  it('unknown footprint → null (never guessed)', () => {
    expect(packDmx([{ fixtureId: 'a', itemId: 'x', product: 'X', footprint: null }])).toBeNull();
  });
  it('footprint larger than a universe is an error', () => {
    expect(() => packDmx([{ fixtureId: 'a', itemId: 'x', product: 'X', footprint: 600 }])).toThrow();
  });
});

describe('lighting design', () => {
  const params = () => {
    const p = applyBrief(defaultParams(), parseBrief('Gala for 500 guests, 12 m x 6 m stage, 6 m x 3 m LED wall, intelligent lighting.'));
    return p;
  };
  const base = () => [ledPanel(150), processor(2), deck(40), leg(200)];

  it('brief enables lighting; default counts scale with stage width', () => {
    expect(params().lighting.enabled).toBe(true);
    expect(defaultCounts(12000, 'standard')).toEqual({ movingHeads: 6, washes: 5 });
    expect(defaultCounts(12000, 'dramatic').movingHeads).toBe(9);
  });

  it('places fixtures on the stage, patches DMX and checks the console', () => {
    const stock = [...base(), fixture('spot', 'Chauvet Rogue R2 Spot', 12, 16, 400), fixture('wash', 'Generic LED Wash Batten', 10, 8, 150), desk(2)];
    const r = generateDesign({ params: params(), venue: ballroom(), stock, relationships: [] });
    const lights = r.scene.objects.filter((o) => o.kind === 'light_fixture');
    expect(lights).toHaveLength(11);
    const stage = r.scene.objects.find((o) => o.kind === 'stage')!;
    for (const l of lights) expect(l.position.z).toBe(stage.size.z);
    expect(r.scene.lightingPlan!.universes).toBe(1); // 6×16 + 5×8 = 136 ch
    const c = Object.fromEntries(r.validation.checks.map((x) => [x.id, x.result]));
    expect(c).toMatchObject({ 'lighting.fixtures': 'PASS', 'lighting.dmx': 'PASS', 'lighting.console': 'PASS', 'lighting.power': 'PASS', 'lighting.positions': 'WARN' });
    expect(r.bom.lines.find((l) => l.itemId === 'desk')!.allocated).toBe(1);
    expect(r.bom.unresolved.some((u) => u.id === 'lighting.front-light')).toBe(true);
    expect(r.validation.checks.some((x) => x.id === 'scope.lighting')).toBe(false);
  });

  it('never exceeds confirmed stock: counts reduce and are reported', () => {
    const r = generateDesign({ params: params(), venue: ballroom(), stock: [...base(), fixture('spot', 'Chauvet Rogue R2 Spot', 3), fixture('wash', 'Generic LED Wash Batten', 10), desk(2)], relationships: [] });
    expect(r.scene.objects.filter((o) => o.meta?.group === 'upstage')).toHaveLength(3);
    expect(r.validation.checks.find((x) => x.id === 'lighting.fixtures')!.result).toBe('WARN');
  });

  it('unknown footprints / console capacity stay UNKNOWN', () => {
    const r = generateDesign({ params: params(), venue: ballroom(), stock: [...base(), fixture('spot', 'Chauvet Rogue R2 Spot', 12, null, null), desk(null)], relationships: [] });
    const c = Object.fromEntries(r.validation.checks.map((x) => [x.id, x.result]));
    expect(c).toMatchObject({ 'lighting.dmx': 'UNKNOWN', 'lighting.console': 'UNKNOWN', 'lighting.power': 'UNKNOWN' });
    expect(r.scene.lightingPlan!.patch).toBeNull();
  });

  it('console without enough universes fails', () => {
    const many = { ...params(), lighting: { ...params().lighting, movingHeads: 40 } };
    const r = generateDesign({ params: many, venue: ballroom(), stock: [...base(), fixture('spot', 'Chauvet Rogue R2 Spot', 40, 30), desk(1)], relationships: [] });
    expect(r.scene.lightingPlan!.universes).toBe(3);
    expect(r.validation.checks.find((x) => x.id === 'lighting.console')!.result).toBe('FAIL');
  });

  it('commands: fewer moving heads, more dramatic, remove lighting', () => {
    const stock = [...base(), fixture('spot', 'Chauvet Rogue R2 Spot', 12), fixture('beam', 'Clay Paky Sharpy Beam', 12), fixture('wash', 'Generic LED Wash Batten', 10), desk(4)];
    const r1 = generateDesign({ params: params(), venue: ballroom(), stock, relationships: [] });
    const fewer = applyOps(effectiveParams(params(), r1), interpretCommand('Use fewer moving heads.').ops);
    expect(fewer.errors).toEqual([]);
    expect(fewer.params.lighting.movingHeads).toBe(4);
    const dramatic = applyOps(params(), interpretCommand('Make the lighting more dramatic').ops).params;
    const r2 = generateDesign({ params: dramatic, venue: ballroom(), stock, relationships: [] });
    const up = r2.scene.objects.filter((o) => o.meta?.group === 'upstage');
    expect(up).toHaveLength(9);
    expect(up[0]!.meta!.role).toBe('BEAM');
    // Defaults stay unpinned across unrelated revisions: a wider stage scales the counts.
    const wider = applyOps(effectiveParams(params(), r1, ['stage.widthMm']), interpretCommand('make the stage 2 m wider').ops).params;
    expect(wider.lighting.movingHeads).toBeNull();
    expect(generateDesign({ params: wider, venue: ballroom(), stock, relationships: [] }).scene.objects.filter((o) => o.meta?.group === 'upstage')).toHaveLength(7);
    const off = applyOps(params(), interpretCommand('remove the lighting').ops).params;
    expect(generateDesign({ params: off, venue: ballroom(), stock, relationships: [] }).scene.objects.some((o) => o.kind === 'light_fixture')).toBe(false);
  });

  it('older stored params without a lighting group still generate', () => {
    const p = params() as unknown as Record<string, unknown>;
    delete p.lighting;
    const r = generateDesign({ params: p as never, venue: ballroom(), stock: base(), relationships: [] });
    expect(r.validation.checks.some((x) => x.id === 'scope.lighting')).toBe(true);
  });
});
