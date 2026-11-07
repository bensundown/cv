import { describe, expect, it } from 'vitest';
import { applyOps, applyBrief, boxesForThrow, defaultParams, generateDesign, interpretCommand, OWNER_GUIDELINE_POLICY, parseBrief, pickConsole, pickStageBox, type StockItem } from '../src/index.js';
import { ballroom, deck, ledPanel, leg, processor, stockItem } from './fixtures.js';

// SYNTHETIC quantities; product names follow the public FBT / Allen & Heath / Sennheiser model names.
const s = (id: string, product: string, category: StockItem['category'], qtyShown: number) => stockItem({ itemId: id, product, category, qtyShown, qtyConfirmed: null });
const audioStock = () => [
  { ...s('la', 'FBT MUSE210LA 2X10" + 2X1" ACTIVE LINE ARRAY', 'SPEAKER_LINE_ARRAY', 16), specs: { weight_kg: { key: 'weight_kg', value: 38.2, unit: 'kg', status: 'PROVISIONAL' as const, source: { kind: 'manufacturer_doc' as const } } } },
  s('bar', 'FBT MS-F210 Flying Bar or Stakking for Muse 210LA', 'SPEAKER_MOUNTING', 4),
  s('sub', 'FBT Muse 218SA Active Subwoofer Dual 18″', 'SUBWOOFER', 8),
  s('sl', 'FBT – SUBLINE218SA ACTIVE SUB', 'SUBWOOFER', 6),
  s('pt', 'FBT X Lite 115A 15" Speaker Top/Monitor', 'SPEAKER_POINT_SOURCE', 4),
  s('sq6', 'Allen and Heath SQ-6 Expandable Digital Mixing Console', 'MIXING_CONSOLE', 1),
  s('cq', 'Allen & Heath CQ-18T', 'MIXING_CONSOLE', 2),
  s('dx', 'Allen & Heath DX168 Stage Box', 'STAGE_BOX', 2),
  s('hh', 'Sennheiser EW-D SKM Handheld', 'MICROPHONE', 15),
  s('bp', 'Sennheiser EW-D SK Body Packs', 'MICROPHONE', 23),
  s('rx', 'Sennheiser EW-D EM Receiver', 'MICROPHONE', 35),
  s('sam', 'Samson SE50 Single Ear Headset Mic (countryman)', 'MICROPHONE', 8),
  s('hs', 'Sennheiser HS Black', 'MICROPHONE', 5),
];
const STRICT_FILE = OWNER_GUIDELINE_POLICY;
const base = () => [{ ...ledPanel(null), qtyShown: 150 }, { ...processor(null), qtyShown: 2 }, { ...deck(null), qtyShown: 40 }, { ...leg(null), qtyShown: 200 }];
const gala = () => applyBrief(defaultParams(), parseBrief('Gala for 500 guests, 12 m x 6 m stage, 6 m x 3 m LED wall, professional sound.'));

describe('audio rules', () => {
  it('box count from throw', () => {
    expect(boxesForThrow(8000)).toBe(2);
    expect(boxesForThrow(25000)).toBe(5);
    expect(boxesForThrow(60000)).toBe(6);
  });
  it('console preference and SLink stage box pairing', () => {
    const st = audioStock();
    const lim = (it: StockItem) => it.qtyShown ?? 0;
    const c = pickConsole(st, lim, null)!;
    expect(c.itemId).toBe('sq6');
    expect(pickStageBox(st, c, lim)!.box.itemId).toBe('dx');
    expect(pickStageBox(st, st.find((x) => x.itemId === 'cq')!, lim)).toBeNull();
  });
});

describe('audio in the design', () => {
  it('brief enables sound; line arrays L/R on same-family subs; console + stage box + wireless', () => {
    const p = gala();
    expect(p.audio.enabled).toBe(true);
    const r = generateDesign({ params: p, venue: ballroom(), stock: [...base(), ...audioStock()], relationships: [], stockPolicy: OWNER_GUIDELINE_POLICY });
    const mains = r.scene.objects.filter((o) => o.kind === 'speaker' && o.meta?.role === 'line_array');
    const subs = r.scene.objects.filter((o) => o.kind === 'speaker' && o.meta?.role === 'sub');
    expect(mains.length % 2).toBe(0);
    expect(new Set(subs.map((x) => x.itemId))).toEqual(new Set(['sub'])); // Muse subs with Muse tops
    const bom = Object.fromEntries(r.bom.lines.map((l) => [l.itemId, l.allocated]));
    expect(bom).toMatchObject({ bar: 2, sq6: 1, dx: 1, hh: 2, bp: 2, hs: 2, rx: 4 });
    const c = Object.fromEntries(r.validation.checks.map((x) => [x.id, x.result]));
    expect(c).toMatchObject({ 'audio.system': 'PASS', 'audio.coverage': 'WARN', 'audio.console': 'PASS', 'audio.wireless': 'PASS' });
    expect(r.bom.unresolved.some((u) => u.id === 'audio.snake')).toBe(true);
    expect(r.validation.checks.find((x) => x.id === 'audio.system')!.message).toMatch(/kg per side|weight/);
    expect(r.validation.checks.some((x) => x.id === 'scope.audio')).toBe(false);
    // Speakers stand outside the stage footprint.
    const stage = r.scene.objects.find((o) => o.kind === 'stage')!;
    for (const m of mains) expect(Math.abs(m.position.y - stage.position.y)).toBeGreaterThan(stage.size.x / 2);
  });
  it('Samson headsets work with Sennheiser bodypacks (with the Sennheiser connector) when Sennheiser headsets run out', () => {
    const p = gala();
    p.audio.wirelessHeadset = 8; // 5 Sennheiser HS in stock → 3 Samson SE50
    const r = generateDesign({ params: p, venue: ballroom(), stock: [...base(), ...audioStock()], relationships: [], stockPolicy: STRICT_FILE });
    const bom = Object.fromEntries(r.bom.lines.map((l) => [l.itemId, l.allocated]));
    expect(bom.hs).toBe(6); // 5 + 20 % headroom
    expect(bom.sam).toBe(2);
    expect(r.validation.checks.find((x) => x.id === 'audio.wireless')!.message).toMatch(/Sennheiser 3\.5 mm connector/);
    expect(r.bom.unresolved.some((u) => u.id.startsWith('audio.headset-connector'))).toBe(true);
  });

  it('commands: boxes per side, point source, remove sound', () => {
    const p1 = applyOps(gala(), interpretCommand('4 boxes per side').ops).params;
    expect(p1.audio.boxesPerSide).toBe(4);
    const r = generateDesign({ params: p1, venue: ballroom(), stock: [...base(), ...audioStock()], relationships: [], stockPolicy: OWNER_GUIDELINE_POLICY });
    expect(r.scene.objects.filter((o) => o.meta?.role === 'line_array')).toHaveLength(8);
    const p2 = applyOps(gala(), interpretCommand('use point source speakers').ops).params;
    const r2 = generateDesign({ params: p2, venue: ballroom(), stock: [...base(), ...audioStock()], relationships: [], stockPolicy: OWNER_GUIDELINE_POLICY });
    expect(r2.scene.objects.filter((o) => o.meta?.role === 'point_source')).toHaveLength(2);
    const p3 = applyOps(gala(), interpretCommand('remove the sound').ops).params;
    expect(generateDesign({ params: p3, venue: ballroom(), stock: [...base(), ...audioStock()], relationships: [] }).scene.objects.some((o) => o.kind === 'speaker')).toBe(false);
  });
  it('never allocates beyond the stock limit', () => {
    const st = audioStock().map((x) => (x.itemId === 'la' ? { ...x, qtyShown: 3 } : x));
    const r = generateDesign({ params: gala(), venue: ballroom(), stock: [...base(), ...st], relationships: [], stockPolicy: OWNER_GUIDELINE_POLICY });
    const la = r.bom.lines.find((l) => l.itemId === 'la')!;
    expect(la.allocated).toBeLessThanOrEqual(3);
    expect(r.validation.checks.find((x) => x.id === 'audio.system')!.result).toBe('FAIL');
  });
});
