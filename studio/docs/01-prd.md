# Product Requirements — Sound Ninja AI Design Studio

## 1. Purpose
Turn a client brief + venue into a technically coherent, inventory-constrained event production design,
with honest verification status, for Sound Ninja (AV, LED, lighting, staging, rigging; Pretoria, South Africa).
Private use first; architecture ready for multi-tenant SaaS.

## 2. Users and roles
| Role | Does |
|---|---|
| admin | everything, users, audit |
| inventory_manager | uploads inventory, confirms owned quantities, records specs |
| designer | venues, projects, revisions, renders, exports |
| technical_reviewer | marks specs/relationships VERIFIED, records human sign-off on safety disciplines |
| viewer | read-only (tablet review) |

## 3. Principles (acceptance-critical)
- One versioned authoritative scene per revision drives plan, 3D, render, schedule and report.
- Never invent dimensions, heights, ratings, suspension points, specs or stock. Unknown stays UNKNOWN.
- VERIFIED / PROVISIONAL / ESTIMATED / UNKNOWN on every fact, with source provenance.
- A design is VERIFIED only in technical mode when every hard check passes on VERIFIED data.
  Safety-critical approval remains human; no output claims certification.
- Never allocate more than the confirmed owned quantity; never present hire-ins as owned.

## 4. Modes
- **Concept**: fast, labelled provisional assumptions allowed; overall status capped at PROVISIONAL.
- **Technical**: same model; VERIFIED status only reachable with verified geometry/specs/quantities.

## 5. Functional requirements and status (✅ built in this slice · ◐ partial · ☐ not yet)

### 5.1 Platform
- ✅ Web app, desktop-first; responsive single-column layout below 1200 px for tablets.
- ✅ Accounts (scrypt), roles, sessions (HttpOnly, SameSite=Strict), CSRF header, rate-limited login, audit trail.
- ✅ Protected file storage (content-addressed, served only via authenticated, tenant-scoped route).
- ☐ SSO / MFA; multi-tenant onboarding (schema has `tenant_id`).

### 5.2 Inventory
- ✅ Upload XLSX/CSV any time; detect header row and columns (synonyms, reordering, title rows).
- ✅ Preserve every source cell, row number, RMS ID, original product group, currency (R → ZAR), charge period.
- ✅ Staged preview: new / changed / renamed (same RMS ID) / matched-by-name (review) / proposed removals.
- ✅ Blocking errors (duplicate RMS ID, missing product, no header) prevent apply; last valid inventory preserved.
- ✅ Proposed removals: keep (flag "not in file") or retire — never silent deletion.
- ✅ Immutable snapshots with version history and rollback (rollback = new snapshot).
- ✅ Data-quality flags: blank qty, zero qty, non-numeric, fractional, negative, zero rate, blank rate, possible duplicates across groups, data flags.
- ✅ Owned-quantity verification with attestation + basis text; history per item; confirmations survive re-imports by stable item identity; mismatch flag when the file later differs.
- ✅ Historical revisions keep their snapshot reference and frozen inputs.

### 5.3 Equipment knowledge base
- ✅ Product model per unique model string; engineering taxonomy alongside the original group; manufacturer guess.
- ✅ Spec values with unit, status, source, history; VERIFIED needs reviewer + documented source.
- ✅ Name-parsed hints (cabinet size, pitch, deck size, leg height) stored as ESTIMATED only.
- ✅ Relationship graph (11 types) with quantity rules, constraints, evidence, status.
- ◐ Used by engine today: REQUIRES/REQUIRES_ONE_OF (legs), MOUNTS_TO (LED hardware), CONTROLLED_BY/COMPATIBLE_WITH (LED↔processor).
- ☐ Manufacturer spec research (needs authorisation — see open questions), 3D asset library, signal/power graph traversal.

### 5.4 Venues
- ✅ Venue records, source documents with URL/date/licence/status, PDF/PNG/JPEG upload.
- ✅ Two-point calibration with uncertainty, independent perpendicular check, status rules.
- ✅ Trace room outline (any polygon) and obstructions; ceiling height with status and source.
- ✅ Typed rectangular dimensions as fallback (status/source required).
- ☐ Automated venue research from public sources; PDF vector extraction; ML plan interpretation; doors/egress.

### 5.5 Design
- ✅ Brief interpretation (deterministic rules) with evidence per extracted value.
- ✅ Stage: deck tiling (single type, rotation, filler strip), leg selection by height, quantity rules, nearest buildable sizes.
- ✅ LED: exact cabinet grid (6 × 3 m @ 500 mm → 72), resolution (spec or pitch-estimated, labelled), processor capacity/ports/dimensions, serpentine data chains, power estimate, mounting via relationships, ceiling check.
- ✅ FOH placement (auto/middle/back) on stage axis; round-table seating with wall/obstruction/FOH clearances; capacity check.
- ✅ Feasible redesign suggestions when stock or size fails.
- ✅ Conversational revisions (supported command set); honest refusal for unsupported asks.
- ☐ Lighting, audio, video, truss design; multi-option generation; budget optimisation; LLM interpretation.

### 5.6 Outputs
- ✅ Dimensioned 2D plan (SVG on screen, vector PDF at a standard scale with title block and scale bar).
- ✅ LED cabinet elevation with data chains; interactive 3D (Three.js) with saved viewpoints; native render capture into the revision.
- ✅ Equipment schedule (CSV, PDF), unresolved requirements, non-inventory items, indicative rental value with caveats.
- ✅ Validation report + assumption register + human sign-off records.
- ☐ Photoreal path-traced renders, DXF/IFC/glTF exports, cable/power schedules, client presentation deck.

## 6. Non-functional
- Reproducibility: revision stores frozen inputs + SHA-256 input hash; engine deterministic (tested).
- Precision: never display more precision than calibration supports; calibration uncertainty carried into the assumption register.
- Security: see `02-architecture.md §Security`.
- Performance target: design generation < 200 ms for 500-guest venues (currently ~5 ms in tests).
