import type { LocalDate } from './dates';
import type { Paise } from './money';
import { apportion, formatPaise } from './money';
import type { Account, Snapshot, Transaction } from './types';

/**
 * One ledger feeds every screen. These helpers turn ledger rows into the
 * numbers each screen shows, so totals always agree.
 */

/** Counts as completed spending / money movement. */
export function isCompleted(t: Transaction): boolean {
  return t.state === 'completed';
}

/** Money really moved (completed, or debited and waiting to come back). */
export function movesMoney(t: Transaction): boolean {
  return t.state === 'completed' || t.state === 'awaiting_reversal';
}

/** Needs attention: not known to be finished. */
export function isUnresolved(t: Transaction): boolean {
  return t.state === 'pending' || t.state === 'awaiting_reversal';
}

export function personalShareOf(expense: Transaction): Paise {
  return expense.personalShare ?? expense.amount;
}

export function othersShareOf(expense: Transaction): Paise {
  return expense.amount - personalShareOf(expense);
}

export function refundPersonalPartOf(refund: Transaction): Paise {
  return refund.refundPersonalPart ?? refund.amount;
}

export interface SpendComponent {
  txnId: string;
  kind: 'expense' | 'refund';
  categoryId: string;
  /** + for purchases, - for refunds. Your personal part only. */
  amount: Paise;
  localDate: LocalDate;
  occurredAt: number;
}

/**
 * Your personal spending pieces from one transaction, split by category.
 * Category parts always add up to exactly the personal share.
 */
export function spendComponents(t: Transaction): SpendComponent[] {
  if (!isCompleted(t)) return [];
  if (t.kind !== 'expense' && t.kind !== 'refund') return [];
  const personal = t.kind === 'expense' ? personalShareOf(t) : refundPersonalPartOf(t);
  const weights = t.allocations.map((a) => a.amount);
  const parts = apportion(personal, weights);
  const sign = t.kind === 'expense' ? 1 : -1;
  return t.allocations
    .map((a, i) => ({
      txnId: t.id,
      kind: t.kind as 'expense' | 'refund',
      categoryId: a.categoryId,
      amount: sign * parts[i],
      localDate: t.localDate,
      occurredAt: t.occurredAt,
    }))
    .filter((c) => c.amount !== 0);
}

export function allSpendComponents(txns: readonly Transaction[]): SpendComponent[] {
  const out: SpendComponent[] = [];
  for (const t of txns) out.push(...spendComponents(t));
  return out;
}

export interface ExpenseStatus {
  gross: Paise;
  personal: Paise;
  others: Paise;
  refunded: Paise;
  refundedPersonal: Paise;
  refundedOthers: Paise;
  reimbursed: Paise;
  /** Still owed to you by others for this purchase. Not cash. */
  receivableOutstanding: Paise;
  /** How much more can still be refunded. */
  refundableLeft: Paise;
  refundIds: string[];
  reimbursementIds: string[];
}

export function expenseStatus(expense: Transaction, txns: readonly Transaction[]): ExpenseStatus {
  let refunded = 0;
  let refundedPersonal = 0;
  let reimbursed = 0;
  const refundIds: string[] = [];
  const reimbursementIds: string[] = [];
  for (const t of txns) {
    if (t.kind === 'refund' && t.refundOfId === expense.id && t.state !== 'failed' && t.state !== 'reversed') {
      refundIds.push(t.id);
      if (isCompleted(t) || t.state === 'pending') {
        refunded += t.amount;
        refundedPersonal += refundPersonalPartOf(t);
      }
    }
    if (t.kind === 'reimbursement' && t.reimbursementOfId === expense.id) {
      reimbursementIds.push(t.id);
      if (isCompleted(t) || t.state === 'pending') reimbursed += t.amount;
    }
  }
  const personal = personalShareOf(expense);
  const others = expense.amount - personal;
  const refundedOthers = refunded - refundedPersonal;
  return {
    gross: expense.amount,
    personal,
    others,
    refunded,
    refundedPersonal,
    refundedOthers,
    reimbursed,
    receivableOutstanding: others - refundedOthers - reimbursed,
    refundableLeft: expense.amount - refunded,
    refundIds,
    reimbursementIds,
  };
}

export interface Receivable {
  expenseId: string;
  label: string;
  localDate: LocalDate;
  outstanding: Paise;
}

/** Money others still owe you from shared purchases. Never counted as cash. */
export function receivables(snapshot: Snapshot): Receivable[] {
  const out: Receivable[] = [];
  for (const t of snapshot.transactions) {
    if (t.kind !== 'expense' || !isCompleted(t)) continue;
    if (othersShareOf(t) === 0) continue;
    const st = expenseStatus(t, snapshot.transactions);
    if (st.receivableOutstanding !== 0) {
      out.push({
        expenseId: t.id,
        label: t.purpose ?? t.payee ?? 'Shared purchase',
        localDate: t.localDate,
        outstanding: st.receivableOutstanding,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Account balances

export interface AccountBalance {
  account: Account;
  /**
   * Signed value. Asset accounts: money in it. Credit cards: negative = you owe,
   * positive = card credit (not cash).
   */
  value: Paise;
  /** Opening balance was never entered, so the value is only movements since. */
  known: boolean;
  /** Pending or awaiting-reversal movements touching this account. */
  unresolvedCount: number;
  unresolvedAmount: Paise;
}

/** Signed effect of a transaction on one account's value. */
export function accountEffect(t: Transaction, accountId: string): Paise {
  let effect = 0;
  if (t.fromAccountId === accountId) effect -= t.amount;
  if (t.toAccountId === accountId) effect += t.amount;
  return effect;
}

export function accountBalance(account: Account, txns: readonly Transaction[]): AccountBalance {
  const opening = account.openingBalance ?? 0;
  // Credit cards store the opening as amount owed; value is the negative of that.
  let value = account.kind === 'credit_card' ? -opening : opening;
  let unresolvedCount = 0;
  let unresolvedAmount = 0;
  for (const t of txns) {
    if (t.fromAccountId !== account.id && t.toAccountId !== account.id) continue;
    // Movements already inside the opening snapshot are not applied again.
    if (t.occurredAt <= account.openingAt) continue;
    if (movesMoney(t)) value += accountEffect(t, account.id);
    if (isUnresolved(t)) {
      unresolvedCount += 1;
      unresolvedAmount += t.amount;
    }
  }
  return {
    account,
    value,
    known: account.openingBalance !== null,
    unresolvedCount,
    unresolvedAmount,
  };
}

export function allAccountBalances(snapshot: Snapshot): AccountBalance[] {
  return snapshot.accounts.map((a) => accountBalance(a, snapshot.transactions));
}

/** Amount owed on a credit card (0 if in credit). */
export function cardOwed(balance: AccountBalance): Paise {
  return balance.value < 0 ? -balance.value : 0;
}

/** Card credit from overpayment/refund (0 if you owe). Not liquid cash. */
export function cardCredit(balance: AccountBalance): Paise {
  return balance.value > 0 ? balance.value : 0;
}

// ---------------------------------------------------------------------------
// Validation

export interface ValidationIssue {
  field: string;
  message: string;
}

const KINDS = ['expense', 'refund', 'transfer', 'income', 'reimbursement', 'adjustment'];
const STATES = ['completed', 'pending', 'awaiting_reversal', 'reversed', 'failed'];

/**
 * Checks a transaction against the money rules before it is saved.
 * `others` = every other (non-deleted) transaction, used for refund and
 * reimbursement limits.
 */
export function validateTransaction(
  t: Transaction,
  others: readonly Transaction[],
  accounts: readonly Account[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (field: string, message: string) => issues.push({ field, message });
  const accountIds = new Set(accounts.map((a) => a.id));

  if (!KINDS.includes(t.kind)) add('kind', 'Pick what kind of entry this is.');
  if (!STATES.includes(t.state)) add('state', 'Unknown status.');
  if (t.currency !== 'INR') add('currency', 'Only INR is supported in this version.');
  if (!Number.isSafeInteger(t.amount) || t.amount <= 0) add('amount', 'Enter an amount above ₹0.');
  if (t.fromAccountId && !accountIds.has(t.fromAccountId)) add('fromAccountId', 'That account no longer exists.');
  if (t.toAccountId && !accountIds.has(t.toAccountId)) add('toAccountId', 'That account no longer exists.');

  const needsAllocations = t.kind === 'expense' || t.kind === 'refund';
  if (needsAllocations) {
    if (t.allocations.length === 0) add('allocations', 'Pick a category (Uncategorized is fine).');
    let sum = 0;
    const seen = new Set<string>();
    for (const a of t.allocations) {
      if (!Number.isSafeInteger(a.amount) || a.amount <= 0) add('allocations', 'Each category part must be above ₹0.');
      if (seen.has(a.categoryId)) add('allocations', 'A category appears twice in the split.');
      seen.add(a.categoryId);
      sum += a.amount;
    }
    if (t.allocations.length > 0 && sum !== t.amount) {
      add('allocations', 'Category parts must add up exactly to the total.');
    }
  } else if (t.allocations.length > 0) {
    add('allocations', 'Only purchases and refunds have categories.');
  }

  if (t.kind === 'expense') {
    if (t.personalShare !== null) {
      if (!Number.isSafeInteger(t.personalShare) || t.personalShare < 0 || t.personalShare > t.amount) {
        add('personalShare', 'Your share must be between ₹0 and the amount paid.');
      }
    }
    // If refunds or reimbursements already exist, the new numbers must still cover them.
    const st = expenseStatus(t, others);
    if (st.refunded > t.amount) add('amount', 'Refunds recorded for this purchase are more than the new amount.');
    if (st.refundedPersonal > st.personal) add('personalShare', 'Refunds of your share are more than your new share.');
    if (st.refundedOthers + st.reimbursed > st.others) {
      add('personalShare', "Money already returned for others' share is more than their new share.");
    }
  }

  if (t.kind === 'refund') {
    if (t.refundPersonalPart !== null) {
      if (!Number.isSafeInteger(t.refundPersonalPart) || t.refundPersonalPart < 0 || t.refundPersonalPart > t.amount) {
        add('refundPersonalPart', 'Your part of the refund must be between ₹0 and the refund.');
      }
    }
    if (t.refundOfId) {
      const original = others.find((o) => o.id === t.refundOfId);
      if (!original || original.kind !== 'expense') {
        add('refundOfId', 'The original purchase was not found.');
      } else {
        const st = expenseStatus(original, others.filter((o) => o.id !== t.id));
        const personalPart = refundPersonalPartOf(t);
        if (t.amount > st.refundableLeft) add('amount', `Only ${formatPaise(st.refundableLeft)} can still be refunded.`);
        if (personalPart > st.personal - st.refundedPersonal) {
          add('refundPersonalPart', 'This refunds more of your share than you paid.');
        }
        if (t.amount - personalPart > st.others - st.refundedOthers - st.reimbursed) {
          add('refundPersonalPart', "This refunds more of others' share than is still owed.");
        }
      }
    }
  }

  if (t.kind === 'transfer') {
    if (!t.fromAccountId || !t.toAccountId) add('accounts', 'Pick both accounts.');
    else if (t.fromAccountId === t.toAccountId) add('accounts', 'Pick two different accounts.');
  }

  if (t.kind === 'income' && !t.toAccountId) add('toAccountId', 'Pick where the money arrived.');

  if (t.kind === 'reimbursement') {
    const original = others.find((o) => o.id === t.reimbursementOfId);
    if (!original || original.kind !== 'expense') {
      add('reimbursementOfId', 'Pick the shared purchase this pays back.');
    } else {
      const st = expenseStatus(original, others.filter((o) => o.id !== t.id));
      if (t.amount > st.receivableOutstanding) add('amount', 'This is more than is still owed for that purchase.');
    }
  }

  if (t.kind === 'adjustment') {
    const sides = (t.fromAccountId ? 1 : 0) + (t.toAccountId ? 1 : 0);
    if (sides !== 1) add('accounts', 'An adjustment changes exactly one account.');
  }

  if (t.kind !== 'expense' && t.personalShare !== null) add('personalShare', 'Only purchases can be split.');

  return issues;
}
