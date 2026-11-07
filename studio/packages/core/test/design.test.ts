import { describe, expect, it } from 'vitest';
import {
  applyBrief,
  applyOps,
  cabinetGrid,
  canonicalJson,
  checkProcessor,
  dataChains,
  defaultParams,
  generateDesign,
  interpretCommand,
  ledPower,
  nearestWallSizes,
  parseBrief,
  planDrawing,
  renderSvg,
  tileStage,
  type DesignParams,
  type EquipmentRelationship,
  type Sourced,
} from '../src/index.js';
import { ballroom, deck, ledPanel, leg, processor } from './fixtures.js';

const known = (v: number): Sourced<number> => ({ value: v, status: 'VERIFIED', source: { kind: 'manufacturer_doc' } });
const none: Sourced<number> = { value: null, status: 'UNKNOWN', source: { kind: 'derived' } };

describe('LED arithmetic', () => {
  it('6 m × 3 m with 500 × 500 mm cabinets = exactly 72 cabinets', () => {
    expect(cabinetGrid(6000, 3000, 500, 500)).toEqual({ cols: 12, rows: 6, count: 72 });
  });
  it('10 m × 3 m = 120 cabinets', () => {
    expect(cabinetGrid(10000, 3000, 500, 500)!.count).toBe(120);
  });
  it('non-multiples are rejected with nearest exact sizes', () => {
    expect(cabinetGrid(6250, 3000, 500, 500)).toBeNull();
    expect(nearestWallSizes(6250, 3000, 500, 500).map((s) => s.widthMm)).toEqual([6000, 6500]);
  });
  it('a quantity check alone is insufficient: processor is UNKNOWN without specs', () => {
    const r = checkProcessor(cabinetGrid(6000, 3000, 500, 500)!, known(192), known(192), { totalPixelCapacity: none, outputPorts: none, pixelsPerPort: none, maxWidthPx: none, maxHeightPx: none });
    expect(r.result).toBe('UNKNOWN');
  });
  it('processor capacity and ports', () => {
    const grid = cabinetGrid(10000, 3000, 500, 500)!; // 120 × 36 864 px = 4 423 680 px
    const spec = { totalPixelCapacity: known(3_900_000), outputPorts: known(6), pixelsPerPort: known(650_000), maxWidthPx: known(10240), maxHeightPx: known(8192) };
    const r = checkProcessor(grid, known(192), known(192), spec);
    expect(r.result).toBe('FAIL');
    expect(r.cabinetsPerPort).toBe(17);
    expect(r.portsNeeded).toBe(8);
    const small = checkProcessor(cabinetGrid(6000, 3000, 500, 500)!, known(192), known(192), spec);
    expect(small.result).toBe('PASS');
    expect(small.portsNeeded).toBe(5);
  });
  it('data chains cover every cabinet exactly once, serpentine', () => {
    const g = cabinetGrid(6000, 3000, 500, 500)!;
    const chains = dataChains(g, 17, (c, r) => `${c},${r}`);
    const all = chains.flat();
    expect(all).toHaveLength(72);
    expect(new Set(all).size).toBe(72);
    expect(all.slice(5, 8)).toEqual(['0,5', '1,5', '1,4']);
  });
  it('power: unknown without cabinet power, computed with it', () => {
    expect(ledPower(72, none, known(230), known(16), known(0.8)).totalW.status).toBe('UNKNOWN');
    const p = ledPower(72, known(200), known(230), known(16), known(0.8));
    expect(p.totalW.value).toBe(14400);
    expect(p.cabinetsPerCircuit).toBe(14);
    expect(p.circuits.value).toBe(6);
  });
});

describe('stage tiling', () => {
  const opt = [{ itemId: 'd21', widthMm: 2000, depthMm: 1000, available: 100 }];
  it('12 m × 6 m from 2 × 1 m decks = 36 decks', () => {
    const t = tileStage(12000, 6000, opt)!;
    expect(t.decks).toHaveLength(36);
    expect(t.withinStock).toBe(true);
  });
  it('uses rotation when needed', () => {
    expect(tileStage(3000, 4000, opt)!.decks).toHaveLength(6); // 3 × 2 rotated
  });
  it('mixes a filler strip', () => {
    const t = tileStage(4000, 2500, [...opt, { itemId: 'd105', widthMm: 1000, depthMm: 500, available: 10 }])!;
    expect(t.counts).toEqual({ d105: 4, d21: 4 });
  });
  it('returns null when no exact tiling exists', () => {
    expect(tileStage(12500, 6000, opt)).toBeNull();
  });
});

function galaParams(): DesignParams {
  const b = parseBrief('Design a premium corporate gala for 500 guests at the Sandton Convention Centre. I need a 12 m x 6 m stage, a 10 m x 3 m LED wall, intelligent lighting, professional sound, FOH and a luxurious black-and-gold aesthetic. Use our inventory.');
  return applyBrief(defaultParams(), b);
}

describe('brief interpretation', () => {
  it('extracts the example brief', () => {
    const b = parseBrief('Design a premium corporate gala for 500 guests at the Sandton Convention Centre. I need a 12 m x 6 m stage, a 10 m x 3 m LED wall, intelligent lighting, professional sound, FOH and a luxurious black-and-gold aesthetic.');
    const v = Object.fromEntries(b.extracted.map((e) => [e.path, e.value]));
    expect(v).toMatchObject({ guests: 500, 'stage.widthMm': 12000, 'stage.depthMm': 6000, 'led.widthMm': 10000, 'led.heightMm': 3000, eventType: 'gala', aesthetic: 'black-and-gold' });
    expect(b.venueName).toBe('Sandton Convention Centre');
    expect(b.requests).toEqual(expect.arrayContaining(['Lighting design', 'Audio / PA design', 'FOH position']));
  });
  it('records brief provenance as PROVISIONAL', () => {
    const p = galaParams();
    expect(p.sources['stage.widthMm']!.status).toBe('PROVISIONAL');
    expect(p.sources['stage.widthMm']!.source.kind).toBe('brief');
  });
});

describe('revision commands', () => {
  it.each([
    ['Make the stage 2 metres wider.', [{ op: 'add', path: 'stage.widthMm', delta: 2000 }]],
    ['make the LED 1m taller', [{ op: 'add', path: 'led.heightMm', delta: 1000 }]],
    ['Move FOH to the back of the room.', [{ op: 'set', path: 'foh.position', value: 'back' }]],
    ['stage 10 m x 5 m', [{ op: 'set', path: 'stage.widthMm', value: 10000 }, { op: 'set', path: 'stage.depthMm', value: 5000 }]],
    ['put the stage on wall 2', [{ op: 'set', path: 'stageWall', value: 1 }]],
  ])('%s', (text, expected) => {
    const r = interpretCommand(text);
    expect(r.recognised).toBe(true);
    expect(r.ops).toMatchObject(expected);
  });
  it('view requests switch viewpoint without changing the design', () => {
    const r = interpretCommand('Show me the view from the VIP tables.');
    expect(r.viewpoint).toBe('front-tables');
    expect(r.ops).toHaveLength(0);
  });
  it('honestly declines unsupported requests', () => {
    for (const t of ['Use fewer moving heads.', 'Change the LED to a curved concept', 'Reduce the equipment rental value by 20%.', 'Create three completely different stage designs']) {
      const r = interpretCommand(t);
      expect(r.recognised).toBe(false);
      expect(r.ops).toHaveLength(0);
    }
  });
  it('applies ops with user provenance', () => {
    const r = applyOps(galaParams(), interpretCommand('make the stage 2 m wider').ops);
    expect(r.params.stage.widthMm).toBe(14000);
    expect(r.params.sources['stage.widthMm']!.source.kind).toBe('user_entry');
  });
});

describe('design generation (end-to-end, synthetic)', () => {
  const fullStock = () => [ledPanel(150), processor(2), deck(40), leg(200)];

  it('builds the gala design from confirmed stock with consistent scene and BOM', () => {
    const p = galaParams();
    p.led.widthMm = 6000; // 72 cabinets — within a single VX600's capacity
    const r = generateDesign({ params: p, venue: ballroom(), stock: fullStock(), relationships: [] });
    const cabs = r.scene.objects.filter((o) => o.kind === 'led_cabinet');
    expect(cabs).toHaveLength(72);
    const ledLine = r.bom.lines.find((l) => l.itemId === 'led26')!;
    expect(ledLine.allocated).toBe(72);
    expect(cabs.filter((c) => c.supply === 'OWNED')).toHaveLength(ledLine.allocated);
    const decks = r.scene.objects.filter((o) => o.kind === 'stage_deck');
    expect(decks).toHaveLength(36);
    expect(r.bom.lines.find((l) => l.itemId === 'leg1000')!.required).toBe(144);
    const c = Object.fromEntries(r.validation.checks.map((x) => [x.id, x.result]));
    expect(c).toMatchObject({ 'stage.fit': 'PASS', 'stage.decks': 'PASS', 'stage.legs': 'PASS', 'led.layout': 'PASS', 'led.stock': 'PASS', 'led.processor': 'PASS', 'led.ceiling': 'PASS', 'foh.fit': 'PASS', 'seating.capacity': 'PASS' });
    expect(c['led.mounting']).toBe('UNKNOWN'); // no mounting relationship recorded
    expect(c['led.compat']).toBe('UNKNOWN');
    expect(c['safety.structural']).toBe('HUMAN_REQUIRED');
    expect(r.validation.overall).toBe('INCOMPLETE');
    expect(r.scene.objects.filter((o) => o.kind === 'table')).toHaveLength(50);
  });

  it('never allocates more than the confirmed quantity, and reports a feasible redesign', () => {
    const r = generateDesign({ params: galaParams(), venue: ballroom(), stock: [ledPanel(100), processor(2), deck(40), leg(200)], relationships: [] });
    const line = r.bom.lines.find((l) => l.itemId === 'led26')!;
    expect(line.required).toBe(120);
    expect(line.allocated).toBe(100);
    expect(line.shortfall).toBe(20);
    expect(r.validation.checks.find((c) => c.id === 'led.stock')!.result).toBe('FAIL');
    expect(r.validation.overall).toBe('FAILS_CHECKS');
    expect(r.alternatives.some((a) => a.includes('8.00 m × 3.00 m (96 cabinets)'))).toBe(true);
  });

  it('unconfirmed quantities allocate nothing (the file quantity is provisional)', () => {
    const r = generateDesign({ params: galaParams(), venue: ballroom(), stock: [ledPanel(null), deck(40), leg(200)], relationships: [] });
    expect(r.bom.lines.find((l) => l.itemId === 'led26')!.allocated).toBe(0);
    expect(r.validation.checks.find((c) => c.id === 'led.stock')!.message).toMatch(/not yet confirmed/);
  });

  it('processor capacity checks run against the real wall: 10 × 3 m exceeds one VX600', () => {
    const r = generateDesign({ params: galaParams(), venue: ballroom(), stock: fullStock(), relationships: [] });
    expect(r.validation.checks.find((c) => c.id === 'led.processor')!.result).toBe('FAIL');
    expect(r.bom.unresolved.some((u) => u.id === 'led.processor')).toBe(true);
  });

  it('missing processor specs → UNKNOWN, never assumed', () => {
    const r = generateDesign({ params: galaParams(), venue: ballroom(), stock: [ledPanel(150), processor(2, false), deck(40), leg(200)], relationships: [] });
    expect(r.validation.checks.find((c) => c.id === 'led.processor')!.result).toBe('UNKNOWN');
  });

  it('stage that does not fit fails, ceiling too low fails', () => {
    const p = galaParams();
    p.stage.widthMm = 32000;
    const v = ballroom({ ceilingHeight: { value: 3500, status: 'VERIFIED', source: { kind: 'venue_doc' }, unit: 'mm' } });
    const r = generateDesign({ params: p, venue: v, stock: fullStock(), relationships: [] });
    expect(r.validation.checks.find((c) => c.id === 'stage.fit')!.result).toBe('FAIL');
    expect(r.validation.checks.find((c) => c.id === 'led.ceiling')!.result).toBe('FAIL');
  });

  it('unknown ceiling → UNKNOWN check, recorded as assumption', () => {
    const r = generateDesign({ params: galaParams(), venue: ballroom({ ceilingHeight: { value: null, status: 'UNKNOWN', source: { kind: 'derived' } } }), stock: fullStock(), relationships: [] });
    expect(r.validation.checks.find((c) => c.id === 'led.ceiling')!.result).toBe('UNKNOWN');
    expect(r.assumptions.some((a) => a.id === 'venue:ceiling')).toBe(true);
  });

  it('a recorded value whose status is UNKNOWN is never used', () => {
    const v = ballroom({ ceilingHeight: { value: 8000, status: 'UNKNOWN', source: { kind: 'user_entry' } } });
    const r = generateDesign({ params: galaParams(), venue: v, stock: fullStock(), relationships: [] });
    expect(r.validation.checks.find((c) => c.id === 'led.ceiling')!.result).toBe('UNKNOWN');
  });

  it('uses REQUIRES relationships for leg quantities and MOUNTS_TO for LED hardware', () => {
    const rel: EquipmentRelationship[] = [
      { id: 'r1', type: 'REQUIRES', fromModelId: 'model-deck21', to: { category: 'STAGE_LEG' }, quantity: { kind: 'per_unit', ratio: 2 }, constraints: {}, evidence: [], status: 'VERIFIED' },
      { id: 'r2', type: 'MOUNTS_TO', fromModelId: 'model-led26', to: { modelId: 'model-gs' }, quantity: { kind: 'per_n_units', per: 2, qty: 1, rounding: 'ceil' }, constraints: { per: 'column' }, evidence: [], status: 'PROVISIONAL' },
    ];
    const gs = { itemId: 'gs', rmsId: 'gs', product: 'LED ground stack frame', productGroup: null, category: 'LED_MOUNTING' as const, modelId: 'model-gs', qtyConfirmed: 10, qtyShown: 10, rentalRate: 0, chargePeriod: 'Day', currency: 'ZAR', specs: {} };
    const p = galaParams();
    p.led.widthMm = 6000;
    const r = generateDesign({ params: p, venue: ballroom(), stock: [...fullStock(), gs], relationships: rel });
    expect(r.bom.lines.find((l) => l.itemId === 'leg1000')!.required).toBe(72);
    expect(r.bom.lines.find((l) => l.itemId === 'gs')!.required).toBe(6);
    expect(r.validation.checks.find((c) => c.id === 'led.mounting')!.result).toBe('PASS');
  });

  it('is deterministic: identical inputs give byte-identical outputs', () => {
    const ctx = () => ({ params: galaParams(), venue: ballroom(), stock: fullStock(), relationships: [] });
    expect(canonicalJson(generateDesign(ctx()))).toBe(canonicalJson(generateDesign(ctx())));
  });

  it('a design is never VERIFIED in concept mode', () => {
    const r = generateDesign({ params: galaParams(), venue: ballroom(), stock: fullStock(), relationships: [] });
    expect(r.validation.overall).not.toBe('VERIFIED');
    expect(r.validation.notCertification).toMatch(/not structural/);
  });

  it('works on a rotated, non-rectangular room', () => {
    const rot = (x: number, y: number) => ({ x: x * Math.cos(0.5) - y * Math.sin(0.5), y: x * Math.sin(0.5) + y * Math.cos(0.5) });
    const poly = [rot(0, 0), rot(30000, 0), rot(30000, 12000), rot(22000, 12000), rot(22000, 20000), rot(0, 20000)];
    const p = galaParams();
    p.led.widthMm = 6000;
    const r = generateDesign({ params: p, venue: ballroom({ roomPolygon: poly, stageWallIndex: 5 }), stock: fullStock(), relationships: [] });
    expect(r.validation.checks.find((c) => c.id === 'stage.fit')!.result).toBe('PASS');
    expect(r.validation.checks.find((c) => c.id === 'foh.fit')!.result).toBe('PASS');
  });
});

describe('drawing consistency', () => {
  it('plan dimensions come from the scene', () => {
    const p = galaParams();
    p.led.widthMm = 6000;
    const r = generateDesign({ params: p, venue: ballroom(), stock: [ledPanel(150), processor(2), deck(40), leg(200)], relationships: [] });
    const d = planDrawing(r.scene);
    const dims = d.prims.filter((x) => x.t === 'dim').map((x) => (x as { text: string }).text);
    expect(dims).toEqual(expect.arrayContaining(['12.00 m', '6.00 m', 'LED 6.00 m', '40.00 m', '30.00 m']));
    const svg = renderSvg(d, 200);
    expect(svg).toContain('data-scale="1:200"');
    expect(svg).toContain('12.00 m');
  });
});
