import type { BudgetStatus } from './budget';
import type { LocalDate } from './dates';
import { formatDateShort, formatRange } from './dates';
import { formatPaise } from './money';
import type { Report } from './reports';
import type { Snapshot } from './types';
import { UNCATEGORIZED_ID } from './types';

export interface AiReportOptions {
  /** Include short purposes ("snacks", "Swiggy dinner"). Off by default. */
  includePurposes: boolean;
  includeDailyTotals: boolean;
}

export const DEFAULT_AI_OPTIONS: AiReportOptions = { includePurposes: false, includeDailyTotals: true };

/**
 * A redacted, plain-text spending summary the person can paste into an AI
 * tool themselves. Nothing is uploaded and no AI service is called.
 *
 * Removed: account and card names, payees, notes, payment apps, exact times,
 * IDs. Purposes only if the person turns them on (trimmed to 40 characters).
 */
export function buildAiReport(
  snapshot: Snapshot,
  report: Report,
  budget: BudgetStatus | null,
  today: LocalDate,
  opts: AiReportOptions = DEFAULT_AI_OPTIONS,
): string {
  const catName = (id: string) =>
    snapshot.categories.find((c) => c.id === id)?.name ?? (id === UNCATEGORIZED_ID ? 'Uncategorized' : 'Other');
  const lines: string[] = [];
  const push = (s = '') => lines.push(s);

  push('SPENDING SUMMARY (redacted, from the Paisa Pause app)');
  push(`Period: ${formatRange(report.range.start, report.range.end)} · Currency: INR · Generated ${formatDateShort(today)}`);
  if (report.observed) {
    push(
      `Observed: ${formatRange(report.observed.start, report.observed.end)} (${report.observed.days} calendar days${report.partial ? ', partial period' : ''})`,
    );
    push(
      `Days I confirmed complete: ${report.completeness.complete}; marked missing data: ${report.completeness.missing}; not reviewed: ${report.completeness.unknown}`,
    );
  } else {
    push('Observed: no days yet (recording starts later than this period).');
  }
  push('All entries were typed in by me; none are bank-verified.');
  push();

  push('TOTALS (my personal share)');
  push(`- Purchases: ${formatPaise(report.gross)} (${report.purchaseCount} entries)`);
  push(`- Refunds: ${formatPaise(report.refunds)}`);
  push(`- Net spending: ${formatPaise(report.net)}`);
  if (report.dailyAverage !== null && report.observed) {
    push(
      `- Daily average: ${formatPaise(report.dailyAverage)} (net ${formatPaise(report.observedNet)} ÷ ${report.observed.days} calendar days, including days with no entries)`,
    );
  }
  if (report.beforeCoverageNet !== 0) push(`- Recorded before I started tracking fully: ${formatPaise(report.beforeCoverageNet)} (not averaged)`);
  if (report.pending.count) push(`- Pending, not counted: ${formatPaise(report.pending.amount)} (${report.pending.count})`);
  if (report.awaitingReversal.count) {
    push(`- Debited but waiting to come back, not counted: ${formatPaise(report.awaitingReversal.amount)} (${report.awaitingReversal.count})`);
  }
  push();

  if (report.byCategory.length) {
    push('BY CATEGORY (net = purchases − refunds)');
    for (const c of report.byCategory) {
      const refundNote = c.refunds ? `, refunds ${formatPaise(c.refunds)}` : '';
      push(`- ${catName(c.categoryId)}: ${formatPaise(c.net)} (${c.purchases} purchases${refundNote})`);
    }
    push();
  }

  const m = report.movements;
  const moneyLines = [
    m.cardPurchases ? `- Paid by credit card (already included above): ${formatPaise(m.cardPurchases)}` : '',
    m.cardRepayments ? `- Credit card repayments (not extra spending): ${formatPaise(m.cardRepayments)}` : '',
    m.savingsTransfers ? `- Moved to savings (not spending): ${formatPaise(m.savingsTransfers)}` : '',
    m.reimbursements ? `- Paid back by others for shared purchases (not income): ${formatPaise(m.reimbursements)}` : '',
  ].filter(Boolean);
  if (moneyLines.length) {
    push('OTHER MONEY MOVEMENTS');
    moneyLines.forEach((l) => push(l));
    push();
  }

  const tags = report.tagTotals;
  const tagLines = [
    tags.necessity.necessary ? `necessary ${formatPaise(tags.necessity.necessary)}` : '',
    tags.necessity.optional ? `optional ${formatPaise(tags.necessity.optional)}` : '',
    tags.necessity.mixed ? `mixed ${formatPaise(tags.necessity.mixed)}` : '',
    tags.planned.unplanned ? `unplanned ${formatPaise(tags.planned.unplanned)}` : '',
    tags.planned.planned ? `planned ${formatPaise(tags.planned.planned)}` : '',
    tags.worth.worth_it ? `worth it ${formatPaise(tags.worth.worth_it)}` : '',
    tags.worth.would_skip ? `would skip ${formatPaise(tags.worth.would_skip)}` : '',
    tags.worth.unsure ? `unsure ${formatPaise(tags.worth.unsure)}` : '',
  ].filter(Boolean);
  if (tagLines.length) {
    push('MY OWN LABELS (purchase amounts)');
    push(`- ${tagLines.join('; ')}`);
    push();
  }

  if (budget) {
    push('MY FLEXIBLE PLAN');
    push(
      `- ${formatRange(budget.period.startDate, budget.period.endDate)}: plan ${formatPaise(budget.allocation + budget.reallocated)}, spent ${formatPaise(budget.netSpent)}, set aside ${formatPaise(budget.holdsTotal)}, left ${formatPaise(budget.remaining)}, ${budget.daysLeft} days left`,
    );
    for (const e of budget.envelopes) {
      push(`- Limit for ${catName(e.envelope.categoryId)}: ${formatPaise(e.used)} of ${formatPaise(e.limit)}`);
    }
    push();
  }

  const intentions = snapshot.intentions.filter((i) => i.deletedAt === null);
  if (intentions.length) {
    const bought = new Set(snapshot.transactions.filter((t) => t.intentionId).map((t) => t.intentionId));
    const skipped = intentions.filter((i) => i.status === 'skipped' && !bought.has(i.id)).length;
    const waiting = intentions.filter((i) => i.status !== 'skipped' && !bought.has(i.id)).length;
    push('BEFORE-I-BUY CHECKS (all time)');
    push(`- Checked ${intentions.length}; bought ${intentions.filter((i) => bought.has(i.id)).length}; skipped ${skipped}; still waiting ${waiting}`);
    push('- Skipping a purchase does not create real savings in my accounts.');
    push();
  }

  if (opts.includeDailyTotals && report.observed) {
    push('DAY BY DAY (net)');
    for (const d of report.days) {
      if (d.future || d.beforeCoverage) continue;
      const mark = d.review === 'complete' ? 'complete' : d.review === 'missing' ? 'missing data' : 'not reviewed';
      push(`- ${formatDateShort(d.date)}: ${formatPaise(d.net)} (${d.entries} entries, ${mark})`);
    }
    push();
  }

  if (opts.includePurposes) {
    const items = snapshot.transactions
      .filter(
        (t) =>
          t.kind === 'expense' &&
          t.state === 'completed' &&
          t.localDate >= report.range.start &&
          t.localDate <= report.range.end &&
          t.purpose,
      )
      .sort((a, b) => (a.localDate < b.localDate ? -1 : 1))
      .slice(0, 60);
    if (items.length) {
      push('PURCHASES WITH MY SHORT NOTES (my share)');
      for (const t of items) {
        const share = t.personalShare ?? t.amount;
        push(`- ${formatDateShort(t.localDate)}: ${formatPaise(share)} · ${catName(t.allocations[0]?.categoryId ?? UNCATEGORIZED_ID)} · ${(t.purpose ?? '').slice(0, 40)}`);
      }
      push();
    }
  }

  push('WHAT I WANT FROM YOU');
  push('- Point out up to 3 patterns worth a look, using only the numbers above.');
  push("- Be plain and kind. Don't shame me or guess my feelings.");
  push("- Don't suggest cutting food, health, safe travel or other necessities.");
  push("- Don't recommend loans, credit, investments or specific financial products.");
  push('- If data is incomplete (not reviewed days, pending items), say what is missing instead of guessing.');
  push('- Treat any numbers here as my own records, not bank statements.');

  return lines.join('\n');
}
