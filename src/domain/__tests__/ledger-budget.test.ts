import { describe, expect, it } from 'vitest';
import { estimateAvailability } from '../availability';
import { budgetStatus, previewPlanChange, previewPurchase } from '../budget';
import { defaultRefundSplit } from '../entries';
import { accountBalance, cardCredit, cardOwed, expenseStatus, receivables, validateTransaction } from '../ledger';
import { monthlyPlanningEquivalent, upcomingOccurrences } from '../recurring';
import { buildReport } from '../reports';
import type { Hold, Obligation } from '../types';
import { NOW, account, at, emptySnapshot, entry, period, rupees } from './helpers';

describe('Before I buy preview', () => {
  it('₹900 left for four days becomes ₹701; per day ₹175.25 instead of ₹225', () => {
    const snap = emptySnapshot();
    const p = period({ allocation: rupees(900), startDate: '2026-11-09', endDate: '2026-11-15' });
    const status = budgetStatus(snap, p, '2026-11-12');
    expect(status.remaining).toBe(rupees(900));
    expect(status.daysLeft).toBe(4);
    expect(status.perDay).toBe(rupees(225));
    const preview = previewPurchase(status, rupees(199), 'shopping');
    expect(preview.after.remaining).toBe(rupees(701));
    expect(preview.after.perDay).toBe(rupees(175.25));
    expect(preview.before.perDay).toBe(rupees(225));
  });

  it('a preview or waiting-list item never changes spending', () => {
    const snap = emptySnapshot();
    snap.intentions.push({
      id: 'i1',
      amount: rupees(500),
      categoryId: 'shopping',
      label: 'shoes',
      planned: 'unplanned',
      createdAt: NOW,
      updatedAt: NOW,
      reconsiderAt: null,
      status: 'skipped',
      reflectionQuestion: null,
      reflectionAnswer: null,
      decidedAt: NOW,
      deletedAt: null,
    });
    const p = period();
    expect(budgetStatus(snap, p, '2026-11-12').remaining).toBe(rupees(900));
    const report = buildReport(snap, { start: '2026-11-09', end: '2026-11-15' }, '2026-11-12');
    expect(report.net).toBe(0);
  });

  it('a purchase linked to its intention counts exactly once', () => {
    const snap = emptySnapshot();
    snap.transactions.push(entry({ kind: 'expense', amount: rupees(199), categoryId: 'shopping', intentionId: 'i1' }));
    const status = budgetStatus(snap, period(), '2026-11-12');
    expect(status.netSpent).toBe(rupees(199));
    expect(status.remaining).toBe(rupees(701));
  });
});

describe('plan anchors', () => {
  it('"₹900 remaining now": earlier purchases are not deducted again', () => {
    const snap = emptySnapshot();
    const anchor = at('2026-11-12', 15);
    const p = period({ anchorMode: 'remaining_now', anchoredAt: anchor });
    // Recorded later, but it happened before the anchor.
    snap.transactions.push(entry({ kind: 'expense', amount: rupees(120), date: '2026-11-11' }));
    snap.transactions.push(entry({ kind: 'expense', amount: rupees(80), date: '2026-11-12', hour: 9 }));
    expect(budgetStatus(snap, p, '2026-11-12').remaining).toBe(rupees(900));
    snap.transactions.push(entry({ kind: 'expense', amount: rupees(50), date: '2026-11-12', hour: 18 }));
    expect(budgetStatus(snap, p, '2026-11-12').remaining).toBe(rupees(850));
    // Historical reports still show all of it.
    const report = buildReport(snap, { start: '2026-11-09', end: '2026-11-15' }, '2026-11-12');
    expect(report.net).toBe(rupees(250));
  });

  it('switching to a full-period budget shows a recomputation preview first', () => {
    const snap = emptySnapshot();
    const p = period({ anchorMode: 'remaining_now', anchoredAt: at('2026-11-12', 15) });
    snap.transactions.push(entry({ kind: 'expense', amount: rupees(300), date: '2026-11-10' }));
    const preview = previewPlanChange(snap, p, rupees(1500), 'full_period', NOW, '2026-11-12');
    expect(preview.current.remaining).toBe(rupees(900));
    expect(preview.proposed.countedSpending).toBe(rupees(300));
    expect(preview.proposed.remaining).toBe(rupees(1200));
  });

  it('overruns stay visible and are never clamped', () => {
    const snap = emptySnapshot();
    snap.transactions.push(entry({ kind: 'expense', amount: rupees(1250) }));
    const status = budgetStatus(snap, period(), '2026-11-12');
    expect(status.remaining).toBe(rupees(-350));
    const preview = previewPurchase(status, rupees(10), null);
    expect(preview.comparison).toEqual({ kind: 'already_over', overBy: rupees(350) });
  });

  it('protected costs do not reduce the flexible plan', () => {
    const snap = emptySnapshot();
    snap.transactions.push(entry({ kind: 'expense', amount: rupees(4000), budgetBucket: 'protected', categoryId: 'home_bills' }));
    expect(budgetStatus(snap, period(), '2026-11-12').remaining).toBe(rupees(900));
  });

  it('pending purchases are shown separately, not as completed spending', () => {
    const snap = emptySnapshot();
    snap.transactions.push(entry({ kind: 'expense', amount: rupees(450), state: 'pending' }));
    const status = budgetStatus(snap, period(), '2026-11-12');
    expect(status.remaining).toBe(rupees(900));
    expect(status.pendingAmount).toBe(rupees(450));
    const report = buildReport(snap, { start: '2026-11-09', end: '2026-11-15' }, '2026-11-12');
    expect(report.net).toBe(0);
    expect(report.pending).toEqual({ count: 1, amount: rupees(450) });
  });
});

describe('holds', () => {
  const hold = (h: Partial<Hold> = {}): Hold => ({
    id: h.id ?? 'h1',
    periodId: h.periodId ?? 'p1',
    amount: h.amount ?? rupees(300),
    label: 'movie',
    intentionId: null,
    createdAt: NOW,
    releasedAt: h.releasedAt ?? null,
    deletedAt: null,
  });

  it('an active hold reduces the plan; consuming it with the purchase never double-counts', () => {
    const snap = emptySnapshot();
    const p = period({ id: 'p1' });
    snap.holds.push(hold());
    expect(budgetStatus(snap, p, '2026-11-12').remaining).toBe(rupees(600));
    snap.transactions.push(entry({ kind: 'expense', amount: rupees(300), holdId: 'h1' }));
    const after = budgetStatus(snap, p, '2026-11-12');
    expect(after.holdsTotal).toBe(0);
    expect(after.remaining).toBe(rupees(600));
  });

  it('a released hold gives the money back to the plan', () => {
    const snap = emptySnapshot();
    snap.holds.push(hold({ releasedAt: NOW }));
    expect(budgetStatus(snap, period({ id: 'p1' }), '2026-11-12').remaining).toBe(rupees(900));
  });
});

describe('refunds', () => {
  it('reduce net spending once and restore the same plan', () => {
    const snap = emptySnapshot();
    const buy = entry({ kind: 'expense', amount: rupees(1000), categoryId: 'shopping', date: '2026-11-10' });
    const split = defaultRefundSplit(buy, rupees(400));
    const refund = entry({
      kind: 'refund',
      amount: rupees(400),
      allocations: split.allocations,
      refundPersonalPart: split.personalPart,
      refundOfId: buy.id,
      date: '2026-11-12',
    });
    snap.transactions.push(buy, refund);
    const status = budgetStatus(snap, period(), '2026-11-12');
    expect(status.grossSpent).toBe(rupees(1000));
    expect(status.refundsRestored).toBe(rupees(400));
    expect(status.remaining).toBe(rupees(300));
    const report = buildReport(snap, { start: '2026-11-09', end: '2026-11-15' }, '2026-11-12');
    expect(report.gross).toBe(rupees(1000));
    expect(report.refunds).toBe(rupees(400));
    expect(report.net).toBe(rupees(600));
  });

  it('a refund for an older purchase is an unallocated return, and can make a category negative', () => {
    const snap = emptySnapshot();
    const old = entry({ kind: 'expense', amount: rupees(800), categoryId: 'shopping', date: '2026-10-20' });
    const refund = entry({ kind: 'refund', amount: rupees(800), categoryId: 'shopping', refundOfId: old.id, date: '2026-11-11' });
    snap.transactions.push(old, refund);
    const status = budgetStatus(snap, period(), '2026-11-12');
    expect(status.remaining).toBe(rupees(900));
    expect(status.unallocatedRefunds).toHaveLength(1);
    expect(status.unallocatedRefunds[0].reason).toBe('older_purchase');
    const nov = buildReport(snap, { start: '2026-11-01', end: '2026-11-30' }, '2026-11-12');
    expect(nov.byCategory.find((c) => c.categoryId === 'shopping')?.net).toBe(rupees(-800));
    // October is not rewritten.
    const oct = buildReport(snap, { start: '2026-10-01', end: '2026-10-31' }, '2026-11-12');
    expect(oct.net).toBe(rupees(800));
  });

  it('assigning an unallocated refund to the plan adds it exactly once', () => {
    const snap = emptySnapshot();
    const old = entry({ kind: 'expense', amount: rupees(800), date: '2026-10-20' });
    const refund = entry({ kind: 'refund', amount: rupees(800), refundOfId: old.id, date: '2026-11-11' });
    snap.transactions.push(old, refund);
    const p = period({ id: 'p1' });
    snap.reallocations.push({ id: 'r1', periodId: 'p1', amount: rupees(800), note: null, refundId: refund.id, createdAt: NOW, deletedAt: null });
    const status = budgetStatus(snap, p, '2026-11-12');
    expect(status.unallocatedRefunds).toHaveLength(0);
    expect(status.remaining).toBe(rupees(1700));
  });

  it('cannot refund more than was paid', () => {
    const snap = emptySnapshot();
    const buy = entry({ kind: 'expense', amount: rupees(500) });
    const first = entry({ kind: 'refund', amount: rupees(300), refundOfId: buy.id });
    snap.transactions.push(buy, first);
    const second = entry({ kind: 'refund', amount: rupees(300), refundOfId: buy.id });
    const issues = validateTransaction(second, snap.transactions, snap.accounts);
    expect(issues.map((i) => i.field)).toContain('amount');
  });

  it('a refund to a credit card reduces what you owe', () => {
    const snap = emptySnapshot();
    const card = account({ kind: 'credit_card', openingBalance: 0 });
    snap.accounts.push(card);
    const buy = entry({ kind: 'expense', amount: rupees(700), fromAccountId: card.id });
    const refund = entry({ kind: 'refund', amount: rupees(200), refundOfId: buy.id, toAccountId: card.id });
    snap.transactions.push(buy, refund);
    expect(cardOwed(accountBalance(card, snap.transactions))).toBe(rupees(500));
  });
});

describe('cards, transfers and accounts', () => {
  it('the ₹10,000 invariant: card purchase then repayment changes capacity once', () => {
    const snap = emptySnapshot();
    snap.settings.mode = 'account_aware';
    const bank = account({ id: 'bank', kind: 'bank', nickname: 'SBI', openingBalance: rupees(10000) });
    const card = account({ id: 'card', kind: 'credit_card', nickname: 'Card', openingBalance: rupees(1000) });
    snap.accounts.push(bank, card);
    snap.reservations.push({ id: 'rent', label: 'Rent', amount: rupees(4000), kind: 'essential', active: true, createdAt: NOW, deletedAt: null });

    const a0 = estimateAvailability(snap, '2026-11-12', null, null);
    expect(a0.liquidCapacity).toBe(rupees(5000));

    snap.transactions.push(entry({ kind: 'expense', amount: rupees(500), fromAccountId: 'card', rail: 'card' }));
    const a1 = estimateAvailability(snap, '2026-11-12', null, null);
    expect(a1.liquidCapacity).toBe(rupees(4500));

    snap.transactions.push(entry({ kind: 'transfer', amount: rupees(500), fromAccountId: 'bank', toAccountId: 'card', hour: 13 }));
    const a2 = estimateAvailability(snap, '2026-11-12', null, null);
    expect(accountBalance(bank, snap.transactions).value).toBe(rupees(9500));
    expect(cardOwed(accountBalance(card, snap.transactions))).toBe(rupees(1000));
    expect(a2.liquidCapacity).toBe(rupees(4500));

    const report = buildReport(snap, { start: '2026-11-12', end: '2026-11-12' }, '2026-11-12');
    expect(report.net).toBe(rupees(500));
    expect(report.movements.cardPurchases).toBe(rupees(500));
    expect(report.movements.cardRepayments).toBe(rupees(500));
  });

  it('available within plan is the smaller of plan and liquid capacity', () => {
    const snap = emptySnapshot();
    snap.accounts.push(account({ kind: 'bank', openingBalance: rupees(600) }));
    const a = estimateAvailability(snap, '2026-11-12', rupees(900), '2026-11-15');
    expect(a.availableWithinPlan).toBe(rupees(600));
    expect(a.status).toBe('ok');
  });

  it('wallet top-ups, ATM withdrawals and savings moves are transfers, not purchases', () => {
    const snap = emptySnapshot();
    const bank = account({ kind: 'bank', openingBalance: rupees(5000) });
    const wallet = account({ kind: 'wallet', openingBalance: 0 });
    const cash = account({ kind: 'cash', openingBalance: 0 });
    const savings = account({ kind: 'bank', isSavings: true, includeInLiquid: false, openingBalance: 0 });
    snap.accounts.push(bank, wallet, cash, savings);
    snap.transactions.push(
      entry({ kind: 'transfer', amount: rupees(500), fromAccountId: bank.id, toAccountId: wallet.id }),
      entry({ kind: 'transfer', amount: rupees(1000), fromAccountId: bank.id, toAccountId: cash.id }),
      entry({ kind: 'transfer', amount: rupees(2000), fromAccountId: bank.id, toAccountId: savings.id }),
    );
    const report = buildReport(snap, { start: '2026-11-12', end: '2026-11-12' }, '2026-11-12');
    expect(report.net).toBe(0);
    expect(report.movements.savingsTransfers).toBe(rupees(2000));
    expect(accountBalance(bank, snap.transactions).value).toBe(rupees(1500));
    // Savings account is excluded from liquid money and not subtracted again.
    const a = estimateAvailability(snap, '2026-11-12', null, null);
    expect(a.includedLiquid).toBe(rupees(3000));
  });

  it('income is separate from spending; expected income is never liquid', () => {
    const snap = emptySnapshot();
    const bank = account({ kind: 'bank', openingBalance: rupees(100) });
    snap.accounts.push(bank);
    snap.transactions.push(entry({ kind: 'income', amount: rupees(20000), toAccountId: bank.id }));
    const report = buildReport(snap, { start: '2026-11-12', end: '2026-11-12' }, '2026-11-12');
    expect(report.net).toBe(0);
    expect(report.movements.income).toBe(rupees(20000));
    expect(accountBalance(bank, snap.transactions).value).toBe(rupees(20100));
  });

  it('opening snapshots are not re-applied; later movements roll forward', () => {
    const snap = emptySnapshot();
    const bank = account({ kind: 'bank', openingBalance: rupees(5000), openingAt: at('2026-11-10', 12) });
    snap.accounts.push(bank);
    snap.transactions.push(
      entry({ kind: 'expense', amount: rupees(300), fromAccountId: bank.id, date: '2026-11-09' }),
      entry({ kind: 'expense', amount: rupees(200), fromAccountId: bank.id, date: '2026-11-11' }),
    );
    expect(accountBalance(bank, snap.transactions).value).toBe(rupees(4800));
  });

  it('card fees and interest are expenses; overpayment becomes card credit, not cash', () => {
    const snap = emptySnapshot();
    const bank = account({ kind: 'bank', openingBalance: rupees(3000) });
    const card = account({ kind: 'credit_card', openingBalance: rupees(500) });
    snap.accounts.push(bank, card);
    snap.transactions.push(
      entry({ kind: 'expense', amount: rupees(40), fromAccountId: card.id, categoryId: 'other', purpose: 'Card fee' }),
      entry({ kind: 'transfer', amount: rupees(740), fromAccountId: bank.id, toAccountId: card.id }),
    );
    const bal = accountBalance(card, snap.transactions);
    expect(cardOwed(bal)).toBe(0);
    expect(cardCredit(bal)).toBe(rupees(200));
    const a = estimateAvailability(snap, '2026-11-12', null, null);
    expect(a.includedLiquid).toBe(rupees(2260));
    expect(a.protectedTotal).toBe(0);
    const report = buildReport(snap, { start: '2026-11-12', end: '2026-11-12' }, '2026-11-12');
    expect(report.net).toBe(rupees(40));
  });

  it('a failed payment with no debit changes nothing; a debit awaiting reversal is unresolved', () => {
    const snap = emptySnapshot();
    const bank = account({ kind: 'bank', openingBalance: rupees(1000) });
    snap.accounts.push(bank);
    snap.transactions.push(entry({ kind: 'expense', amount: rupees(250), fromAccountId: bank.id, state: 'failed' }));
    expect(accountBalance(bank, snap.transactions).value).toBe(rupees(1000));
    snap.transactions.push(entry({ kind: 'expense', amount: rupees(400), fromAccountId: bank.id, state: 'awaiting_reversal' }));
    expect(accountBalance(bank, snap.transactions).value).toBe(rupees(600));
    const report = buildReport(snap, { start: '2026-11-12', end: '2026-11-12' }, '2026-11-12');
    expect(report.net).toBe(0);
    expect(report.awaitingReversal.amount).toBe(rupees(400));
    const a = estimateAvailability(snap, '2026-11-12', rupees(900), '2026-11-15');
    expect(a.status).toBe('unresolved');
  });

  it('an unknown opening balance suppresses a confident estimate', () => {
    const snap = emptySnapshot();
    snap.accounts.push(account({ kind: 'bank', openingBalance: null }));
    expect(estimateAvailability(snap, '2026-11-12', null, null).status).toBe('unresolved');
  });
});

describe('shared purchases', () => {
  it('₹1,200 meal with ₹400 share: ₹400 spending, ₹800 receivable, repayment is not income', () => {
    const snap = emptySnapshot();
    const bank = account({ kind: 'bank', openingBalance: rupees(5000) });
    snap.accounts.push(bank);
    const meal = entry({ kind: 'expense', amount: rupees(1200), personalShare: rupees(400), fromAccountId: bank.id, categoryId: 'eating_out' });
    snap.transactions.push(meal);
    expect(budgetStatus(snap, period(), '2026-11-12').netSpent).toBe(rupees(400));
    expect(receivables(snap)).toEqual([expect.objectContaining({ outstanding: rupees(800) })]);
    // Unpaid receivables are not cash.
    expect(estimateAvailability(snap, '2026-11-12', null, null).includedLiquid).toBe(rupees(3800));

    snap.transactions.push(entry({ kind: 'reimbursement', amount: rupees(800), reimbursementOfId: meal.id, toAccountId: bank.id, hour: 20 }));
    expect(receivables(snap)).toEqual([]);
    const report = buildReport(snap, { start: '2026-11-12', end: '2026-11-12' }, '2026-11-12');
    expect(report.net).toBe(rupees(400));
    expect(report.movements.income).toBe(0);
    expect(report.movements.reimbursements).toBe(rupees(800));
    expect(accountBalance(bank, snap.transactions).value).toBe(rupees(4600));
  });

  it('cannot be paid back more than is owed', () => {
    const snap = emptySnapshot();
    const meal = entry({ kind: 'expense', amount: rupees(1200), personalShare: rupees(400) });
    snap.transactions.push(meal);
    const tooMuch = entry({ kind: 'reimbursement', amount: rupees(900), reimbursementOfId: meal.id });
    expect(validateTransaction(tooMuch, snap.transactions, snap.accounts).length).toBeGreaterThan(0);
  });

  it('a partial refund of a shared purchase splits between your share and theirs', () => {
    const meal = entry({ kind: 'expense', amount: rupees(1200), personalShare: rupees(400) });
    const split = defaultRefundSplit(meal, rupees(300));
    expect(split.personalPart).toBe(rupees(100));
    const refund = entry({ kind: 'refund', amount: rupees(300), refundOfId: meal.id, refundPersonalPart: split.personalPart, allocations: split.allocations });
    const st = expenseStatus(meal, [meal, refund]);
    expect(st.receivableOutstanding).toBe(rupees(600));
  });
});

describe('categories and validation', () => {
  it('category splits must add up exactly to the parent amount', () => {
    const t = entry({
      kind: 'expense',
      amount: rupees(500),
      allocations: [
        { categoryId: 'groceries', amount: rupees(300) },
        { categoryId: 'health', amount: rupees(150) },
      ],
    });
    expect(validateTransaction(t, [], []).map((i) => i.field)).toContain('allocations');
  });

  it('split personal spending sums exactly to the personal share', () => {
    const snap = emptySnapshot();
    snap.transactions.push(
      entry({
        kind: 'expense',
        amount: 1001,
        personalShare: 500,
        allocations: [
          { categoryId: 'groceries', amount: 667 },
          { categoryId: 'health', amount: 334 },
        ],
      }),
    );
    const report = buildReport(snap, { start: '2026-11-12', end: '2026-11-12' }, '2026-11-12');
    expect(report.net).toBe(500);
    expect(report.byCategory.reduce((s, c) => s + c.net, 0)).toBe(500);
  });

  it('rejects zero amounts, unknown kinds and same-account transfers', () => {
    const acc = account({ kind: 'bank' });
    expect(validateTransaction(entry({ kind: 'expense', amount: 0 }), [], []).length).toBeGreaterThan(0);
    const bad = entry({ kind: 'transfer', amount: 100, fromAccountId: acc.id, toAccountId: acc.id });
    expect(validateTransaction(bad, [], [acc]).map((i) => i.field)).toContain('accounts');
  });
});

describe('recurring commitments', () => {
  const sub: Obligation = {
    id: 'o1',
    name: 'Cloud storage',
    amount: rupees(1200),
    categoryId: 'apps_subscriptions',
    cadence: 'yearly',
    anchorDate: '2026-11-20',
    fundingAccountId: null,
    protect: true,
    active: true,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  };

  it('an annual ₹1,200 subscription is one ₹1,200 expense with a labelled ₹100/month equivalent', () => {
    expect(monthlyPlanningEquivalent(sub)).toBe(rupees(100));
    const snap = emptySnapshot();
    snap.obligations.push(sub);
    const before = buildReport(snap, { start: '2026-11-01', end: '2026-11-30' }, '2026-11-12');
    expect(before.net).toBe(0); // forecasts are never spending
    snap.transactions.push(
      entry({ kind: 'expense', amount: rupees(1200), obligationId: 'o1', occurrenceDate: '2026-11-20', date: '2026-11-20', budgetBucket: 'protected' }),
    );
    const after = buildReport(snap, { start: '2026-11-01', end: '2026-11-30' }, '2026-11-25');
    expect(after.net).toBe(rupees(1200));
    expect(upcomingOccurrences(snap.obligations, snap.transactions, [], '2026-11-12', 30)).toHaveLength(0);
  });

  it('unpaid protected commitments are protected once, then released when paid', () => {
    const snap = emptySnapshot();
    snap.accounts.push(account({ kind: 'bank', openingBalance: rupees(5000) }));
    snap.obligations.push({ ...sub, cadence: 'monthly', amount: rupees(649), anchorDate: '2026-11-15' });
    const a = estimateAvailability(snap, '2026-11-12', null, '2026-11-15');
    // Horizon is the later of the plan end and 30 days ahead: 15 Nov is in, 15 Dec is not.
    expect(a.protectedItems.filter((p) => p.kind === 'commitment')).toHaveLength(1);
    expect(a.liquidCapacity).toBe(rupees(5000 - 649));
    snap.transactions.push(entry({ kind: 'expense', amount: rupees(649), obligationId: 'o1', occurrenceDate: '2026-11-15' }));
    const b = estimateAvailability(snap, '2026-11-12', null, '2026-11-15');
    expect(b.protectedItems.filter((p) => p.kind === 'commitment')).toHaveLength(0);
  });
});
