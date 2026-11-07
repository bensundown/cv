/**
 * Equipment relationship graph. See docs/04-equipment-relationships.md.
 * Edges connect product models (or a model to an engineering category).
 * Only VERIFIED edges may justify a VERIFIED technical check; PROVISIONAL /
 * ESTIMATED edges can drive concept designs but are reported as such.
 */
import type { EngineeringCategory } from '../inventory/taxonomy.js';
import type { Confidence, Source } from '../provenance.js';

export const RELATIONSHIP_TYPES = [
  'REQUIRES',
  'REQUIRES_ONE_OF',
  'COMPATIBLE_WITH',
  'INCOMPATIBLE_WITH',
  'CONNECTS_TO',
  'MOUNTS_TO',
  'POWERED_BY',
  'CONTROLLED_BY',
  'COMPONENT_OF',
  'OPTIONAL_ACCESSORY',
  'ALTERNATIVE_TO',
] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

/** How many of the target are needed. */
export type QuantityRule =
  | { kind: 'per_unit'; ratio: number } // e.g. 4 legs per deck
  | { kind: 'per_n_units'; per: number; qty: number; rounding: 'ceil' } // e.g. 1 flybar per 2 cabinets wide
  | { kind: 'fixed'; qty: number } // e.g. 1 processor per system
  | { kind: 'none' };

export interface RelationshipTarget {
  /** A specific product model… */
  modelId?: string;
  /** …or any model of an engineering category (e.g. REQUIRES_ONE_OF STAGE_LEG). */
  category?: EngineeringCategory;
  /** For REQUIRES_ONE_OF: the alternative set. */
  oneOf?: string[];
}

export interface EquipmentRelationship {
  id: string;
  type: RelationshipType;
  fromModelId: string;
  to: RelationshipTarget;
  quantity: QuantityRule;
  /** Free-form constraints, e.g. { legHeightMm: 1000 } or { connector: 'etherCON' }. */
  constraints: Record<string, unknown>;
  evidence: Source[];
  status: Confidence;
}

export function requiredQuantity(rule: QuantityRule, units: number): number {
  switch (rule.kind) {
    case 'per_unit':
      return Math.ceil(units * rule.ratio - 1e-9);
    case 'per_n_units':
      return Math.ceil(units / rule.per - 1e-9) * rule.qty;
    case 'fixed':
      return units > 0 ? rule.qty : 0;
    case 'none':
      return 0;
  }
}

/** Relationships from a model of a given type, optionally to a category. */
export function edgesFrom(graph: EquipmentRelationship[], modelId: string, type: RelationshipType): EquipmentRelationship[] {
  return graph.filter((e) => e.fromModelId === modelId && e.type === type);
}

/** Is there a usable edge (any status) from → to-model of the given type? Returns the edge. */
export function findEdge(
  graph: EquipmentRelationship[],
  fromModelId: string,
  type: RelationshipType,
  toModelId: string,
): EquipmentRelationship | undefined {
  return graph.find(
    (e) => e.fromModelId === fromModelId && e.type === type && (e.to.modelId === toModelId || e.to.oneOf?.includes(toModelId)),
  );
}

export function isIncompatible(graph: EquipmentRelationship[], a: string, b: string): EquipmentRelationship | undefined {
  return graph.find(
    (e) => e.type === 'INCOMPATIBLE_WITH' && ((e.fromModelId === a && e.to.modelId === b) || (e.fromModelId === b && e.to.modelId === a)),
  );
}
