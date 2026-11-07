# Sound Ninja AI Design Studio

Private, browser-based event production design for Sound Ninja. Enter a client brief, pick a venue with
calibrated geometry, and the studio builds a stage + LED design from **confirmed owned** inventory, with a
dimensioned 2D plan, interactive 3D scene, LED cabinet plan, equipment schedule, vector PDF and a
validation report that says exactly what is verified and what is not.

**Status:** Phase 1 foundation + first Phase 2 vertical slice. See `docs/06-roadmap.md` for what is and
is not built.

## Offline desktop app (no internet, no database server)

The studio also runs as a desktop app on Windows, macOS and Linux. Everything stays on the computer:
an embedded database (PGlite — PostgreSQL compiled to WebAssembly) and local file storage in the
user's app-data folder (*File → Open data folder* to back it up). The window talks only to a server
inside the app on 127.0.0.1; nothing is exposed to the network.

- **Get the installer:** GitHub → *Actions* → **studio-desktop** → latest run → *Artifacts*
  (`…-Windows` = `.exe` installer, `…-macOS` = `.dmg`, `…-Linux` = `.AppImage`). Builds are unsigned:
  Windows SmartScreen → *More info → Run anyway*; macOS → right-click the app → *Open* (or
  `xattr -cr "/Applications/Sound Ninja Design Studio.app"`).
- **Build it yourself:** `pnpm install && pnpm desktop:build` (builds for the current OS into `release/desktop/`).
- **Run the server without PostgreSQL:** `DB_MODE=pglite PGLITE_DIR=./data/db pnpm start`.

## Run locally (server + PostgreSQL)

Requirements: Node 22+, pnpm 10, PostgreSQL 16 (or Docker).

```bash
cd studio
docker compose up -d db                 # or use an existing Postgres 16
cp .env.example .env                    # adjust if needed
pnpm install
pnpm --filter @sn/web build
set -a; . ./.env; set +a
pnpm start                              # http://127.0.0.1:8787 — migrations run automatically
```

For development with hot reload: `pnpm --filter @sn/server dev` and `pnpm --filter @sn/web dev`
(web on :5173 proxies `/api` to :8787).

First visit shows a one-time **setup** screen that creates the admin account. On any network-reachable
deployment, set `SETUP_TOKEN` first.

## Workflow (what works today)

1. **Inventory** → upload `SNI_Inventory_List_*.xlsx` (worksheet *Inventory*) or CSV → review the preview
   (column mapping, data-quality issues, new/changed/renamed/removed items) → apply as a snapshot.
2. **Stock policy** (Inventory page): by default the file's *Qty shown* is used as an availability guideline and
   designs may use up to 20 % more (flagged). Typing a confirmed owned quantity makes it a hard limit.
3. **Equipment** pages: correct categories, record datasheet specs with sources (cabinet pixels, max power,
   processor capacity, deck sizes…), add relationships (deck REQUIRES legs, LED MOUNTS_TO frame…).
4. **Venues**: upload a PDF/PNG/JPEG plan, record its provenance, calibrate from a known dimension plus a
   perpendicular check dimension, trace the room and columns, set ceiling height with its source.
5. **Projects** → new design from brief → revision 1. Revise conversationally ("make the stage 2 m
   wider", "move FOH to the back", "show me the view from the VIP tables"). Each change is a new
   immutable revision.
   Lighting: “make the lighting more dramatic”, “use fewer moving heads”, “8 moving heads”, “add/remove lighting”.
   Record `dmx_footprint_ch` and `max_power_w` on fixtures and `dmx_universes` on consoles to complete the checks.
6. Export **PDF** (plan, LED elevation, render, schedule, validation), **equipment CSV**, **scene JSON**.

## Tests

```bash
pnpm --filter @sn/core test     # 168 unit tests: geometry, calibration, import, diff, taxonomy, LED, staging, lighting, generator
TEST_DATABASE_URL=postgres://sn:sn@127.0.0.1:5432/sound_ninja_test pnpm --filter @sn/server test   # 21 API tests
node e2e/smoke.mjs http://127.0.0.1:8787 ./e2e-output   # browser e2e (empty DB)
```
