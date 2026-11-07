# Sound Ninja AI Design Studio — engineering rules

Browser-based event production design for Sound Ninja (South Africa): brief → venue →
inventory-constrained stage/LED design → 2D/3D → PDF/CSV → validation report.
Docs live in `docs/` (PRD, architecture, data model, provenance, roadmap, risks, acceptance tests, decisions).

## Non-negotiable rules
1. **One authoritative model.** Every 2D plan, 3D view, PDF, schedule and report is rendered from a stored
   `design_revision.result` (scene + BOM + validation). Never compute geometry in a renderer.
   Renderers (`drawing/svg.ts`, `apps/server/src/pdf.ts`, `Scene3D.tsx`) only map coordinates.
2. **Deterministic engines own numbers.** Geometry, counts, stock allocation and validation live in
   `packages/core` as pure functions with tests. AI (future) may only propose `DesignParams` / `DesignOp`s.
3. **Never invent data.** No venue dimensions, ceiling heights, ratings, suspension points, manufacturer
   specs or stock quantities from assumption. Missing → `UNKNOWN`, reported, never silently defaulted.
   System design defaults (table pitch, FOH size…) are allowed only as `design_default` / `ESTIMATED`
   entries that appear in the assumption register.
4. **Provenance on everything.** Use `Sourced<T>` / `{status, source}`. Statuses: VERIFIED > PROVISIONAL >
   ESTIMATED > UNKNOWN. Derived values take the **weakest** input status (`weakest()`).
   A value recorded with status UNKNOWN is never used.
5. **Stock (owner policy D-016):** a user-confirmed owned quantity is a hard limit. Without one, the file
   quantity (RMS "available to rent") is an availability *guideline* and up to `headroomPct` (default 20 %)
   more may be allocated — tenant setting `stock_policy`, frozen into each revision. Units over the guideline
   are always flagged (`overGuideline`, `inventory.availability` check). Blank/zero file qty → nothing.
   The engine itself defaults to confirmed-only when no policy is passed. Never present hired-in equipment as owned.
6. **Not certification.** Nothing auto-generated is structural/electrical/rigging/crowd-safety approval.
   Safety checks are `HUMAN_REQUIRED`; concept mode is capped at PROVISIONAL.
7. **Don't fake features.** Unsupported requests get an honest reply (see `interpretCommand`). Unbuilt
   disciplines appear as `scope.*` UNKNOWN checks.
8. **Uncalibrated drawings are not dimensional references.** Calibration rules: `geometry/calibration.ts`.

## Conventions
- Units: millimetres (number) internally; convert only at boundaries (`units.ts`). Display metres.
- Plan coordinates: x east, y north (y up). PDF page points: origin top-left, y down (`pageToPlan`).
- Stage frame: origin on stage wall midpoint, `u` along wall, `n` into room. Room polygons may be CW or
  CCW — keep the user's vertex order (wall numbers W1…Wn must match what they traced).
- History is append-only: snapshots, spec values (`superseded_at`), quantity confirmations,
  relationships, revisions. Rollback = new snapshot copying an old one.
- Inventory: preserve every source cell (`raw`), row number, original product group, RMS ID.
  Zero qty, blank qty and zero rate are distinct issues. Zero rate ≠ free.
- Authorisation: permission map in `apps/server/src/auth.ts` (`PERMISSIONS`); always `requirePerm`.
  Tenant-scope every query (`tenant_id`). Mutations need header `X-SN-Request: 1` (CSRF).
- Pricing is informational only; no VAT assumption; no margin from rental rates.

## Commands
```
pnpm install
pnpm --filter @sn/core test          # unit tests (no DB)
pnpm --filter @sn/server test        # API integration tests (needs Postgres, TEST_DATABASE_URL)
pnpm typecheck
pnpm --filter @sn/web build
node e2e/smoke.mjs http://127.0.0.1:8787 ./e2e-output   # browser e2e on an EMPTY database
pnpm --filter @sn/server test:pglite  # API tests on the embedded PGlite database (offline mode)
pnpm desktop:build                    # offline Electron app for the current OS → release/desktop/
```
Offline mode: `apps/server/src/db-pglite.ts` adapts PGlite to the pg.Pool subset we use (single connection,
mutex-serialised). Keep SQL portable to both (no extensions beyond core). `apps/desktop/main.mjs` sets
STORAGE_DIR/WEB_DIST/MIGRATIONS_DIR/FONT_DIR before importing the bundled `embedded.mjs`.

Test data is synthetic and labelled as such. Never commit real client or inventory data to fixtures.
