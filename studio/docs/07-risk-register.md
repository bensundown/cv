# Risk register

| # | Risk | L | I | Mitigation (built ✅ / planned ☐) | Owner |
|---|---|---|---|---|---|
| R1 | Photoreal output mistaken for engineering approval | M | H | ✅ status banner on every PDF page, "not certification" text, HUMAN_REQUIRED checks; concept mode capped at PROVISIONAL; ☐ watermark on renders | Product |
| R2 | RMS "available to rent" treated as owned stock → over-promising | H | H | Owner accepted guideline use +20 % (D-016). ✅ every guideline/over-guideline allocation flagged on design, PDF and CSV; confirmed quantities stay hard caps; policy switchable to confirmed-only | Inventory mgr |
| R3 | Real workbook differs from documented columns (merged headers, extra sheets, formulas) | M | M | ✅ header detection, synonyms, unmapped columns preserved, preview before apply; ☐ test with real file | Eng |
| R4 | Uncalibrated or rescaled PDF used as dimensional reference | M | H | ✅ tracing refused before calibration; perpendicular check required for VERIFIED; uncertainty shown | Eng |
| R5 | Specs copied from wrong variant (e.g. 2.6 mm indoor vs 3.9 mm outdoor cabinet) | M | H | ✅ exact model strings, name hints ESTIMATED only, reviewer-only VERIFIED with source | Tech reviewer |
| R6 | Venue/manufacturer research breaches site terms or copyright | L | M | ☐ authorised sources only, robots/terms respected, licence field stored; human-in-loop | Product |
| R7 | LLM hallucinates dimensions or quantities | M | H | ✅ architecture: AI proposes params only; deterministic validation; ☐ eval suite before enabling | Eng |
| R8 | Client data leaves South Africa via AI/cloud providers (POPIA) | M | M | ☐ provider + region decision (D-004, D-005), DPA, opt-in per project | Owner |
| R9 | Stage/LED structural loads not assessed | H | H | ✅ always HUMAN_REQUIRED; load ratings UNKNOWN until recorded | Rigger/engineer |
| R10 | Electrical estimate used as a distribution design | M | H | ✅ labelled preliminary; planning factor shown as ESTIMATED assumption | Electrician |
| R11 | Egress/fire not assessed while layout looks complete | M | H | ✅ crowd-safety HUMAN_REQUIRED; ☐ doors/exits capture + egress width checks | Safety officer |
| R12 | Loss of historical traceability after inventory updates | L | H | ✅ immutable snapshots, frozen revision inputs + hash, append-only history | Eng |
| R13 | Account takeover / data exposure | L | H | ✅ scrypt, HttpOnly/SameSite cookies, CSRF header, RBAC, tenant scoping, rate limits, audit; ☐ MFA, CSP, HTTPS-only | Eng |
| R14 | Scope creep — broad but shallow features | M | M | ✅ vertical-slice first, `scope.*` checks expose unbuilt disciplines | Product |
| R15 | Licence contamination (AGPL PDF libs, GPL tools in SaaS) | L | M | ✅ MIT/Apache stack today; ☐ D-006 before adding PyMuPDF/Blender | Owner |
| R16 | Single maintainer / bus factor | M | M | ✅ CLAUDE.md rules, docs, 97 automated tests + e2e, CI workflow | Owner |
