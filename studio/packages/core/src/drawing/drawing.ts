/**
 * Drawing primitives in world millimetres, generated from the authoritative scene.
 * Renderers (SVG in core, PDF in the server) only map coordinates — they never
 * compute geometry — so the screen plan and the exported PDF cannot diverge.
 */
import type { LedPlan, Scene, SceneObject } from '../design/types.js';
import { add, bounds, norm, rectPolygon, scale, signedArea, sub, type Pt } from '../geometry/polygon.js';

export type Style = { stroke?: string; fill?: string; weight?: number /* paper mm */; dash?: number[] /* paper mm */; opacity?: number };

export type Prim =
  | ({ t: 'poly'; pts: Pt[]; closed: boolean } & Style)
  | ({ t: 'circle'; c: Pt; r: number } & Style)
  | { t: 'text'; at: Pt; text: string; size: number /* paper mm */; color?: string; anchor?: 'start' | 'middle' | 'end'; angleDeg?: number; bold?: boolean }
  | { t: 'dim'; a: Pt; b: Pt; offset: number /* world mm, + = left of a→b */; text: string; color?: string };

export interface Drawing {
  title: string;
  prims: Prim[];
  extents: { minX: number; minY: number; maxX: number; maxY: number };
  /** Notes printed in the title block / legend. */
  notes: string[];
}

export const COLORS = {
  ink: '#0C0C0C',
  grey: '#6E6E6E',
  light: '#D6D6D6',
  crimson: '#E0144B',
  pink: '#FA2158',
  blue: '#3D7BFF',
  amber: '#FF8F1F',
  stage: '#F2F2F2',
  shortfall: '#B3103C',
};

export const STANDARD_SCALES = [20, 25, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000, 1250, 1500, 2000];

/** Smallest standard scale (most detail) at which extents fit the given paper area (mm). */
export function chooseScale(ext: Drawing['extents'], paperW: number, paperH: number): number {
  const w = ext.maxX - ext.minX;
  const h = ext.maxY - ext.minY;
  for (const s of STANDARD_SCALES) if (w / s <= paperW && h / s <= paperH) return s;
  return STANDARD_SCALES.at(-1)!;
}

const dashFor = (o: SceneObject) => (o.status === 'VERIFIED' ? undefined : o.status === 'PROVISIONAL' ? undefined : [2, 1]);
const m2 = (mm: number) => `${(mm / 1000).toFixed(2)} m`;

export function planDrawing(scene: Scene, opts: { precisionNote?: string } = {}): Drawing {
  const P: Prim[] = [];
  const f = scene.frame;
  const W = (lx: number, ly: number): Pt => add(f.origin, add(scale(f.u, lx), scale(f.n, ly)));
  const room = scene.objects.find((o) => o.kind === 'room');
  if (room?.polygon) {
    P.push({ t: 'poly', pts: room.polygon, closed: true, stroke: COLORS.ink, weight: 0.7, ...(room.status === 'VERIFIED' ? {} : { dash: [4, 1.5] }) });
    const ccw = signedArea(room.polygon) > 0;
    room.polygon.forEach((p, i) => {
      const q = room.polygon![(i + 1) % room.polygon!.length]!;
      const mid = scale(add(p, q), 0.5);
      const u = norm(sub(q, p));
      const nIn = ccw ? { x: -u.y, y: u.x } : { x: u.y, y: -u.x };
      P.push({ t: 'text', at: add(mid, scale(nIn, 700)), text: `W${i + 1}`, size: 2.2, color: COLORS.grey, anchor: 'middle' });
    });
  }
  for (const o of scene.objects) {
    if (o.kind === 'obstacle' && o.polygon) {
      P.push({ t: 'poly', pts: o.polygon, closed: true, stroke: COLORS.ink, fill: COLORS.light, weight: 0.35 });
      const b = bounds(o.polygon);
      P.push({ t: 'text', at: { x: (b.minX + b.maxX) / 2, y: b.maxY }, text: o.label, size: 1.8, color: COLORS.grey, anchor: 'middle' });
    }
  }
  const stage = scene.objects.find((o) => o.kind === 'stage');
  if (stage?.polygon) P.push({ t: 'poly', pts: stage.polygon, closed: true, fill: COLORS.stage, stroke: COLORS.ink, weight: 0.5 });
  for (const o of scene.objects.filter((x) => x.kind === 'stage_deck')) {
    P.push({ t: 'poly', pts: o.polygon!, closed: true, stroke: o.supply === 'SHORTFALL' ? COLORS.shortfall : COLORS.grey, weight: 0.18, ...(o.supply === 'SHORTFALL' ? { dash: [1, 0.8] } : dashFor(o) ? { dash: dashFor(o)! } : {}) });
  }
  const led = scene.objects.find((o) => o.kind === 'led_wall');
  if (led?.polygon) {
    P.push({ t: 'poly', pts: led.polygon, closed: true, fill: COLORS.pink, stroke: COLORS.crimson, weight: 0.35 });
    for (const c of scene.objects.filter((x) => x.kind === 'led_cabinet' && x.supply === 'SHORTFALL' && (x.meta?.row ?? 0) === 0)) {
      P.push({ t: 'poly', pts: rectPolygon({ x: c.position.x, y: c.position.y }, c.size.x, c.size.y * 3, c.rotationDeg), closed: true, stroke: COLORS.shortfall, weight: 0.3, dash: [1, 0.8] });
    }
  }
  const foh = scene.objects.find((o) => o.kind === 'foh');
  if (foh?.polygon) {
    P.push({ t: 'poly', pts: foh.polygon, closed: true, stroke: COLORS.blue, weight: 0.4, fill: '#EAF1FF' });
    P.push({ t: 'text', at: { x: foh.position.x, y: foh.position.y }, text: 'FOH', size: 2.5, color: COLORS.blue, anchor: 'middle', bold: true, angleDeg: f.rotationDeg });
  }
  for (const t of scene.objects.filter((x) => x.kind === 'table')) {
    P.push({ t: 'circle', c: { x: t.position.x, y: t.position.y }, r: t.size.x / 2, stroke: COLORS.grey, weight: 0.2 });
    P.push({ t: 'text', at: { x: t.position.x, y: t.position.y }, text: t.id.replace('table-', ''), size: 1.6, color: COLORS.grey, anchor: 'middle' });
  }

  // Dimensions (all from the scene's stage frame).
  if (stage) {
    const sw = stage.size.x;
    const sd = stage.size.y;
    const upc = (() => {
      const loc = (p: Pt) => ({ lx: (p.x - f.origin.x) * f.u.x + (p.y - f.origin.y) * f.u.y, ly: (p.x - f.origin.x) * f.n.x + (p.y - f.origin.y) * f.n.y });
      return loc({ x: stage.position.x, y: stage.position.y }).ly - sd / 2;
    })();
    const front = upc + sd;
    P.push({ t: 'dim', a: W(-sw / 2, front), b: W(sw / 2, front), offset: -1500, text: m2(sw) });
    P.push({ t: 'dim', a: W(sw / 2, upc), b: W(sw / 2, front), offset: -1500, text: m2(sd) });
    if (upc > 0) P.push({ t: 'dim', a: W(-sw / 2, 0), b: W(-sw / 2, upc), offset: 1500, text: m2(upc) });
    P.push({ t: 'text', at: W(0, upc + sd / 2), text: stage.label.toUpperCase(), size: 2.6, color: COLORS.ink, anchor: 'middle', bold: true, angleDeg: f.rotationDeg });
    if (led) P.push({ t: 'dim', a: W(-led.size.x / 2, upc), b: W(led.size.x / 2, upc), offset: 900, text: `LED ${m2(led.size.x)}` });
    if (foh) {
      const fl = (foh.position.x - f.origin.x) * f.n.x + (foh.position.y - f.origin.y) * f.n.y - foh.size.y / 2;
      P.push({ t: 'dim', a: W(0, front), b: W(0, fl), offset: 0, text: m2(fl - front) });
    }
  }
  if (room?.polygon) {
    const b = bounds(room.polygon);
    P.push({ t: 'dim', a: { x: b.minX, y: b.minY }, b: { x: b.maxX, y: b.minY }, offset: -2500, text: m2(b.maxX - b.minX), color: COLORS.grey });
    P.push({ t: 'dim', a: { x: b.maxX, y: b.minY }, b: { x: b.maxX, y: b.maxY }, offset: -2500, text: m2(b.maxY - b.minY), color: COLORS.grey });
  }
  const pts: Pt[] = [...(room?.polygon ?? [])];
  for (const o of scene.objects) if (o.polygon) pts.push(...o.polygon);
  const e = bounds(pts.length ? pts : [{ x: 0, y: 0 }]);
  const pad = 4000;
  return {
    title: `Plan — ${scene.venue.name}`,
    prims: P,
    extents: { minX: e.minX - pad, minY: e.minY - pad, maxX: e.maxX + pad, maxY: e.maxY + pad },
    notes: [
      'All dimensions in metres. Plan coordinates in millimetres internally.',
      'Dashed outlines: geometry that is not VERIFIED. Red dashed: equipment short of confirmed stock.',
      ...(opts.precisionNote ? [opts.precisionNote] : []),
    ],
  };
}

const PORT_COLORS = ['#E0144B', '#3D7BFF', '#FF8F1F', '#22D67A', '#7A3DFF', '#0C0C0C', '#B3103C', '#2DB7A0'];

/** Front elevation of the LED wall (x = along the stage, y = height above floor). */
export function ledElevationDrawing(scene: Scene, plan: LedPlan): Drawing {
  const P: Prim[] = [];
  const stage = scene.objects.find((o) => o.kind === 'stage');
  const cabs = scene.objects.filter((o) => o.kind === 'led_cabinet');
  const W = plan.cols * plan.cabinetWidthMm;
  const H = plan.rows * plan.cabinetHeightMm;
  const z0 = cabs[0]?.position.z ?? 0;
  const portOf = new Map<string, number>();
  plan.dataPorts?.forEach((chain, i) => chain.forEach((id) => portOf.set(id, i)));
  const x0 = -W / 2;
  P.push({ t: 'poly', pts: [{ x: x0 - 3000, y: 0 }, { x: -x0 + 3000, y: 0 }], closed: false, stroke: COLORS.ink, weight: 0.5 });
  P.push({ t: 'text', at: { x: x0 - 2800, y: 150 }, text: 'FFL ±0.00', size: 2, color: COLORS.grey });
  if (stage) {
    P.push({ t: 'poly', pts: [{ x: -stage.size.x / 2, y: 0 }, { x: stage.size.x / 2, y: 0 }, { x: stage.size.x / 2, y: stage.size.z }, { x: -stage.size.x / 2, y: stage.size.z }], closed: true, fill: COLORS.stage, stroke: COLORS.ink, weight: 0.4 });
    P.push({ t: 'dim', a: { x: stage.size.x / 2, y: 0 }, b: { x: stage.size.x / 2, y: stage.size.z }, offset: -1200, text: m2(stage.size.z) });
  }
  for (const c of cabs) {
    const col = c.meta!.col as number;
    const row = c.meta!.row as number;
    const x = x0 + col * plan.cabinetWidthMm;
    const y = z0 + row * plan.cabinetHeightMm;
    const port = portOf.get(c.id);
    P.push({
      t: 'poly',
      pts: [{ x, y }, { x: x + plan.cabinetWidthMm, y }, { x: x + plan.cabinetWidthMm, y: y + plan.cabinetHeightMm }, { x, y: y + plan.cabinetHeightMm }],
      closed: true,
      stroke: c.supply === 'SHORTFALL' ? COLORS.shortfall : COLORS.ink,
      weight: 0.15,
      fill: port !== undefined ? PORT_COLORS[port % PORT_COLORS.length]! : '#FFFFFF',
      opacity: port !== undefined ? 0.25 : 1,
      ...(c.supply === 'SHORTFALL' ? { dash: [1, 0.6] } : {}),
    });
    if (plan.cols * plan.rows <= 200) P.push({ t: 'text', at: { x: x + plan.cabinetWidthMm / 2, y: y + plan.cabinetHeightMm / 2 - 60 }, text: port !== undefined ? `P${port + 1}` : `${col + 1}.${row + 1}`, size: 1.4, color: COLORS.ink, anchor: 'middle' });
  }
  P.push({ t: 'dim', a: { x: x0, y: z0 + H }, b: { x: -x0, y: z0 + H }, offset: 900, text: `${m2(W)} (${plan.cols} cabinets)` });
  P.push({ t: 'dim', a: { x: x0, y: z0 }, b: { x: x0, y: z0 + H }, offset: 900, text: `${m2(H)} (${plan.rows})` });
  P.push({ t: 'dim', a: { x: -x0, y: 0 }, b: { x: -x0, y: z0 + H }, offset: -2600, text: `top ${m2(z0 + H)}` });
  const ceil = scene.venue.ceilingHeight;
  if (ceil.value !== null) {
    P.push({ t: 'poly', pts: [{ x: x0 - 3000, y: ceil.value }, { x: -x0 + 3000, y: ceil.value }], closed: false, stroke: COLORS.grey, weight: 0.3, dash: [3, 1] });
    P.push({ t: 'text', at: { x: x0 - 2800, y: ceil.value + 150 }, text: `Ceiling ${m2(ceil.value)} (${ceil.status})`, size: 2, color: COLORS.grey });
  }
  const top = Math.max(z0 + H, ceil.value ?? 0) + 1500;
  return {
    title: `LED cabinet plan — ${plan.product}`,
    prims: P,
    extents: { minX: x0 - 4000, minY: -1500, maxX: -x0 + 4500, maxY: top },
    notes: [
      `${plan.cols} × ${plan.rows} = ${plan.cols * plan.rows} cabinets, ${plan.cabinetWidthMm} × ${plan.cabinetHeightMm} mm.`,
      plan.resolution.value ? `Resolution ${plan.resolution.value.w} × ${plan.resolution.value.h} px (${plan.resolution.status}).` : 'Resolution unknown (pixels per cabinet not recorded).',
      plan.dataPorts ? `${plan.dataPorts.length} data chains, serpentine by column (P = processor output).` : 'Data chains not computed (processor capacity unknown).',
    ],
  };
}
