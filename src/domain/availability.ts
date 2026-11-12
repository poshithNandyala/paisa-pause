import type { LocalDate } from './dates';
import { addDays, diffDays, maxDate } from './dates';
import type { AccountBalance } from './ledger';
import { allAccountBalances, cardOwed, isUnresolved } from './ledger';
import type { Paise } from './money';
import { formatPaise } from './money';
import { upcomingOccurrences } from './recurring';
import type { Snapshot } from './types';

export interface ProtectedItem {
  kind: 'commitment' | 'reservation' | 'card_reserve';
  label: string;
  amount: Paise;
  detail: string;
}

export interface Availability {
  /**
   * 'ok' — confident estimate.
   * 'unresolved' — pending/unknown data; no confident number is shown.
   * 'no_accounts' — nothing included yet.
   */
  status: 'ok' | 'unresolved' | 'no_accounts';
  liquidAccounts: AccountBalance[];
  includedLiquid: Paise;
  protectedItems: ProtectedItem[];
  protectedTotal: Paise;
  /** includedLiquid - protectedTotal */
  liquidCapacity: Paise;
  /** The flexible plan's remaining money. */
  planRemaining: Paise | null;
  /** min(planRemaining, liquidCapacity) — or liquidCapacity if there is no plan. */
  availableWithinPlan: Paise;
  reasons: string[];
}

/**
 * Optional account-aware estimate.
 *
 *   liquid_capacity      = included liquid balances − protected amounts still inside them
 *   available_within_plan = min(plan remaining, liquid_capacity)
 *
 * Protected: unpaid protected commitments due soon, money you've kept aside
 * inside included accounts, and the FULL recorded unpaid credit-card balance.
 * Never counted as cash: credit limits, expected income, money others owe you,
 * card credit, excluded (e.g. savings) accounts.
 */
export function estimateAvailability(
  snapshot: Snapshot,
  today: LocalDate,
  planRemaining: Paise | null,
  planEnd: LocalDate | null,
): Availability {
  const balances = allAccountBalances(snapshot);
  const liquidAccounts = balances.filter(
    (b) => !b.account.archived && b.account.kind !== 'credit_card' && b.account.includeInLiquid,
  );
  const includedLiquid = liquidAccounts.reduce((s, b) => s + b.value, 0);
  const reasons: string[] = [];

  const protectedItems: ProtectedItem[] = [];

  // 1) Protected commitments due within the plan period or the next 30 days, whichever is later.
  const horizonEnd = maxDate(addDays(today, 30), planEnd ?? today);
  const horizonDays = Math.max(0, diffDays(today, horizonEnd));
  const occurrences = upcomingOccurrences(
    snapshot.obligations,
    snapshot.transactions,
    snapshot.obligationSkips,
    today,
    horizonDays,
  );
  for (const occ of occurrences) {
    if (!occ.obligation.protect) continue;
    if (occ.state !== 'due' && occ.state !== 'overdue') continue;
    // A commitment charged to a credit card is covered by the card reserve once charged.
    protectedItems.push({
      kind: 'commitment',
      label: occ.obligation.name,
      amount: occ.obligation.amount,
      detail: occ.state === 'overdue' ? `was due ${occ.date}` : `due ${occ.date}`,
    });
  }

  // 2) Money kept aside inside included accounts.
  for (const r of snapshot.reservations) {
    if (r.deletedAt !== null || !r.active || r.amount <= 0) continue;
    protectedItems.push({ kind: 'reservation', label: r.label, amount: r.amount, detail: 'kept aside' });
  }

  // 3) Card reserve: the full recorded unpaid balance on each credit card.
  for (const b of balances) {
    if (b.account.kind !== 'credit_card' || b.account.archived) continue;
    const owed = cardOwed(b);
    if (owed > 0) {
      protectedItems.push({
        kind: 'card_reserve',
        label: b.account.nickname,
        amount: owed,
        detail: 'full amount owed (assumes you pay it in full)',
      });
    }
  }

  const protectedTotal = protectedItems.reduce((s, p) => s + p.amount, 0);
  const liquidCapacity = includedLiquid - protectedTotal;
  const availableWithinPlan = planRemaining === null ? liquidCapacity : Math.min(planRemaining, liquidCapacity);

  // When material data is unresolved, don't make a confident claim.
  const unknownOpening = liquidAccounts.filter((b) => !b.known).map((b) => b.account.nickname);
  const unknownCards = balances
    .filter((b) => b.account.kind === 'credit_card' && !b.account.archived && !b.known)
    .map((b) => b.account.nickname);
  if (unknownOpening.length) reasons.push(`No starting balance for ${unknownOpening.join(', ')}.`);
  if (unknownCards.length) reasons.push(`No starting amount owed for ${unknownCards.join(', ')}.`);
  const relevantIds = new Set(
    balances
      .filter((b) => !b.account.archived && (b.account.kind === 'credit_card' || b.account.includeInLiquid))
      .map((b) => b.account.id),
  );
  const unresolved = snapshot.transactions.filter(
    (t) =>
      isUnresolved(t) &&
      ((t.fromAccountId && relevantIds.has(t.fromAccountId)) || (t.toAccountId && relevantIds.has(t.toAccountId))),
  );
  if (unresolved.length) {
    const amount = unresolved.reduce((s, t) => s + t.amount, 0);
    reasons.push(`${unresolved.length} unresolved payment${unresolved.length === 1 ? '' : 's'} (${formatPaise(amount)}).`);
  }

  const status: Availability['status'] =
    liquidAccounts.length === 0 ? 'no_accounts' : reasons.length > 0 ? 'unresolved' : 'ok';

  return {
    status,
    liquidAccounts,
    includedLiquid,
    protectedItems,
    protectedTotal,
    liquidCapacity,
    planRemaining,
    availableWithinPlan,
    reasons,
  };
}
