/**
 * Vector PDF export. Pages are drawn from the stored revision result (scene, BOM,
 * validation) via the shared Drawing primitives — the same ones the web plan uses.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chooseScale, dimGeometry, ledElevationDrawing, normaliseTextAngle, planDrawing, type DesignResult, type Drawing, type Pt } from '@sn/core';
import PDFDocument from 'pdfkit';

const MM = 72 / 25.4; // pt per mm
const A3 = { w: 420, h: 297 };
const MARGIN = 10;
const TITLE_H = 34;

const fontDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/public/brand/fonts');
function registerFonts(doc: PDFKit.PDFDocument) {
  const reg = (name: string, file: string, fallback: string) => {
    try {
      const f = path.join(fontDir, file);
      if (fs.existsSync(f)) {
        doc.registerFont(name, f);
        return;
      }
    } catch {
      /* fall through */
    }
    doc.registerFont(name, fallback);
  };
  reg('body', 'Manrope-Variable.ttf', 'Helvetica');
  reg('head', 'PlusJakartaSans-Variable.ttf', 'Helvetica-Bold');
  reg('mono', 'JetBrainsMono-Variable.ttf', 'Courier');
}

export interface PdfMeta {
  projectName: string;
  client: string | null;
  revisionNumber: number;
  revisionDate: string;
  inputHash: string;
  mode: string;
  inventoryVersion: number | null;
  approvals: { discipline: string; decision: string; user: string; at: string; comment: string | null }[];
  renderPng: Buffer | null;
}

function drawDrawing(doc: PDFKit.PDFDocument, d: Drawing, area: { x: number; y: number; w: number; h: number }, scale: number) {
  const { minX, maxY } = d.extents;
  const dw = (d.extents.maxX - d.extents.minX) / scale;
  const dh = (d.extents.maxY - d.extents.minY) / scale;
  const ox = area.x + (area.w - dw) / 2;
  const oy = area.y + (area.h - dh) / 2;
  const P = (p: Pt): [number, number] => [(ox + (p.x - minX) / scale) * MM, (oy + (maxY - p.y) / scale) * MM];
  const stroke = (s: { stroke?: string; fill?: string; weight?: number; dash?: number[]; opacity?: number }) => {
    doc.lineWidth((s.weight ?? 0.25) * MM);
    if (s.dash) doc.dash(s.dash[0]! * MM, { space: (s.dash[1] ?? s.dash[0]!) * MM });
    else doc.undash();
    if (s.fill && s.stroke) doc.fillOpacity(s.opacity ?? 1).fillAndStroke(s.fill, s.stroke);
    else if (s.fill) doc.fillOpacity(s.opacity ?? 1).fill(s.fill);
    else if (s.stroke) doc.stroke(s.stroke);
    doc.fillOpacity(1).undash();
  };
  const text = (at: Pt, str: string, sizeMm: number, opts: { color?: string; anchor?: string; angle?: number; font?: string }) => {
    const [x, y] = P(at);
    doc.font(opts.font ?? 'body').fontSize(sizeMm * MM).fillColor(opts.color ?? '#0C0C0C');
    const w = doc.widthOfString(str);
    const h = doc.currentLineHeight();
    const dx = opts.anchor === 'middle' ? -w / 2 : opts.anchor === 'end' ? -w : 0;
    doc.save();
    if (opts.angle) doc.rotate(-opts.angle, { origin: [x, y] });
    doc.text(str, x + dx, y - h / 2, { lineBreak: false });
    doc.restore();
  };
  for (const p of d.prims) {
    if (p.t === 'poly') {
      const pts = p.pts.map(P);
      doc.moveTo(...pts[0]!);
      for (const q of pts.slice(1)) doc.lineTo(...q);
      if (p.closed) doc.closePath();
      stroke(p);
    } else if (p.t === 'circle') {
      const [x, y] = P(p.c);
      doc.circle(x, y, (p.r / scale) * MM);
      stroke(p);
    } else if (p.t === 'text') {
      text(p.at, p.text, p.size, { ...(p.color ? { color: p.color } : {}), anchor: p.anchor ?? 'start', angle: p.angleDeg ? normaliseTextAngle(p.angleDeg) : 0, font: p.bold ? 'head' : 'body' });
    } else if (p.t === 'dim') {
      const g = dimGeometry(p.a, p.b, p.offset, scale);
      const c = p.color ?? '#333333';
      for (const seg of [g.ext1, g.ext2, g.line, g.tickA, g.tickB]) {
        if (!seg) continue;
        doc.moveTo(...P(seg[0]!)).lineTo(...P(seg[1]!)).lineWidth(0.18 * MM).stroke(c);
      }
      text(g.textAt, p.text, 2.2, { color: c, anchor: 'middle', angle: g.angleDeg, font: 'mono' });
    }
  }
}

function frame(doc: PDFKit.PDFDocument, title: string, meta: PdfMeta, result: DesignResult, scaleText: string) {
  const W = A3.w;
  const H = A3.h;
  doc.lineWidth(0.5 * MM).rect(MARGIN * MM, MARGIN * MM, (W - 2 * MARGIN) * MM, (H - 2 * MARGIN) * MM).stroke('#0C0C0C');
  // Status banner (never claims certification).
  const overall = result.validation.overall;
  const banner = meta.mode === 'concept' ? `CONCEPT DESIGN — NOT FOR CONSTRUCTION — STATUS: ${overall}` : `TECHNICAL DRAFT — STATUS: ${overall} — SUBJECT TO HUMAN APPROVAL`;
  doc.rect(MARGIN * MM, MARGIN * MM, (W - 2 * MARGIN) * MM, 7 * MM).fill(overall === 'FAILS_CHECKS' ? '#B3103C' : '#0C0C0C');
  doc.font('head').fontSize(3.2 * MM).fillColor('#FFFFFF').text(banner, (MARGIN + 3) * MM, (MARGIN + 1.8) * MM, { lineBreak: false });
  // Title block.
  const ty = H - MARGIN - TITLE_H;
  doc.lineWidth(0.35 * MM).moveTo(MARGIN * MM, ty * MM).lineTo((W - MARGIN) * MM, ty * MM).stroke('#0C0C0C');
  const cell = (x: number, label: string, value: string, w: number) => {
    doc.font('body').fontSize(2.2 * MM).fillColor('#6E6E6E').text(label.toUpperCase(), x * MM, (ty + 3) * MM, { width: w * MM, lineBreak: false });
    doc.font('head').fontSize(3.4 * MM).fillColor('#0C0C0C').text(value, x * MM, (ty + 7) * MM, { width: w * MM, height: 20 * MM, ellipsis: true });
  };
  cell(MARGIN + 4, 'Sound Ninja · Design Studio', title, 120);
  cell(MARGIN + 128, 'Project / client', `${meta.projectName}${meta.client ? ` — ${meta.client}` : ''}`, 100);
  cell(MARGIN + 232, 'Revision', `R${meta.revisionNumber} · ${meta.revisionDate.slice(0, 10)}`, 50);
  cell(MARGIN + 286, 'Scale (A3)', scaleText, 40);
  cell(MARGIN + 330, 'Inventory', meta.inventoryVersion ? `Snapshot v${meta.inventoryVersion}` : '—', 60);
  doc.font('mono').fontSize(1.9 * MM).fillColor('#6E6E6E').text(`Input hash ${meta.inputHash.slice(0, 16)} · units: metres (internal mm) · ${result.validation.notCertification}`, (MARGIN + 4) * MM, (H - MARGIN - 7) * MM, { width: (W - 2 * MARGIN - 8) * MM, lineBreak: true });
}

function scaleBar(doc: PDFKit.PDFDocument, x: number, y: number, scale: number) {
  const meters = scale <= 100 ? 5 : scale <= 250 ? 10 : 20;
  const lenMm = (meters * 1000) / scale;
  for (let i = 0; i < 5; i++) doc.rect((x + (i * lenMm) / 5) * MM, y * MM, (lenMm / 5) * MM, 1.5 * MM).fillAndStroke(i % 2 ? '#FFFFFF' : '#0C0C0C', '#0C0C0C');
  doc.font('mono').fontSize(2 * MM).fillColor('#0C0C0C').text('0', x * MM, (y + 2.5) * MM, { lineBreak: false }).text(`${meters} m`, (x + lenMm - 4) * MM, (y + 2.5) * MM, { lineBreak: false });
}

function table(doc: PDFKit.PDFDocument, x: number, y: number, cols: { h: string; w: number }[], rows: string[][], maxY: number, onNewPage: () => number): number {
  const rowH = 5;
  const header = (yy: number) => {
    doc.rect(x * MM, yy * MM, cols.reduce((a, c) => a + c.w, 0) * MM, rowH * MM).fill('#0C0C0C');
    let cx = x;
    for (const c of cols) {
      doc.font('head').fontSize(2.3 * MM).fillColor('#FFFFFF').text(c.h, (cx + 1) * MM, (yy + 1.3) * MM, { width: (c.w - 2) * MM, lineBreak: false, ellipsis: true });
      cx += c.w;
    }
    return yy + rowH;
  };
  let yy = header(y);
  rows.forEach((r, i) => {
    if (yy + rowH > maxY) yy = header(onNewPage());
    if (i % 2) doc.rect(x * MM, yy * MM, cols.reduce((a, c) => a + c.w, 0) * MM, rowH * MM).fill('#F4F4F4');
    let cx = x;
    r.forEach((v, j) => {
      doc.font('body').fontSize(2.3 * MM).fillColor('#333333').text(v, (cx + 1) * MM, (yy + 1.3) * MM, { width: (cols[j]!.w - 2) * MM, lineBreak: false, ellipsis: true });
      cx += cols[j]!.w;
    });
    yy += rowH;
  });
  return yy;
}

export async function buildPdf(result: DesignResult, meta: PdfMeta): Promise<Buffer> {
  const doc = new PDFDocument({ size: [A3.w * MM, A3.h * MM], margin: 0, info: { Title: `${meta.projectName} R${meta.revisionNumber}`, Author: 'Sound Ninja Design Studio', Subject: 'Event production design (generated)' } });
  registerFonts(doc);
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  const area = { x: MARGIN + 4, y: MARGIN + 10, w: A3.w - 2 * MARGIN - 8, h: A3.h - 2 * MARGIN - TITLE_H - 14 };

  // 1. Plan
  const plan = planDrawing(result.scene);
  const s = chooseScale(plan.extents, area.w, area.h);
  frame(doc, plan.title, meta, result, `1:${s}`);
  drawDrawing(doc, plan, area, s);
  scaleBar(doc, MARGIN + 6, A3.h - MARGIN - TITLE_H - 8, s);
  doc.font('body').fontSize(2.1 * MM).fillColor('#555555');
  plan.notes.forEach((n, i) => doc.text(n, (MARGIN + 80) * MM, (A3.h - MARGIN - TITLE_H - 10 + i * 3) * MM, { lineBreak: false }));

  // 2. LED elevation
  if (result.scene.ledPlan) {
    doc.addPage();
    const el = ledElevationDrawing(result.scene, result.scene.ledPlan);
    const es = chooseScale(el.extents, area.w, area.h - 10);
    frame(doc, el.title, meta, result, `1:${es}`);
    drawDrawing(doc, el, area, es);
    doc.font('body').fontSize(2.4 * MM).fillColor('#333333');
    el.notes.forEach((n, i) => doc.text(n, (MARGIN + 6) * MM, (A3.h - MARGIN - TITLE_H - 12 + i * 3.4) * MM, { lineBreak: false }));
  }

  // 3. Render
  if (meta.renderPng) {
    doc.addPage();
    frame(doc, 'Visualisation (native real-time render)', meta, result, 'NTS');
    doc.image(meta.renderPng, area.x * MM, area.y * MM, { fit: [area.w * MM, (area.h - 8) * MM], align: 'center', valign: 'center' });
    doc.font('body').fontSize(2.4 * MM).fillColor('#555555').text('Rendered in-browser from the authoritative scene of this revision. Not photoreal; materials and lighting are indicative. Not to scale.', area.x * MM, (area.y + area.h - 5) * MM, { lineBreak: false });
  }

  // 4. Equipment schedule
  doc.addPage();
  frame(doc, 'Equipment schedule & inventory pull list', meta, result, '—');
  const bottom = A3.h - MARGIN - TITLE_H - 4;
  const newPage = () => {
    doc.addPage();
    frame(doc, 'Equipment schedule (cont.)', meta, result, '—');
    return area.y;
  };
  let y = table(
    doc,
    area.x,
    area.y,
    [
      { h: 'RMS ID', w: 22 },
      { h: 'Product', w: 100 },
      { h: 'Original group', w: 50 },
      { h: 'Purpose', w: 70 },
      { h: 'Required', w: 20 },
      { h: 'Allocated', w: 20 },
      { h: 'Short', w: 16 },
      { h: 'Confirmed owned', w: 28 },
      { h: 'Qty basis', w: 25 },
      { h: 'Rate', w: 22 },
      { h: 'Period', w: 18 },
    ],
    result.bom.lines.map((l) => [l.rmsId ?? '—', l.product, l.productGroup ?? '', l.purpose, String(l.required), String(l.allocated), l.shortfall ? String(l.shortfall) : '', l.qtyConfirmed === null ? 'NOT CONFIRMED' : String(l.qtyConfirmed), l.quantityBasis, l.rentalRate === null ? '—' : l.rentalRate === 0 ? '0 (unpriced)' : `R ${l.rentalRate.toFixed(2)}`, l.chargePeriod ?? '']),
    bottom,
    newPage,
  );
  y += 4;
  const para = (title: string, lines: string[]) => {
    if (!lines.length) return;
    if (y + 10 > bottom) y = newPage();
    doc.font('head').fontSize(3 * MM).fillColor('#0C0C0C').text(title.toUpperCase(), area.x * MM, y * MM);
    y += 5;
    for (const l of lines) {
      if (y + 4 > bottom) y = newPage();
      doc.font('body').fontSize(2.4 * MM).fillColor('#333333').text(`• ${l}`, (area.x + 2) * MM, y * MM, { width: (area.w - 4) * MM, lineBreak: false, ellipsis: true });
      y += 3.6;
    }
    y += 2;
  };
  para('Unresolved requirements (not in schedule)', result.bom.unresolved.map((u) => `${u.description} — ${u.reason}${u.candidates.length ? ` (candidates: ${u.candidates.join(', ')})` : ''}`));
  para('Non-inventory items', result.bom.nonInventory.map((n) => `${n.qty} × ${n.description} — ${n.note}`));
  para('Indicative rental value at listed rates', [...result.bom.rentalSummary.byPeriod.map((p) => `${p.chargePeriod}: R ${p.total.toFixed(2)} (${p.lines} lines)`), `${result.bom.rentalSummary.excludedZeroOrBlankRate} allocated line(s) with zero/blank rate excluded`, ...result.bom.rentalSummary.caveats]);

  // 5. Validation report
  doc.addPage();
  frame(doc, 'Validation report & assumption register', meta, result, '—');
  y = area.y;
  const vPage = () => {
    doc.addPage();
    frame(doc, 'Validation report (cont.)', meta, result, '—');
    return area.y;
  };
  y = table(
    doc,
    area.x,
    y,
    [
      { h: 'Check', w: 70 },
      { h: 'Result', w: 28 },
      { h: 'Data', w: 24 },
      { h: 'Severity', w: 18 },
      { h: 'Detail', w: area.w - 140 },
    ],
    result.validation.checks.map((c) => [c.title, c.result, c.dataStatus, c.severity, c.message]),
    bottom,
    vPage,
  );
  y += 4;
  const vpara = (title: string, lines: string[]) => {
    if (!lines.length) return;
    if (y + 10 > bottom) y = vPage();
    doc.font('head').fontSize(3 * MM).fillColor('#0C0C0C').text(title.toUpperCase(), area.x * MM, y * MM);
    y += 5;
    for (const l of lines) {
      if (y + 4 > bottom) y = vPage();
      doc.font('body').fontSize(2.4 * MM).fillColor('#333333').text(`• ${l}`, (area.x + 2) * MM, y * MM, { width: (area.w - 4) * MM, lineBreak: false, ellipsis: true });
      y += 3.6;
    }
    y += 2;
  };
  vpara(`Overall status: ${result.validation.overall}`, [result.validation.notCertification]);
  vpara('Human approvals required', result.validation.humanApprovalsRequired.map((h) => {
    const a = meta.approvals.filter((x) => x.discipline === h);
    return a.length ? `${h}: ${a.map((x) => `${x.decision} by ${x.user} ${x.at.slice(0, 10)}${x.comment ? ` — ${x.comment}` : ''}`).join('; ')}` : `${h}: PENDING`;
  }));
  vpara('Assumption register', result.assumptions.map((a) => `[${a.status}] ${a.text}${a.source.note ? ` — ${a.source.note}` : ''}`));
  vpara('Feasible alternatives', result.alternatives);

  doc.end();
  return done;
}
