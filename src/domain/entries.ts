import type { LocalDate } from './dates';
import { addDays } from './dates';
import { personalShareOf } from './ledger';
import type { Paise } from './money';
import { apportion, divRound } from './money';
import type { BudgetBucket, CategoryAllocation, Rail, Tags, Transaction, TxnKind } from './types';
import { DEFAULT_TAGS, UNCATEGORIZED_ID } from './types';

export interface EntryInput {
  id: string;
  kind: TxnKind;
  amount: Paise;
  occurredAt: number;
  localDate: LocalDate;
  now: number;
  state?: Transaction['state'];
  fromAccountId?: string | null;
  toAccountId?: string | null;
  cardId?: string | null;
  rail?: Rail | null;
  paymentApp?: string | null;
  purpose?: string | null;
  payee?: string | null;
  note?: string | null;
  categoryId?: string | null;
  allocations?: CategoryAllocation[];
  personalShare?: Paise | null;
  budgetBucket?: BudgetBucket;
  tags?: Partial<Tags>;
  refundOfId?: string | null;
  refundPersonalPart?: Paise | null;
  reimbursementOfId?: string | null;
  intentionId?: string | null;
  holdId?: string | null;
  obligationId?: string | null;
  occurrenceDate?: LocalDate | null;
  adjustmentReason?: 'reconcile' | null;
}

function clean(text: string | null | undefined): string | null {
  const t = (text ?? '').trim();
  return t === '' ? null : t;
}

/** Build a ledger row with safe defaults. Validation happens separately. */
export function makeEntry(input: EntryInput): Transaction {
  const hasCategories = input.kind === 'expense' || input.kind === 'refund';
  const allocations = hasCategories
    ? input.allocations && input.allocations.length > 0
      ? input.allocations
      : [{ categoryId: input.categoryId ?? UNCATEGORIZED_ID, amount: input.amount }]
    : [];
  return {
    id: input.id,
    kind: input.kind,
    amount: input.amount,
    currency: 'INR',
    occurredAt: input.occurredAt,
    localDate: input.localDate,
    createdAt: input.now,
    updatedAt: input.now,
    state: input.state ?? 'completed',
    basis: 'manual',
    fromAccountId: input.fromAccountId ?? null,
    toAccountId: input.toAccountId ?? null,
    cardId: input.cardId ?? null,
    rail: input.rail ?? null,
    paymentApp: clean(input.paymentApp),
    purpose: clean(input.purpose),
    payee: clean(input.payee),
    note: clean(input.note),
    allocations,
    personalShare: input.kind === 'expense' ? (input.personalShare ?? null) : null,
    budgetBucket: input.kind === 'expense' ? (input.budgetBucket ?? 'flexible') : 'outside',
    tags: { ...DEFAULT_TAGS, ...(input.tags ?? {}) },
    refundOfId: input.kind === 'refund' ? (input.refundOfId ?? null) : null,
    refundPersonalPart: input.kind === 'refund' ? (input.refundPersonalPart ?? null) : null,
    reimbursementOfId: input.kind === 'reimbursement' ? (input.reimbursementOfId ?? null) : null,
    intentionId: input.intentionId ?? null,
    holdId: input.holdId ?? null,
    obligationId: input.obligationId ?? null,
    occurrenceDate: input.occurrenceDate ?? null,
    adjustmentReason: input.kind === 'adjustment' ? (input.adjustmentReason ?? 'reconcile') : null,
    deletedAt: null,
    deleteBatchId: null,
  };
}

/**
 * Defaults for refunding part of a purchase: same categories (proportional)
 * and, for shared purchases, your part proportional to your share.
 */
export function defaultRefundSplit(
  original: Transaction,
  refundAmount: Paise,
): { allocations: CategoryAllocation[]; personalPart: Paise | null } {
  const parts = apportion(
    refundAmount,
    original.allocations.map((a) => a.amount),
  );
  const allocations = original.allocations
    .map((a, i) => ({ categoryId: a.categoryId, amount: parts[i] }))
    .filter((a) => a.amount > 0);
  const personal = personalShareOf(original);
  const personalPart = personal === original.amount ? null : divRound(refundAmount * personal, original.amount);
  return { allocations, personalPart };
}

export interface RepeatTemplate {
  key: string;
  amount: Paise;
  categoryId: string;
  purpose: string | null;
  fromAccountId: string | null;
  cardId: string | null;
  rail: Rail | null;
  paymentApp: string | null;
  uses: number;
  lastUsed: number;
}

/** Frequent recent purchases (last 45 days) for one-tap repeat. */
export function repeatTemplates(txns: readonly Transaction[], today: LocalDate, limit = 4): RepeatTemplate[] {
  const since = addDays(today, -45);
  const map = new Map<string, RepeatTemplate>();
  for (const t of txns) {
    if (t.kind !== 'expense' || t.state !== 'completed' || t.localDate < since) continue;
    if (t.allocations.length !== 1 || t.personalShare !== null) continue;
    const categoryId = t.allocations[0].categoryId;
    const key = [t.amount, categoryId, (t.purpose ?? '').toLowerCase(), t.fromAccountId ?? '', t.cardId ?? ''].join('|');
    const existing = map.get(key);
    if (existing) {
      existing.uses += 1;
      existing.lastUsed = Math.max(existing.lastUsed, t.occurredAt);
    } else {
      map.set(key, {
        key,
        amount: t.amount,
        categoryId,
        purpose: t.purpose,
        fromAccountId: t.fromAccountId,
        cardId: t.cardId,
        rail: t.rail,
        paymentApp: t.paymentApp,
        uses: 1,
        lastUsed: t.occurredAt,
      });
    }
  }
  return [...map.values()]
    .filter((t) => t.uses >= 2)
    .sort((a, b) => b.uses - a.uses || b.lastUsed - a.lastUsed)
    .slice(0, limit);
}

/** Most recently used categories, for quick chips. */
export function recentCategoryIds(txns: readonly Transaction[], limit = 6): string[] {
  const sorted = [...txns].filter((t) => t.kind === 'expense').sort((a, b) => b.createdAt - a.createdAt);
  const out: string[] = [];
  for (const t of sorted) {
    for (const a of t.allocations) {
      if (a.categoryId !== UNCATEGORIZED_ID && !out.includes(a.categoryId)) out.push(a.categoryId);
      if (out.length >= limit) return out;
    }
  }
  return out;
}
