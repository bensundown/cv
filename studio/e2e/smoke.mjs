/**
 * End-to-end smoke test of the Phase-2 vertical slice in a real browser.
 * Usage: node e2e/smoke.mjs <baseUrl> <outDir>
 * Requires a running server (serving apps/web/dist) on an EMPTY database.
 * All inventory and venue data generated here is SYNTHETIC.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ExcelJS = require('../apps/server/node_modules/exceljs');
const PDFDocument = require('../apps/server/node_modules/pdfkit');

const base = process.argv[2] ?? 'http://127.0.0.1:8787';
const out = process.argv[3] ?? path.resolve('e2e-output');
fs.mkdirSync(out, { recursive: true });

async function fixtures() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Inventory');
  ws.addRow(['RMS ID', 'Product', 'Product group', "Qty shown ('available to rent')", 'Rental rate (R)', 'Charge period', 'Data flag']);
  for (const r of [
    ['9001', 'Leyard 2.6mm 500 x 500mm LED Panel', 'LED Screens', 160, 250, 'Day', null],
    ['9002', 'Novastar VX1000', 'LED Processing', 1, 1800, 'Day', null],
    ['9003', 'AluStage Deck 2m x 1m', 'Staging', 60, 300, 'Day', null],
    ['9004', 'AluStage Leg 1m', 'Staging', 300, 0, 'Day', null],
    ['9005', 'FBT Muse 210LA', 'Audio', 12, 900, 'Day', null],
    ['9006', 'Allen & Heath SQ-6', 'Audio', 0, 2500, 'Day', 'check'],
    ['9007', 'Chauvet Rogue R2 Spot', 'Lighting', 12, 450, 'Day', null],
    ['9008', 'Clay Paky Sharpy Beam', 'Lighting', 10, 500, 'Day', null],
    ['9009', 'Generic LED Wash Batten', 'Lighting', 10, 150, 'Day', null],
    ['9010', 'ChamSys MagicQ MQ80', 'Lighting Control', 1, 1200, 'Day', null],
  ])
    ws.addRow(r);
  const xlsxPath = path.join(out, 'SYNTHETIC_inventory.xlsx');
  await wb.xlsx.writeFile(xlsxPath);
  // Synthetic A3 plan at 1:200 → 1 m = 5 mm = 14.173 pt. Room 40 × 30 m.
  const pdfPath = path.join(out, 'SYNTHETIC_plan.pdf');
  await new Promise((res) => {
    const d = new PDFDocument({ size: 'A3', layout: 'landscape', margin: 0 });
    const s = fs.createWriteStream(pdfPath);
    d.pipe(s);
    const k = (72 / 25.4) * 5; // pt per metre
    const ox = 150, oy = 150;
    d.lineWidth(2).rect(ox, oy, 40 * k, 30 * k).stroke();
    for (const [x, y] of [[13, 10], [27, 10], [13, 20], [27, 20]]) d.rect(ox + x * k - 0.3 * k, oy + y * k - 0.3 * k, 0.6 * k, 0.6 * k).fill('#555');
    d.fillColor('#000').fontSize(12).text('40.00 m', ox + 20 * k - 20, oy - 20).text('30.00 m', ox - 60, oy + 15 * k);
    d.fontSize(10).text('SYNTHETIC TEST PLAN — 1:200 @ A3', ox, oy + 30 * k + 20);
    d.end();
    s.on('finish', res);
  });
  return { xlsxPath, pdfPath, k: (72 / 25.4) * 5, ox: 150, oy: 150 };
}

const step = async (name, fn) => {
  process.stdout.write(`• ${name} … `);
  await fn();
  console.log('ok');
};

const f = await fixtures();
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.error('PAGE ERROR', e.message, (e.stack ?? '').split('\n').slice(0, 6).join(' | ')));
page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'e2e sign-off note' : undefined));

try {
  await step('first-run setup', async () => {
    await page.goto(base);
    await page.getByText('Create the admin account').waitFor();
    const inputs = page.locator('form input');
    await inputs.nth(0).fill('E2E Admin');
    await inputs.nth(1).fill('e2e@example.test');
    await inputs.nth(2).fill('e2e password 123');
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.getByRole('heading', { name: 'Projects' }).waitFor();
  });

  await step('upload inventory and preview', async () => {
    await page.getByRole('link', { name: 'Inventory' }).click();
    await page.locator('input[type=file]').setInputFiles(f.xlsxPath);
    await page.getByText('Detected columns').waitFor();
    await page.screenshot({ path: path.join(out, '01-import-preview.png'), fullPage: true });
    await page.getByRole('button', { name: 'Apply as new inventory snapshot' }).click();
    await page.getByText('snapshot v1').waitFor();
  });

  await step('confirm owned quantities', async () => {
    await page.getByLabel('Select all shown').check();
    await page.getByPlaceholder(/Basis/).fill('E2E synthetic stock count');
    await page.getByText('I confirm these are quantities').click();
    await page.getByRole('button', { name: /Accept file qty as owned/ }).click();
    await page.getByText(/9 of 10 items are confirmed/).waitFor();
    await page.screenshot({ path: path.join(out, '02-inventory.png'), fullPage: true });
  });

  const recordSpecs = async (product, pairs) => {
    await page.getByRole('link', { name: 'Inventory' }).click();
    await page.getByRole('link', { name: product }).click();
    await page.getByRole('heading', { name: product }).waitFor();
    for (const [key, v] of pairs) {
      await page.locator('select').filter({ hasText: 'Spec…' }).selectOption(key);
      await page.getByPlaceholder('Value').fill(v);
      await page.getByPlaceholder('Source reference (document, page)').fill('SYNTHETIC e2e value');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.waitForTimeout(250);
    }
  };
  await step('record equipment specs (provisional, synthetic)', async () => {
    await recordSpecs('Novastar VX1000', [['total_pixel_capacity', '6500000'], ['output_ports', '10'], ['pixels_per_port', '650000'], ['max_width_px', '10240'], ['max_height_px', '8192']]);
    await page.screenshot({ path: path.join(out, '03-equipment.png'), fullPage: true });
    await recordSpecs('Chauvet Rogue R2 Spot', [['dmx_footprint_ch', '16'], ['max_power_w', '400']]);
    await recordSpecs('Clay Paky Sharpy Beam', [['dmx_footprint_ch', '16'], ['max_power_w', '200']]);
    await recordSpecs('Generic LED Wash Batten', [['dmx_footprint_ch', '8'], ['max_power_w', '150']]);
    await recordSpecs('ChamSys MagicQ MQ80', [['dmx_universes', '4']]);
  });

  await step('venue: upload plan, calibrate, trace', async () => {
    await page.getByRole('link', { name: 'Venues' }).click();
    await page.getByPlaceholder(/Venue name/).fill('Synthetic Ballroom');
    await page.getByRole('button', { name: 'Add venue' }).click();
    await page.locator('input[type=file]').setInputFiles(f.pdfPath);
    const overlay = page.locator('.calib svg');
    await overlay.waitFor();
    // Recompute the overlay position on every click: the page may scroll between clicks.
    const at = (xm, ym) => ({ xm, ym });
    const click = async ({ xm, ym }) => {
      await page.evaluate(() => document.querySelector('.calib')?.scrollIntoView({ block: 'start' }));
      const box = await overlay.boundingBox();
      await page.mouse.click(box.x + f.ox + xm * f.k, box.y + f.oy + ym * f.k);
    };
    await page.getByRole('button', { name: '1 · Reference dimension' }).click();
    await click(at(0, 0));
    await click(at(40, 0));
    const refForm = page.locator('h3:has-text("1 · Reference dimension") + p + div');
    await refForm.locator('input').nth(0).fill('40');
    await refForm.locator('input').nth(2).fill('Dimension string 40.00 m on synthetic plan');
    await page.getByRole('button', { name: '2 · Check dimension' }).click();
    await click(at(0, 0));
    await click(at(0, 30));
    const chkForm = page.locator('h3:has-text("2 · Independent check") + p + div');
    await chkForm.locator('input').nth(0).fill('30');
    await chkForm.locator('input').nth(2).fill('Dimension string 30.00 m on synthetic plan');
    await page.getByRole('button', { name: 'Calibrate scale' }).click();
    await page.getByText('mm / pt').waitFor();
    await page.getByRole('button', { name: '3 · Trace room outline' }).click();
    for (const [x, y] of [[0, 0], [40, 0], [40, 30], [0, 30]]) await click(at(x, y));
    await page.getByRole('button', { name: '4 · Columns / obstructions' }).click();
    for (const [cx, cy] of [[13, 10], [27, 10], [13, 20], [27, 20]]) {
      for (const [dx, dy] of [[-0.3, -0.3], [0.3, -0.3], [0.3, 0.3], [-0.3, 0.3]]) await click(at(cx + dx, cy + dy));
      await page.getByRole('button', { name: 'Close obstruction' }).click();
    }
    await page.locator('input[placeholder="unknown"]').first().fill('8');
    // stage on W4 (west wall, x = 0) facing the 40 m length
    await page.locator('label:has-text("Default stage wall") + select').first().selectOption('3');
    await page.getByRole('button', { name: 'Save venue geometry from plan' }).click();
    await page.getByText(/Saved venue geometry v1/).waitFor();
    await page.screenshot({ path: path.join(out, '04-venue-calibrated.png'), fullPage: true });
  });

  await step('new project from brief', async () => {
    await page.getByRole('link', { name: 'Projects' }).click();
    await page.getByRole('link', { name: 'New design from brief' }).click();
    await page.getByPlaceholder('Client gala 2027').fill('E2E Gala');
    const venueSelect = page.locator('label:has-text("Venue") + select');
    const value = await venueSelect.locator('option', { hasText: 'Synthetic Ballroom' }).getAttribute('value');
    await venueSelect.selectOption(value);
    await page.getByText('What the interpreter understood').waitFor();
    await page.getByRole('button', { name: 'Generate design' }).click();
    await page.getByText(/Overall status R1/).waitFor();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(out, '05-workspace-plan.png') });
  });

  await step('3D view and render capture', async () => {
    await page.getByRole('button', { name: '3D scene' }).click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(out, '06-workspace-3d.png') });
    await page.getByRole('button', { name: 'Save render' }).click();
    await page.getByText(/Render saved/).waitFor();
  });

  await step('LED cabinet plan', async () => {
    await page.getByRole('button', { name: 'LED cabinet plan' }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(out, '07-led-plan.png') });
  });

  await step('conversational revision', async () => {
    await page.getByPlaceholder(/Make the stage 2 metres wider/).fill('Make the stage 2 metres wider');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.getByText(/Revision 2 status/).waitFor();
    await page.getByRole('button', { name: '2D plan' }).click();
    await page.getByText('Stage 14.00 m', { exact: false }).first().waitFor();
    await page.getByPlaceholder(/Make the stage 2 metres wider/).fill('Show me the view from the VIP tables.');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(out, '08-vip-view.png') });
  });

  await step('lighting commands', async () => {
    await page.getByPlaceholder(/Make the stage 2 metres wider/).fill('Make the lighting more dramatic');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.getByText(/Revision 3 status/).waitFor();
    await page.getByText(/16 fixtures/).first().waitFor(); // 14 m stage, dramatic: 10 beams (stock-limited from 11) + 6 washes
    await page.getByRole('button', { name: '3D scene' }).click();
    await page.locator('select').filter({ hasText: 'Overview' }).selectOption('overview');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(out, '09-dramatic-3d.png') });
    await page.getByPlaceholder(/Make the stage 2 metres wider/).fill('Use fewer moving heads');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.getByText(/Revision 4 status/).waitFor();
    await page.getByText(/14 fixtures/).first().waitFor();
    await page.getByRole('button', { name: 'Equipment' }).click();
    await page.getByText(/DMX patch \(dramatic\)/).waitFor();
    await page.screenshot({ path: path.join(out, '10-dmx-patch.png') });
  });

  await step('exports', async () => {
    for (const [name, file] of [['PDF', 'export.pdf'], ['Equipment CSV', 'equipment.csv']]) {
      const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name }).click()]);
      await dl.saveAs(path.join(out, file));
    }
    const pdf = fs.readFileSync(path.join(out, 'export.pdf'));
    if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('PDF export invalid');
  });
  console.log(`\nAll steps passed. Screenshots and exports in ${out}`);
} catch (e) {
  await page.screenshot({ path: path.join(out, 'FAILURE.png'), fullPage: true }).catch(() => undefined);
  console.error('\nFAILED:', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
