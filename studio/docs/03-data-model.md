# Data model

Source of truth: `apps/server/migrations/*.sql`. Conventions: UUID keys, `timestamptz`, unit-suffixed
columns, `tenant_id` on top-level entities, append-only history (`superseded_at`) for attested facts.

## Entity map
```
tenant ─┬─ app_user ── user_session
        ├─ audit_event
        ├─ stored_file  (content-addressed blobs; sha256)
        │
        ├─ product_model ──┬─ spec_value          (key, value, unit, status, source, history)
        │                  ├─ asset_3d            (physical bbox + display appearance, separate)
        │                  └─ equipment_relationship (from → model | category | one-of; quantity rule, evidence, status)
        │
        ├─ inventory_item (stable identity; rms_id; → product_model; retired_at)
        │      └─ quantity_confirmation (qty_owned, basis, who, when; one current per item)
        ├─ inventory_import (staged file: parse_result + diff, status)
        └─ inventory_snapshot (version, is_current, parent, kind import|rollback)
               └─ inventory_snapshot_item (verbatim source values + raw cells + issues, in_source_file)
        │
        ├─ venue ──┬─ venue_source (upload/url, document date, licence, status)
        │          ├─ venue_plan (page, calibration input+result, calibration_status)
        │          └─ venue_geometry_version (room polygon mm, obstacles, ceiling Sourced, status)
        │
        └─ project ──┬─ design_revision (params, frozen inputs, input_hash, result, overall_status, parent)
                     │       ├─ render_output (native_realtime | pathtraced | generative_enhanced)
                     │       └─ approval (discipline, decision, user)
                     └─ project_message (user/assistant, → revision)
```

## Separation requirements mapped
| Requirement | Entity |
|---|---|
| Source inventory records | `inventory_snapshot_item` (verbatim + `raw`) |
| Normalised product models | `product_model` |
| Equipment specifications | `spec_value` |
| Equipment relationships | `equipment_relationship` |
| Physical/3D assets | `asset_3d` (table in place; library is Phase 3) |
| Inventory snapshots | `inventory_snapshot` |
| Venue sources / geometry | `venue_source`, `venue_plan`, `venue_geometry_version` |
| Projects / design revisions | `project`, `design_revision` |
| Scene objects | `design_revision.result.scene.objects` (JSONB, schemaVersion 1) |
| Validation results | `design_revision.result.validation` |
| Render outputs | `render_output` |
| Equipment schedules | `design_revision.result.bom` |
| Pricing | rate/period/currency on snapshot items only; separate from specs |

Scene objects are stored inside the immutable revision rather than as rows because a revision is an atomic,
reproducible artefact; Phase 5 scene editing will add a `scene_edit` op log that the generator replays.

## Scene schema (v1, millimetres)
`Scene { schemaVersion, units:'mm', venue{name, roomPolygon, obstacles, ceilingHeight}, frame{origin,u,n,rotationDeg},
objects[], ledPlan, viewpoints[] }` — `SceneObject { id (deterministic), kind, label, position{x,y,z}, rotationDeg,
size{x,y,z}, polygon?, itemId?, supply OWNED|SHORTFALL|NOT_INVENTORY, status, meta }`. Full types:
`packages/core/src/design/types.ts`.

## Identity rules
- Inventory items match across imports by RMS ID; name-only matches require explicit user acceptance.
- Product models are keyed by (tenant, manufacturer, exact model string, variant) — never generalised across variants.
- Revisions reference the snapshot and geometry version they used, plus a frozen copy of every input.
