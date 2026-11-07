/**
 * Drawing scale calibration.
 *
 * A PDF or image has no trustworthy scale until a human calibrates it from a
 * known dimension. Rules (docs/05-provenance-model.md §Calibration):
 *  - no calibration                                   → UNKNOWN
 *  - one reference dimension                          → PROVISIONAL if the reference is VERIFIED, else ESTIMATED
 *  - plus ≥1 passing independent check on a different
 *    axis (≥30° apart), all references VERIFIED       → VERIFIED
 *  - any failing check                                → ESTIMATED with conflict=true
 *
 * Page coordinates are PDF points with origin top-left, y down (pdf.js viewport at scale 1).
 */
import type { Confidence } from '../provenance.js';
import type { Pt } from './polygon.js';
import { dist } from './polygon.js';

export interface CalibrationMeasure {
  p1: Pt; // page points
  p2: Pt;
  knownLengthMm: number;
  /** ± tolerance of the known dimension itself (mm). */
  knownToleranceMm: number;
  /** Confidence of the known dimension (e.g. VERIFIED if from an official dimension string). */
  referenceStatus: Confidence;
  referenceNote: string;
}

export interface CalibrationInput {
  reference: CalibrationMeasure;
  checks: CalibrationMeasure[];
  /** Estimated pointing uncertainty per click, in page points (depends on zoom). */
  clickUncertaintyPt: number;
}

export interface CalibrationCheckResult {
  measuredMm: number;
  knownMm: number;
  deviationMm: number;
  allowedMm: number;
  pass: boolean;
  angleFromReferenceDeg: number;
}

export interface CalibrationResult {
  mmPerPt: number;
  /** Relative standard uncertainty of the scale (e.g. 0.004 = 0.4 %). */
  relUncertainty: number;
  status: Confidence;
  conflict: boolean;
  checks: CalibrationCheckResult[];
  notes: string[];
}

/** Minimum relative tolerance for a check to pass (drawing line weight, print distortion). */
export const MIN_CHECK_TOLERANCE = 0.01;

function angleDeg(a: Pt, b: Pt): number {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

function axisAngleBetween(a: number, b: number): number {
  let d = Math.abs(a - b) % 180;
  if (d > 90) d = 180 - d;
  return d;
}

export function calibrate(input: CalibrationInput): CalibrationResult {
  const ref = input.reference;
  const dPt = dist(ref.p1, ref.p2);
  if (dPt < 1) throw new Error('Reference points are too close together to calibrate');
  if (!(ref.knownLengthMm > 0)) throw new Error('Known length must be positive');
  const mmPerPt = ref.knownLengthMm / dPt;
  const relClick = (Math.SQRT2 * input.clickUncertaintyPt) / dPt;
  const relRef = ref.knownToleranceMm / ref.knownLengthMm;
  const relUncertainty = Math.hypot(relClick, relRef);
  const notes: string[] = [];
  const refAngle = angleDeg(ref.p1, ref.p2);

  const checks: CalibrationCheckResult[] = input.checks.map((c) => {
    const cPt = dist(c.p1, c.p2);
    const measuredMm = cPt * mmPerPt;
    const relCheckClick = (Math.SQRT2 * input.clickUncertaintyPt) / Math.max(cPt, 1e-9);
    // 2σ combined allowance, with a minimum percentage floor.
    const rel = 2 * Math.hypot(relUncertainty, relCheckClick, c.knownToleranceMm / c.knownLengthMm);
    const allowedMm = Math.max(rel, MIN_CHECK_TOLERANCE) * c.knownLengthMm;
    const deviationMm = measuredMm - c.knownLengthMm;
    return {
      measuredMm,
      knownMm: c.knownLengthMm,
      deviationMm,
      allowedMm,
      pass: Math.abs(deviationMm) <= allowedMm,
      angleFromReferenceDeg: axisAngleBetween(refAngle, angleDeg(c.p1, c.p2)),
    };
  });

  const conflict = checks.some((c) => !c.pass);
  let status: Confidence = ref.referenceStatus === 'VERIFIED' ? 'PROVISIONAL' : 'ESTIMATED';
  if (conflict) {
    status = 'ESTIMATED';
    notes.push('At least one check dimension disagrees with the calibration. Re-check the reference or the drawing.');
  } else {
    const independentAxis = checks.some((c, i) => c.pass && c.angleFromReferenceDeg >= 30 && input.checks[i]!.referenceStatus === 'VERIFIED');
    if (ref.referenceStatus === 'VERIFIED' && independentAxis && input.checks.every((c) => c.referenceStatus === 'VERIFIED')) {
      status = 'VERIFIED';
    } else if (checks.length === 0) {
      notes.push('Add an independent check dimension on a perpendicular axis to verify the scale.');
    } else if (!independentAxis) {
      notes.push('Checks so far are parallel to the reference; a perpendicular check is needed to rule out non-uniform scaling.');
    }
  }
  if (ref.referenceStatus !== 'VERIFIED') notes.push('Reference dimension is not verified; calibration cannot exceed ESTIMATED/PROVISIONAL.');
  return { mmPerPt, relUncertainty, status, conflict, checks, notes };
}

/** Convert page points (y down) to plan millimetres (y up). */
export function pageToPlan(p: Pt, mmPerPt: number): Pt {
  return { x: p.x * mmPerPt, y: -p.y * mmPerPt };
}

export function planToPage(p: Pt, mmPerPt: number): Pt {
  return { x: p.x / mmPerPt, y: -p.y / mmPerPt };
}

/**
 * Scale implied by a drawing's printed ratio (e.g. 1:100) when the PDF page is at true paper size.
 * Never treated as better than ESTIMATED: PDFs are routinely re-scaled when exported.
 */
export function mmPerPtFromRatio(denominator: number): number {
  return (25.4 / 72) * denominator;
}
