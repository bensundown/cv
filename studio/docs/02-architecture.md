# Architecture specification

## 1. Shape
```
 Browser (React + TS)                       API (Node 22, Fastify, TS)                 PostgreSQL 16
 ┌──────────────────────────┐   JSON/HTTPS  ┌───────────────────────────────┐   SQL   ┌──────────────┐
 │ Inventory / Equipment UI │──────────────▶│ routes (zod-validated)        │────────▶│ snapshots,   │
 │ Venue calibrator (pdf.js)│               │ auth · RBAC · audit · CSRF    │         │ specs, graph,│
 │ Workspace: SVG plan,     │◀──────────────│ inventory · venues · design   │         │ venues,      │
 │ Three.js 3D, chat        │               │ PDF export (pdfkit)           │         │ revisions…   │
 └────────────┬─────────────┘               └──────────────┬────────────────┘         └──────────────┘
              │      @sn/core (pure TS, shared by both)    │            object store (content-addressed;
              └────────────────────────────────────────────┘            local FS now → S3-compatible later)
 Future: Python worker (PDF vector extraction, CV/ML plan reading, Blender/Cycles rendering) via job queue.
```
`@sn/core` holds every deterministic rule: units, provenance, geometry, calibration, inventory parse/diff,
taxonomy, spec registry, relationship rules, LED/stage calculators, the design generator, brief/command
interpretation and drawing primitives. Browser and server run the **same code**, so the on-screen plan and
the PDF come from identical primitives and the server can re-run any revision from its frozen inputs.

## 2. Technology evaluation (decisions recorded in `09-decisions.md`)

| Concern | Choice | Why / alternatives considered |
|---|---|---|
| UI | React 19 + TypeScript + Vite | Largest talent pool, mature tooling. Alternatives (Svelte, Vue) fine but no advantage worth the hiring cost. |
| 3D | Three.js (MIT) | Most mature WebGL engine, glTF ecosystem, path-tracer add-ons for later. Babylon.js comparable (Apache-2.0); Unity/Unreal web = heavy, licence cost. |
| PDF viewing | pdf.js (Apache-2.0) | De-facto standard; gives page-point coordinates needed for calibration. |
| API | Node 22 + Fastify 5 | Lets the geometry engine be shared with the browser (single source of truth). Python would duplicate geometry in two languages. |
| Validation | zod | Runtime-checked request schemas. |
| Database | PostgreSQL 16 | Relational integrity for snapshots/history, JSONB for scenes, `pgcrypto`; PostGIS and pgvector available when venue spatial queries and multimodal retrieval arrive (Phase 4). |
| SQL access | `pg` + hand-written SQL migrations | Transparent, no ORM lock-in; migrations are plain files run in order (`schema_migration`). |
| Spreadsheet | ExcelJS (MIT) + PapaParse (MIT) | SheetJS on npm is stale with known CVEs; its maintained build is off-registry. |
| PDF export | PDFKit (MIT) | Vector output, embedded TTF fonts. |
| Docs/CV/ML (future) | Python worker: PyMuPDF (AGPL — **licence decision needed**) or pdfplumber/pdfminer (MIT), OpenCV, ezdxf | Vector extraction quality vs licence; see open questions. |
| Rendering (future) | three-gpu-pathtracer in browser or Blender Cycles worker (GPL tool, output unrestricted) | Physically based photoreal renders from the same scene. |
| AI (future) | LLM via API behind `BriefInterpreter` interface; RAG over project archive (pgvector) | AI proposes `DesignParams`/`DesignOp`; deterministic code validates and applies. Provider decision pending (cost, data residency). |
| Jobs (future) | pg-boss (Postgres-backed queue) | No extra infrastructure until volume justifies Redis/SQS. |

## 3. Data flow of a design
1. `POST /projects` → brief parsed (`parseBrief`) → `DesignParams` with provenance.
2. `createRevision`: loads **current** inventory snapshot + confirmed quantities + specs + relationships +
   latest venue geometry → freezes them into `DesignContext` → `generateDesign(ctx)` → stores params,
   frozen inputs, SHA-256 of canonical JSON, result, overall status (one transaction, advisory-locked per project).
3. Clients fetch the revision result (never the frozen inputs) and render plan/3D/LED views locally.
4. Messages → `interpretCommand` → `DesignOp[]` → `applyOps` → new revision (parent link = branch history).
5. Exports render the stored result; they never regenerate.

## 4. Security
- Passwords: scrypt (N=2^15), per-user salt, timing-safe compare. Login and setup rate-limited.
- Sessions: 256-bit random token in HttpOnly SameSite=Strict cookie; only SHA-256 stored; expiry.
- CSRF: mutations require `X-SN-Request: 1` (not settable cross-origin without CORS, which is off).
- RBAC: single `PERMISSIONS` map; every route calls `requirePerm`; every query tenant-scoped.
- Uploads: size limit, MIME sniffed from magic bytes + extension; stored by hash outside web root;
  served only through authenticated `/api/files/:id`; CSV exports guard against formula injection.
- First-run setup only when zero users; `SETUP_TOKEN` required on non-loopback deployments.
- Security headers: nosniff, frame DENY, referrer same-origin. Audit log for all state changes and failed logins.
- To do before internet exposure: HTTPS + `COOKIE_SECURE=true`, CSP header, MFA, backup/restore drill,
  dependency scanning in CI, penetration test.

## 5. Deployment (recommended)
Single region close to users (e.g. AWS af-south-1 Cape Town or Azure South Africa North for POPIA-friendly
data residency): one container for API+static web, managed PostgreSQL with PITR backups, S3-compatible
object storage with versioning. Estimated small-team cost: low hundreds of USD/month. Decision pending.
