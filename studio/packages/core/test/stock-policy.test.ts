import { describe, expect, it } from 'vitest';
import { applyBrief, defaultParams, generateDesign, OWNER_GUIDELINE_POLICY, parseBrief, stockLimit, STRICT_POLICY } from '../src/index.js';
import { ballroom, deck, ledPanel, leg, processor } from './fixtures.js';

describe('stock limits', () => {
  it('confirmed quantity is a hard cap; file quantity + 20 % only when unconfirmed', () => {
    expect(stockLimit({ qtyConfirmed: 58, qtyShown: 100 }, OWNER_GUIDELINE_POLICY)).toEqual({ limit: 58, guideline: null, basis: 'CONFIRMED' });
    expect(stockLimit({ qtyConfirmed: null, qtyShown: 100 }, OWNER_GUIDELINE_POLICY)).toEqual({ limit: 120, guideline: 100, basis: 'FILE_GUIDELINE' });
    expect(stockLimit({ qtyConfirmed: null, qtyShown: 134 }, OWNER_GUIDELINE_POLICY).limit).toBe(160); // floor(160.8)
    expect(stockLimit({ qtyConfirmed: null, qtyShown: 3 }, OWNER_GUIDELINE_POLICY).limit).toBe(3); // floor(3.6)
    expect(stockLimit({ qtyConfirmed: null, qtyShown: 0 }, OWNER_GUIDELINE_POLICY).basis).toBe('NONE');
    expect(stockLimit({ qtyConfirmed: null, qtyShown: null }, OWNER_GUIDELINE_POLICY).basis).toBe('NONE');
    expect(stockLimit({ qtyConfirmed: null, qtyShown: 100 }, STRICT_POLICY).limit).toBe(0);
  });
});

describe('design under the owner guideline policy', () => {
  const params = () => applyBrief(defaultParams(), parseBrief('Gala for 500 guests, 12 m x 6 m stage, 10 m x 3 m LED wall.'));
  // 120 cabinets needed; file shows 100 → 120 allowed with 20 % headroom.
  const stock = () => [{ ...ledPanel(null), qtyShown: 100 }, { ...processor(null), qtyShown: 2 }, { ...deck(null), qtyShown: 36 }, { ...leg(null), qtyShown: 144 }];

  it('allocates up to file qty + 20 % and reports the headroom use', () => {
    const r = generateDesign({ params: params(), venue: ballroom(), stock: stock(), relationships: [], stockPolicy: OWNER_GUIDELINE_POLICY });
    const led = r.bom.lines.find((l) => l.itemId === 'led26')!;
    expect(led).toMatchObject({ required: 120, allocated: 120, shortfall: 0, stockBasis: 'FILE_GUIDELINE', overGuideline: 20 });
    expect(r.validation.checks.find((c) => c.id === 'led.stock')).toMatchObject({ result: 'PASS', dataStatus: 'PROVISIONAL' });
    const av = r.validation.checks.find((c) => c.id === 'inventory.availability')!;
    expect(av.result).toBe('WARN');
    expect(av.message).toContain('+20 over 100');
    expect(r.assumptions.some((a) => a.id === 'stock.policy')).toBe(true);
  });

  it('never exceeds the headroom, and confirmed quantities stay hard limits', () => {
    const s = stock();
    s[0] = { ...s[0]!, qtyShown: 90 }; // 108 allowed < 120 needed
    const r = generateDesign({ params: params(), venue: ballroom(), stock: s, relationships: [], stockPolicy: OWNER_GUIDELINE_POLICY });
    expect(r.bom.lines.find((l) => l.itemId === 'led26')).toMatchObject({ allocated: 108, shortfall: 12 });
    s[0] = { ...s[0]!, qtyShown: 500, qtyConfirmed: 100 };
    const r2 = generateDesign({ params: params(), venue: ballroom(), stock: s, relationships: [], stockPolicy: OWNER_GUIDELINE_POLICY });
    expect(r2.bom.lines.find((l) => l.itemId === 'led26')).toMatchObject({ allocated: 100, shortfall: 20, stockBasis: 'CONFIRMED', overGuideline: 0 });
  });

  it('without a policy the engine stays strict (confirmed only)', () => {
    const r = generateDesign({ params: params(), venue: ballroom(), stock: stock(), relationships: [] });
    expect(r.bom.lines.find((l) => l.itemId === 'led26')!.allocated).toBe(0);
  });
});

describe('no-limits policy (owner decision 2026-11-09)', () => {
  it('never caps by stock and flags units over recorded quantities', async () => {
    const { stockLimit, NO_LIMITS_POLICY } = await import('../src/index.js');
    const a = stockLimit({ qtyConfirmed: null, qtyShown: 10 }, NO_LIMITS_POLICY);
    expect(a.basis).toBe('FILE_GUIDELINE');
    expect(a.guideline).toBe(10);
    expect(a.limit).toBeGreaterThan(10_000);
    const b = stockLimit({ qtyConfirmed: 4, qtyShown: 10 }, NO_LIMITS_POLICY);
    expect(b.basis).toBe('CONFIRMED');
    expect(b.guideline).toBe(4);
    const c = stockLimit({ qtyConfirmed: null, qtyShown: null }, NO_LIMITS_POLICY);
    expect(c.basis).toBe('NONE');
    expect(c.limit).toBeLessThan(a.limit); // ranking still prefers recorded stock
  });
});
