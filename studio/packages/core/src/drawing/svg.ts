/** SVG renderer for Drawing primitives. 1 SVG user unit = 1 world mm. Y is flipped (plan y-up). */
import type { Pt } from '../geometry/polygon.js';
import type { Drawing, Prim } from './drawing.js';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Render at a drawing scale (world mm per paper mm): line weights and text are paper-sized. */
export function renderSvg(d: Drawing, drawingScale: number, opts: { background?: string } = {}): string {
  const { minX, minY, maxX, maxY } = d.extents;
  const k = drawingScale;
  const X = (p: Pt) => (p.x - minX).toFixed(1);
  const Y = (p: Pt) => (maxY - p.y).toFixed(1);
  const style = (p: { stroke?: string; fill?: string; weight?: number; dash?: number[]; opacity?: number }) =>
    `stroke="${p.stroke ?? 'none'}" fill="${p.fill ?? 'none'}" stroke-width="${((p.weight ?? 0.25) * k).toFixed(1)}"${p.dash ? ` stroke-dasharray="${p.dash.map((x) => (x * k).toFixed(0)).join(' ')}"` : ''}${p.opacity !== undefined ? ` fill-opacity="${p.opacity}"` : ''}`;
  const out: string[] = [];
  for (const p of d.prims) out.push(prim(p));
  function prim(p: Prim): string {
    switch (p.t) {
      case 'poly':
        return `<${p.closed ? 'polygon' : 'polyline'} points="${p.pts.map((q) => `${X(q)},${Y(q)}`).join(' ')}" ${style(p)} stroke-linejoin="round"/>`;
      case 'circle':
        return `<circle cx="${X(p.c)}" cy="${Y(p.c)}" r="${p.r.toFixed(1)}" ${style(p)}/>`;
      case 'text': {
        const rot = p.angleDeg ? normaliseTextAngle(p.angleDeg) : 0;
        return `<text x="${X(p.at)}" y="${Y(p.at)}" font-size="${(p.size * k).toFixed(0)}" fill="${p.color ?? '#0C0C0C'}" text-anchor="${p.anchor ?? 'start'}" dominant-baseline="middle"${p.bold ? ' font-weight="800"' : ''}${rot ? ` transform="rotate(${-rot} ${X(p.at)} ${Y(p.at)})"` : ''} font-family="Manrope, Arial, sans-serif">${esc(p.text)}</text>`;
      }
      case 'dim':
        return dimSvg(p, k, X, Y);
    }
  }
  const w = maxX - minX;
  const h = maxY - minY;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.toFixed(0)} ${h.toFixed(0)}" data-scale="1:${k}">${opts.background ? `<rect width="100%" height="100%" fill="${opts.background}"/>` : ''}${out.join('')}</svg>`;
}

/** Keep text upright: angles mapped into (-90, 90]. */
export function normaliseTextAngle(a: number): number {
  let x = ((a % 360) + 360) % 360;
  if (x > 90 && x <= 270) x -= 180;
  if (x > 270) x -= 360;
  return x;
}

/** Shared dimension geometry used by all renderers. */
export function dimGeometry(a: Pt, b: Pt, offset: number, k: number) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L = Math.hypot(dx, dy) || 1;
  const n = { x: -dy / L, y: dx / L };
  const o = { x: n.x * offset, y: n.y * offset };
  const a2 = { x: a.x + o.x, y: a.y + o.y };
  const b2 = { x: b.x + o.x, y: b.y + o.y };
  const ext = Math.sign(offset || 1) * 1.5 * k;
  const ticks = 1.2 * k;
  const ux = dx / L;
  const uy = dy / L;
  const tick = (p: Pt) => [{ x: p.x - (ux + n.x) * ticks * 0.5, y: p.y - (uy + n.y) * ticks * 0.5 }, { x: p.x + (ux + n.x) * ticks * 0.5, y: p.y + (uy + n.y) * ticks * 0.5 }];
  const mid = { x: (a2.x + b2.x) / 2 + n.x * 1.6 * k * Math.sign(offset || 1), y: (a2.y + b2.y) / 2 + n.y * 1.6 * k * Math.sign(offset || 1) };
  return {
    ext1: offset ? [a, { x: a2.x + n.x * ext * 0.5, y: a2.y + n.y * ext * 0.5 }] : null,
    ext2: offset ? [b, { x: b2.x + n.x * ext * 0.5, y: b2.y + n.y * ext * 0.5 }] : null,
    line: [a2, b2],
    tickA: tick(a2),
    tickB: tick(b2),
    textAt: offset ? mid : { x: (a2.x + b2.x) / 2 + n.x * 1.6 * k, y: (a2.y + b2.y) / 2 + n.y * 1.6 * k },
    angleDeg: normaliseTextAngle((Math.atan2(dy, dx) * 180) / Math.PI),
  };
}

function dimSvg(p: Extract<Prim, { t: 'dim' }>, k: number, X: (p: Pt) => string, Y: (p: Pt) => string): string {
  const g = dimGeometry(p.a, p.b, p.offset, k);
  const c = p.color ?? '#333333';
  const ln = (s: Pt[]) => `<line x1="${X(s[0]!)}" y1="${Y(s[0]!)}" x2="${X(s[1]!)}" y2="${Y(s[1]!)}" stroke="${c}" stroke-width="${(0.18 * k).toFixed(1)}"/>`;
  return [
    g.ext1 ? ln(g.ext1) : '',
    g.ext2 ? ln(g.ext2) : '',
    ln(g.line),
    ln(g.tickA),
    ln(g.tickB),
    `<text x="${X(g.textAt)}" y="${Y(g.textAt)}" font-size="${(2.2 * k).toFixed(0)}" fill="${c}" text-anchor="middle" dominant-baseline="middle" font-family="JetBrains Mono, monospace" transform="rotate(${-g.angleDeg} ${X(g.textAt)} ${Y(g.textAt)})">${esc(p.text)}</text>`,
  ].join('');
}
