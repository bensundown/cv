# Decision log

| ID | Decision | Status | Rationale / reversibility |
|---|---|---|---|
| D-001 | TypeScript end-to-end with a shared pure `@sn/core` engine; Python only for future document/CV/render workers | Made | One geometry implementation for browser, server and exports. Reversible per worker. |
| D-002 | PostgreSQL 16 + plain SQL migrations, JSONB for immutable revision results | Made | Integrity + history; PostGIS/pgvector available later. |
| D-003 | Stock allocation uses only user-attested owned quantities; file "available to rent" never allocated | Made (per brief) | Bulk accept requires attestation; zero/blank require typing. |
| D-004 | **AI provider for brief/revision interpretation** (e.g. Claude via API, Azure-hosted model, or none) | **Open — needs owner** | Cost, POPIA/data residency, quality. Rule-based interpreter ships meanwhile; interface ready. |
| D-005 | **Hosting region & provider** (AWS af-south-1 / Azure SA North / on-prem) | **Open — needs owner** | Data residency, cost, ops. App is a single container + Postgres + object store. |
| D-006 | **PDF vector extraction library** (PyMuPDF AGPL/commercial vs MIT alternatives) | **Open — needs owner** | Extraction quality vs licence obligations for future SaaS. |
| D-007 | Product lives in `studio/` inside the `cv` repo for now | Made, easy to move | Repo was a personal site; `studio/` is self-contained (own workspace, CI filter). Recommend a dedicated private repo. |
| D-008 | Stage height defaults to the available leg height closest to 1.0 m when the brief doesn't state it | Made | Labelled ESTIMATED in the assumption register. |
| D-009 | 4 legs per deck as a labelled design default until a REQUIRES relationship is recorded | Made | Real AluStage leg sharing differs; must be replaced by verified relationships. |
| D-010 | Rollback = new snapshot copying an old one | Made | Linear, auditable history; no destructive edits. |
| D-011 | Traced room geometry keeps user's vertex order (CW or CCW) | Made | Wall numbers must match what the user drew; engine handles both windings. |
| D-013 | Ordered, group-aware taxonomy rules; non-equipment categories (PACKAGE, SERVICE_OR_CONSUMABLE); STAGE_DECK_SHAPED never tiled; adjustable leg ranges | Made after the real workbook | Real names broke the first keyword rules (truss as decks, amps for 32 A cables). Categories remain ESTIMATED and user-correctable. |
| D-012 | Native renders captured in-browser from the scene (WebGL); photoreal deferred | Made | Honest labelling; path tracing in Phase 5. |
