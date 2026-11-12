import type { TimeZoneSetting } from './dates';
import { formatTime, isLocalDate } from './dates';
import { personalShareOf } from './ledger';
import type { Paise } from './money';
import type { Snapshot, Transaction } from './types';

export const BACKUP_FORMAT = 'paisa-pause-backup';
export const BACKUP_VERSION = 1;

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  schemaVersion: number;
  data: Snapshot;
}

export function makeBackup(snapshot: Snapshot, schemaVersion: number, now: number): Backup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date(now).toISOString(),
    schemaVersion,
    data: snapshot,
  };
}

export interface BackupCheck {
  ok: boolean;
  errors: string[];
  counts: Record<string, number>;
  backup?: Backup;
}

const ARRAY_KEYS: (keyof Snapshot)[] = [
  'accounts',
  'cards',
  'categories',
  'transactions',
  'periods',
  'reallocations',
  'holds',
  'envelopes',
  'reservations',
  'goals',
  'intentions',
  'obligations',
  'obligationSkips',
  'dayReviews',
  'dismissals',
];

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v);
}

/** Checks a backup file before anything is replaced. Never partially applies. */
export function checkBackup(raw: unknown): BackupCheck {
  const errors: string[] = [];
  const counts: Record<string, number> = {};
  const fail = (msg: string): BackupCheck => ({ ok: false, errors: [...errors, msg], counts });

  if (!raw || typeof raw !== 'object') return fail('This file is not a Paisa Pause backup.');
  const b = raw as Partial<Backup>;
  if (b.format !== BACKUP_FORMAT) return fail('This file is not a Paisa Pause backup.');
  if (!isInt(b.version) || b.version > BACKUP_VERSION) {
    return fail('This backup was made by a newer version of the app. Update the app first.');
  }
  const data = b.data as Partial<Snapshot> | undefined;
  if (!data || typeof data !== 'object') return fail('The backup has no data.');
  if (!data.settings || typeof data.settings !== 'object') return fail('The backup has no settings.');
  for (const key of ARRAY_KEYS) {
    const arr = (data as Record<string, unknown>)[key];
    if (!Array.isArray(arr)) return fail(`The backup is missing "${key}".`);
    counts[key] = arr.length;
  }
  const snap = data as Snapshot;

  const accountIds = new Set<string>();
  for (const a of snap.accounts) {
    if (typeof a.id !== 'string' || !['bank', 'cash', 'wallet', 'credit_card'].includes(a.kind)) {
      errors.push('An account has an unknown type.');
      break;
    }
    if (a.openingBalance !== null && !isInt(a.openingBalance)) errors.push(`Account "${a.nickname}" has a broken balance.`);
    accountIds.add(a.id);
  }
  const categoryIds = new Set(snap.categories.map((c) => c.id));
  const txnIds = new Set<string>();
  for (const t of snap.transactions) {
    const label = `Entry on ${t.localDate}`;
    if (typeof t.id !== 'string' || txnIds.has(t.id)) {
      errors.push('Two entries share the same ID.');
      break;
    }
    txnIds.add(t.id);
    if (!isInt(t.amount) || t.amount <= 0) errors.push(`${label}: amount must be a whole number of paise above 0.`);
    if (t.currency !== 'INR') errors.push(`${label}: only INR is supported.`);
    if (!isLocalDate(t.localDate)) errors.push(`${label}: broken date.`);
    if (!isInt(t.occurredAt)) errors.push(`${label}: broken time.`);
    if (t.fromAccountId && !accountIds.has(t.fromAccountId)) errors.push(`${label}: unknown account.`);
    if (t.toAccountId && !accountIds.has(t.toAccountId)) errors.push(`${label}: unknown account.`);
    if (t.kind === 'expense' || t.kind === 'refund') {
      const sum = (t.allocations ?? []).reduce((s, a) => s + (isInt(a.amount) ? a.amount : NaN), 0);
      if (sum !== t.amount) errors.push(`${label}: category parts don't add up to the amount.`);
      for (const a of t.allocations ?? []) {
        if (!categoryIds.has(a.categoryId)) errors.push(`${label}: unknown category.`);
      }
    }
    if (t.personalShare !== null && t.personalShare !== undefined) {
      if (!isInt(t.personalShare) || t.personalShare < 0 || t.personalShare > t.amount) errors.push(`${label}: broken split.`);
    }
    if (errors.length > 20) break;
  }
  for (const t of snap.transactions) {
    if (t.refundOfId && !txnIds.has(t.refundOfId)) errors.push(`Refund on ${t.localDate} points to a missing purchase.`);
    if (t.reimbursementOfId && !txnIds.has(t.reimbursementOfId)) {
      errors.push(`Repayment on ${t.localDate} points to a missing purchase.`);
    }
    if (errors.length > 20) break;
  }
  const unique = [...new Set(errors)];
  if (unique.length) return { ok: false, errors: unique, counts };
  return { ok: true, errors: [], counts, backup: b as Backup };
}

// ---------------------------------------------------------------------------
// CSV (for spreadsheets)

function rupees(paise: Paise): string {
  const neg = paise < 0;
  const abs = Math.abs(paise);
  return `${neg ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

function cell(value: string | null | undefined): string {
  let v = value ?? '';
  // Stop spreadsheet apps from treating text as a formula.
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  if (/[",\n\r]/.test(v)) v = `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function transactionsCsv(snapshot: Snapshot, tz: TimeZoneSetting): string {
  const accounts = new Map(snapshot.accounts.map((a) => [a.id, a.nickname]));
  const cards = new Map(snapshot.cards.map((c) => [c.id, c.nickname]));
  const cats = new Map(snapshot.categories.map((c) => [c.id, c.name]));
  const header = [
    'date',
    'time',
    'type',
    'status',
    'amount_inr',
    'my_share_inr',
    'categories',
    'purpose',
    'payee',
    'from_account',
    'to_account',
    'card',
    'rail',
    'payment_app',
    'necessary',
    'planned',
    'worth_it',
    'note',
    'id',
  ];
  const rows = [...snapshot.transactions]
    .sort((a, b) => a.occurredAt - b.occurredAt)
    .map((t: Transaction) =>
      [
        t.localDate,
        formatTime(t.occurredAt, tz),
        t.kind,
        t.state,
        rupees(t.amount),
        t.kind === 'expense' ? rupees(personalShareOf(t)) : '',
        t.allocations.map((a) => `${cats.get(a.categoryId) ?? a.categoryId} ${rupees(a.amount)}`).join('; '),
        t.purpose,
        t.payee,
        t.fromAccountId ? accounts.get(t.fromAccountId) : '',
        t.toAccountId ? accounts.get(t.toAccountId) : '',
        t.cardId ? cards.get(t.cardId) : '',
        t.rail,
        t.paymentApp,
        t.tags.necessity,
        t.tags.planned,
        t.tags.worth,
        t.note,
        t.id,
      ]
        .map((v) => cell(v ?? ''))
        .join(','),
    );
  return [header.join(','), ...rows].join('\r\n') + '\r\n';
}
