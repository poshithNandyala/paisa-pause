import { estimateAvailability, type Availability } from '../domain/availability';
import { budgetStatus, periodCovering, type BudgetStatus } from '../domain/budget';
import type { LocalDate } from '../domain/dates';
import { localDateOf, localTimeOf, parseTimeHHMM } from '../domain/dates';
import {
  allAccountBalances,
  receivables,
  spendComponents,
  type AccountBalance,
  type Receivable,
} from '../domain/ledger';
import type { Paise } from '../domain/money';
import { upcomingOccurrences, type Occurrence } from '../domain/recurring';
import { incompleteEntries } from '../domain/reports';
import { buildSuggestions, type Suggestion } from '../domain/suggestions';
import type { Account, BudgetPeriod, Card, Category, Intention, Snapshot, Transaction } from '../domain/types';
import { UNCATEGORIZED_ID } from '../domain/types';

export interface Derived {
  today: LocalDate;
  period: BudgetPeriod | null;
  budget: BudgetStatus | null;
  availability: Availability | null;
  todayNet: Paise;
  todayCount: number;
  incomplete: Transaction[];
  waiting: Intention[];
  reconsiderReady: Intention[];
  boughtIntentionIds: Set<string>;
  receivables: Receivable[];
  upcoming: Occurrence[];
  suggestions: Suggestion[];
  balances: AccountBalance[];
  categoriesById: Map<string, Category>;
  accountsById: Map<string, Account>;
  cardsById: Map<string, Card>;
  /** Visible categories for pickers; Uncategorized last. */
  pickerCategories: Category[];
  categoryName: (id: string | null | undefined) => string;
  /** The review time has passed today and today isn't reviewed yet. */
  reviewDue: boolean;
}

export function derive(snapshot: Snapshot, now: number): Derived {
  const s = snapshot.settings;
  const today = localDateOf(now, s.timezone);
  const period = periodCovering(snapshot.periods, today) ?? null;
  const budget = period ? budgetStatus(snapshot, period, today) : null;
  const availability =
    s.mode === 'account_aware'
      ? estimateAvailability(snapshot, today, budget ? budget.remaining : null, period ? period.endDate : null)
      : null;

  let todayNet = 0;
  let todayCount = 0;
  for (const t of snapshot.transactions) {
    if (t.localDate !== today) continue;
    const comps = spendComponents(t);
    if (comps.length) todayCount += 1;
    for (const c of comps) todayNet += c.amount;
  }

  const boughtIntentionIds = new Set(
    snapshot.transactions
      .filter((t) => t.intentionId && t.kind === 'expense' && t.state !== 'failed' && t.state !== 'reversed')
      .map((t) => t.intentionId as string),
  );
  const waiting = snapshot.intentions.filter((i) => i.status !== 'skipped' && !boughtIntentionIds.has(i.id));
  const reconsiderReady = waiting.filter((i) => i.reconsiderAt !== null && i.reconsiderAt <= now);

  const categoriesById = new Map(snapshot.categories.map((c) => [c.id, c]));
  const accountsById = new Map(snapshot.accounts.map((a) => [a.id, a]));
  const cardsById = new Map(snapshot.cards.map((c) => [c.id, c]));
  const pickerCategories = snapshot.categories
    .filter((c) => !c.hidden && !c.archived)
    .sort((a, b) => {
      if (a.id === UNCATEGORIZED_ID) return 1;
      if (b.id === UNCATEGORIZED_ID) return -1;
      return a.sort - b.sort;
    });

  let reviewDue = false;
  if (s.reviewTime) {
    const t = parseTimeHHMM(s.reviewTime);
    const nowTime = localTimeOf(now, s.timezone);
    if (t && (nowTime.h > t.h || (nowTime.h === t.h && nowTime.min >= t.min))) {
      reviewDue = !snapshot.dayReviews.some((r) => r.localDate === today);
    }
  }

  return {
    today,
    period,
    budget,
    availability,
    todayNet,
    todayCount,
    incomplete: incompleteEntries(snapshot),
    waiting,
    reconsiderReady,
    boughtIntentionIds,
    receivables: receivables(snapshot),
    upcoming: upcomingOccurrences(snapshot.obligations, snapshot.transactions, snapshot.obligationSkips, today, 30),
    suggestions: buildSuggestions(snapshot, today, budget),
    balances: allAccountBalances(snapshot),
    categoriesById,
    accountsById,
    cardsById,
    pickerCategories,
    categoryName: (id) => (id ? (categoriesById.get(id)?.name ?? 'Unknown category') : 'Uncategorized'),
    reviewDue,
  };
}
