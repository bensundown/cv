# Acceptance tests

Automated: `packages/core/test` (unit, 100), `apps/server/test` (API + Postgres, 17), `e2e/smoke.mjs` (browser).
All fixtures are synthetic.

## A. Inventory import
| ID | Criterion | Test |
|---|---|---|
| A1 | Documented headers mapped incl. `Qty shown ('available to rent')`, `Rental rate (R)` → ZAR; title rows skipped | core `column detection` |
| A2 | Original values, row numbers, raw cells preserved | core `inventory parse` |
| A3 | Blank qty, zero qty, zero rate reported as distinct issues; zero rate never treated as free | core `inventory parse`, rental summary excludes |
| A4 | Same product across groups → possible-duplicate warning; duplicate RMS ID → blocking | core + API |
| A5 | Preview shows added/changed/renamed/name-matched/removals before apply | core `inventory diff`, API lifecycle |
| A6 | Corrupt file → 422, current snapshot unchanged | API |
| A7 | Removals never silent: keep or retire per item | API |
| A8 | Rollback creates a new snapshot equal to the target; history retained | API |
| A9 | Confirmed owned quantities survive re-imports and renames (stable item id) | API |
| A10 | Historical revision unchanged after a later import | API |

## B. Geometry & calibration
| B1 | Length parsing/conversions; multiples tolerant to float error but not misfit | core `units` |
| B2 | Point-in-polygon, containment (incl. L-shaped room), overlap, ray cast, self-intersection | core `polygon` |
| B3 | Calibration status rules (PROVISIONAL / ESTIMATED cap / VERIFIED with perpendicular check / conflict) | core `calibration` |
| B4 | Tracing refused before calibration; page→plan conversion exact; vertex order preserved | API venue |
| B5 | E2E: calibrated A3 1:200 plan → scale within reported uncertainty (observed 70.67 vs 70.56 mm/pt, ±0.38 %) | e2e |

## C. Design engine
| C1 | 6 × 3 m @ 500 × 500 mm = **72 cabinets**; 10 × 3 m = 120 | core |
| C2 | Processor UNKNOWN without specs; FAIL when capacity/ports exceeded; PASS with ports and chains | core |
| C3 | Data chains cover each cabinet exactly once, serpentine | core |
| C4 | Power UNKNOWN without cabinet max power; circuits computed with it | core |
| C5 | 12 × 6 m from 2 × 1 m decks = 36; rotation; filler strip; null when impossible | core |
| C6 | Never allocate beyond confirmed quantity; shortfall shown; feasible redesign suggested | core |
| C7 | Unconfirmed quantities allocate 0 | core |
| C8 | REQUIRES / MOUNTS_TO relationships drive quantities | core |
| C9 | Ceiling too low → FAIL; unknown → UNKNOWN + assumption; value with UNKNOWN status not used | core |
| C10 | Deterministic: identical inputs → byte-identical output | core |
| C11 | Concept mode never VERIFIED; non-certification statement present | core |
| C12 | Rotated non-rectangular room works | core |
| C13 | Scene ↔ BOM consistency: OWNED cabinets in scene = allocated in BOM | core |

## D. Outputs & workflow
| D1 | Plan dimensions derive from scene (stage, LED, room extents) and SVG states its scale | core `drawing` |
| D2 | Brief example extracts guests, stage, LED, event type, aesthetic, venue name, requested disciplines | core |
| D3 | Revision commands from the brief list map to ops; unsupported asks refused honestly | core |
| D4 | Conversational change creates a new revision; previous unchanged | API |
| D5 | PDF is valid vector PDF; CSV includes schedule; scene JSON in mm | API, e2e |
| D6 | Human sign-off recorded without changing overall status | API |
| D7 | Audit events for import, confirmation, rollback, calibration, revision, export | API |

## L. Lighting
| L1 | Fixture role from recorded spec, else keyword guess marked ESTIMATED | core `lighting` |
| L2 | DMX patch sequential, no fixture straddles a universe; unknown footprint → no patch (UNKNOWN) | core |
| L3 | Fixture counts never exceed confirmed stock (reduced count → WARN + alternative) | core |
| L4 | Console must have ≥ required universes; unknown capacity → UNKNOWN; insufficient → FAIL | core |
| L5 | “More dramatic”, “fewer moving heads”, “remove the lighting” produce the expected revisions; defaults stay unpinned across unrelated edits | core, e2e |
| L6 | Enumerated spec values validated by the API | API |

## A2. Audio
| AU1 | Box count from throw (2–6/side), subs per 2 boxes, labelled ESTIMATED | core `audio` |
| AU2 | Subs from the same family as the mains; stacking bar matched by model token | core |
| AU3 | SQ → DX168 (SLink); CQ-18T → no stage box | core |
| AU4 | Wireless: receivers = transmitters; headsets from the bodypack's manufacturer | core |
| AU5 | Never exceeds the stock limit; shortfall FAILs the PA check | core |
| AU6 | Coverage & SPL always WARN “not modelled” | core |

## E. Security
| E1 | Unauthenticated → 401; missing CSRF header → 403; viewer cannot import (403) | API |
| E2 | Setup only once; cookies HttpOnly + SameSite=Strict | API |
| E3 | Wrong password → 401 + audited | API |

## Tolerances
- Lengths from calibrated plans: display to 0.01 m; acceptance = within reported 2σ calibration uncertainty
  (floor 1 %). Never present more precision than the calibration supports.
- Cabinet/deck tiling: exact within ±0.5 mm floating-point slack only.
- Benchmark B-1 (to do with real data): one real venue with an official dimensioned plan; traced room extents
  within ±0.5 % of official dimensions; stage/LED counts match a manual take-off.
