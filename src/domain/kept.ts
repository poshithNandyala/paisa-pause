import type { LocalDate, TimeZoneSetting } from './dates';
import { inRange, localDateOf } from './dates';
import type { Paise } from './money';
import type { Snapshot } from './types';

/**
 * Money you chose not to spend.
 *
 * Only your own decisions count: an optional purchase you paused on and then
 * decided against (status 'skipped'). Nothing here is money you earned, moved
 * or saved into an account — it stays in your plan, and the app says so.
 */

export interface KeptRange {
  start: LocalDate;
  end: LocalDate;
}

export interface KeptSummary {
  /** Sum of skipped intentions decided within the range. */
  kept: Paise;
  count: number;
  /** Money still paused on, waiting for a decision. */
  waiting: Paise;
  waitingCount: number;
}

export function keptSummary(
  snapshot: Pick<Snapshot, 'intentions'>,
  timezone: TimeZoneSetting,
  range: KeptRange,
  boughtIntentionIds: ReadonlySet<string> = new Set(),
): KeptSummary {
  let kept = 0;
  let count = 0;
  let waiting = 0;
  let waitingCount = 0;
  for (const i of snapshot.intentions) {
    if (i.deletedAt !== null || boughtIntentionIds.has(i.id)) continue;
    if (i.status === 'skipped') {
      if (i.decidedAt === null) continue;
      if (!inRange(localDateOf(i.decidedAt, timezone), range.start, range.end)) continue;
      kept += i.amount;
      count += 1;
    } else {
      waiting += i.amount;
      waitingCount += 1;
    }
  }
  return { kept, count, waiting, waitingCount };
}
