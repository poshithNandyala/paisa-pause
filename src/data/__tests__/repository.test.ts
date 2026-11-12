import { describe, expect, it } from 'vitest';
import { budgetStatus } from '../../domain/budget';
import { accountBalance } from '../../domain/ledger';
import { NOW, account, entry, rupees } from '../../domain/__tests__/helpers';
import { createEntry, deleteEntry, nextPeriodIfNeeded, reconciliationEntry, updateEntry, ValidationError } from '../operations';
import { Repository } from '../repository';
import { SCHEMA_VERSION } from '../schema';
import { nodeDriver } from './nodeDriver';

async function freshRepo() {
  const driver = nodeDriver();
  const repo = new Repository(driver);
  await repo.init('2026-11-12', NOW);
  return { repo, driver };
}

let n = 0;
const ids = () => `gen${++n}`;

describe('local database', () => {
  it('migrates and seeds editable default categories once', async () => {
    const { repo, driver } = await freshRepo();
    await repo.init('2026-11-12', NOW); // second run is a no-op
    const snap = await repo.load();
    expect(snap.categories.map((c) => c.id)).toContain('eating_out');
    expect(snap.categories.filter((c) => c.id === 'eating_out')).toHaveLength(1);
    expect(snap.settings.currency).toBe('INR');
    expect(snap.settings.timezone).toBe('Asia/Kolkata');
    const v = await driver.get<{ user_version: number }>('PRAGMA user_version');
    expect(v?.user_version).toBe(SCHEMA_VERSION);
  });

  it('round-trips a transaction exactly, including splits and tags', async () => {
    const { repo } = await freshRepo();
    const snap = await repo.load();
    const t = entry({
      kind: 'expense',
      amount: 120050,
      personalShare: 40017,
      allocations: [
        { categoryId: 'eating_out', amount: 100050 },
        { categoryId: 'leisure', amount: 20000 },
      ],
      purpose: 'Team dinner',
      tags: { worth: 'worth_it', planned: 'planned' },
      rail: 'upi',
      paymentApp: 'Google Pay',
    });
    expect(await createEntry(repo, snap, t, NOW)).toBe('inserted');
    const loaded = (await repo.load()).transactions[0];
    expect(loaded).toEqual(t);
  });

  it('a double tap cannot save the same expense twice', async () => {
    const { repo } = await freshRepo();
    const snap = await repo.load();
    const t = entry({ kind: 'expense', amount: rupees(199) });
    const results = await Promise.all([createEntry(repo, snap, t, NOW), createEntry(repo, snap, t, NOW)]);
    expect(results.sort()).toEqual(['duplicate', 'inserted']);
    expect((await repo.load()).transactions).toHaveLength(1);
  });

  it('rejects invalid entries without writing anything', async () => {
    const { repo } = await freshRepo();
    const snap = await repo.load();
    const bad = entry({
      kind: 'expense',
      amount: rupees(100),
      allocations: [{ categoryId: 'groceries', amount: rupees(90) }],
    });
    await expect(createEntry(repo, snap, bad, NOW)).rejects.toBeInstanceOf(ValidationError);
    expect((await repo.load()).transactions).toHaveLength(0);
  });

  it('delete removes a purchase and its refunds from totals; undo brings them back', async () => {
    const { repo } = await freshRepo();
    let snap = await repo.load();
    const buy = entry({ kind: 'expense', amount: rupees(1000) });
    await createEntry(repo, snap, buy, NOW);
    snap = await repo.load();
    const refund = entry({ kind: 'refund', amount: rupees(250), refundOfId: buy.id });
    await createEntry(repo, snap, refund, NOW);
    snap = await repo.load();

    const { batchId, count } = await deleteEntry(repo, snap, buy.id, 'batch1', NOW);
    expect(count).toBe(2);
    expect((await repo.load()).transactions).toHaveLength(0);
    expect(await repo.loadDeleted()).toHaveLength(2);

    expect(await repo.restoreBatch(batchId, NOW)).toBe(2);
    expect((await repo.load()).transactions).toHaveLength(2);
  });

  it('edits are audited and keep the same ID', async () => {
    const { repo, driver } = await freshRepo();
    let snap = await repo.load();
    const t = entry({ kind: 'expense', amount: rupees(50), categoryId: 'transport' });
    await createEntry(repo, snap, t, NOW);
    snap = await repo.load();
    await updateEntry(repo, snap, { ...t, amount: rupees(60), allocations: [{ categoryId: 'transport', amount: rupees(60) }] }, NOW + 1);
    const after = await repo.load();
    expect(after.transactions).toHaveLength(1);
    expect(after.transactions[0].amount).toBe(rupees(60));
    const audits = await driver.all<{ action: string }>('SELECT action FROM audit_log WHERE entity_id = ?', [t.id]);
    expect(audits.map((a) => a.action)).toEqual(['create', 'update']);
  });

  it('a balance check adds one auditable adjustment that is neither income nor spending', async () => {
    const { repo } = await freshRepo();
    const bank = account({ kind: 'bank', openingBalance: rupees(1000) });
    await repo.apply({ upserts: { accounts: [bank] } }, NOW);
    let snap = await repo.load();
    await createEntry(repo, snap, entry({ kind: 'expense', amount: rupees(200), fromAccountId: bank.id }), NOW);
    snap = await repo.load();
    const adj = reconciliationEntry(bank, snap, rupees(750), ids, NOW, '2026-11-12');
    expect(adj?.amount).toBe(rupees(50));
    expect(adj?.fromAccountId).toBe(bank.id);
    await createEntry(repo, snap, adj!, NOW);
    snap = await repo.load();
    expect(accountBalance(bank, snap.transactions).value).toBe(rupees(750));
    expect(reconciliationEntry(bank, snap, rupees(750), ids, NOW, '2026-11-12')).toBeNull();
  });

  it('starts the next plan period on its own with the same amount', async () => {
    const { repo } = await freshRepo();
    let snap = await repo.load();
    snap.settings.onboarded = true;
    snap.settings.cycle = 'weekly';
    snap.settings.defaultAllocation = rupees(1500);
    await repo.apply({ settings: snap.settings }, NOW);
    snap = await repo.load();
    const p = nextPeriodIfNeeded(snap, '2026-11-12', ids, NOW);
    expect(p).toMatchObject({ startDate: '2026-11-09', endDate: '2026-11-15', allocation: rupees(1500), autoCreated: true });
    await repo.apply({ upserts: { periods: [p!] } }, NOW);
    snap = await repo.load();
    expect(nextPeriodIfNeeded(snap, '2026-11-12', ids, NOW)).toBeNull();
    expect(budgetStatus(snap, snap.periods[0], '2026-11-12').remaining).toBe(rupees(1500));
  });

  it('restores a backup atomically and wipes everything on request', async () => {
    const { repo } = await freshRepo();
    let snap = await repo.load();
    await createEntry(repo, snap, entry({ kind: 'expense', amount: rupees(10) }), NOW);
    snap = await repo.load();
    const copy = JSON.parse(JSON.stringify(snap));
    copy.transactions.push(entry({ kind: 'expense', amount: rupees(20) }));
    await repo.replaceAll(copy, NOW);
    expect((await repo.load()).transactions).toHaveLength(2);

    // A broken backup leaves current data untouched.
    const broken = JSON.parse(JSON.stringify(copy));
    broken.transactions.push({ ...broken.transactions[0] }); // duplicate ID
    await expect(repo.replaceAll(broken, NOW)).rejects.toThrow();
    expect((await repo.load()).transactions).toHaveLength(2);

    await repo.wipeRows();
    const empty = await repo.load();
    expect(empty.transactions).toHaveLength(0);
    expect(empty.categories).toHaveLength(0);
  });

  it('purges soft-deleted entries after the cutoff', async () => {
    const { repo } = await freshRepo();
    let snap = await repo.load();
    const t = entry({ kind: 'expense', amount: rupees(5) });
    await createEntry(repo, snap, t, NOW);
    snap = await repo.load();
    await deleteEntry(repo, snap, t.id, 'b', NOW);
    expect(await repo.purgeDeleted(NOW + 1)).toBe(1);
    expect(await repo.loadDeleted()).toHaveLength(0);
  });
});

describe('sample data', () => {
  it('is valid ledger data with sensible totals', async () => {
    const { buildSampleSnapshot } = await import('../../state/sampleData');
    const { validateTransaction } = await import('../../domain/ledger');
    const { derive } = await import('../../state/derive');
    const snap = buildSampleSnapshot('2026-11-12', NOW, ids);
    for (const t of snap.transactions) {
      const others = snap.transactions.filter((o) => o.id !== t.id);
      expect(validateTransaction(t, others, snap.accounts)).toEqual([]);
    }
    const { repo } = await freshRepo();
    await repo.replaceAll(snap, NOW);
    const loaded = await repo.load();
    expect(loaded.transactions).toHaveLength(snap.transactions.length);
    const d = derive(loaded, NOW);
    expect(d.budget).not.toBeNull();
    expect(d.availability?.status).toBe('ok');
    expect(d.suggestions.length).toBeLessThanOrEqual(3);
  });
});
