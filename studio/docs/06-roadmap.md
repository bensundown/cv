# Implementation roadmap

Legend: ✅ done in this delivery · ◐ partly · ☐ next

## Phase 1 — Working foundation
✅ App shell, branded UI · ✅ auth, roles, sessions, audit · ✅ inventory upload/preview/apply/rollback/history ·
✅ quantity verification · ✅ equipment KB (models, specs, relationships) · ✅ PDF/image plan upload ·
✅ scale calibration with uncertainty · ✅ venue geometry versions · ✅ scene model v1.

## Phase 2 — First complete workflow
✅ Brief → params (rule-based) · ✅ stage + LED from confirmed stock · ✅ FOH + seating · ✅ 2D plan, 3D, LED plan ·
✅ native render capture · ✅ vector PDF, CSV, scene JSON · ✅ validation report & assumption register ·
✅ conversational revisions (command set) · ✅ human sign-off records ·
☐ **2b:** LLM brief/revision interpreter (decision D-004) · ☐ venue research from public sources ·
☐ verify against your real workbook and one real verified venue plan (benchmark project B-1).

## Phase 3 — Equipment intelligence (started)
✅ Lighting first pass: roles, selection, placement on deck, DMX patch, console check, power, commands (“more dramatic”, “fewer moving heads”, “8 moving heads”, “4 washes”, “add/remove lighting”), 3D beams, plan symbols, PDF patch page.

✅ Audio first pass: PA concept (mains/subs/stacking), console + stage box pairing, snake length, wireless, commands (“add/remove sound”, “4 boxes per side”, “2 subs per side”, “use point source / line arrays”, “4 handheld mics”).
✅ Spec library: researched manufacturer specs with sources, auto-applied, self-correcting.
✅ Stage access: stairs matched to stage height (front + side), stair handrails, edge-protection rails on rear/sides (human sign-off), clash checks; commands “3 stairs”, “no stairs”, “no edge protection”.

- Spec enrichment workflow from manufacturer documents (upload datasheet → extract → reviewer verifies).
- Relationship templates per family (AluStage decks/legs, Leyard cabinets/frames, Novastar outputs, QUAD 290/OV40 connectors).
- Lighting next: front-light positions on stands/truss, DMX distribution schedule, fixture dimensions/weights for loads; audio (FBT Muse/Horizon arrays, preliminary coverage
  concepts, A&H console ↔ stage-box compatibility), video signal paths, truss assemblies with connector validation.
- Cable & connection schedules, preliminary power summary per distro.
- 3D asset library: parametric + glTF with verified bounding boxes.

## Phase 4 — Historical intelligence
Project archive ingestion (PDF plans, renders, photos, equipment lists), extraction with human correction,
"proposed vs installed" separation, pgvector multimodal retrieval, approved-reference marking. RAG first.

## Phase 5 — Advanced visualisation
Path-traced renders (three-gpu-pathtracer or Blender worker), fixture beams/gobos, materials library, direct
scene editing as an op log replayed by the generator, presentation mode.

## Phase 6 — Production automation
Constraint solver for layouts and alternatives (OR-Tools/CP-SAT or custom), budget optimisation once pricing is
trusted, external hire recommendations (clearly labelled), approval workflows, DXF/IFC/glTF exports, quotation integration.

## Immediate next steps
1. Import the real `SNI_Inventory_List_2026-11-03.xlsx`; fix any column/format surprises; review category guesses.
2. Confirm owned quantities for LED, processors, decks and legs.
3. Enter verified specs for the Leyard 2.6 mm cabinet (pixels, max power, weight, depth) and Novastar VX600/VX1000/VX2000Pro.
4. Record deck→leg and cabinet→mounting relationships from AluStage/Leyard documentation.
5. Calibrate one official venue plan with a perpendicular check → first VERIFIED-geometry benchmark.
