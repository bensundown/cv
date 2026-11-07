/** Deterministic 2D geometry in millimetres. Plan coordinates: x east, y north (y up). */

export interface Pt {
  x: number;
  y: number;
}

export const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Pt, b: Pt): number => a.x * b.x + a.y * b.y;
export const cross = (a: Pt, b: Pt): number => a.x * b.y - a.y * b.x;
export const len = (a: Pt): number => Math.hypot(a.x, a.y);
export const dist = (a: Pt, b: Pt): number => len(sub(a, b));
export const norm = (a: Pt): Pt => {
  const l = len(a);
  if (l === 0) throw new Error('Cannot normalise zero vector');
  return { x: a.x / l, y: a.y / l };
};

/** Signed area: positive for counter-clockwise polygons. */
export function signedArea(poly: Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export const area = (poly: Pt[]): number => Math.abs(signedArea(poly));

export function ensureCCW(poly: Pt[]): Pt[] {
  return signedArea(poly) < 0 ? [...poly].reverse() : poly;
}

export function bounds(points: Pt[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

/** Point-in-polygon (ray casting). Points exactly on the boundary are treated as inside. */
export function pointInPolygon(p: Pt, poly: Pt[], eps = 1e-6): boolean {
  for (let i = 0; i < poly.length; i++) {
    if (distPointSegment(p, poly[i]!, poly[(i + 1) % poly.length]!) <= eps) return true;
  }
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function distPointSegment(p: Pt, a: Pt, b: Pt): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return dist(p, add(a, scale(ab, t)));
}

/** Minimum distance from a point to the polygon boundary. */
export function distToBoundary(p: Pt, poly: Pt[]): number {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) d = Math.min(d, distPointSegment(p, poly[i]!, poly[(i + 1) % poly.length]!));
  return d;
}

/** Proper segment intersection (touching at endpoints counts as no crossing). */
export function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = cross(sub(b, a), sub(c, a));
  const d2 = cross(sub(b, a), sub(d, a));
  const d3 = cross(sub(d, c), sub(a, c));
  const d4 = cross(sub(d, c), sub(b, c));
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** True when `inner` lies entirely within `outer` (boundary contact allowed). */
export function polygonInside(inner: Pt[], outer: Pt[]): boolean {
  if (!inner.every((p) => pointInPolygon(p, outer, 0.01))) return false;
  for (let i = 0; i < inner.length; i++) {
    for (let j = 0; j < outer.length; j++) {
      if (segmentsCross(inner[i]!, inner[(i + 1) % inner.length]!, outer[j]!, outer[(j + 1) % outer.length]!)) return false;
    }
  }
  return true;
}

/** True when the two polygons' interiors overlap. */
export function polygonsOverlap(a: Pt[], b: Pt[]): boolean {
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (segmentsCross(a[i]!, a[(i + 1) % a.length]!, b[j]!, b[(j + 1) % b.length]!)) return true;
    }
  }
  const strictlyInside = (p: Pt, poly: Pt[]) => pointInPolygon(p, poly, -1) && distToBoundary(p, poly) > 0.01;
  return a.some((p) => strictlyInside(p, b)) || b.some((p) => strictlyInside(p, a)) || strictlyInside(centroid(a), b);
}

export function centroid(poly: Pt[]): Pt {
  const s = poly.reduce((acc, p) => add(acc, p), { x: 0, y: 0 });
  return scale(s, 1 / poly.length);
}

/** Rectangle polygon (CCW) from centre, size and rotation (degrees, CCW about +z). */
export function rectPolygon(center: Pt, w: number, d: number, rotationDeg: number): Pt[] {
  const r = (rotationDeg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const hw = w / 2;
  const hd = d / 2;
  return [
    { x: -hw, y: -hd },
    { x: hw, y: -hd },
    { x: hw, y: hd },
    { x: -hw, y: hd },
  ].map((p) => ({ x: center.x + p.x * c - p.y * s, y: center.y + p.x * s + p.y * c }));
}

/** Distance along a ray from `origin` in direction `dir` (unit) to the polygon boundary; null if none. */
export function rayToBoundary(origin: Pt, dir: Pt, poly: Pt[]): number | null {
  let best: number | null = null;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const e = sub(b, a);
    const denom = cross(dir, e);
    if (Math.abs(denom) < 1e-12) continue;
    const ao = sub(a, origin);
    const t = cross(ao, e) / denom;
    const u = cross(ao, dir) / denom;
    if (t > 1e-6 && u >= -1e-9 && u <= 1 + 1e-9 && (best === null || t < best)) best = t;
  }
  return best;
}

/** Validate a room polygon: ≥3 vertices, non-zero area, no self-intersection. */
export function validatePolygon(poly: Pt[]): string[] {
  const errors: string[] = [];
  if (poly.length < 3) errors.push('Polygon needs at least 3 vertices');
  else {
    if (area(poly) < 1) errors.push('Polygon has zero area');
    for (let i = 0; i < poly.length; i++) {
      for (let j = i + 1; j < poly.length; j++) {
        if (Math.abs(i - j) <= 1 || (i === 0 && j === poly.length - 1)) continue;
        if (segmentsCross(poly[i]!, poly[(i + 1) % poly.length]!, poly[j]!, poly[(j + 1) % poly.length]!)) {
          errors.push(`Edges ${i} and ${j} intersect`);
        }
      }
    }
  }
  return errors;
}
