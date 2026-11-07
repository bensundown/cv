/**
 * LED wall calculations: cabinet grid, resolution, processor capacity, data
 * chains and power. Pure arithmetic over sourced inputs; anything not known is
 * reported as UNKNOWN rather than assumed.
 */
import { derive, type Sourced, unknown, weakest } from '../provenance.js';
import { isMultiple } from '../units.js';

export interface CabinetGrid {
  cols: number;
  rows: number;
  count: number;
}

/** Exact cabinet grid for a W × H wall, or null when cabinets don't tile exactly. */
export function cabinetGrid(widthMm: number, heightMm: number, cabW: number, cabH: number): CabinetGrid | null {
  if (!isMultiple(widthMm, cabW) || !isMultiple(heightMm, cabH)) return null;
  const cols = Math.round(widthMm / cabW);
  const rows = Math.round(heightMm / cabH);
  return { cols, rows, count: cols * rows };
}

/** Nearest exact sizes (floor/ceil in each axis). */
export function nearestWallSizes(widthMm: number, heightMm: number, cabW: number, cabH: number) {
  const ws = [...new Set([Math.floor(widthMm / cabW), Math.ceil(widthMm / cabW)])].filter((n) => n > 0);
  const hs = [...new Set([Math.floor(heightMm / cabH), Math.ceil(heightMm / cabH)])].filter((n) => n > 0);
  const out: { widthMm: number; heightMm: number; cabinets: number }[] = [];
  for (const c of ws) for (const r of hs) out.push({ widthMm: c * cabW, heightMm: r * cabH, cabinets: c * r });
  return out;
}

export function wallResolution(grid: CabinetGrid, pxW: Sourced<number>, pxH: Sourced<number>): Sourced<{ w: number; h: number }> {
  return derive([pxW, pxH], () => ({ w: grid.cols * pxW.value!, h: grid.rows * pxH.value! }), 'cabinet grid × pixels per cabinet');
}

export interface ProcessorSpecs {
  totalPixelCapacity: Sourced<number>;
  outputPorts: Sourced<number>;
  pixelsPerPort: Sourced<number>;
  maxWidthPx: Sourced<number>;
  maxHeightPx: Sourced<number>;
}

export interface ProcessorCheck {
  result: 'PASS' | 'FAIL' | 'UNKNOWN';
  portsNeeded: number | null;
  cabinetsPerPort: number | null;
  reasons: string[];
  status: ReturnType<typeof weakest>;
}

export function checkProcessor(grid: CabinetGrid, pxW: Sourced<number>, pxH: Sourced<number>, p: ProcessorSpecs): ProcessorCheck {
  const inputs = [pxW, pxH, p.totalPixelCapacity, p.outputPorts, p.pixelsPerPort];
  const missing = [
    ['cabinet pixels (w)', pxW],
    ['cabinet pixels (h)', pxH],
    ['processor total pixel capacity', p.totalPixelCapacity],
    ['processor output ports', p.outputPorts],
    ['processor pixels per port', p.pixelsPerPort],
  ].filter(([, s]) => (s as Sourced<number>).value === null);
  if (missing.length) {
    return { result: 'UNKNOWN', portsNeeded: null, cabinetsPerPort: null, reasons: missing.map(([l]) => `Missing ${l as string}`), status: 'UNKNOWN' };
  }
  const reasons: string[] = [];
  const cabPx = pxW.value! * pxH.value!;
  const totalPx = grid.count * cabPx;
  const cabinetsPerPort = Math.floor(p.pixelsPerPort.value! / cabPx);
  if (cabinetsPerPort < 1) reasons.push('A single cabinet exceeds the per-port pixel capacity');
  const portsNeeded = cabinetsPerPort >= 1 ? Math.ceil(grid.count / cabinetsPerPort) : null;
  if (totalPx > p.totalPixelCapacity.value!) reasons.push(`Total ${totalPx.toLocaleString('en-ZA')} px exceeds capacity ${p.totalPixelCapacity.value!.toLocaleString('en-ZA')} px`);
  if (portsNeeded !== null && portsNeeded > p.outputPorts.value!) reasons.push(`Needs ${portsNeeded} ports; processor has ${p.outputPorts.value}`);
  const wPx = grid.cols * pxW.value!;
  const hPx = grid.rows * pxH.value!;
  const dimInputs: Sourced<number>[] = [];
  if (p.maxWidthPx.value !== null) {
    dimInputs.push(p.maxWidthPx);
    if (wPx > p.maxWidthPx.value) reasons.push(`Width ${wPx} px exceeds max ${p.maxWidthPx.value} px`);
  } else reasons.push('Max output width unknown (not checked)');
  if (p.maxHeightPx.value !== null) {
    dimInputs.push(p.maxHeightPx);
    if (hPx > p.maxHeightPx.value) reasons.push(`Height ${hPx} px exceeds max ${p.maxHeightPx.value} px`);
  } else reasons.push('Max output height unknown (not checked)');
  const hardFail = reasons.some((r) => !r.endsWith('(not checked)'));
  const incomplete = p.maxWidthPx.value === null || p.maxHeightPx.value === null;
  return {
    result: hardFail ? 'FAIL' : incomplete ? 'UNKNOWN' : 'PASS',
    portsNeeded,
    cabinetsPerPort,
    reasons,
    status: weakest(...inputs.map((i) => i.status), ...dimInputs.map((i) => i.status)),
  };
}

/** Serpentine column-wise cable order, split into chains of at most `perPort` cabinets. */
export function dataChains(grid: CabinetGrid, perPort: number, idOf: (col: number, row: number) => string): string[][] {
  const order: string[] = [];
  for (let c = 0; c < grid.cols; c++) {
    for (let k = 0; k < grid.rows; k++) {
      const row = c % 2 === 0 ? k : grid.rows - 1 - k; // up one column, down the next
      order.push(idOf(c, row));
    }
  }
  const chains: string[][] = [];
  for (let i = 0; i < order.length; i += perPort) chains.push(order.slice(i, i + perPort));
  return chains;
}

export interface PowerEstimate {
  totalW: Sourced<number>;
  totalA: Sourced<number>;
  circuits: Sourced<number>;
  cabinetsPerCircuit: number | null;
}

export function ledPower(count: number, maxPowerW: Sourced<number>, voltageV: Sourced<number>, circuitA: Sourced<number>, factor: Sourced<number>): PowerEstimate {
  if (maxPowerW.value === null) {
    return {
      totalW: unknown('Maximum cabinet power not recorded', 'W'),
      totalA: unknown('Maximum cabinet power not recorded', 'A'),
      circuits: unknown('Maximum cabinet power not recorded'),
      cabinetsPerCircuit: null,
    };
  }
  const totalW = derive([maxPowerW], () => count * maxPowerW.value!, `${count} cabinets × max power`, 'W');
  const totalA = derive([totalW, voltageV], () => totalW.value! / voltageV.value!, 'total W ÷ supply voltage', 'A');
  const perCircuitW = (voltageV.value ?? 0) * (circuitA.value ?? 0) * (factor.value ?? 0);
  const cabinetsPerCircuit = maxPowerW.value > 0 ? Math.floor(perCircuitW / maxPowerW.value) : null;
  const circuits =
    cabinetsPerCircuit && cabinetsPerCircuit > 0
      ? derive([maxPowerW, voltageV, circuitA, factor], () => Math.ceil(count / cabinetsPerCircuit), 'cabinets ÷ cabinets per circuit')
      : unknown<number>('Cabinet max power exceeds one circuit planning capacity');
  return { totalW, totalA, circuits, cabinetsPerCircuit };
}
