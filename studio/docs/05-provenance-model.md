# Source provenance and verification model

## Statuses (ordered)
| Status | Meaning | Typical sources |
|---|---|---|
| **VERIFIED** | Confirmed against an authoritative source by an authorised person | Manufacturer datasheet entered by reviewer; official venue drawing with checked calibration; attested physical count |
| **PROVISIONAL** | From a credible source but not independently checked | Client brief; uploaded plan with unconfirmed origin; single-dimension calibration |
| **ESTIMATED** | Inferred or defaulted | Name-parsed cabinet size; pitch-derived pixels; design defaults (table pitch, FOH size, 4 legs/deck) |
| **UNKNOWN** | Not available | Missing spec, ceiling not provided, no relationship |

`Sourced<T> = { value | null, status, source{kind, ref, url, documentDate, licence, note}, unit?, tolerance? }`.

## Rules
1. **Weakest-link propagation**: any derived value or check takes the weakest status of its inputs (`weakest()`).
2. **UNKNOWN is never used** even if a number is stored with it (engine + server enforcement).
3. **Nothing is promoted automatically.** Status rises only by a user action with a recorded source.
4. **VERIFIED needs a reference**: specs (reviewer + manufacturer doc/measurement), relationships (reviewer
   + evidence), venue sources (URL or origin note), room dimensions/ceiling (source note).
5. **History is append-only** so any earlier revision can be explained from its frozen inputs.

## Inventory quantities (stock policy D-016)
- `quantity_confirmation.qty_owned` = attested owned quantity (who, when, basis) → **hard limit**, status VERIFIED.
- Otherwise `qty_shown` (Current RMS "available to rent") is an **availability guideline** (PROVISIONAL): the engine may
  allocate up to `floor(qty_shown × (1 + headroom))`, default headroom 20 % (owner decision). Units above `qty_shown`
  are reported per line (`overGuideline`) and in the `inventory.availability` warning — "check availability before quoting".
- Blank, zero or fractional file quantities give nothing to allocate.
- The policy is a tenant setting (Inventory page) and is frozen into every revision's inputs.
- Bulk "accept file quantity" is allowed only for positive whole numbers and requires an explicit attestation;
  zero/blank/fractional quantities must be typed.
- A later file that disagrees with the confirmation is flagged (≠ file) but does not overwrite it.

## Calibration (drawings)
| State | Status |
|---|---|
| Not calibrated | UNKNOWN — tracing refused |
| One reference dimension, reference VERIFIED | PROVISIONAL |
| Reference not VERIFIED | ESTIMATED (cap) |
| + ≥1 passing **perpendicular** (≥30°) check, all references VERIFIED | VERIFIED |
| Any failing check | ESTIMATED + conflict flag |

Scale uncertainty: σ_rel = √((√2·u_click/d)² + (tol_ref/L_ref)²); checks pass within 2σ combined (≥1 % floor).
Traced geometry status = weakest(calibration status, source-document status). Scale ratios printed on a
drawing (1:100) are never better than ESTIMATED (PDFs are often rescaled).

## Design status
`overall = FAILS_CHECKS` if any hard check fails · `INCOMPLETE` if any hard check is UNKNOWN · else the
weakest data status of hard checks. Concept mode caps at PROVISIONAL. Human-required checks (structural/
rigging, electrical, crowd/egress/fire) never auto-pass; recorded sign-offs are shown but do not convert
the output into certification.
