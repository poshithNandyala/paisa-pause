import type { LocalDate } from './dates';
import { addDays, addMonthsClamped, parts } from './dates';
import type { Paise } from './money';
import { divRound } from './money';
import type { Obligation, ObligationSkip, Transaction } from './types';

/** Due dates of an obligation inside [from, to], in order. */
export function occurrencesBetween(o: Obligation, from: LocalDate, to: LocalDate, limit = 400): LocalDate[] {
  const out: LocalDate[] = [];
  const anchorDay = parts(o.anchorDate).d;
  let i = 0;
  let date = o.anchorDate;
  while (date <= to && i < limit) {
    if (date >= from) out.push(date);
    i += 1;
    if (o.cadence === 'weekly') date = addDays(o.anchorDate, 7 * i);
    else if (o.cadence === 'monthly') date = addMonthsClamped(o.anchorDate, i, anchorDay);
    else date = addMonthsClamped(o.anchorDate, 12 * i, anchorDay);
  }
  return out;
}

export type OccurrenceState = 'paid' | 'pending_payment' | 'skipped' | 'due' | 'overdue';

export interface Occurrence {
  obligation: Obligation;
  date: LocalDate;
  state: OccurrenceState;
  /** The real recorded charge, if any. Forecasts never count as spending. */
  linkedTxnId: string | null;
}

export function occurrenceState(
  o: Obligation,
  date: LocalDate,
  today: LocalDate,
  txns: readonly Transaction[],
  skips: readonly ObligationSkip[],
): { state: OccurrenceState; linkedTxnId: string | null } {
  const linked = txns.find(
    (t) => t.kind === 'expense' && t.obligationId === o.id && t.occurrenceDate === date && t.state !== 'failed' && t.state !== 'reversed',
  );
  if (linked) return { state: linked.state === 'completed' ? 'paid' : 'pending_payment', linkedTxnId: linked.id };
  if (skips.some((s) => s.obligationId === o.id && s.occurrenceDate === date)) {
    return { state: 'skipped', linkedTxnId: null };
  }
  return { state: date < today ? 'overdue' : 'due', linkedTxnId: null };
}

/**
 * Occurrences worth showing: anything overdue and unpaid in the last 60 days,
 * plus everything due in the next `daysAhead` days.
 */
export function upcomingOccurrences(
  obligations: readonly Obligation[],
  txns: readonly Transaction[],
  skips: readonly ObligationSkip[],
  today: LocalDate,
  daysAhead: number,
): Occurrence[] {
  const out: Occurrence[] = [];
  const from = addDays(today, -60);
  const to = addDays(today, daysAhead);
  for (const o of obligations) {
    if (o.deletedAt !== null || !o.active) continue;
    for (const date of occurrencesBetween(o, from, to)) {
      const { state, linkedTxnId } = occurrenceState(o, date, today, txns, skips);
      if (state === 'overdue' || state === 'due' || state === 'pending_payment') {
        out.push({ obligation: o, date, state, linkedTxnId });
      }
    }
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.obligation.name.localeCompare(b.obligation.name)));
  return out;
}

/**
 * A labelled planning equivalent per month (e.g. ₹1,200 yearly ≈ ₹100/month).
 * This is only for planning; it is never recorded as spending.
 */
export function monthlyPlanningEquivalent(o: Pick<Obligation, 'amount' | 'cadence'>): Paise {
  if (o.cadence === 'monthly') return o.amount;
  if (o.cadence === 'yearly') return divRound(o.amount, 12);
  return divRound(o.amount * 52, 12);
}

export function cadenceLabel(c: Obligation['cadence']): string {
  return c === 'weekly' ? 'every week' : c === 'monthly' ? 'every month' : 'every year';
}
