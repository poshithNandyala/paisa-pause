import type { LocalDate } from './dates';
import {
  addDays,
  addMonthsClamped,
  daysInclusive,
  daysInMonth,
  inRange,
  makeDate,
  parts,
  weekday,
} from './dates';
import { isCompleted, refundPersonalPartOf, spendComponents, type SpendComponent } from './ledger';
import type { Paise } from './money';
import { divRound } from './money';
import type {
  AnchorMode,
  BudgetPeriod,
  CycleKind,
  Envelope,
  Hold,
  Settings,
  Snapshot,
  Transaction,
} from './types';

// ---------------------------------------------------------------------------
// Period boundaries

export interface DateRange {
  start: LocalDate;
  end: LocalDate;
}

export function paydayIn(y: number, m: number, paydayDay: number): LocalDate {
  return makeDate(y, m, Math.min(paydayDay, daysInMonth(y, m)));
}

export function periodRangeFor(
  date: LocalDate,
  cycle: CycleKind,
  weekStartsOn: number,
  paydayDay: number,
): DateRange {
  if (cycle === 'weekly') {
    const offset = (weekday(date) - weekStartsOn + 7) % 7;
    const start = addDays(date, -offset);
    return { start, end: addDays(start, 6) };
  }
  const { y, m } = parts(date);
  if (cycle === 'monthly') {
    return { start: makeDate(y, m, 1), end: makeDate(y, m, daysInMonth(y, m)) };
  }
  // payday: from this payday up to the day before the next one
  const thisPayday = paydayIn(y, m, paydayDay);
  if (date >= thisPayday) {
    const next = addMonthsClamped(makeDate(y, m, 1), 1);
    const np = parts(next);
    return { start: thisPayday, end: addDays(paydayIn(np.y, np.m, paydayDay), -1) };
  }
  const prev = addMonthsClamped(makeDate(y, m, 1), -1);
  const pp = parts(prev);
  return { start: paydayIn(pp.y, pp.m, paydayDay), end: addDays(thisPayday, -1) };
}

export function periodRangeForSettings(date: LocalDate, s: Settings): DateRange {
  return periodRangeFor(date, s.cycle, s.weekStartsOn, s.paydayDay);
}

/** The plan period covering `date`, if one exists. Latest-created wins on overlap. */
export function periodCovering(periods: readonly BudgetPeriod[], date: LocalDate): BudgetPeriod | undefined {
  let found: BudgetPeriod | undefined;
  for (const p of periods) {
    if (inRange(date, p.startDate, p.endDate)) {
      if (!found || p.createdAt > found.createdAt) found = p;
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Budget status

/** Does this purchase/refund fall inside the plan window (after the anchor)? */
export function inPlanWindow(t: Pick<Transaction, 'localDate' | 'occurredAt'>, period: BudgetPeriod): boolean {
  if (!inRange(t.localDate, period.startDate, period.endDate)) return false;
  if (period.anchorMode === 'remaining_now' && t.occurredAt <= period.anchoredAt) return false;
  return true;
}

/** A purchase that took money from this period's flexible plan. */
export function consumesPlan(expense: Transaction, period: BudgetPeriod): boolean {
  return (
    expense.kind === 'expense' &&
    isCompleted(expense) &&
    expense.budgetBucket === 'flexible' &&
    inPlanWindow(expense, period)
  );
}

export interface UnallocatedRefund {
  refund: Transaction;
  /** Your part of the refund — what could be added to the plan. */
  amount: Paise;
  reason: 'older_purchase' | 'unbudgeted_purchase' | 'no_linked_purchase';
}

export interface EnvelopeStatus {
  envelope: Envelope;
  used: Paise;
  limit: Paise;
  /** Rounded down to a whole percent; can exceed 100. */
  pct: number;
}

export interface BudgetStatus {
  period: BudgetPeriod;
  allocation: Paise;
  reallocated: Paise;
  /** Your flexible purchases in the window (personal share). */
  grossSpent: Paise;
  /** Refunds that went back into this plan. */
  refundsRestored: Paise;
  /** grossSpent - refundsRestored */
  netSpent: Paise;
  activeHolds: Hold[];
  holdsTotal: Paise;
  /** allocation + reallocated - netSpent - holdsTotal. Can be negative; never clamped. */
  remaining: Paise;
  /** Calendar days left including today (0 once the period is over). */
  daysLeft: number;
  /** remaining / daysLeft, to the paise. null when no days are left. */
  perDay: Paise | null;
  /** Pending flexible purchases, NOT included above. */
  pendingAmount: Paise;
  pendingCount: number;
  unallocatedRefunds: UnallocatedRefund[];
  components: SpendComponent[];
  envelopes: EnvelopeStatus[];
}

export function isHoldConsumed(hold: Hold, txns: readonly Transaction[]): boolean {
  return txns.some((t) => t.holdId === hold.id && t.kind === 'expense' && isCompleted(t));
}

export function activeHoldsFor(period: BudgetPeriod, snapshot: Pick<Snapshot, 'holds' | 'transactions'>): Hold[] {
  return snapshot.holds.filter(
    (h) =>
      h.periodId === period.id &&
      h.deletedAt === null &&
      h.releasedAt === null &&
      !isHoldConsumed(h, snapshot.transactions),
  );
}

export function budgetStatus(
  snapshot: Pick<Snapshot, 'transactions' | 'reallocations' | 'holds' | 'envelopes'>,
  period: BudgetPeriod,
  today: LocalDate,
): BudgetStatus {
  const byId = new Map(snapshot.transactions.map((t) => [t.id, t]));
  const assignedRefundIds = new Set(
    snapshot.reallocations.filter((r) => r.deletedAt === null && r.refundId).map((r) => r.refundId as string),
  );

  const components: SpendComponent[] = [];
  let grossSpent = 0;
  let refundsRestored = 0;
  let pendingAmount = 0;
  let pendingCount = 0;
  const unallocatedRefunds: UnallocatedRefund[] = [];

  for (const t of snapshot.transactions) {
    if (t.kind === 'expense') {
      if (t.budgetBucket === 'flexible' && t.state === 'pending' && inPlanWindow(t, period)) {
        pendingAmount += t.personalShare ?? t.amount;
        pendingCount += 1;
      }
      if (!consumesPlan(t, period)) continue;
      const parts = spendComponents(t);
      for (const c of parts) {
        grossSpent += c.amount;
        components.push(c);
      }
    } else if (t.kind === 'refund') {
      if (!isCompleted(t) || !inPlanWindow(t, period)) continue;
      const original = t.refundOfId ? byId.get(t.refundOfId) : undefined;
      if (original && consumesPlan(original, period)) {
        const parts = spendComponents(t);
        for (const c of parts) {
          refundsRestored += -c.amount;
          components.push(c);
        }
      } else if (!assignedRefundIds.has(t.id)) {
        const amount = refundPersonalPartOf(t);
        if (amount > 0) {
          unallocatedRefunds.push({
            refund: t,
            amount,
            reason: !original
              ? 'no_linked_purchase'
              : original.budgetBucket !== 'flexible'
                ? 'unbudgeted_purchase'
                : 'older_purchase',
          });
        }
      }
    }
  }

  const reallocated = snapshot.reallocations
    .filter((r) => r.periodId === period.id && r.deletedAt === null)
    .reduce((sum, r) => sum + r.amount, 0);
  const activeHolds = activeHoldsFor(period, snapshot);
  const holdsTotal = activeHolds.reduce((s, h) => s + h.amount, 0);
  const netSpent = grossSpent - refundsRestored;
  const remaining = period.allocation + reallocated - netSpent - holdsTotal;
  const daysLeft = today > period.endDate ? 0 : daysInclusive(today < period.startDate ? period.startDate : today, period.endDate);
  const perDay = daysLeft > 0 ? divRound(remaining, daysLeft) : null;

  const envelopes: EnvelopeStatus[] = snapshot.envelopes
    .filter((e) => e.deletedAt === null)
    .map((envelope) => {
      const used = components
        .filter((c) => c.categoryId === envelope.categoryId)
        .reduce((s, c) => s + c.amount, 0);
      const pct = envelope.limit > 0 ? Math.floor((used * 100) / envelope.limit) : 0;
      return { envelope, used, limit: envelope.limit, pct };
    });

  return {
    period,
    allocation: period.allocation,
    reallocated,
    grossSpent,
    refundsRestored,
    netSpent,
    activeHolds,
    holdsTotal,
    remaining,
    daysLeft,
    perDay,
    pendingAmount,
    pendingCount,
    unallocatedRefunds,
    components,
    envelopes,
  };
}

// ---------------------------------------------------------------------------
// Before I buy

export interface PurchasePreview {
  amount: Paise;
  daysLeft: number;
  before: { remaining: Paise; perDay: Paise | null };
  after: { remaining: Paise; perDay: Paise | null };
  /** One relevant comparison. */
  comparison:
    | { kind: 'envelope'; categoryId: string; used: Paise; limit: Paise; usedAfter: Paise }
    | { kind: 'share_of_left'; pct: number }
    | { kind: 'goes_over'; overBy: Paise }
    | { kind: 'already_over'; overBy: Paise };
}

export function previewPurchase(status: BudgetStatus, amount: Paise, categoryId: string | null): PurchasePreview {
  const after = status.remaining - amount;
  const perDay = (r: Paise) => (status.daysLeft > 0 ? divRound(r, status.daysLeft) : null);
  const envelope = categoryId ? status.envelopes.find((e) => e.envelope.categoryId === categoryId) : undefined;
  let comparison: PurchasePreview['comparison'];
  if (status.remaining < 0) {
    comparison = { kind: 'already_over', overBy: -status.remaining };
  } else if (after < 0) {
    comparison = { kind: 'goes_over', overBy: -after };
  } else if (envelope) {
    comparison = {
      kind: 'envelope',
      categoryId: envelope.envelope.categoryId,
      used: envelope.used,
      limit: envelope.limit,
      usedAfter: envelope.used + amount,
    };
  } else {
    const pct = status.remaining > 0 ? Math.round((amount * 100) / status.remaining) : 100;
    comparison = { kind: 'share_of_left', pct };
  }
  return {
    amount,
    daysLeft: status.daysLeft,
    before: { remaining: status.remaining, perDay: perDay(status.remaining) },
    after: { remaining: after, perDay: perDay(after) },
    comparison,
  };
}

// ---------------------------------------------------------------------------
// Changing the plan amount (explicit preview before switching)

export interface PlanChangePreview {
  current: { allocation: Paise; mode: AnchorMode; remaining: Paise };
  proposed: { allocation: Paise; mode: AnchorMode; remaining: Paise; countedSpending: Paise };
}

export function previewPlanChange(
  snapshot: Pick<Snapshot, 'transactions' | 'reallocations' | 'holds' | 'envelopes'>,
  period: BudgetPeriod,
  allocation: Paise,
  mode: AnchorMode,
  now: number,
  today: LocalDate,
): PlanChangePreview {
  const current = budgetStatus(snapshot, period, today);
  const proposedPeriod: BudgetPeriod = {
    ...period,
    allocation,
    anchorMode: mode,
    anchoredAt: mode === 'remaining_now' ? now : period.anchoredAt,
  };
  const proposed = budgetStatus(snapshot, proposedPeriod, today);
  return {
    current: { allocation: period.allocation, mode: period.anchorMode, remaining: current.remaining },
    proposed: { allocation, mode, remaining: proposed.remaining, countedSpending: proposed.netSpent },
  };
}
