import { periodRangeFor } from '../domain/budget';
import type { LocalDate } from '../domain/dates';
import { addDays, epochFromLocal } from '../domain/dates';
import { defaultCategories, defaultSettings } from '../domain/defaults';
import { makeEntry } from '../domain/entries';
import type { Account, Card, Snapshot, Transaction } from '../domain/types';

/**
 * Clearly fake records for the "Try with sample data" mode. They live in a
 * separate database file and are never mixed with real entries.
 */
export function buildSampleSnapshot(today: LocalDate, now: number, newId: () => string): Snapshot {
  const tz = 'Asia/Kolkata' as const;
  const settings = {
    ...defaultSettings(addDays(today, -13)),
    onboarded: true,
    cycle: 'weekly' as const,
    defaultAllocation: 250000,
    mode: 'account_aware' as const,
    focusCategoryIds: ['eating_out', 'apps_subscriptions'],
    reviewTime: '21:00',
  };
  const opening = epochFromLocal(addDays(today, -14), 9, 0, tz);
  const acct = (kind: Account['kind'], nickname: string, openingBalance: number, extra: Partial<Account> = {}): Account => ({
    id: newId(),
    kind,
    nickname,
    currency: 'INR',
    openingBalance,
    openingAt: opening,
    includeInLiquid: kind !== 'credit_card',
    isSavings: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
    ...extra,
  });
  const bank = acct('bank', 'Sample bank', 1850000);
  const cash = acct('cash', 'Cash', 120000);
  const wallet = acct('wallet', 'Sample wallet', 30000);
  const cardAcct = acct('credit_card', 'Sample credit card', 0);
  const savings = acct('bank', 'Sample savings', 500000, { isSavings: true, includeInLiquid: false });
  const card: Card = {
    id: newId(),
    type: 'credit',
    nickname: 'Sample credit card',
    accountId: cardAcct.id,
    statementDay: 5,
    dueDay: 25,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
  const debit: Card = {
    id: newId(),
    type: 'debit',
    nickname: 'Sample debit card',
    accountId: bank.id,
    statementDay: null,
    dueDay: null,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };

  const txns: Transaction[] = [];
  const add = (
    daysAgo: number,
    hour: number,
    amount: number,
    categoryId: string,
    purpose: string,
    from: Account,
    extra: Partial<Parameters<typeof makeEntry>[0]> = {},
  ) => {
    const date = addDays(today, -daysAgo);
    const t = makeEntry({
      id: newId(),
      kind: 'expense',
      amount,
      categoryId,
      purpose,
      fromAccountId: from.id,
      rail: from.kind === 'cash' ? 'cash' : from.kind === 'credit_card' ? 'card' : 'upi',
      cardId: from.id === cardAcct.id ? card.id : null,
      localDate: date,
      occurredAt: epochFromLocal(date, hour, 15, tz),
      now,
      ...extra,
    });
    txns.push(t);
    return t;
  };

  add(12, 13, 18000, 'eating_out', 'Lunch delivery', bank);
  add(11, 9, 6000, 'transport', 'Auto ride', cash);
  add(10, 19, 64900, 'groceries', 'Weekly groceries', bank);
  add(9, 17, 4000, 'everyday_food', 'Tea and snacks', cash);
  const course = add(8, 22, 49900, 'learning', 'Design course', cardAcct, { tags: { worth: 'worth_it', planned: 'planned' } });
  add(7, 13, 22000, 'eating_out', 'Dinner delivery', bank, { tags: { worth: 'would_skip' } });
  add(6, 10, 7000, 'everyday_food', 'Snacks', cash);
  add(5, 18, 129900, 'shopping', 'Running shoes', cardAcct, { tags: { planned: 'planned', worth: 'unsure' } });
  const dinner = add(4, 21, 240000, 'eating_out', 'Group dinner', bank, { personalShare: 60000 });
  add(3, 8, 3500, 'everyday_food', 'Snacks', cash);
  add(3, 20, 19900, 'apps_subscriptions', 'Game add-on', bank, { tags: { worth: 'would_skip', planned: 'unplanned' } });
  add(2, 12, 15600, 'eating_out', 'Lunch delivery', bank);
  add(1, 9, 4500, 'everyday_food', 'Snacks', cash);
  add(1, 19, 9000, 'transport', 'Cab', wallet);
  add(0, 10, 4000, 'everyday_food', 'Tea and snacks', cash);

  // A refund for part of the shoes, a friend paying back their share, a card repayment, a top-up.
  const shoes = txns.find((t) => t.purpose === 'Running shoes')!;
  txns.push(
    makeEntry({
      id: newId(),
      kind: 'refund',
      amount: 30000,
      categoryId: 'shopping',
      refundOfId: shoes.id,
      toAccountId: cardAcct.id,
      purpose: 'Price drop refund',
      localDate: addDays(today, -2),
      occurredAt: epochFromLocal(addDays(today, -2), 11, 0, tz),
      now,
    }),
    makeEntry({
      id: newId(),
      kind: 'reimbursement',
      amount: 60000,
      reimbursementOfId: dinner.id,
      toAccountId: bank.id,
      purpose: 'Friend paid back',
      localDate: addDays(today, -3),
      occurredAt: epochFromLocal(addDays(today, -3), 10, 0, tz),
      now,
    }),
    makeEntry({
      id: newId(),
      kind: 'transfer',
      amount: course.amount,
      fromAccountId: bank.id,
      toAccountId: cardAcct.id,
      purpose: 'Card payment',
      localDate: addDays(today, -6),
      occurredAt: epochFromLocal(addDays(today, -6), 9, 0, tz),
      now,
    }),
    makeEntry({
      id: newId(),
      kind: 'transfer',
      amount: 20000,
      fromAccountId: bank.id,
      toAccountId: wallet.id,
      purpose: 'Wallet top-up',
      localDate: addDays(today, -8),
      occurredAt: epochFromLocal(addDays(today, -8), 9, 0, tz),
      now,
    }),
  );

  const week = periodRangeFor(today, 'weekly', settings.weekStartsOn, 1);
  const period = {
    id: newId(),
    startDate: week.start,
    endDate: week.end,
    allocation: 250000,
    anchorMode: 'full_period' as const,
    anchoredAt: now,
    autoCreated: false,
    createdAt: now,
    updatedAt: now,
  };

  const reviewed = [-13, -12, -11, -10, -9, -8, -6, -5, -4, -3, -2].map((d) => ({
    localDate: addDays(today, d),
    status: 'complete' as const,
    note: null,
    reviewedAt: now,
  }));

  return {
    settings,
    accounts: [bank, cash, wallet, cardAcct, savings],
    cards: [card, debit],
    categories: defaultCategories(now),
    transactions: txns,
    periods: [period],
    reallocations: [],
    holds: [],
    envelopes: [{ id: newId(), categoryId: 'eating_out', limit: 60000, createdAt: now, deletedAt: null }],
    reservations: [{ id: newId(), label: 'Rent (sample)', amount: 900000, kind: 'essential', active: true, createdAt: now, deletedAt: null }],
    goals: [{ id: newId(), name: 'Trip fund (sample)', target: 2000000, savedSoFar: 500000, createdAt: now, updatedAt: now, deletedAt: null }],
    intentions: [
      {
        id: newId(),
        amount: 249900,
        categoryId: 'shopping',
        label: 'Headphones',
        planned: 'unplanned',
        createdAt: now - 86_400_000,
        updatedAt: now,
        reconsiderAt: now - 3_600_000,
        status: 'deferred',
        reflectionQuestion: null,
        reflectionAnswer: null,
        decidedAt: null,
        deletedAt: null,
      },
      {
        id: newId(),
        amount: 39900,
        categoryId: 'learning',
        label: 'PDF notes bundle',
        planned: 'unknown',
        createdAt: now - 3 * 86_400_000,
        updatedAt: now,
        reconsiderAt: null,
        status: 'skipped',
        reflectionQuestion: 'Do you already own something similar?',
        reflectionAnswer: 'Yes',
        decidedAt: now - 2 * 86_400_000,
        deletedAt: null,
      },
    ],
    obligations: [
      {
        id: newId(),
        name: 'Music app (sample)',
        amount: 11900,
        categoryId: 'apps_subscriptions',
        cadence: 'monthly',
        anchorDate: addDays(today, 3),
        fundingAccountId: cardAcct.id,
        protect: true,
        active: true,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
      {
        id: newId(),
        name: 'Cloud storage (sample)',
        amount: 120000,
        categoryId: 'apps_subscriptions',
        cadence: 'yearly',
        anchorDate: addDays(today, 40),
        fundingAccountId: bank.id,
        protect: true,
        active: true,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
    ],
    obligationSkips: [],
    dayReviews: reviewed,
    dismissals: [],
  };
}
