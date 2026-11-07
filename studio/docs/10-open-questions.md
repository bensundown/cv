# Open questions

## Blocking for real use
1. ~~Inventory workbook~~ — received 2026-11-07 and validated: 307 records, 35 groups, all 7 columns mapped, no
   blocking errors. Findings that need a decision from you:
   - **Near-duplicates:** ✅ answered for Epson 16 000 lm laser (same item, 2 owned) and CQ-18T (same item, 2 owned) —
     mark them in the app (Inventory → filter “Possible / marked duplicates”). Still open: "Fuel 80Kva Diesel generator"
     vs "80kva Generator", and "Beamz MHL 1940" vs "Beamz Nereid 1940".
   - **Two lighting groups** ("Lighting" and "Lights") — keep both (preserved either way)?
   - **Per-unit-of-measure items** ("Dancefloor per m2", "Stage Facings per meter", "ABS … per sheet"): quantity is m²/m/sheets.
   - **Packages / services** (DJ packages, "The Keynote Killer…", COC certificates, consumables) are classified as
     non-equipment and will never be allocated.
2. **AI provider and data policy (D-004)** — may client briefs be sent to an external LLM API? Which provider/region?
3. ✅ **Manufacturer research authorised** (owner, 2026-11-07). Researched specs live in the spec library
   (`packages/core/src/equipment/spec-library.ts`), applied on import and via Inventory → “Apply spec library”.
   Direct fetch of novastar.tech / leyardeurope.eu was blocked by this environment's network allowlist; values were taken
   from search excerpts of the cited documents and are PROVISIONAL/ESTIMATED until a reviewer checks them.
   ✅ Leyard 2.6 mm panels run from the Novastar VX processors (owner, 2026-11-07) — relationship library.
   ✅ Samson SE50/SE60 headsets are used with Sennheiser bodypacks (with Samson's Sennheiser 3.5 mm connector).
   Still needed: (a) is the Leyard 2.6 mm panel the **LN2.6** (cabinet label)? (c) DMX modes you run on the Beamz fixtures.

## Needed for technical mode
4. Who are the technical reviewers (people allowed to mark specs/relationships VERIFIED and sign off disciplines)?
5. ✅ **Leg rule: 4 legs per deck** (owner, 2026-11-07) — record it once via any deck's equipment page → Add relationship →
   REQUIRES · any STAGE_LEG · 4 · “Apply to every STAGE_DECK model”. Without a stated height, stages default to the highest
   height the confirmed legs fully support (0.6 m for a 12 × 6 m stage with the current file; 0.9 m needs 10 more 600–900 mm legs).
   Still open: are the 400–600 / 600–900 mm legs telescopic, and does the range include deck thickness?
6. LED mounting: how many Leyard 2.6 mm cabinets does one “LN Led Screen Hanging And Stacking Frame” carry, and which
   feet / bracing pipes / low-profile legs go with a ground-stacked wall? (Needed for the LED mounting check.)
7. Standard event power assumption: typical supply (e.g. 3-phase 32 A CEE / 63 A) and planning factor to use.
8. Preferred standard viewing/clearance rules (stage-front clearance, table pitch, FOH size) — currently labelled defaults.

## Product direction
9. Hosting region/provider (D-005) and whether staff access from tablets on-site needs offline mode.
10. Should the product move to its own private repository (recommended)?
11. VAT treatment of rental rates in the workbook (inclusive/exclusive) — currently "unknown", not assumed.
