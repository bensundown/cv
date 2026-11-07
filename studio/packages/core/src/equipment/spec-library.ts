/**
 * Researched specification library (public manufacturer information).
 *
 * Applied to product models whose name matches an entry. Library values replace
 * name-parsed hints but NEVER a value a person entered. Nothing here is VERIFIED:
 * a technical reviewer must check each value against the physical item/datasheet.
 *
 * Status rules used:
 *  - PROVISIONAL: stated by the manufacturer document cited.
 *  - ESTIMATED: derived (e.g. watts from a current rating) or model identity inferred.
 *
 * Researched 2026-11-07 via web search excerpts of the cited documents (direct fetch of
 * novastar.tech / leyardeurope.eu was not possible from the research environment).
 */
import type { Confidence } from '../provenance.js';

export interface LibrarySpec {
  key: string;
  value: number | string;
  status: Exclude<Confidence, 'VERIFIED' | 'UNKNOWN'>;
  ref: string;
  url: string;
  note?: string;
}

export interface LibraryEntry {
  id: string;
  /** Case-insensitive pattern tested against the inventory product name. */
  match: RegExp;
  manufacturer: string;
  model: string;
  specs: LibrarySpec[];
}

const NOVA_VX1000 = { ref: 'NovaStar VX1000 All-in-One Controller Specifications V1.6.0 (2024-07)', url: 'https://oss.novastar.tech/uploads/2024/07/VX1000-All-in-One-Controller-Specifications-V1.6.0.pdf' };
const NOVA_VX1000_MAN = { ref: 'NovaStar VX1000 All-in-One Controller User Manual V1.5.0', url: 'https://oss.novastar.tech/uploads/2025/06/VX1000-All-in-One-Controller-User-Manual-V1.5.0.pdf' };
const NOVA_VX600 = { ref: 'NovaStar VX600 All-in-One Controller Specifications V1.3.1', url: 'https://oss.novastar.tech/uploads/2022/11/VX600-All-in-One-Controller-Specifications-V1.3.1.pdf' };
const NOVA_VX2000P = { ref: 'NovaStar VX2000 Pro All-in-One Controller Specifications V1.0.1 (2024-12)', url: 'https://oss.novastar.tech/uploads/2024/12/VX2000-Pro-All-in-One-Controller-Specifications-V1.0.1.pdf' };
const LN_FAMILY = { ref: 'Leyard LN Family Rental LED Display (LN/LN-R/LN-C) datasheet; Leyard Europe LN Series page', url: 'https://www.ledwallcentral.com/specs/led_wall_series_1360.pdf' };
const BEAMZ_75B = { ref: 'beamZ Fuze75B LED Beam Moving Head — product page', url: 'https://www.beamzlighting.com/product/fuze75b-led-beam-moving-head/' };
const BEAMZ_2812 = { ref: 'beamZ Fuze2812 LED Wash Moving Head with Zoom — product page', url: 'https://www.beamzlighting.com/product/fuze2812-led-wash-moving-head-with-zoom/' };

export const SPEC_LIBRARY: LibraryEntry[] = [
  {
    id: 'novastar-vx1000',
    match: /\bvx\s?1000\b(?!\s*pro)/i,
    manufacturer: 'Novastar',
    model: 'VX1000',
    specs: [
      { key: 'total_pixel_capacity', value: 6_500_000, status: 'PROVISIONAL', ...NOVA_VX1000 },
      { key: 'output_ports', value: 10, status: 'PROVISIONAL', ...NOVA_VX1000, note: '10 × Gigabit Ethernet outputs' },
      { key: 'pixels_per_port', value: 650_000, status: 'ESTIMATED', ...NOVA_VX1000_MAN, note: '= 6.5 M ÷ 10 ports; manual states Ethernet port 1 ≤ 650,000 px (8-bit). Halves at 10/12-bit.' },
      { key: 'max_width_px', value: 10_240, status: 'PROVISIONAL', ...NOVA_VX1000 },
      { key: 'max_height_px', value: 8_192, status: 'PROVISIONAL', ...NOVA_VX1000 },
    ],
  },
  {
    id: 'novastar-vx600',
    match: /\bvx\s?600\b(?!\s*pro)/i,
    manufacturer: 'Novastar',
    model: 'VX600',
    specs: [
      { key: 'total_pixel_capacity', value: 3_900_000, status: 'PROVISIONAL', ...NOVA_VX600 },
      { key: 'output_ports', value: 6, status: 'PROVISIONAL', ...NOVA_VX600, note: '6 × Gigabit Ethernet outputs' },
      { key: 'pixels_per_port', value: 650_000, status: 'ESTIMATED', ...NOVA_VX600, note: '= 3.9 M ÷ 6 ports (per-port figure not stated in the base VX600 sheet). Halves at 10/12-bit.' },
      { key: 'max_width_px', value: 10_240, status: 'PROVISIONAL', ...NOVA_VX600 },
      { key: 'max_height_px', value: 8_192, status: 'PROVISIONAL', ...NOVA_VX600 },
    ],
  },
  {
    id: 'novastar-vx2000pro',
    match: /\bvx\s?2000\s?pro\b/i,
    manufacturer: 'Novastar',
    model: 'VX2000 Pro',
    specs: [
      { key: 'total_pixel_capacity', value: 13_000_000, status: 'PROVISIONAL', ...NOVA_VX2000P },
      { key: 'output_ports', value: 20, status: 'PROVISIONAL', ...NOVA_VX2000P, note: '20 × Gigabit Ethernet outputs' },
      { key: 'pixels_per_port', value: 650_000, status: 'PROVISIONAL', ...NOVA_VX2000P, note: 'Single port loading capacity 650,000 px (8-bit)' },
      { key: 'max_width_px', value: 16_384, status: 'PROVISIONAL', ...NOVA_VX2000P },
      { key: 'max_height_px', value: 8_192, status: 'PROVISIONAL', ...NOVA_VX2000P },
    ],
  },
  {
    id: 'leyard-ln2.6',
    match: /leyard.*2[.,]6\s?mm.*500\s?mm\s?x\s?500\s?mm|\bln\s?2[.,]6\b/i,
    manufacturer: 'Leyard',
    model: 'LN2.6 (identity inferred)',
    specs: [
      { key: 'pixels_w', value: 192, status: 'ESTIMATED', ...LN_FAMILY, note: 'Model inferred as LN2.6 (inventory lists LN hanging/stacking frames) — confirm the cabinet label' },
      { key: 'pixels_h', value: 192, status: 'ESTIMATED', ...LN_FAMILY, note: 'Model inferred as LN2.6 — confirm the cabinet label' },
      { key: 'max_power_w', value: 150, status: 'ESTIMATED', ...LN_FAMILY, note: '600 W/m² max (≈50 W typical). LN2.6-R / -C variants differ — confirm model' },
      { key: 'weight_kg', value: 7.5, status: 'ESTIMATED', ...LN_FAMILY, note: 'LN2.6; LN2.6-R 6.5 kg, LN2.6-C 8.2 kg — confirm model' },
      { key: 'cabinet_depth_mm', value: 79, status: 'ESTIMATED', ...LN_FAMILY, note: 'Model inferred as LN2.6 — confirm' },
    ],
  },
  {
    id: 'beamz-fuze75b',
    match: /\b(fuze\s?)?75b\b/i,
    manufacturer: 'Beamz',
    model: 'Fuze75B',
    specs: [
      { key: 'fixture_role', value: 'BEAM', status: 'PROVISIONAL', ...BEAMZ_75B, note: '75 W white LED beam moving head, 2° beam' },
      { key: 'dmx_footprint_ch', value: 12, status: 'PROVISIONAL', ...BEAMZ_75B, note: 'Extended 12-ch mode assumed (10-ch mode also available) — set to the mode you run' },
      { key: 'max_power_w', value: 192, status: 'ESTIMATED', ...BEAMZ_75B, note: 'Derived: manufacturer lists 1.6–0.8 A at 100–240 VAC → 0.8 A × 240 V ≈ 192 VA (worst case)' },
    ],
  },
  {
    id: 'beamz-fuze2812',
    match: /\b(fuze\s?)?2812\b/i,
    manufacturer: 'Beamz',
    model: 'Fuze2812',
    specs: [
      { key: 'fixture_role', value: 'MOVING_WASH', status: 'PROVISIONAL', ...BEAMZ_2812, note: '28 × 12 W RGBWA-UV moving head wash with zoom' },
      { key: 'dmx_footprint_ch', value: 45, status: 'PROVISIONAL', ...BEAMZ_2812, note: 'Extended 45-ch mode assumed (21-ch mode also available) — set to the mode you run' },
      { key: 'max_power_w', value: 235, status: 'ESTIMATED', ...BEAMZ_2812, note: 'Derived: manufacturer lists 2.14–0.98 A at 100–240 VAC → 0.98 A × 240 V ≈ 235 VA (worst case)' },
    ],
  },
  {
    id: 'beamz-lcb14',
    match: /\blcb-?\s?14\b(?!c)/i,
    manufacturer: 'Beamz',
    model: 'LCB14 Hybrid LED Bar',
    specs: [
      { key: 'fixture_role', value: 'WASH', status: 'PROVISIONAL', ref: 'beamZ LCB14 Hybrid LED BAR Pixel Control — product page', url: 'https://www.beamzlighting.com/product/lcb14-hybrid-led-bar-pixel-control/', note: '1 m LED bar: 14 × 3 W warm white + 56 SMD RGB' },
      { key: 'dmx_footprint_ch', value: 12, status: 'PROVISIONAL', ref: 'beamZ LCB14 Hybrid LED BAR Pixel Control — product page', url: 'https://www.beamzlighting.com/product/lcb14-hybrid-led-bar-pixel-control/', note: '12-ch mode assumed (6, 8, 12 or 60-ch pixel mode available) — set to the mode you run' },
      { key: 'max_power_w', value: 100, status: 'ESTIMATED', ref: 'beamZ LCB14 Hybrid LED BAR Pixel Control — product page', url: 'https://www.beamzlighting.com/product/lcb14-hybrid-led-bar-pixel-control/', note: 'Derived: manufacturer lists 1.0–0.4 A at 100–240 VAC → ≈100 VA worst case (a retailer lists 60 W)' },
    ],
  },
  {
    id: 'chamsys-mq50',
    match: /\bmq\s?50\b/i,
    manufacturer: 'ChamSys',
    model: 'MagicQ MQ50',
    specs: [{ key: 'dmx_universes', value: 6, status: 'PROVISIONAL', ref: 'ChamSys MagicQ MQ50 Compact Console cutsheet (710-005)', url: 'https://cdn.shopify.com/s/files/1/0009/6416/5668/files/710-005-_MagicQ-MQ50-Compact-Console-Cutsheet.pdf', note: '4 direct DMX outputs + Art-Net/sACN; some retailers list 8 universes' }],
  },
  {
    id: 'chamsys-quickq20',
    match: /quick\s?q-?\s?20\b(?!\s*\+)/i,
    manufacturer: 'ChamSys',
    model: 'QuickQ 20',
    specs: [{ key: 'dmx_universes', value: 2, status: 'ESTIMATED', ref: 'Retailer listings (ChamSys QuickQ 20 two-universe DMX lighting desk)', url: 'https://www.simplysoundandlighting.co.uk/products/chamsys-quickq20-two-universe-dmx-lighting-desk', note: 'Retailer figure; the QuickQ 20+ variant has 4 network universes' }],
  },
  {
    id: 'avolites-t3',
    match: /avo\w*.*\bt3\b/i,
    manufacturer: 'Avolites',
    model: 'T3',
    specs: [{ key: 'dmx_universes', value: 16, status: 'ESTIMATED', ref: 'Retailer listings (Avolites T3: 4 physical DMX outputs, 16 universes Art-Net/sACN)', url: 'https://www.simplysoundandlighting.co.uk/products/avolites-t3-portable-lighting-controller-16-universe-including-carry-case', note: 'Base 16 universes from the host PC (hardware dependent); 32/64 with Titan Net processors' }],
  },
  {
    id: 'fbt-muse210la',
    match: /^(?!.*\b(bar|stak\w*|stack\w*|fly\w*|flying|trolley|cover)\b).*\bmuse\s?210\s?la\b/i,
    manufacturer: 'FBT',
    model: 'MUSE 210LA',
    specs: [{ key: 'weight_kg', value: 38.2, status: 'PROVISIONAL', ref: 'FBT MUSE 210 LA product page (net weight 38.2 kg)', url: 'https://www.fbt.it/?p=22728' }],
  },
  {
    id: 'fbt-muse218sa',
    match: /\bmuse\s?218\s?sa\b/i,
    manufacturer: 'FBT',
    model: 'MUSE 218SA',
    specs: [{ key: 'weight_kg', value: 99, status: 'PROVISIONAL', ref: 'FBT MUSE 218 SA product page (net weight 99 kg)', url: 'https://www.fbt.it/?p=22321', note: 'Designed for ground stacking with MUSE 210LA via the MS-F 210 bar' }],
  },
];

export function matchSpecLibrary(product: string, library: LibraryEntry[] = SPEC_LIBRARY): LibraryEntry[] {
  return library.filter((e) => e.match.test(product));
}

/** Relationship facts applied between matching models (owner confirmations and documented pairings). */
export interface LibraryRelationship {
  id: string;
  type: 'CONTROLLED_BY' | 'COMPATIBLE_WITH';
  from: RegExp;
  to: RegExp;
  status: Exclude<Confidence, 'VERIFIED' | 'UNKNOWN'>;
  ref: string;
}

export const RELATIONSHIP_LIBRARY: LibraryRelationship[] = [
  {
    id: 'leyard26-novastar',
    type: 'CONTROLLED_BY',
    from: /leyard.*2[.,]6\s?mm|\bln\s?2[.,]6\b/i,
    to: /\bnovastar\b.*\bvx\s?(600|1000|2000)/i,
    status: 'PROVISIONAL',
    ref: 'Owner confirmation 2026-11-07: Sound Ninja runs its Leyard 2.6 mm panels from its Novastar VX processors',
  },
];
