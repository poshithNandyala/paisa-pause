import { epochFromLocal, type LocalDate } from '../dates';
import { defaultCategories, defaultSettings } from '../defaults';
import { makeEntry, type EntryInput } from '../entries';
import type { Account, BudgetPeriod, Snapshot, Transaction } from '../types';

export const NOW = epochFromLocal('2026-11-12', 15, 0, 'Asia/Kolkata');

let seq = 0;
export function id(prefix = 'x'): string {
  seq += 1;
  return `${prefix}${seq}`;
}

export function rupees(r: number): number {
  return Math.round(r * 100);
}

export function at(date: LocalDate, h = 12, m = 0): number {
  return epochFromLocal(date, h, m, 'Asia/Kolkata');
}

export function emptySnapshot(today: LocalDate = '2026-11-12'): Snapshot {
  return {
    settings: { ...defaultSettings(today), onboarded: true, trackingStartDate: '2026-11-01' },
    accounts: [],
    cards: [],
    categories: defaultCategories(NOW),
    transactions: [],
    periods: [],
    reallocations: [],
    holds: [],
    envelopes: [],
    reservations: [],
    goals: [],
    intentions: [],
    obligations: [],
    obligationSkips: [],
    dayReviews: [],
    dismissals: [],
  };
}

export function account(partial: Partial<Account> & Pick<Account, 'kind'>): Account {
  return {
    id: partial.id ?? id('acc'),
    kind: partial.kind,
    nickname: partial.nickname ?? partial.kind,
    currency: 'INR',
    openingBalance: partial.openingBalance === undefined ? 0 : partial.openingBalance,
    openingAt: partial.openingAt ?? at('2026-11-01', 0, 0),
    includeInLiquid: partial.includeInLiquid ?? partial.kind !== 'credit_card',
    isSavings: partial.isSavings ?? false,
    archived: false,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

type Quick = Omit<EntryInput, 'id' | 'now' | 'occurredAt' | 'localDate'> & {
  date?: LocalDate;
  hour?: number;
  id?: string;
};

export function entry(q: Quick): Transaction {
  const date = q.date ?? '2026-11-12';
  return makeEntry({
    ...q,
    id: q.id ?? id('t'),
    now: NOW,
    localDate: date,
    occurredAt: at(date, q.hour ?? 12),
  });
}

export function period(partial: Partial<BudgetPeriod> = {}): BudgetPeriod {
  return {
    id: partial.id ?? id('p'),
    startDate: partial.startDate ?? '2026-11-09',
    endDate: partial.endDate ?? '2026-11-15',
    allocation: partial.allocation ?? rupees(900),
    anchorMode: partial.anchorMode ?? 'full_period',
    anchoredAt: partial.anchoredAt ?? at('2026-11-09', 0, 0),
    autoCreated: false,
    createdAt: NOW,
    updatedAt: NOW,
  };
}
