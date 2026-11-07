# Open questions

## Blocking for real use
1. ~~Inventory workbook~~ — received 2026-11-07 and validated: 307 records, 35 groups, all 7 columns mapped, no
   blocking errors. Findings that need a decision from you:
   - **Near-duplicates:** "Allen & Heath CQ-18T" (Audio Accessories, qty 0) vs the CQ-18T mixer in Sound Desks (qty 2);
     "Fuel 80Kva Diesel generator" vs "80kva Generator"; "Epson 16000 lm Laser Projector" (qty 0) vs the EB-PU2216B;
     possibly "Beamz MHL 1940" vs "Beamz Nereid 1940". Same item twice, or different?
   - **Two lighting groups** ("Lighting" and "Lights") — keep both (preserved either way)?
   - **Per-unit-of-measure items** ("Dancefloor per m2", "Stage Facings per meter", "ABS … per sheet"): quantity is m²/m/sheets.
   - **Packages / services** (DJ packages, "The Keynote Killer…", COC certificates, consumables) are classified as
     non-equipment and will never be allocated.
2. **AI provider and data policy (D-004)** — may client briefs be sent to an external LLM API? Which provider/region?
3. **Manufacturer / venue research authorisation** — may the system fetch public manufacturer datasheets and venue
   pages automatically, or should research be human-uploaded documents only for now?

## Needed for technical mode
4. Who are the technical reviewers (people allowed to mark specs/relationships VERIFIED and sign off disciplines)?
5. **AluStage leg rule (now the main staging blocker):** with the labelled default of 4 legs per deck, a 12 × 6 m stage
   needs 144 × 600–900 mm legs (134 in the file). If AluStage legs are shared at deck corners the real number is far lower.
   Also: are the "400-600mm" / "600-900mm" legs telescopic (any height in range), and does the range include the deck thickness?
   No owned leg reaches 1.0 m, so stages default to 0.9 m.
6. LED mounting: which ground-stack / flying hardware is owned for the Leyard 2.6 mm and 3.9 mm cabinets?
7. Standard event power assumption: typical supply (e.g. 3-phase 32 A CEE / 63 A) and planning factor to use.
8. Preferred standard viewing/clearance rules (stage-front clearance, table pitch, FOH size) — currently labelled defaults.

## Product direction
9. Hosting region/provider (D-005) and whether staff access from tablets on-site needs offline mode.
10. Should the product move to its own private repository (recommended)?
11. VAT treatment of rental rates in the workbook (inclusive/exclusive) — currently "unknown", not assumed.
