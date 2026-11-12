import { periodCovering, periodRangeForSettings } from '../domain/budget';
import type { LocalDate } from '../domain/dates';
import { makeEntry } from '../domain/entries';
import { accountBalance, validateTransaction, type ValidationIssue } from '../domain/ledger';
import type { Paise } from '../domain/money';
import type { Account, AnchorMode, BudgetPeriod, Snapshot, Transaction } from '../domain/types';
import { DEFAULT_TAGS } from '../domain/types';
import type { ChangeSet, InsertOutcome, Repository } from './repository';

export class ValidationError extends Error {
  constructor(public readonly issues: ValidationIssue[]) {
    super(issues.map((i) => i.message).join(' '));
  }
}

export type IdFactory = () => string;

/** Save a new entry. Validated, atomic and idempotent. */
export async function createEntry(
  repo: Repository,
  snapshot: Snapshot,
  entry: Transaction,
  now: number,
  extra: ChangeSet = {},
): Promise<InsertOutcome> {
  const issues = validateTransaction(entry, snapshot.transactions, snapshot.accounts);
  if (issues.length) throw new ValidationError(issues);
  return repo.apply({ ...extra, insertTxns: [entry, ...(extra.insertTxns ?? [])] }, now);
}

/** Edit an existing entry in place (audited). */
export async function updateEntry(repo: Repository, snapshot: Snapshot, entry: Transaction, now: number): Promise<void> {
  const others = snapshot.transactions.filter((t) => t.id !== entry.id);
  const issues = validateTransaction(entry, others, snapshot.accounts);
  if (issues.length) throw new ValidationError(issues);
  await repo.apply({ updateTxns: [{ ...entry, updatedAt: now }] }, now);
}

/** Entries that go with this one when it is deleted (its refunds and repayments). */
export function deletionGroup(snapshot: Snapshot, id: string): string[] {
  const ids = [id];
  for (const t of snapshot.transactions) {
    if (t.refundOfId === id || t.reimbursementOfId === id) ids.push(t.id);
  }
  return ids;
}

/**
 * Delete an entry and anything that only makes sense with it. They leave all
 * totals immediately. Returns a batch ID that undo can restore.
 */
export async function deleteEntry(repo: Repository, snapshot: Snapshot, id: string, batchId: string, now: number) {
  const ids = deletionGroup(snapshot, id);
  await repo.softDelete(ids, batchId, now);
  return { batchId, count: ids.length };
}

/** "This was really a transfer between my accounts" — keeps the same row and ID. */
export function asTransfer(t: Transaction, toAccountId: string, now: number): Transaction {
  return {
    ...t,
    kind: 'transfer',
    toAccountId,
    allocations: [],
    personalShare: null,
    budgetBucket: 'outside',
    tags: { ...DEFAULT_TAGS },
    refundOfId: null,
    refundPersonalPart: null,
    reimbursementOfId: null,
    intentionId: null,
    holdId: null,
    obligationId: null,
    occurrenceDate: null,
    updatedAt: now,
  };
}

/**
 * Build the correction that makes the ledger match a balance you checked.
 * Credit cards take the amount OWED. Returns null when nothing changes.
 */
export function reconciliationEntry(
  account: Account,
  snapshot: Snapshot,
  actual: Paise,
  ids: IdFactory,
  now: number,
  today: LocalDate,
): Transaction | null {
  const current = accountBalance(account, snapshot.transactions).value;
  const desired = account.kind === 'credit_card' ? -actual : actual;
  const delta = desired - current;
  if (delta === 0) return null;
  return makeEntry({
    id: ids(),
    kind: 'adjustment',
    amount: Math.abs(delta),
    occurredAt: now,
    localDate: today,
    now,
    fromAccountId: delta < 0 ? account.id : null,
    toAccountId: delta > 0 ? account.id : null,
    purpose: 'Balance check',
    adjustmentReason: 'reconcile',
  });
}

/**
 * Make sure a plan period covers today. When the last one has ended, start the
 * next with the same amount (marked as started automatically, so the app can
 * say so). Returns the new period, or null if none was needed or possible.
 */
export function nextPeriodIfNeeded(snapshot: Snapshot, today: LocalDate, ids: IdFactory, now: number): BudgetPeriod | null {
  if (!snapshot.settings.onboarded) return null;
  if (periodCovering(snapshot.periods, today)) return null;
  const last = [...snapshot.periods].sort((a, b) => (a.endDate < b.endDate ? 1 : -1))[0];
  const allocation = snapshot.settings.defaultAllocation || last?.allocation || 0;
  if (!last && allocation === 0) return null;
  const range = periodRangeForSettings(today, snapshot.settings);
  return {
    id: ids(),
    startDate: range.start,
    endDate: range.end,
    allocation,
    anchorMode: 'full_period',
    anchoredAt: now,
    autoCreated: true,
    createdAt: now,
    updatedAt: now,
  };
}

export function newPeriod(
  snapshot: Snapshot,
  today: LocalDate,
  allocation: Paise,
  mode: AnchorMode,
  ids: IdFactory,
  now: number,
): BudgetPeriod {
  const range = periodRangeForSettings(today, snapshot.settings);
  return {
    id: ids(),
    startDate: range.start,
    endDate: range.end,
    allocation,
    anchorMode: mode,
    anchoredAt: now,
    autoCreated: false,
    createdAt: now,
    updatedAt: now,
  };
}
