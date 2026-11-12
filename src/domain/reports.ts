import type { DateRange } from './budget';
import type { LocalDate } from './dates';
import { addDays, daysInclusive, eachDate, inRange, maxDate, minDate } from './dates';
import { isCompleted, spendComponents } from './ledger';
import type { Paise } from './money';
import { divRound } from './money';
import type { DayStatus, Snapshot, Tags, Transaction } from './types';

export interface CategoryLine {
  categoryId: string;
  gross: Paise;
  refunds: Paise;
  /** Can be negative (e.g. a refund for something bought last month). */
  net: Paise;
  purchases: number;
}

export interface DayLine {
  date: LocalDate;
  gross: Paise;
  refunds: Paise;
  net: Paise;
  entries: number;
  review: DayStatus | null;
  /** Before you started recording everything. */
  beforeCoverage: boolean;
  future: boolean;
}

export interface AccountMovement {
  accountId: string;
  out: Paise;
  in: Paise;
}

export interface Report {
  range: DateRange;
  /** Calendar days actually observed: from coverage start (or range start) to today (or range end). */
  observed: { start: LocalDate; end: LocalDate; days: number } | null;
  /** The observed span is shorter than the range. */
  partial: boolean;
  gross: Paise;
  refunds: Paise;
  net: Paise;
  byCategory: CategoryLine[];
  days: DayLine[];
  /** net within the observed span ÷ calendar days in it (zero-entry days count). */
  dailyAverage: Paise | null;
  observedNet: Paise;
  completeness: { complete: number; missing: number; unknown: number };
  /** Spending recorded on dates before coverage start (shown, not averaged). */
  beforeCoverageNet: Paise;
  movements: {
    cardPurchases: Paise;
    cardRepayments: Paise;
    savingsTransfers: Paise;
    otherTransfers: Paise;
    income: Paise;
    reimbursements: Paise;
    adjustments: number;
    byAccount: AccountMovement[];
  };
  pending: { count: number; amount: Paise };
  awaitingReversal: { count: number; amount: Paise };
  purchaseCount: number;
  refundCount: number;
  /** Your personal purchase amounts by label (gross, before refunds). */
  tagTotals: {
    necessity: Record<Tags['necessity'], Paise>;
    planned: Record<Tags['planned'], Paise>;
    worth: Record<Tags['worth'], Paise>;
  };
}

export function buildReport(snapshot: Snapshot, range: DateRange, today: LocalDate): Report {
  const coverageStart = snapshot.settings.trackingStartDate;
  const accountsById = new Map(snapshot.accounts.map((a) => [a.id, a]));
  const reviews = new Map(snapshot.dayReviews.map((r) => [r.localDate, r.status]));

  const obsStart = maxDate(range.start, coverageStart);
  const obsEnd = minDate(range.end, today);
  const observed = obsStart <= obsEnd ? { start: obsStart, end: obsEnd, days: daysInclusive(obsStart, obsEnd) } : null;

  const dayMap = new Map<LocalDate, DayLine>();
  for (const date of eachDate(range.start, range.end)) {
    dayMap.set(date, {
      date,
      gross: 0,
      refunds: 0,
      net: 0,
      entries: 0,
      review: reviews.get(date) ?? null,
      beforeCoverage: date < coverageStart,
      future: date > today,
    });
  }

  const cats = new Map<string, CategoryLine>();
  const catLine = (id: string) => {
    let line = cats.get(id);
    if (!line) {
      line = { categoryId: id, gross: 0, refunds: 0, net: 0, purchases: 0 };
      cats.set(id, line);
    }
    return line;
  };

  let gross = 0;
  let refunds = 0;
  let purchaseCount = 0;
  let refundCount = 0;
  const pending = { count: 0, amount: 0 };
  const awaitingReversal = { count: 0, amount: 0 };
  const movements: Report['movements'] = {
    cardPurchases: 0,
    cardRepayments: 0,
    savingsTransfers: 0,
    otherTransfers: 0,
    income: 0,
    reimbursements: 0,
    adjustments: 0,
    byAccount: [],
  };
  const byAccount = new Map<string, AccountMovement>();
  const touch = (accountId: string) => {
    let m = byAccount.get(accountId);
    if (!m) {
      m = { accountId, out: 0, in: 0 };
      byAccount.set(accountId, m);
    }
    return m;
  };
  const tagTotals: Report['tagTotals'] = {
    necessity: { necessary: 0, optional: 0, mixed: 0, unspecified: 0 },
    planned: { planned: 0, unplanned: 0, unknown: 0 },
    worth: { worth_it: 0, mixed: 0, would_skip: 0, unsure: 0, unspecified: 0 },
  };

  for (const t of snapshot.transactions) {
    if (!inRange(t.localDate, range.start, range.end)) continue;
    if (t.state === 'pending') {
      pending.count += 1;
      pending.amount += t.amount;
    }
    if (t.state === 'awaiting_reversal') {
      awaitingReversal.count += 1;
      awaitingReversal.amount += t.amount;
    }
    if (t.state === 'completed' || t.state === 'awaiting_reversal') {
      if (t.fromAccountId) touch(t.fromAccountId).out += t.amount;
      if (t.toAccountId) touch(t.toAccountId).in += t.amount;
    }
    if (!isCompleted(t)) continue;
    const day = dayMap.get(t.localDate);
    if (day) day.entries += 1;

    const from = t.fromAccountId ? accountsById.get(t.fromAccountId) : undefined;
    const to = t.toAccountId ? accountsById.get(t.toAccountId) : undefined;

    switch (t.kind) {
      case 'expense': {
        purchaseCount += 1;
        if (from?.kind === 'credit_card') movements.cardPurchases += t.amount;
        const parts = spendComponents(t);
        const personal = parts.reduce((s, c) => s + c.amount, 0);
        tagTotals.necessity[t.tags.necessity] += personal;
        tagTotals.planned[t.tags.planned] += personal;
        tagTotals.worth[t.tags.worth] += personal;
        for (const c of parts) {
          gross += c.amount;
          const line = catLine(c.categoryId);
          line.gross += c.amount;
          line.net += c.amount;
          if (day) {
            day.gross += c.amount;
            day.net += c.amount;
          }
        }
        // Count the purchase once per category it touches.
        for (const id of new Set(parts.map((p) => p.categoryId))) catLine(id).purchases += 1;
        break;
      }
      case 'refund': {
        refundCount += 1;
        for (const c of spendComponents(t)) {
          const amount = -c.amount;
          refunds += amount;
          const line = catLine(c.categoryId);
          line.refunds += amount;
          line.net -= amount;
          if (day) {
            day.refunds += amount;
            day.net -= amount;
          }
        }
        break;
      }
      case 'transfer': {
        if (to?.kind === 'credit_card') movements.cardRepayments += t.amount;
        else if (to?.isSavings && !from?.isSavings) movements.savingsTransfers += t.amount;
        else movements.otherTransfers += t.amount;
        break;
      }
      case 'income':
        movements.income += t.amount;
        break;
      case 'reimbursement':
        movements.reimbursements += t.amount;
        break;
      case 'adjustment':
        movements.adjustments += 1;
        break;
    }
  }

  const days = [...dayMap.values()];
  let observedNet = 0;
  let beforeCoverageNet = 0;
  const completeness = { complete: 0, missing: 0, unknown: 0 };
  for (const d of days) {
    if (d.beforeCoverage) beforeCoverageNet += d.net;
    if (observed && inRange(d.date, observed.start, observed.end)) {
      observedNet += d.net;
      if (d.review === 'complete') completeness.complete += 1;
      else if (d.review === 'missing') completeness.missing += 1;
      else completeness.unknown += 1;
    }
  }

  movements.byAccount = [...byAccount.values()];
  const byCategory = [...cats.values()].sort((a, b) => b.net - a.net || a.categoryId.localeCompare(b.categoryId));

  return {
    range,
    observed,
    partial: observed ? observed.start !== range.start || observed.end !== range.end : false,
    gross,
    refunds,
    net: gross - refunds,
    byCategory,
    days,
    dailyAverage: observed && observed.days > 0 ? divRound(observedNet, observed.days) : null,
    observedNet,
    completeness,
    beforeCoverageNet,
    movements,
    pending,
    awaitingReversal,
    purchaseCount,
    refundCount,
    tagTotals,
  };
}

/** Net personal spending (purchases − refunds) over [start, end]. */
export function netSpending(txns: readonly Transaction[], start: LocalDate, end: LocalDate): Paise {
  let net = 0;
  for (const t of txns) {
    if (!inRange(t.localDate, start, end)) continue;
    for (const c of spendComponents(t)) net += c.amount;
  }
  return net;
}

export interface Comparison {
  days: number;
  current: { start: LocalDate; end: LocalDate; net: Paise };
  previous: { start: LocalDate; end: LocalDate; net: Paise };
}

/**
 * Compare the elapsed part of this period with the same number of days at the
 * start of the previous period. Only when both are fully inside coverage.
 */
export function compareWithPrevious(
  snapshot: Snapshot,
  range: DateRange,
  previous: DateRange,
  today: LocalDate,
): Comparison | null {
  const coverageStart = snapshot.settings.trackingStartDate;
  const currentEnd = minDate(range.end, today);
  if (currentEnd < range.start) return null;
  const days = daysInclusive(range.start, currentEnd);
  const prevEnd = addDays(previous.start, days - 1);
  if (prevEnd > previous.end) return null;
  if (previous.start < coverageStart || range.start < coverageStart) return null;
  return {
    days,
    current: { start: range.start, end: currentEnd, net: netSpending(snapshot.transactions, range.start, currentEnd) },
    previous: { start: previous.start, end: prevEnd, net: netSpending(snapshot.transactions, previous.start, prevEnd) },
  };
}

/** Entries that need a look: uncategorized purchases or unresolved status. */
export function incompleteEntries(snapshot: Snapshot): Transaction[] {
  return snapshot.transactions.filter(
    (t) =>
      t.state === 'pending' ||
      t.state === 'awaiting_reversal' ||
      (t.kind === 'expense' && t.allocations.some((a) => a.categoryId === 'uncategorized')) ||
      (snapshot.settings.mode === 'account_aware' && t.kind === 'expense' && !t.fromAccountId),
  );
}

/** Days since coverage start (up to yesterday) with no review mark. */
export function unreviewedDays(snapshot: Snapshot, today: LocalDate, lookbackDays = 7): LocalDate[] {
  const reviewed = new Set(snapshot.dayReviews.map((r) => r.localDate));
  const start = maxDate(snapshot.settings.trackingStartDate, addDays(today, -lookbackDays));
  const end = addDays(today, -1);
  if (start > end) return [];
  return eachDate(start, end).filter((d) => !reviewed.has(d));
}
