/**
 * Equipment specification keys the deterministic engines understand.
 * Values are stored per product model with status + source (append-only history).
 */
import type { EngineeringCategory } from '../inventory/taxonomy.js';
import type { Confidence, Source, Sourced } from '../provenance.js';

export interface SpecKeyDef {
  key: string;
  label: string;
  unit: string;
  categories: EngineeringCategory[];
  /** 'number' (default) or an enumerated text value. */
  kind?: 'number' | 'enum';
  options?: string[];
  /** Engine checks that cannot complete without this value. */
  requiredFor: string[];
}

export const SPEC_KEYS: SpecKeyDef[] = [
  { key: 'cabinet_width_mm', label: 'Cabinet width', unit: 'mm', categories: ['LED_PANEL'], requiredFor: ['led.layout'] },
  { key: 'cabinet_height_mm', label: 'Cabinet height', unit: 'mm', categories: ['LED_PANEL'], requiredFor: ['led.layout'] },
  { key: 'cabinet_depth_mm', label: 'Cabinet depth', unit: 'mm', categories: ['LED_PANEL'], requiredFor: ['led.geometry'] },
  { key: 'pixel_pitch_mm', label: 'Pixel pitch', unit: 'mm', categories: ['LED_PANEL'], requiredFor: ['led.resolution'] },
  { key: 'pixels_w', label: 'Pixels per cabinet (width)', unit: 'px', categories: ['LED_PANEL'], requiredFor: ['led.resolution', 'led.processor'] },
  { key: 'pixels_h', label: 'Pixels per cabinet (height)', unit: 'px', categories: ['LED_PANEL'], requiredFor: ['led.resolution', 'led.processor'] },
  { key: 'max_power_w', label: 'Maximum power draw (per unit)', unit: 'W', categories: ['LED_PANEL', 'LIGHTING_FIXTURE'], requiredFor: ['led.power', 'lighting.power'] },
  { key: 'weight_kg', label: 'Weight', unit: 'kg', categories: ['LED_PANEL', 'STAGE_DECK', 'TRUSS', 'SPEAKER_LINE_ARRAY', 'SUBWOOFER', 'LIGHTING_FIXTURE'], requiredFor: ['load.summary'] },
  { key: 'total_pixel_capacity', label: 'Total pixel capacity', unit: 'px', categories: ['LED_PROCESSOR'], requiredFor: ['led.processor'] },
  { key: 'output_ports', label: 'Ethernet output ports', unit: 'ports', categories: ['LED_PROCESSOR'], requiredFor: ['led.processor'] },
  { key: 'pixels_per_port', label: 'Pixel capacity per port', unit: 'px', categories: ['LED_PROCESSOR'], requiredFor: ['led.processor'] },
  { key: 'max_width_px', label: 'Maximum output width', unit: 'px', categories: ['LED_PROCESSOR'], requiredFor: ['led.processor'] },
  { key: 'max_height_px', label: 'Maximum output height', unit: 'px', categories: ['LED_PROCESSOR'], requiredFor: ['led.processor'] },
  { key: 'deck_width_mm', label: 'Deck width (long side)', unit: 'mm', categories: ['STAGE_DECK'], requiredFor: ['stage.layout'] },
  { key: 'deck_depth_mm', label: 'Deck depth (short side)', unit: 'mm', categories: ['STAGE_DECK'], requiredFor: ['stage.layout'] },
  { key: 'deck_thickness_mm', label: 'Deck thickness', unit: 'mm', categories: ['STAGE_DECK'], requiredFor: ['stage.height'] },
  { key: 'rated_load_kn_m2', label: 'Rated distributed load', unit: 'kN/m²', categories: ['STAGE_DECK'], requiredFor: ['stage.load'] },
  { key: 'fixture_role', label: 'Fixture role', unit: 'role', kind: 'enum', options: ['MOVING_SPOT', 'MOVING_WASH', 'BEAM', 'WASH', 'PROFILE', 'PAR', 'STROBE'], categories: ['LIGHTING_FIXTURE'], requiredFor: ['lighting.selection'] },
  { key: 'dmx_footprint_ch', label: 'DMX footprint (channels, in the mode used)', unit: 'ch', categories: ['LIGHTING_FIXTURE'], requiredFor: ['lighting.dmx'] },
  { key: 'dmx_universes', label: 'DMX output universes', unit: 'universes', categories: ['LIGHTING_CONSOLE'], requiredFor: ['lighting.console'] },
  { key: 'leg_height_min_mm', label: 'Adjustable leg — minimum height', unit: 'mm', categories: ['STAGE_LEG'], requiredFor: ['stage.height'] },
  { key: 'leg_height_max_mm', label: 'Adjustable leg — maximum height', unit: 'mm', categories: ['STAGE_LEG'], requiredFor: ['stage.height'] },
  { key: 'leg_height_mm', label: 'Leg height', unit: 'mm', categories: ['STAGE_LEG'], requiredFor: ['stage.height'] },
];

export const SPEC_KEY_MAP = new Map(SPEC_KEYS.map((k) => [k.key, k]));

export interface SpecValue {
  key: string;
  value: number | string | null;
  unit: string;
  status: Confidence;
  source: Source;
}

export type SpecSheet = Record<string, SpecValue>;

/** Enumerated/text spec value (e.g. fixture_role). UNKNOWN-status values are ignored. */
export function specText(sheet: SpecSheet | undefined, key: string): Sourced<string> {
  const v = sheet?.[key];
  if (!v || typeof v.value !== 'string' || !v.value || v.status === 'UNKNOWN') return { value: null, status: 'UNKNOWN', source: { kind: 'derived', note: `Spec "${key}" not recorded` } };
  return { value: v.value, status: v.status, source: v.source };
}

export function spec(sheet: SpecSheet | undefined, key: string): Sourced<number> {
  const v = sheet?.[key];
  // A value whose status is UNKNOWN is never used, even if a number was recorded.
  if (!v || v.value === null || typeof v.value !== 'number' || Number.isNaN(v.value) || v.status === 'UNKNOWN') {
    return { value: null, status: 'UNKNOWN', source: { kind: 'derived', note: `Spec "${key}" not recorded` }, unit: SPEC_KEY_MAP.get(key)?.unit ?? '' };
  }
  return { value: v.value, status: v.status, source: v.source, unit: v.unit };
}
