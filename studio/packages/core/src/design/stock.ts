/**
 * Stock policy: how many units of an item the design engine may allocate.
 *
 *  - A user-confirmed owned quantity is a HARD limit (physical fact) — no headroom.
 *  - Otherwise, if the policy allows, the file quantity ("available to rent") is used as an
 *    availability GUIDELINE, with optional headroom (owner decision D-016: +20 %).
 *    Units beyond the file figure are reported as "over guideline".
 *  - Blank, zero or fractional file quantities give nothing to allocate.
 */
import type { StockItem } from './types.js';

export interface StockPolicy {
  /** Allocate against file quantities when no confirmed quantity exists. */
  useFileQuantities: boolean;
  /** Extra allowance above the file quantity, in percent (e.g. 20). */
  headroomPct: number;
}

export const STRICT_POLICY: StockPolicy = { useFileQuantities: false, headroomPct: 0 };
/** Owner decision 2026-11-07: file quantities are availability guidelines; up to 20 % more may be used. */
export const OWNER_GUIDELINE_POLICY: StockPolicy = { useFileQuantities: true, headroomPct: 20 };

export type StockBasis = 'CONFIRMED' | 'FILE_GUIDELINE' | 'NONE';

export function stockLimit(it: Pick<StockItem, 'qtyConfirmed' | 'qtyShown'>, policy: StockPolicy): { limit: number; guideline: number | null; basis: StockBasis } {
  if (it.qtyConfirmed !== null) return { limit: it.qtyConfirmed, guideline: null, basis: 'CONFIRMED' };
  const q = it.qtyShown;
  if (policy.useFileQuantities && q !== null && Number.isInteger(q) && q > 0) {
    const h = Math.max(0, Math.min(policy.headroomPct, 100));
    return { limit: Math.floor(q * (1 + h / 100) + 1e-9), guideline: q, basis: 'FILE_GUIDELINE' };
  }
  return { limit: 0, guideline: null, basis: 'NONE' };
}

export function describeStock(it: Pick<StockItem, 'qtyConfirmed' | 'qtyShown'> | undefined, policy: StockPolicy): string {
  if (!it) return '';
  const s = stockLimit(it, policy);
  if (s.basis === 'CONFIRMED') return ` (confirmed owned: ${s.limit})`;
  if (s.basis === 'FILE_GUIDELINE') return ` (availability guideline: ${s.guideline} in file${s.limit > s.guideline! ? `, up to ${s.limit} with ${policy.headroomPct} % headroom` : ''})`;
  return policy.useFileQuantities
    ? ` (no usable quantity: file shows ${it.qtyShown ?? 'blank'} and nothing confirmed)`
    : ` (owned quantity not yet confirmed — 0 allocatable; file shows ${it.qtyShown ?? 'blank'})`;
}
