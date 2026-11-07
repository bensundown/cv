# Equipment relationship schema

Edges between **product models** (`equipment_relationship`), typed and evidenced. Code:
`packages/core/src/equipment/relationships.ts`.

```ts
EquipmentRelationship {
  id; type: RelationshipType;
  fromModelId;                                   // always a specific model
  to: { modelId? | category? | oneOf?: modelId[] };
  quantity: per_unit{ratio} | per_n_units{per, qty, rounding:'ceil'} | fixed{qty} | none;
  constraints: Record<string, unknown>;          // e.g. { legHeightMm: 1000 }, { per: 'column' }, { connector: 'etherCON' }
  evidence: Source[];                            // datasheet, manual page, test record
  status: VERIFIED | PROVISIONAL | ESTIMATED | UNKNOWN;
}
```

| Type | Meaning | Example | Engine use (this slice) |
|---|---|---|---|
| REQUIRES | Must be supplied with | Deck → any STAGE_LEG, 4 per deck | Leg quantity rule; otherwise 4/deck **design default (ESTIMATED)** |
| REQUIRES_ONE_OF | One of a set is required | Deck → {leg 0.6, leg 0.8, leg 1.0} | Restricts leg candidates |
| COMPATIBLE_WITH | Verified to work together | Panel ↔ processor | LED compatibility check |
| INCOMPATIBLE_WITH | Must not be combined | Outdoor cabinet ↔ indoor frame | Helper `isIncompatible` (checks Phase 3) |
| CONNECTS_TO | Signal/data/power link | Processor → fibre converter | Phase 3 signal paths |
| MOUNTS_TO | Physical mounting | Cabinet → ground-stack frame (1 per 2 columns) | LED mounting check + quantities |
| POWERED_BY | Power source/connector | Fixture → powerCON TRUE1 | Phase 3 power schedule |
| CONTROLLED_BY | Control relationship | Panel (receiving card) → processor | LED compatibility check |
| COMPONENT_OF | Part of an assembly | Stage box → console system | Phase 3 |
| OPTIONAL_ACCESSORY | Nice-to-have | Deck → skirt | Enhancements list (Phase 6) |
| ALTERNATIVE_TO | Substitutable | VX1000 ↔ VX2000Pro | Optimiser substitutions (Phase 6) |

## Rules
1. Only VERIFIED edges can contribute to a VERIFIED check; others propagate their status (weakest wins).
2. No edge = no assumption, except explicit labelled design defaults (currently only legs-per-deck), which
   appear in the assumption register.
3. VERIFIED requires a technical reviewer and evidence with a reference or URL (server-enforced).
4. Edges are superseded, never deleted, so historic revisions remain explainable.
5. Category targets (`to.category`) allow generic rules; model targets are preferred once known.

## Assembly logic implemented
- **Stage**: tiling → per-deck-type REQUIRES edge → leg candidates (restricted by edge) → leg height match
  (= stage height, or stage height − deck thickness when known) → quantity rule → allocation.
- **LED**: exact grid → cabinets allocated → resolution (spec, else pitch-estimated) → processor capacity/ports/
  max dimensions → CONTROLLED_BY / COMPATIBLE_WITH check → data chains → power (cabinet max W) → MOUNTS_TO
  hardware with quantity rule (`constraints.per = 'column'` supported) → ceiling clearance.
