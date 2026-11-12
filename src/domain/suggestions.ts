import type { BudgetStatus } from './budget';
import { periodRangeFor } from './budget';
import type { LocalDate } from './dates';
import { addDays, formatDateShort, formatRange, parts, monthName } from './dates';
import { isCompleted, isUnresolved, spendComponents } from './ledger';
import { divRound, formatPaise } from './money';
import { upcomingOccurrences } from './recurring';
import { unreviewedDays } from './reports';
import type { Category, Snapshot } from './types';
import { UNCATEGORIZED_ID } from './types';

/**
 * Small, deterministic review rules. No model, no guessing about feelings.
 * Each rule has a stable ID, a short explanation and the entries behind it.
 * Order: data problems → upcoming commitments → your own limits → patterns.
 */

export type SuggestionAction =
  | { kind: 'entries'; ids: string[] }
  | { kind: 'review_day'; date: LocalDate }
  | { kind: 'recurring' }
  | { kind: 'plan' };

export interface Suggestion {
  /** ruleId:scope — dismissing hides this key only (the cooldown). */
  key: string;
  ruleId: string;
  priority: number;
  title: string;
  explanation: string;
  supportingTxnIds: string[];
  action: SuggestionAction | null;
}

export const RULE_IDS = {
  unresolved: 'data.unresolved',
  uncategorized: 'data.uncategorized',
  unreviewedDays: 'data.unreviewed_days',
  upcoming: 'commit.upcoming',
  envelope: 'limit.envelope',
  wouldSkip: 'pattern.would_skip',
  repeated: 'pattern.repeated',
  pace: 'pattern.pace',
} as const;

export const MAX_SUGGESTIONS = 3;

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function countWord(n: number): string {
  const words = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
  return n < words.length ? words[n] : String(n);
}

export function buildSuggestions(
  snapshot: Snapshot,
  today: LocalDate,
  budget: BudgetStatus | null,
): Suggestion[] {
  const s = snapshot.settings;
  if (!s.suggestionsEnabled) return [];
  const catName = (id: string) =>
    snapshot.categories.find((c: Category) => c.id === id)?.name ?? (id === UNCATEGORIZED_ID ? 'Uncategorized' : 'Other');
  const weekKey = periodRangeFor(today, 'weekly', 1, 1).start;
  const monthKey = today.slice(0, 7);
  const out: Suggestion[] = [];

  // 1. Unresolved payments
  const unresolved = snapshot.transactions.filter(isUnresolved);
  if (unresolved.length > 0) {
    const amount = unresolved.reduce((sum, t) => sum + t.amount, 0);
    out.push({
      key: `${RULE_IDS.unresolved}:${weekKey}`,
      ruleId: RULE_IDS.unresolved,
      priority: 0,
      title: `${plural(unresolved.length, 'payment is', 'payments are')} still unresolved`,
      explanation: `${formatPaise(amount)} is pending or waiting to come back. It isn't counted as spending until you mark what happened.`,
      supportingTxnIds: unresolved.map((t) => t.id),
      action: { kind: 'entries', ids: unresolved.map((t) => t.id) },
    });
  }

  // 2. Uncategorized purchases (last 30 days)
  const since30 = addDays(today, -30);
  const uncategorized = snapshot.transactions.filter(
    (t) =>
      t.kind === 'expense' &&
      t.localDate >= since30 &&
      t.allocations.some((a) => a.categoryId === UNCATEGORIZED_ID),
  );
  if (uncategorized.length > 0) {
    out.push({
      key: `${RULE_IDS.uncategorized}:${weekKey}`,
      ruleId: RULE_IDS.uncategorized,
      priority: 1,
      title: `${plural(uncategorized.length, 'purchase has', 'purchases have')} no category`,
      explanation: 'Adding a category keeps your category totals accurate. Uncategorized is fine if you are unsure.',
      supportingTxnIds: uncategorized.map((t) => t.id),
      action: { kind: 'entries', ids: uncategorized.map((t) => t.id) },
    });
  }

  // 3. Days not reviewed
  const missingReview = unreviewedDays(snapshot, today, 7);
  if (missingReview.length >= 2) {
    out.push({
      key: `${RULE_IDS.unreviewedDays}:${weekKey}`,
      ruleId: RULE_IDS.unreviewedDays,
      priority: 2,
      title: `${plural(missingReview.length, 'recent day')} not reviewed`,
      explanation:
        'A day with no entries could mean no spending or forgotten entries. Marking days complete keeps your averages honest.',
      supportingTxnIds: [],
      action: { kind: 'review_day', date: missingReview[0] },
    });
  }

  // 4. Upcoming or overdue commitments (next 7 days)
  const upcoming = upcomingOccurrences(snapshot.obligations, snapshot.transactions, snapshot.obligationSkips, today, 7).filter(
    (o) => o.state === 'due' || o.state === 'overdue',
  );
  if (upcoming.length > 0) {
    const first = upcoming[0];
    const title =
      upcoming.length === 1
        ? `${first.obligation.name} ${formatPaise(first.obligation.amount)} ${first.state === 'overdue' ? 'was due' : 'is due'} ${formatDateShort(first.date)}`
        : `${upcoming.length} commitments due soon`;
    const list = upcoming
      .slice(0, 3)
      .map((o) => `${o.obligation.name} ${formatPaise(o.obligation.amount)} (${formatDateShort(o.date)})`)
      .join(', ');
    out.push({
      key: `${RULE_IDS.upcoming}:${upcoming.map((o) => `${o.obligation.id}@${o.date}`).join(',')}`,
      ruleId: RULE_IDS.upcoming,
      priority: 10,
      title,
      explanation: `${upcoming.length > 1 ? `${list}. ` : ''}A reminder only — nothing has been paid or cancelled. Record it when it's actually charged.`,
      supportingTxnIds: [],
      action: { kind: 'recurring' },
    });
  }

  // 5. Your own category limits
  if (budget) {
    for (const e of budget.envelopes) {
      if (e.limit <= 0 || e.pct < s.envelopeThresholdPct) continue;
      const ids = budget.components.filter((c) => c.categoryId === e.envelope.categoryId).map((c) => c.txnId);
      out.push({
        key: `${RULE_IDS.envelope}:${e.envelope.id}:${budget.period.id}`,
        ruleId: RULE_IDS.envelope,
        priority: 20,
        title: `${formatPaise(e.used)} of ${formatPaise(e.limit)} used for ${catName(e.envelope.categoryId).toLowerCase()}`,
        explanation: `That's ${e.pct}% of the limit you set for ${formatRange(budget.period.startDate, budget.period.endDate)}.`,
        supportingTxnIds: [...new Set(ids)],
        action: { kind: 'plan' },
      });
    }
  }

  // 6. Your own "would skip" labels (last 30 days)
  const skipByCat = new Map<string, { ids: string[]; total: number }>();
  for (const t of snapshot.transactions) {
    if (t.kind !== 'expense' || !isCompleted(t) || t.localDate < since30 || t.tags.worth !== 'would_skip') continue;
    const comps = spendComponents(t);
    const main = comps[0]?.categoryId ?? UNCATEGORIZED_ID;
    const entry = skipByCat.get(main) ?? { ids: [], total: 0 };
    entry.ids.push(t.id);
    entry.total += comps.reduce((sum, c) => sum + c.amount, 0);
    skipByCat.set(main, entry);
  }
  const topSkip = [...skipByCat.entries()].sort((a, b) => b[1].ids.length - a[1].ids.length || b[1].total - a[1].total)[0];
  if (topSkip && topSkip[1].ids.length >= 3) {
    const [catId, info] = topSkip;
    out.push({
      key: `${RULE_IDS.wouldSkip}:${catId}:${monthKey}`,
      ruleId: RULE_IDS.wouldSkip,
      priority: 30,
      title: `You marked ${countWord(info.ids.length).toLowerCase()} ${catName(catId).toLowerCase()} purchases as ones you'd skip`,
      explanation: `Together ${formatPaise(info.total)} in the last 30 days. This only uses your own labels.`,
      supportingTxnIds: info.ids,
      action: { kind: 'entries', ids: info.ids },
    });
  }

  // 7. Repeated purchases in one category (last 7 days)
  const since7 = addDays(today, -6);
  const repeatByCat = new Map<string, { ids: string[]; total: number }>();
  for (const t of snapshot.transactions) {
    if (t.kind !== 'expense' || !isCompleted(t) || t.localDate < since7 || t.localDate > today) continue;
    const comps = spendComponents(t);
    const main = comps[0]?.categoryId;
    if (!main || main === UNCATEGORIZED_ID) continue;
    const entry = repeatByCat.get(main) ?? { ids: [], total: 0 };
    entry.ids.push(t.id);
    entry.total += comps.reduce((sum, c) => sum + c.amount, 0);
    repeatByCat.set(main, entry);
  }
  const topRepeat = [...repeatByCat.entries()].sort((a, b) => b[1].ids.length - a[1].ids.length || b[1].total - a[1].total)[0];
  if (topRepeat && topRepeat[1].ids.length >= 5) {
    const [catId, info] = topRepeat;
    out.push({
      key: `${RULE_IDS.repeated}:${catId}:${weekKey}`,
      ruleId: RULE_IDS.repeated,
      priority: 31,
      title: `${countWord(info.ids.length)} ${catName(catId).toLowerCase()} purchases totalled ${formatPaise(info.total)}`,
      explanation: `In the last 7 days (${formatRange(since7, today)}). Just a count, not a judgement.`,
      supportingTxnIds: info.ids,
      action: { kind: 'entries', ids: info.ids },
    });
  }

  // 8. Spending pace — only with enough days you marked complete, and only if it matters.
  if (budget && budget.perDay !== null && budget.daysLeft > 0) {
    const completeDays = snapshot.dayReviews
      .filter((r) => r.status === 'complete' && r.localDate >= addDays(today, -30) && r.localDate < today)
      .map((r) => r.localDate)
      .sort();
    if (completeDays.length >= s.minReviewedDaysForPace) {
      const daySet = new Set(completeDays);
      let net = 0;
      for (const t of snapshot.transactions) {
        if (!daySet.has(t.localDate)) continue;
        for (const c of spendComponents(t)) net += c.amount;
      }
      const avg = divRound(net, completeDays.length);
      if (avg > budget.perDay && budget.perDay >= 0) {
        const first = parts(completeDays[0]);
        const last = parts(completeDays[completeDays.length - 1]);
        out.push({
          key: `${RULE_IDS.pace}:${budget.period.id}`,
          ruleId: RULE_IDS.pace,
          priority: 32,
          title: `Recent pace ${formatPaise(avg)}/day; your plan has ${formatPaise(budget.perDay)}/day left`,
          explanation: `Average of the ${completeDays.length} days you marked complete between ${first.d} ${monthName(first.m)} and ${last.d} ${monthName(last.m)}. Other days are left out. It assumes the coming days look like those — they may not.`,
          supportingTxnIds: [],
          action: { kind: 'plan' },
        });
      }
    }
  }

  const dismissed = new Set(snapshot.dismissals.map((d) => d.key));
  return out
    .filter((x) => !dismissed.has(x.key))
    .sort((a, b) => a.priority - b.priority)
    .slice(0, MAX_SUGGESTIONS);
}
