/**
 * Regression tests for naming patterns seen in a real RMS export (names below are
 * generic/invented in the same shapes; no real quantities or rates).
 */
import { describe, expect, it } from 'vitest';
import { defaultParams, findNearDuplicates, generateDesign, guessCategory, parseInventoryRows, parseNameHints, parseSizePair, type SpecSheet } from '../src/index.js';
import { HEADER, ballroom, stockItem } from './fixtures.js';

describe('ordered category rules', () => {
  it.each([
    ['AluStage 2m QUAD 290 Truss', 'Trussing', 'TRUSS'],
    ['ALUSTAGE QUAD 290 1/4 CIRCLE Truss', 'Trussing', 'TRUSS'],
    ['AluStage Deck Clamp', 'Staging', 'STAGE_ACCESSORY'],
    ['AluStage Deck Leveler', 'Staging', 'STAGE_ACCESSORY'],
    ['ALUSTAGE ADJUSTABLE STAGE STAIRS 600MM – 1000MM', 'Staging', 'STAGE_ACCESSORY'],
    ['ALUSTAGE ALUMINIUM HANDRAIL 2M', 'Staging', 'STAGE_ACCESSORY'],
    ['AluStage Leg Clamp', 'Staging', 'STAGE_ACCESSORY'],
    ['HEXA CURVED STAGE PLATFORM 2M X 1M LEFT', 'Staging', 'STAGE_DECK_SHAPED'],
    ['AluStage Triangle Deck', 'Staging', 'STAGE_DECK_SHAPED'],
    ['AluStage 1x 0.5', 'Staging', 'STAGE_DECK'],
    ['AluStage 400-600mm Deck Leg', 'Staging', 'STAGE_LEG'],
    ['Led Legs Low Profile', 'LED Screen', 'LED_MOUNTING'],
    ['Led Feet', 'LED Screen', 'LED_MOUNTING'],
    ['Double Clamps', 'LED Screen', 'LED_MOUNTING'],
    ['Electrical COC', 'LED Screen', 'SERVICE_OR_CONSUMABLE'],
    ['Led Cat Links (Indoor)', 'Led Cabling', 'CABLE'],
    ['32 Amp Cable (10m)', 'Power', 'CABLE'],
    ['Generic P-32 32 Amp Distro', 'Power', 'POWER_DISTRIBUTION'],
    ['300mm Top Plate', 'Trussing', 'TRUSS_ACCESSORY'],
    ['Dell 22\' Monitor', 'Monitors', 'DISPLAY'],
    ['HDMI Splitter', 'Extenders', 'VIDEO_SIGNAL'],
    ['Avo Lighting Console T3', 'Lighting', 'LIGHTING_CONSOLE'],
    ['Chamsys MagicQ (MQ50) [ Lighting Console ]', 'Lighting', 'LIGHTING_CONSOLE'],
    ['GrandMA On Pc', 'Lights', 'LIGHTING_CONSOLE'],
    ['Wireless Transceiver (Wireless DMX)', 'Lighting', 'DMX_DISTRIBUTION'],
    ['Generic BT280 Parcan', 'Lights', 'LIGHTING_FIXTURE'],
    ['Generic X100', 'Lights', 'LIGHTING_FIXTURE'],
    ['Vertical Fogger 24x4W LED', 'Lights', 'SPECIAL_EFFECTS'],
    ['Confetti Cannon - SILVER', 'Lights', 'SPECIAL_EFFECTS'],
    ['The Keynote Package - 100 Pax', 'Packages', 'PACKAGE'],
    ['Consumables Small Event', 'Consumables', 'SERVICE_OR_CONSUMABLE'],
    ['FBT MS-F210 Flying Bar for Muse 210LA', 'Audio Accessories', 'SPEAKER_MOUNTING'],
    ['Speaker Stands', 'Audio Accessories', 'STAND'],
    ['FBT X Lite 118 Subs', 'PA Speakers', 'SUBWOOFER'],
    ['Allen & Heath CQ-18T', 'Audio Accessories', 'MIXING_CONSOLE'],
    ['Stereo DI', 'Audio Accessories', 'AUDIO_ACCESSORY'],
    ['65 inch TV With Truss Stand & Sock', 'TV', 'DISPLAY'],
    ['Tv Podium', 'Podiums', 'OTHER'],
    ['Truss Socks Black', 'Covers', 'COVER'],
  ])('%s (%s) → %s', (name, group, cat) => {
    expect(guessCategory(name, group).category).toBe(cat);
  });
});

describe('size and leg hints', () => {
  it('mixed and missing units', () => {
    expect(parseSizePair('Outdoor LED Panel 1m x 500mm')).toEqual({ a: 1000, b: 500, inferred: false });
    expect(parseSizePair('PLATFORM 2M X 1M')).toEqual({ a: 2000, b: 1000, inferred: false });
    expect(parseSizePair('Deck 1x 0.5')).toEqual({ a: 1000, b: 500, inferred: true });
    expect(parseNameHints('Leyard – 3.9MM Outdoor LED Panel 1m x 500mm', 'LED_PANEL')).toMatchObject({ pixelPitchMm: 3.9, cabinetWidthMm: 1000, cabinetHeightMm: 500 });
  });
  it('adjustable leg ranges', () => {
    expect(parseNameHints('AluStage 400-600mm Deck Leg', 'STAGE_LEG')).toEqual({ legHeightMinMm: 400, legHeightMaxMm: 600 });
    expect(parseNameHints('AluStage 200mm Deck Leg', 'STAGE_LEG')).toEqual({ legHeightMm: 200 });
  });
});

describe('near-duplicates', () => {
  const r = (product: string) => ({ product });
  const pairs = (names: string[]) => findNearDuplicates(names.map(r)).map(([a, b]) => [a.product, b.product]);
  it('finds same equipment under different names', () => {
    expect(pairs(['Allen & Heath CQ-18T', 'Allen & Heath CQ-18T – 18 Channel Digital Mixer'])).toHaveLength(1);
    expect(pairs(['Fuel 80Kva Diesel generator', '80kva Generator'])).toHaveLength(1);
    expect(pairs(['Epson 16000 lm Laser Projector', 'Epson EB-X WUXGA Laser Projector 16000 Lumens (Each)'])).toHaveLength(1);
  });
  it('does not flag different sizes, variants or family members', () => {
    expect(pairs(['AluStage 1m QUAD 290 Truss', 'AluStage 2m QUAD 290 Truss'])).toHaveLength(0);
    expect(pairs(['HEXA PLATFORM SCA-11 LEFT', 'HEXA PLATFORM SCA-11 RIGHT'])).toHaveLength(0);
    expect(pairs(['OV40 Base Plate', 'OV40 Cornerblock'])).toHaveLength(0);
    expect(pairs(['HD 4K Video Capture', 'Nexus 4K Capture Card'])).toHaveLength(0);
    expect(pairs(['Shure SM58', 'Shure SM57'])).toHaveLength(0);
  });
  it('is reported by the parser as a warning', () => {
    const p = parseInventoryRows([HEADER, ['1', 'Fuel 80Kva Diesel generator', 'Generator & Power', 1, 0, 'Daily', null], ['2', '80kva Generator', 'Generators', 1, 0, 'Daily', null], ['3', 'Dancefloor per m2', 'Dance Floor', 64, 0, 'Daily', null]]);
    expect(p.issues.filter((i) => i.code === 'POSSIBLE_NEAR_DUPLICATE')).toHaveLength(2);
    expect(p.issues.some((i) => i.code === 'QTY_UNIT_OF_MEASURE')).toBe(true);
    expect(p.blocking).toBe(false);
  });
});

describe('adjustable legs in the stage engine', () => {
  const s = (key: string, value: number): SpecSheet => ({ [key]: { key, value, unit: 'mm', status: 'ESTIMATED', source: { kind: 'name_parse' } } });
  const deck = stockItem({ itemId: 'd', product: 'Deck 2m x 1m', category: 'STAGE_DECK', qtyConfirmed: 60, specs: { ...s('deck_width_mm', 2000), ...s('deck_depth_mm', 1000) } });
  const legA = stockItem({ itemId: 'a', product: 'Leg 400-600mm', category: 'STAGE_LEG', qtyConfirmed: 300, specs: { ...s('leg_height_min_mm', 400), ...s('leg_height_max_mm', 600) } });
  const legB = stockItem({ itemId: 'b', product: 'Leg 600-900mm', category: 'STAGE_LEG', qtyConfirmed: 300, specs: { ...s('leg_height_min_mm', 600), ...s('leg_height_max_mm', 900) } });
  it('default height = closest achievable to 1.0 m (0.9 m with these legs)', () => {
    const r = generateDesign({ params: { ...defaultParams(), led: { ...defaultParams().led, enabled: false } }, venue: ballroom(), stock: [deck, legA, legB], relationships: [] });
    expect(r.scene.objects.find((o) => o.kind === 'stage')!.size.z).toBe(900);
    expect(r.bom.lines.find((l) => l.itemId === 'b')).toBeTruthy();
  });
  it('a 0.5 m stage uses the 400–600 mm legs', () => {
    const p = defaultParams();
    p.stage.heightMm = 500;
    p.led.enabled = false;
    const r = generateDesign({ params: p, venue: ballroom(), stock: [deck, legA, legB], relationships: [] });
    expect(r.validation.checks.find((c) => c.id === 'stage.legs')!.result).toBe('PASS');
    expect(r.bom.lines.find((l) => l.itemId === 'a')).toBeTruthy();
  });
  it('shaped platforms are never tiled into a rectangular stage', () => {
    const shaped = stockItem({ itemId: 'h', product: 'HEXA CURVED PLATFORM 2M X 1M', category: 'STAGE_DECK_SHAPED', qtyConfirmed: 60, specs: { ...s('deck_width_mm', 2000), ...s('deck_depth_mm', 1000) } });
    const r = generateDesign({ params: defaultParams(), venue: ballroom(), stock: [shaped, legA], relationships: [] });
    expect(r.validation.checks.find((c) => c.id === 'stage.decks')!.result).toBe('UNKNOWN');
  });
});
