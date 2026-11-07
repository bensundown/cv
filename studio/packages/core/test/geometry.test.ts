import { describe, expect, it } from 'vitest';
import { area, calibrate, isMultiple, pageToPlan, parseLength, pointInPolygon, polygonInside, polygonsOverlap, rayToBoundary, rectPolygon, toMm, validatePolygon, weakest } from '../src/index.js';

describe('units', () => {
  it('converts at boundaries only', () => {
    expect(parseLength('12 m')).toBe(12000);
    expect(parseLength('500mm')).toBe(500);
    expect(parseLength('10\'')).toBeCloseTo(3048);
    expect(parseLength('3.5')).toBeNull();
    expect(parseLength('3.5', 'm')).toBe(3500);
    expect(toMm(1, 'in')).toBe(25.4);
  });
  it('isMultiple tolerates floating point but not real misfit', () => {
    expect(isMultiple(6000, 500)).toBe(true);
    expect(isMultiple(0.1 * 3 * 10000, 1000)).toBe(true);
    expect(isMultiple(6250, 500)).toBe(false);
  });
});

describe('provenance', () => {
  it('weakest status wins', () => {
    expect(weakest('VERIFIED', 'ESTIMATED', 'PROVISIONAL')).toBe('ESTIMATED');
    expect(weakest('VERIFIED')).toBe('VERIFIED');
    expect(weakest()).toBe('UNKNOWN');
  });
});

describe('polygon', () => {
  const sq = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  it('area, containment, overlap', () => {
    expect(area(sq)).toBe(100);
    expect(pointInPolygon({ x: 5, y: 5 }, sq)).toBe(true);
    expect(pointInPolygon({ x: 10, y: 5 }, sq)).toBe(true);
    expect(pointInPolygon({ x: 11, y: 5 }, sq)).toBe(false);
    expect(polygonInside(rectPolygon({ x: 5, y: 5 }, 4, 4, 30), sq)).toBe(true);
    expect(polygonInside(rectPolygon({ x: 9, y: 5 }, 4, 4, 0), sq)).toBe(false);
    expect(polygonsOverlap(rectPolygon({ x: 5, y: 5 }, 2, 2, 0), sq)).toBe(true);
    expect(polygonsOverlap(rectPolygon({ x: 20, y: 5 }, 2, 2, 0), sq)).toBe(false);
  });
  it('L-shaped room: rectangle across the notch is not inside', () => {
    const L = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 20 },
      { x: 0, y: 20 },
    ];
    expect(polygonInside(rectPolygon({ x: 12, y: 12 }, 6, 6, 0), L)).toBe(false);
    expect(polygonInside(rectPolygon({ x: 5, y: 15 }, 6, 6, 0), L)).toBe(true);
  });
  it('ray to boundary', () => {
    expect(rayToBoundary({ x: 2, y: 5 }, { x: 1, y: 0 }, sq)).toBeCloseTo(8);
  });
  it('detects self-intersection', () => {
    expect(validatePolygon([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }])).not.toHaveLength(0);
    expect(validatePolygon(sq)).toHaveLength(0);
  });
});

describe('calibration', () => {
  const ref = { p1: { x: 100, y: 100 }, p2: { x: 400, y: 100 }, knownLengthMm: 30000, knownToleranceMm: 10, referenceStatus: 'VERIFIED' as const, referenceNote: 'official 30.0 m' };
  it('single verified reference → PROVISIONAL, scale computed', () => {
    const r = calibrate({ reference: ref, checks: [], clickUncertaintyPt: 0.5 });
    expect(r.mmPerPt).toBe(100);
    expect(r.status).toBe('PROVISIONAL');
    expect(r.relUncertainty).toBeGreaterThan(0);
    expect(pageToPlan({ x: 1, y: 2 }, r.mmPerPt)).toEqual({ x: 100, y: -200 });
  });
  it('unverified reference can never exceed ESTIMATED', () => {
    const r = calibrate({ reference: { ...ref, referenceStatus: 'PROVISIONAL' }, checks: [], clickUncertaintyPt: 0.5 });
    expect(r.status).toBe('ESTIMATED');
  });
  it('perpendicular passing verified check → VERIFIED', () => {
    const r = calibrate({ reference: ref, checks: [{ ...ref, p1: { x: 100, y: 100 }, p2: { x: 100, y: 300 }, knownLengthMm: 20000 }], clickUncertaintyPt: 0.5 });
    expect(r.checks[0]!.pass).toBe(true);
    expect(r.status).toBe('VERIFIED');
  });
  it('parallel check alone does not verify', () => {
    const r = calibrate({ reference: ref, checks: [{ ...ref, p1: { x: 100, y: 200 }, p2: { x: 300, y: 200 }, knownLengthMm: 20000 }], clickUncertaintyPt: 0.5 });
    expect(r.status).toBe('PROVISIONAL');
  });
  it('failing check (non-uniform scale) → ESTIMATED + conflict', () => {
    const r = calibrate({ reference: ref, checks: [{ ...ref, p1: { x: 100, y: 100 }, p2: { x: 100, y: 300 }, knownLengthMm: 25000 }], clickUncertaintyPt: 0.5 });
    expect(r.conflict).toBe(true);
    expect(r.status).toBe('ESTIMATED');
  });
});
