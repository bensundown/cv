/**
 * Audio rules (first pass): PA system selection, box counts from throw distance, console and
 * stage-box pairing, wireless channels. Pure helpers; the generator places and allocates.
 *
 * This is a CONCEPT: box counts are rules of thumb (ESTIMATED). Coverage, SPL and splay angles
 * must be designed in the manufacturer's prediction software (e.g. FBT's EASE Focus data) and
 * signed off by a competent engineer. Nothing here certifies acoustic performance.
 */
import type { Confidence } from '../provenance.js';
import type { StockItem } from './types.js';

/** Rule of thumb: ~1 line-array box per 6 m of throw, 2–6 per side when ground-stacked. */
export function boxesForThrow(throwMm: number): number {
  return Math.min(6, Math.max(2, Math.ceil(throwMm / 6000)));
}

/** Rule of thumb: one dual-18" sub per two line-array boxes per side (min 1). */
export const subsForBoxes = (boxes: number) => Math.max(1, Math.ceil(boxes / 2));

export interface CompatFact {
  console: RegExp;
  stageBox: RegExp;
  link: string;
  status: Confidence;
  ref: string;
  url: string;
}

/**
 * Console ↔ stage-box compatibility from Allen & Heath sources (forum / retailer excerpts).
 * ESTIMATED until a reviewer confirms against the current A&H compatibility chart.
 */
export const AH_COMPAT: CompatFact[] = [
  { console: /\bsq-? ?[567]\b/i, stageBox: /\bdx ?168\b/i, link: 'SLink (DX mode, 96 kHz)', status: 'ESTIMATED', ref: 'Allen & Heath community forum / retailer listings: DX168 is for SLink on SQ and dLive', url: 'https://forums.allen-heath.com/t/sq-5-and-sq6-with-stage-boxes-monitor-split/6912' },
  { console: /\bsq-? ?[567]\b/i, stageBox: /\bar ?2412\b/i, link: 'SLink (dSnake mode, 48 kHz)', status: 'ESTIMATED', ref: 'Allen & Heath community forum: SQ SLink port is compatible with dSnake expanders (AR2412, AR84, AB168)', url: 'https://forums.allen-heath.com/t/using-sq5-with-ar2412-purple/13476' },
  { console: /\bqu-? ?\d+\b/i, stageBox: /\bar ?2412\b/i, link: 'dSnake', status: 'ESTIMATED', ref: 'Allen & Heath community forum: compatible stage boxes for Qu are AB168, AR2412, AR84', url: 'https://community.allen-heath.com/forums/search/DX168++AB168/page/2' },
];

/** Console preference for a mid/large event (owner can override with a param). */
const CONSOLE_PREFERENCE = [/\bsq-? ?6\b/i, /\bsq-? ?5\b/i, /\bqu-? ?16\b/i, /\bcq-? ?18/i, /\bqu-? ?5\b/i, /\bzed/i];

export function pickConsole(stock: StockItem[], limit: (it: StockItem) => number, preferredId: string | null): StockItem | null {
  const consoles = stock.filter((s) => s.category === 'MIXING_CONSOLE' && limit(s) > 0);
  if (preferredId) return consoles.find((c) => c.itemId === preferredId) ?? null;
  for (const re of CONSOLE_PREFERENCE) {
    const c = consoles.find((x) => re.test(x.product));
    if (c) return c;
  }
  return consoles[0] ?? null;
}

export function pickStageBox(stock: StockItem[], console: StockItem, limit: (it: StockItem) => number): { box: StockItem; fact: CompatFact } | null {
  for (const fact of AH_COMPAT) {
    if (!fact.console.test(console.product)) continue;
    const box = stock.find((s) => s.category === 'STAGE_BOX' && fact.stageBox.test(s.product) && limit(s) > 0);
    if (box) return { box, fact };
  }
  return null;
}

/** Prefer subs from the same family as the mains (e.g. "Muse" with "Muse"), then most stock. */
export function pickFamily(cands: StockItem[], familyOf: StockItem | null, limit: (it: StockItem) => number): StockItem | null {
  const fam = familyOf?.product.toLowerCase().match(/\b(muse|horizon|subline|x-?lite|x-?pro|vertus)\b/)?.[1];
  const usable = cands.filter((c) => limit(c) > 0);
  const same = fam ? usable.filter((c) => c.product.toLowerCase().includes(fam)) : [];
  const pool = same.length ? same : usable;
  return [...pool].sort((a, b) => limit(b) - limit(a) || a.product.localeCompare(b.product))[0] ?? null;
}
