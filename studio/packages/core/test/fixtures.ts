/**
 * SYNTHETIC TEST FIXTURES — NOT SOUND NINJA DATA.
 * Product names follow the examples in the product brief; RMS IDs, quantities,
 * rates and all spec values are invented for testing the arithmetic only and
 * must never be seeded into a real database.
 */
import type { SpecSheet, StockItem, VenueGeometry } from '../src/index.js';

export const HEADER = ['RMS ID', 'Product', 'Product group', "Qty shown ('available to rent')", 'Rental rate (R)', 'Charge period', 'Data flag'];

export const syntheticRows = (): unknown[][] => [
  ['SYNTHETIC inventory export', null, null, null, null, null, null],
  [],
  HEADER,
  ['1001', 'Leyard 2.6mm 500 x 500mm LED Panel', 'LED Screens', 120, 'R 250,00', 'Day', null],
  ['1002', 'Novastar VX600', 'LED Processing', 2, 1500, 'Day', null],
  ['1003', 'AluStage Deck 2m x 1m', 'Staging', 40, 300, 'Day', null],
  ['1004', 'AluStage Leg 1m', 'Staging', '', 0, 'Day', 'check count'],
  ['1005', 'FBT Muse 210LA', 'Audio', 0, 900, 'Day', null],
  [null, null, null, null, null, null, null],
  ['1006', 'Novastar VX600', 'Video', 1, 1500, 'Day', null],
];

const s = (key: string, value: number, unit: string, status: 'VERIFIED' | 'PROVISIONAL' | 'ESTIMATED' = 'VERIFIED') => ({
  [key]: { key, value, unit, status, source: { kind: 'manufacturer_doc' as const, ref: 'SYNTHETIC test value' } },
});
export const specs = (...parts: SpecSheet[]): SpecSheet => Object.assign({}, ...parts);

export function stockItem(p: Partial<StockItem> & Pick<StockItem, 'itemId' | 'product' | 'category'>): StockItem {
  return { rmsId: p.itemId, productGroup: null, modelId: `model-${p.itemId}`, qtyConfirmed: null, qtyShown: null, rentalRate: null, chargePeriod: 'Day', currency: 'ZAR', specs: {}, ...p };
}

export const ledPanel = (qty: number | null, extra: SpecSheet = {}) =>
  stockItem({
    itemId: 'led26',
    product: 'Leyard 2.6mm 500 x 500mm LED Panel',
    category: 'LED_PANEL',
    qtyConfirmed: qty,
    qtyShown: 120,
    rentalRate: 250,
    specs: specs(s('cabinet_width_mm', 500, 'mm'), s('cabinet_height_mm', 500, 'mm'), s('pixel_pitch_mm', 2.6, 'mm', 'PROVISIONAL'), extra),
  });

export const processor = (qty: number | null, withSpecs = true) =>
  stockItem({
    itemId: 'vx600',
    product: 'Novastar VX600',
    category: 'LED_PROCESSOR',
    qtyConfirmed: qty,
    rentalRate: 1500,
    specs: withSpecs
      ? specs(s('total_pixel_capacity', 3_900_000, 'px'), s('output_ports', 6, 'ports'), s('pixels_per_port', 650_000, 'px'), s('max_width_px', 10_240, 'px'), s('max_height_px', 8_192, 'px'))
      : {},
  });

export const deck = (qty: number | null) =>
  stockItem({ itemId: 'deck21', product: 'AluStage Deck 2m x 1m', category: 'STAGE_DECK', qtyConfirmed: qty, rentalRate: 300, specs: specs(s('deck_width_mm', 2000, 'mm'), s('deck_depth_mm', 1000, 'mm')) });

export const leg = (qty: number | null, h = 1000) =>
  stockItem({ itemId: `leg${h}`, product: `AluStage Leg ${h / 1000}m`, category: 'STAGE_LEG', qtyConfirmed: qty, rentalRate: 0, specs: specs(s('leg_height_mm', h, 'mm')) });

/** A 40 m × 30 m rectangular ballroom, CCW, verified outline and 6 m ceiling. */
export const ballroom = (over: Partial<VenueGeometry> = {}): VenueGeometry => ({
  venueName: 'Synthetic Ballroom',
  roomPolygon: [
    { x: 0, y: 0 },
    { x: 40000, y: 0 },
    { x: 40000, y: 30000 },
    { x: 0, y: 30000 },
  ],
  roomStatus: 'VERIFIED',
  roomSource: { kind: 'venue_doc', ref: 'synthetic' },
  obstacles: [],
  ceilingHeight: { value: 6000, status: 'VERIFIED', source: { kind: 'venue_doc', ref: 'synthetic' }, unit: 'mm' },
  stageWallIndex: 3, // west wall (0,30000)→(0,0): stage faces east into the 40 m length
  calibrationStatus: 'VERIFIED',
  calibrationRelUncertainty: 0.002,
  ...over,
});
