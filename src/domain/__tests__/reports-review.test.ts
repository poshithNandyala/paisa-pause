import { describe, expect, it } from 'vitest';
import { buildAiReport } from '../aiReport';
import { checkBackup, makeBackup, transactionsCsv } from '../backup';
import { budgetStatus } from '../budget';
import { buildReport, compareWithPrevious } from '../reports';
import { buildSuggestions, MAX_SUGGESTIONS } from '../suggestions';
import { NOW, account, emptySnapshot, entry, period, rupees } from './helpers';

describe('daily average', () => {
  it('₹2,800 across seven calendar days is ₹400/day even with only four entry days', () => {
    const snap = emptySnapshot();
    snap.settings.trackingStartDate = '2026-11-01';
    snap.transactions.push(
      entry({ kind: 'expense', amount: rupees(700), date: '2026-11-02' }),
      entry({ kind: 'expense', amount: rupees(700), date: '2026-11-04' }),
      entry({ kind: 'expense', amount: rupees(700), date: '2026-11-05' }),
      entry({ kind: 'expense', amount: rupees(700), date: '2026-11-07' }),
    );
    const r = buildReport(snap, { start: '2026-11-02', end: '2026-11-08' }, '2026-11-12');
    expect(r.observed?.days).toBe(7);
    expect(r.net).toBe(rupees(2800));
    expect(r.dailyAverage).toBe(rupees(400));
    expect(r.completeness).toEqual({ complete: 0, missing: 0, unknown: 7 });
  });

  it('tracking 8–12 November is a five-day partial span', () => {
    const snap = emptySnapshot();
    snap.settings.trackingStartDate = '2026-11-08';
    snap.transactions.push(entry({ kind: 'expense', amount: rupees(1000), date: '2026-11-09' }));
    snap.dayReviews.push({ localDate: '2026-11-09', status: 'complete', note: null, reviewedAt: NOW });
    const r = buildReport(snap, { start: '2026-11-01', end: '2026-11-30' }, '2026-11-12');
    expect(r.observed).toEqual({ start: '2026-11-08', end: '2026-11-12', days: 5 });
    expect(r.partial).toBe(true);
    expect(r.dailyAverage).toBe(rupees(200));
    expect(r.completeness.complete).toBe(1);
  });

  it('spending before coverage is shown but not averaged', () => {
    const snap = emptySnapshot();
    snap.settings.trackingStartDate = '2026-11-08';
    snap.transactions.push(entry({ kind: 'expense', amount: rupees(500), date: '2026-11-03' }));
    const r = buildReport(snap, { start: '2026-11-01', end: '2026-11-30' }, '2026-11-12');
    expect(r.net).toBe(rupees(500));
    expect(r.beforeCoverageNet).toBe(rupees(500));
    expect(r.dailyAverage).toBe(0);
  });

  it('only compares equal-length spans with full coverage', () => {
    const snap = emptySnapshot();
    snap.settings.trackingStartDate = '2026-11-08';
    const thisWeek = { start: '2026-11-09', end: '2026-11-15' };
    const lastWeek = { start: '2026-11-02', end: '2026-11-08' };
    expect(compareWithPrevious(snap, thisWeek, lastWeek, '2026-11-12')).toBeNull();
    snap.settings.trackingStartDate = '2026-11-01';
    snap.transactions.push(
      entry({ kind: 'expense', amount: rupees(100), date: '2026-11-03' }),
      entry({ kind: 'expense', amount: rupees(100), date: '2026-11-07' }), // outside the first 4 days
      entry({ kind: 'expense', amount: rupees(250), date: '2026-11-10' }),
    );
    const cmp = compareWithPrevious(snap, thisWeek, lastWeek, '2026-11-12');
    expect(cmp?.days).toBe(4);
    expect(cmp?.previous.net).toBe(rupees(100));
    expect(cmp?.current.net).toBe(rupees(250));
  });
});

describe('suggestions', () => {
  it('shows the envelope threshold once per period with exact numbers', () => {
    const snap = emptySnapshot();
    const p = period({ id: 'p1', allocation: rupees(5000) });
    snap.envelopes.push({ id: 'e1', categoryId: 'eating_out', limit: rupees(1000), createdAt: NOW, deletedAt: null });
    snap.transactions.push(entry({ kind: 'expense', amount: rupees(800), categoryId: 'eating_out' }));
    const budget = budgetStatus(snap, p, '2026-11-12');
    const list = buildSuggestions(snap, '2026-11-12', budget);
    const env = list.find((s) => s.ruleId === 'limit.envelope');
    expect(env?.title).toBe('₹800 of ₹1,000 used for eating out & delivery');
    expect(env?.key).toBe('limit.envelope:e1:p1');
    snap.dismissals.push({ key: env!.key, dismissedAt: NOW });
    expect(buildSuggestions(snap, '2026-11-12', budget).find((s) => s.ruleId === 'limit.envelope')).toBeUndefined();
  });

  it('counts repeated purchases without calling them waste', () => {
    const snap = emptySnapshot();
    snap.dayReviews.push(
      ...['2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11'].map((d) => ({
        localDate: d,
        status: 'complete' as const,
        note: null,
        reviewedAt: NOW,
      })),
    );
    for (let i = 0; i < 6; i++) {
      snap.transactions.push(entry({ kind: 'expense', amount: rupees(70), categoryId: 'everyday_food', date: `2026-11-${String(7 + (i % 5)).padStart(2, '0')}` }));
    }
    const list = buildSuggestions(snap, '2026-11-12', null);
    const rep = list.find((s) => s.ruleId === 'pattern.repeated');
    expect(rep?.title).toBe('Six everyday food purchases totalled ₹420');
    expect(rep?.title.toLowerCase()).not.toContain('waste');
    expect(rep?.supportingTxnIds).toHaveLength(6);
  });

  it('never shows more than three and puts data problems first', () => {
    const snap = emptySnapshot();
    snap.transactions.push(entry({ kind: 'expense', amount: rupees(100), state: 'pending' }));
    snap.transactions.push(entry({ kind: 'expense', amount: rupees(100) })); // uncategorized
    for (let i = 0; i < 3; i++) {
      snap.transactions.push(entry({ kind: 'expense', amount: rupees(99), categoryId: 'apps_subscriptions', tags: { worth: 'would_skip' } }));
    }
    snap.obligations.push({
      id: 'o1',
      name: 'Phone bill',
      amount: rupees(399),
      categoryId: 'home_bills',
      cadence: 'monthly',
      anchorDate: '2026-11-14',
      fundingAccountId: null,
      protect: true,
      active: true,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    });
    const list = buildSuggestions(snap, '2026-11-12', null);
    expect(list.length).toBeLessThanOrEqual(MAX_SUGGESTIONS);
    expect(list[0].ruleId).toBe('data.unresolved');
    expect(list[1].ruleId).toBe('data.uncategorized');
  });

  it('shows nothing rather than filler when there is no useful pattern', () => {
    const snap = emptySnapshot();
    snap.settings.trackingStartDate = '2026-11-12';
    expect(buildSuggestions(snap, '2026-11-12', null)).toEqual([]);
  });

  it('can be switched off', () => {
    const snap = emptySnapshot();
    snap.settings.suggestionsEnabled = false;
    snap.transactions.push(entry({ kind: 'expense', amount: rupees(100), state: 'pending' }));
    expect(buildSuggestions(snap, '2026-11-12', null)).toEqual([]);
  });
});

describe('Copy for AI review', () => {
  it('redacts names, payees, notes and purposes by default and includes instructions', () => {
    const snap = emptySnapshot();
    const bank = account({ kind: 'bank', nickname: 'HDFC Salary', openingBalance: rupees(1000) });
    snap.accounts.push(bank);
    snap.transactions.push(
      entry({
        kind: 'expense',
        amount: rupees(349),
        categoryId: 'eating_out',
        fromAccountId: bank.id,
        payee: 'Zomato Ltd',
        purpose: 'late night biryani',
        note: 'with Ravi',
        paymentApp: 'PhonePe',
      }),
    );
    const report = buildReport(snap, { start: '2026-11-01', end: '2026-11-30' }, '2026-11-12');
    const text = buildAiReport(snap, report, null, '2026-11-12');
    expect(text).toContain('₹349');
    expect(text).toContain('Eating out & delivery');
    for (const secret of ['HDFC', 'Zomato', 'biryani', 'Ravi', 'PhonePe']) expect(text).not.toContain(secret);
    expect(text).toContain("Don't recommend loans");
    const withPurposes = buildAiReport(snap, report, null, '2026-11-12', { includePurposes: true, includeDailyTotals: false });
    expect(withPurposes).toContain('late night biryani');
    expect(withPurposes).not.toContain('Zomato');
  });
});

describe('backup and CSV', () => {
  it('round-trips a backup and rejects broken files', () => {
    const snap = emptySnapshot();
    snap.transactions.push(entry({ kind: 'expense', amount: rupees(10) }));
    const raw = JSON.parse(JSON.stringify(makeBackup(snap, 1, NOW)));
    const ok = checkBackup(raw);
    expect(ok.ok).toBe(true);
    expect(ok.counts.transactions).toBe(1);
    raw.data.transactions[0].amount = 10.5;
    expect(checkBackup(raw).ok).toBe(false);
    expect(checkBackup({ hello: 'world' }).ok).toBe(false);
  });

  it('escapes CSV cells and blocks spreadsheet formulas', () => {
    const snap = emptySnapshot();
    snap.transactions.push(entry({ kind: 'expense', amount: rupees(12.5), purpose: '=HYPERLINK("x")', note: 'a, "b"' }));
    const csv = transactionsCsv(snap, 'Asia/Kolkata');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('"a, ""b"""');
    expect(csv).toContain('12.50');
  });
});
