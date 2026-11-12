import { describe, expect, it } from 'vitest';
import type { LocalDate } from '../dates';
import { keptSummary } from '../kept';
import type { Intention } from '../types';
import { NOW, at, emptySnapshot, rupees } from './helpers';

function intention(partial: Partial<Intention> & { id: string }): Intention {
  return {
    amount: rupees(500),
    categoryId: 'shopping',
    label: null,
    planned: 'unplanned',
    createdAt: NOW,
    updatedAt: NOW,
    reconsiderAt: null,
    status: 'considering',
    reflectionQuestion: null,
    reflectionAnswer: null,
    decidedAt: null,
    deletedAt: null,
    ...partial,
  };
}

const range = { start: '2026-11-09' as LocalDate, end: '2026-11-15' as LocalDate };

describe('kept by skipping', () => {
  it('counts only skipped decisions made inside the range', () => {
    const snap = emptySnapshot();
    snap.intentions.push(
      intention({ id: 'a', amount: rupees(1200), status: 'skipped', decidedAt: at('2026-11-10') }),
      intention({ id: 'b', amount: rupees(300), status: 'skipped', decidedAt: at('2026-11-12') }),
      // decided before the range started
      intention({ id: 'c', amount: rupees(900), status: 'skipped', decidedAt: at('2026-11-02') }),
      // still deciding: money paused, not kept
      intention({ id: 'd', amount: rupees(400), status: 'considering' }),
      intention({ id: 'e', amount: rupees(250), status: 'deferred', reconsiderAt: at('2026-11-13') }),
    );
    const s = keptSummary(snap, 'Asia/Kolkata', range);
    expect(s.kept).toBe(rupees(1500));
    expect(s.count).toBe(2);
    expect(s.waiting).toBe(rupees(650));
    expect(s.waitingCount).toBe(2);
  });

  it('never counts a skipped intention that was actually bought', () => {
    const snap = emptySnapshot();
    snap.intentions.push(intention({ id: 'a', amount: rupees(800), status: 'skipped', decidedAt: at('2026-11-11') }));
    expect(keptSummary(snap, 'Asia/Kolkata', range, new Set(['a'])).kept).toBe(0);
  });

  it('ignores deleted intentions and skipped ones with no decision time', () => {
    const snap = emptySnapshot();
    snap.intentions.push(
      intention({ id: 'a', amount: rupees(500), status: 'skipped', decidedAt: at('2026-11-11'), deletedAt: NOW }),
      intention({ id: 'b', amount: rupees(500), status: 'skipped', decidedAt: null }),
    );
    const s = keptSummary(snap, 'Asia/Kolkata', range);
    expect(s).toEqual({ kept: 0, count: 0, waiting: 0, waitingCount: 0 });
  });
});
