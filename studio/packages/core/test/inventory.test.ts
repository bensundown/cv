import { describe, expect, it } from 'vitest';
import { detectColumns, diffInventory, guessCategory, guessManufacturer, parseInventoryRows, parseNameHints, parseNumberCell, type SnapshotItemLite } from '../src/index.js';
import { HEADER, syntheticRows } from './fixtures.js';

describe('column detection', () => {
  it('finds the documented header row below title rows and maps every field', () => {
    const m = detectColumns(syntheticRows())!;
    expect(m.headerRowIndex).toBe(2);
    expect(m.fields).toEqual({ rmsId: 0, product: 1, productGroup: 2, qtyShown: 3, rentalRate: 4, chargePeriod: 5, dataFlag: 6 });
    expect(m.currency).toBe('ZAR');
  });
  it('handles reordered columns and keeps unknown columns as unmapped', () => {
    const m = detectColumns([['Product', 'Serials', 'RMS ID', 'Qty']])!;
    expect(m.fields.product).toBe(0);
    expect(m.fields.rmsId).toBe(2);
    expect(m.fields.qtyShown).toBe(3);
    expect(m.unmappedColumns).toEqual([{ index: 1, header: 'Serials' }]);
  });
  it('rejects a file with no recognisable header', () => {
    const r = parseInventoryRows([['a', 'b'], [1, 2]]);
    expect(r.blocking).toBe(true);
    expect(r.issues[0]!.code).toBe('NO_HEADER');
  });
});

describe('value parsing', () => {
  it.each([
    ['R 250,00', 250],
    ['1 200,50', 1200.5],
    ['1,200.50', 1200.5],
    ['1,200', 1200],
    [350, 350],
    ['abc', NaN],
  ])('%s → %s', (input, out) => {
    expect(parseNumberCell(input)).toEqual(out);
  });
});

describe('inventory parse', () => {
  const r = parseInventoryRows(syntheticRows());
  it('preserves source values, row numbers and raw cells', () => {
    const led = r.records.find((x) => x.rmsId === '1001')!;
    expect(led.rowNumber).toBe(4);
    expect(led.rentalRate).toBe(250);
    expect(led.rentalRateRaw).toBe('R 250,00');
    expect(led.raw[HEADER[3]!]).toBe(120);
    expect(led.currency).toBe('ZAR');
  });
  it('skips blank rows and counts them', () => {
    expect(r.records).toHaveLength(6);
    expect(r.blankRowsSkipped).toBe(1);
  });
  it('treats blank quantity, zero quantity and zero rate as separate issues', () => {
    const legs = r.records.find((x) => x.rmsId === '1004')!;
    expect(legs.issues).toContain('QTY_BLANK');
    expect(legs.issues).toContain('RATE_ZERO');
    expect(legs.qtyShown).toBeNull();
    const muse = r.records.find((x) => x.rmsId === '1005')!;
    expect(muse.issues).toContain('QTY_ZERO');
    expect(muse.issues).not.toContain('QTY_BLANK');
    expect(muse.qtyShown).toBe(0);
  });
  it('flags the same product in different groups as a possible duplicate (warning, not blocking)', () => {
    const dups = r.issues.filter((i) => i.code === 'POSSIBLE_DUPLICATE_PRODUCT');
    expect(dups.map((d) => d.rmsId).sort()).toEqual(['1002', '1006']);
    expect(r.blocking).toBe(false);
  });
  it('preserves data flags', () => {
    expect(r.records.find((x) => x.rmsId === '1004')!.dataFlag).toBe('check count');
  });
  it('blocks duplicate RMS IDs', () => {
    const rows = syntheticRows();
    rows.push(['1001', 'Different product', 'X', 1, 1, 'Day', null]);
    const res = parseInventoryRows(rows);
    expect(res.blocking).toBe(true);
    expect(res.issues.filter((i) => i.code === 'RMS_ID_DUPLICATE')).toHaveLength(2);
  });
});

describe('inventory diff', () => {
  const prev: SnapshotItemLite[] = [
    { itemId: 'a', rmsId: '1001', product: 'Leyard 2.6mm 500 x 500mm LED Panel', productGroup: 'LED Screens', qtyShown: 100, rentalRate: 250, chargePeriod: 'Day', dataFlag: null },
    { itemId: 'b', rmsId: '1002', product: 'Novastar VX-600', productGroup: 'LED Processing', qtyShown: 2, rentalRate: 1500, chargePeriod: 'Day', dataFlag: null },
    { itemId: 'c', rmsId: '9999', product: 'Retired thing', productGroup: 'X', qtyShown: 1, rentalRate: 1, chargePeriod: 'Day', dataFlag: null },
    { itemId: 'd', rmsId: null, product: 'AluStage Deck 2m x 1m', productGroup: 'Staging', qtyShown: 40, rentalRate: 300, chargePeriod: 'Day', dataFlag: null },
  ];
  const d = diffInventory(prev, parseInventoryRows(syntheticRows()).records);
  const by = (rms: string) => d.changes.find((c) => c.rmsId === rms)!;
  it('detects changed fields matched by RMS ID', () => {
    expect(by('1001').kind).toBe('changed');
    expect(by('1001').fields).toEqual([{ field: 'qtyShown', before: 100, after: 120 }]);
  });
  it('detects renames by stable RMS ID', () => {
    expect(by('1002').kind).toBe('renamed');
    expect(by('1002').itemId).toBe('b');
  });
  it('matches records without a shared RMS ID by name only, for review', () => {
    expect(by('1003').kind).toBe('matched_by_name');
    expect(by('1003').itemId).toBe('d');
  });
  it('never silently deletes: missing items become proposed removals', () => {
    expect(d.changes.find((c) => c.itemId === 'c')!.kind).toBe('removal_proposed');
  });
  it('reports new items as added', () => {
    expect(by('1005').kind).toBe('added');
    expect(d.summary.added).toBe(3); // 1004, 1005, 1006
  });
});

describe('taxonomy and name hints', () => {
  it.each([
    ['Leyard 2.6mm 500 x 500mm LED Panel', 'LED_PANEL'],
    ['Leyard 3.9mm Outdoor 500 x 1000mm', 'LED_PANEL'],
    ['Novastar VX1000', 'LED_PROCESSOR'],
    ['Novastar VX2000Pro', 'LED_PROCESSOR'],
    ['FBT Muse 210LA', 'SPEAKER_LINE_ARRAY'],
    ['FBT Muse 218SA', 'SUBWOOFER'],
    ['FBT Horizon VHA 406', 'SPEAKER_POINT_SOURCE'],
    ['Allen & Heath SQ-6', 'MIXING_CONSOLE'],
    ['Allen & Heath DX168', 'STAGE_BOX'],
    ['AluStage Deck 2m x 1m', 'STAGE_DECK'],
    ['AluStage Leg 600mm', 'STAGE_LEG'],
    ['QUAD 290 Truss 3m', 'TRUSS'],
  ])('%s → %s', (name, cat) => {
    expect(guessCategory(name, null).category).toBe(cat);
  });
  it('extracts LED cabinet hints but never claims verification', () => {
    expect(parseNameHints('Leyard 2.6mm 500 x 500mm LED Panel', 'LED_PANEL')).toEqual({ pixelPitchMm: 2.6, cabinetWidthMm: 500, cabinetHeightMm: 500 });
    expect(parseNameHints('Leyard 3.9mm Outdoor 500 x 1000mm', 'LED_PANEL')).toMatchObject({ pixelPitchMm: 3.9, cabinetWidthMm: 500, cabinetHeightMm: 1000, outdoor: true });
    expect(guessCategory('Leyard 2.6mm 500 x 500mm LED Panel', null).status).toBe('ESTIMATED');
  });
  it('extracts deck and leg sizes', () => {
    expect(parseNameHints('AluStage Deck 2m x 1m', 'STAGE_DECK')).toEqual({ deckWidthMm: 2000, deckDepthMm: 1000 });
    expect(parseNameHints('AluStage Leg 600mm', 'STAGE_LEG')).toEqual({ legHeightMm: 600 });
  });
  it('guesses manufacturers', () => {
    expect(guessManufacturer('Allen & Heath SQ-6')).toBe('Allen & Heath');
    expect(guessManufacturer('FBT Muse 210LA')).toBe('FBT');
    expect(guessManufacturer('Mystery box')).toBeNull();
  });
});
