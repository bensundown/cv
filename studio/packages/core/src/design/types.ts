import type { EquipmentRelationship } from '../equipment/relationships.js';
import type { SpecSheet } from '../equipment/specs.js';
import type { Pt } from '../geometry/polygon.js';
import type { EngineeringCategory } from '../inventory/taxonomy.js';
import type { Confidence, Source, Sourced } from '../provenance.js';

/** One inventory item as the design engine sees it (from the current snapshot). */
export interface StockItem {
  itemId: string;
  rmsId: string | null;
  product: string;
  productGroup: string | null;
  category: EngineeringCategory;
  modelId: string | null;
  /** Quantity owned as confirmed by a user. null = not confirmed → 0 allocatable. */
  qtyConfirmed: number | null;
  /** Quantity shown in the source file (provisional, "available to rent"). Never allocated. */
  qtyShown: number | null;
  rentalRate: number | null;
  chargePeriod: string | null;
  currency: string | null;
  specs: SpecSheet;
}

export interface Obstacle {
  id: string;
  label: string;
  polygon: Pt[];
  heightMm?: number | null;
}

export interface VenueGeometry {
  venueName: string;
  roomPolygon: Pt[]; // mm, plan coordinates
  roomStatus: Confidence;
  roomSource: Source;
  obstacles: Obstacle[];
  ceilingHeight: Sourced<number>;
  /** Index of the room edge the stage backs onto. */
  stageWallIndex: number;
  calibrationStatus: Confidence;
  calibrationRelUncertainty: number | null;
}

export type ParamStatus = { status: Confidence; source: Source };

export interface DesignParams {
  mode: 'concept' | 'technical';
  eventType: string | null;
  guests: number | null;
  aesthetic: string | null;
  stage: {
    widthMm: number;
    depthMm: number;
    heightMm: number | null; // null = choose from available leg heights
    upstageClearanceMm: number; // gap between back wall and stage rear (LED service access)
    offsetAlongWallMm: number;
    deckItemId: string | null; // user preference
    /** Number of stair units (1 = front; 2 = front + side; 3 = + other side; 4 = + second front). */
    stairs: number;
    edgeProtection: boolean;
    /** Edge protection is laid out when the stage is at least this high (design default; check local rules). */
    edgeProtectionAboveMm: number;
  };
  led: {
    enabled: boolean;
    widthMm: number;
    heightMm: number;
    bottomAboveStageMm: number;
    setbackFromStageRearMm: number;
    panelItemId: string | null;
    processorItemId: string | null;
  };
  foh: {
    position: 'auto' | 'middle' | 'back';
    widthMm: number;
    depthMm: number;
    rearClearanceMm: number;
  };
  seating: {
    style: 'rounds' | 'none';
    seatsPerTable: number;
    tableDiameterMm: number;
    pitchMm: number;
    frontClearanceMm: number;
    wallClearanceMm: number;
  };
  power: { voltageV: number; circuitA: number; planningFactor: number };
  lighting: {
    enabled: boolean;
    look: 'standard' | 'dramatic';
    /** Upstage moving-light count; null = engine default from stage width and look. */
    movingHeads: number | null;
    /** Downstage wash count; null = engine default. */
    stageWashes: number | null;
    consoleItemId: string | null;
  };
  audio: {
    enabled: boolean;
    system: 'auto' | 'line_array' | 'point_source';
    /** Main boxes per side; null = rule of thumb from throw distance. */
    boxesPerSide: number | null;
    subsPerSide: number | null;
    wirelessHandheld: number;
    wirelessHeadset: number;
    consoleItemId: string | null;
  };
  /** Provenance for each parameter path, e.g. "stage.widthMm" → brief. */
  sources: Record<string, ParamStatus>;
}

export type Supply = 'OWNED' | 'SHORTFALL' | 'NOT_INVENTORY';

export interface SceneObject {
  id: string;
  kind: 'room' | 'obstacle' | 'stage' | 'stage_deck' | 'led_wall' | 'led_cabinet' | 'foh' | 'table' | 'zone' | 'light_fixture' | 'speaker' | 'audio_device' | 'stage_accessory';
  label: string;
  /** Footprint centre (plan mm) and base elevation z (mm above finished floor). */
  position: { x: number; y: number; z: number };
  rotationDeg: number;
  /** Local extents: x along the object's width, y depth, z height (mm). */
  size: { x: number; y: number; z: number };
  polygon?: Pt[];
  itemId?: string;
  supply?: Supply;
  status: Confidence;
  meta?: Record<string, unknown>;
}

export interface Scene {
  schemaVersion: 1;
  units: 'mm';
  venue: { name: string; roomPolygon: Pt[]; obstacles: Obstacle[]; ceilingHeight: Sourced<number> };
  /** Stage frame: origin on the stage wall, x along the wall, y into the room. */
  frame: { origin: Pt; u: Pt; n: Pt; rotationDeg: number };
  objects: SceneObject[];
  ledPlan: LedPlan | null;
  /** Optional for revisions generated before lighting existed. */
  lightingPlan?: LightingPlan | null;
  /** Named camera viewpoints (mm). */
  viewpoints: { id: string; label: string; eye: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } }[];
}

export interface LedPlan {
  panelItemId: string;
  product: string;
  cols: number;
  rows: number;
  cabinetWidthMm: number;
  cabinetHeightMm: number;
  resolution: Sourced<{ w: number; h: number }>;
  /** Data chains: each array lists cabinet ids in cable order for one processor output. */
  dataPorts: string[][] | null;
  processorItemId: string | null;
  powerTotalW: Sourced<number>;
  circuits: Sourced<number>;
}

export interface DmxPatchEntry {
  fixtureId: string;
  itemId: string;
  product: string;
  universe: number; // 1-based
  address: number; // 1–512
  footprint: number;
}

export interface LightingPlan {
  look: 'standard' | 'dramatic';
  patch: DmxPatchEntry[] | null; // null when any footprint is unknown
  universes: number | null;
  consoleItemId: string | null;
  totalPowerW: Sourced<number>;
}

export type CheckResult = 'PASS' | 'FAIL' | 'WARN' | 'UNKNOWN' | 'HUMAN_REQUIRED';

export interface Check {
  id: string;
  title: string;
  discipline: 'venue' | 'staging' | 'led' | 'lighting' | 'audio' | 'foh' | 'seating' | 'safety' | 'inventory' | 'scope';
  severity: 'hard' | 'advisory';
  result: CheckResult;
  message: string;
  dataStatus: Confidence;
  inputs: { label: string; status: Confidence; note?: string }[];
}

export interface BomLine {
  itemId: string;
  rmsId: string | null;
  product: string;
  productGroup: string | null;
  category: EngineeringCategory;
  purpose: string;
  required: number;
  allocated: number;
  shortfall: number;
  qtyConfirmed: number | null;
  qtyShown: number | null;
  /** What the allocation limit was based on. */
  stockBasis: 'CONFIRMED' | 'FILE_GUIDELINE' | 'NONE';
  /** Units allocated above the file availability guideline (within the policy headroom). */
  overGuideline: number;
  quantityBasis: Confidence; // how certain the required count is
  rentalRate: number | null;
  chargePeriod: string | null;
  currency: string | null;
}

export interface UnresolvedRequirement {
  id: string;
  description: string;
  reason: string;
  candidates: string[];
}

export interface Assumption {
  id: string;
  text: string;
  status: Confidence;
  source: Source;
}

export interface DesignResult {
  scene: Scene;
  bom: { lines: BomLine[]; unresolved: UnresolvedRequirement[]; nonInventory: { description: string; qty: number; note: string }[]; rentalSummary: RentalSummary };
  validation: { checks: Check[]; overall: OverallStatus; humanApprovalsRequired: string[]; notCertification: string };
  assumptions: Assumption[];
  alternatives: string[];
}

export interface RentalSummary {
  byPeriod: { chargePeriod: string; currency: string | null; total: number; lines: number }[];
  excludedZeroOrBlankRate: number;
  caveats: string[];
}

export type OverallStatus = 'FAILS_CHECKS' | 'INCOMPLETE' | Confidence;

export interface DesignContext {
  /** Allocation policy; absent = confirmed owned quantities only. */
  stockPolicy?: { useFileQuantities: boolean; headroomPct: number };
  params: DesignParams;
  venue: VenueGeometry;
  stock: StockItem[];
  relationships: EquipmentRelationship[];
}
