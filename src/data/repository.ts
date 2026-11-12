import { defaultCategories, defaultSettings } from '../domain/defaults';
import type {
  Account,
  BudgetPeriod,
  Card,
  Category,
  DayReview,
  Dismissal,
  Envelope,
  Goal,
  Hold,
  Intention,
  Obligation,
  ObligationSkip,
  Reallocation,
  Reservation,
  Settings,
  Snapshot,
  Transaction,
} from '../domain/types';
import { migrate, SCHEMA_VERSION } from './schema';
import { Mutex, type SqlDriver, type SqlValue } from './sql';

type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Generic column mapping for simple entities

type ColType = 'text' | 'int' | 'bool' | 'real';
interface Col {
  field: string;
  column: string;
  type: ColType;
}
interface Spec {
  table: string;
  key: string[];
  cols: Col[];
}

const c = (field: string, column: string, type: ColType = 'text'): Col => ({ field, column, type });

const SPECS = {
  accounts: {
    table: 'accounts',
    key: ['id'],
    cols: [
      c('id', 'id'),
      c('kind', 'kind'),
      c('nickname', 'nickname'),
      c('currency', 'currency'),
      c('openingBalance', 'opening_balance', 'int'),
      c('openingAt', 'opening_at', 'int'),
      c('includeInLiquid', 'include_in_liquid', 'bool'),
      c('isSavings', 'is_savings', 'bool'),
      c('archived', 'archived', 'bool'),
      c('createdAt', 'created_at', 'int'),
      c('updatedAt', 'updated_at', 'int'),
    ],
  },
  cards: {
    table: 'cards',
    key: ['id'],
    cols: [
      c('id', 'id'),
      c('type', 'type'),
      c('nickname', 'nickname'),
      c('accountId', 'account_id'),
      c('statementDay', 'statement_day', 'int'),
      c('dueDay', 'due_day', 'int'),
      c('archived', 'archived', 'bool'),
      c('createdAt', 'created_at', 'int'),
      c('updatedAt', 'updated_at', 'int'),
    ],
  },
  categories: {
    table: 'categories',
    key: ['id'],
    cols: [
      c('id', 'id'),
      c('name', 'name'),
      c('hidden', 'hidden', 'bool'),
      c('archived', 'archived', 'bool'),
      c('sort', 'sort', 'int'),
      c('builtin', 'builtin', 'bool'),
      c('createdAt', 'created_at', 'int'),
    ],
  },
  periods: {
    table: 'budget_periods',
    key: ['id'],
    cols: [
      c('id', 'id'),
      c('startDate', 'start_date'),
      c('endDate', 'end_date'),
      c('allocation', 'allocation', 'int'),
      c('anchorMode', 'anchor_mode'),
      c('anchoredAt', 'anchored_at', 'int'),
      c('autoCreated', 'auto_created', 'bool'),
      c('createdAt', 'created_at', 'int'),
      c('updatedAt', 'updated_at', 'int'),
    ],
  },
  reallocations: {
    table: 'reallocations',
    key: ['id'],
    cols: [
      c('id', 'id'),
      c('periodId', 'period_id'),
      c('amount', 'amount', 'int'),
      c('note', 'note'),
      c('refundId', 'refund_id'),
      c('createdAt', 'created_at', 'int'),
      c('deletedAt', 'deleted_at', 'int'),
    ],
  },
  holds: {
    table: 'holds',
    key: ['id'],
    cols: [
      c('id', 'id'),
      c('periodId', 'period_id'),
      c('amount', 'amount', 'int'),
      c('label', 'label'),
      c('intentionId', 'intention_id'),
      c('createdAt', 'created_at', 'int'),
      c('releasedAt', 'released_at', 'int'),
      c('deletedAt', 'deleted_at', 'int'),
    ],
  },
  envelopes: {
    table: 'envelopes',
    key: ['id'],
    cols: [
      c('id', 'id'),
      c('categoryId', 'category_id'),
      c('limit', 'limit_amount', 'int'),
      c('createdAt', 'created_at', 'int'),
      c('deletedAt', 'deleted_at', 'int'),
    ],
  },
  reservations: {
    table: 'reservations',
    key: ['id'],
    cols: [
      c('id', 'id'),
      c('label', 'label'),
      c('amount', 'amount', 'int'),
      c('kind', 'kind'),
      c('active', 'active', 'bool'),
      c('createdAt', 'created_at', 'int'),
      c('deletedAt', 'deleted_at', 'int'),
    ],
  },
  goals: {
    table: 'goals',
    key: ['id'],
    cols: [
      c('id', 'id'),
      c('name', 'name'),
      c('target', 'target', 'int'),
      c('savedSoFar', 'saved_so_far', 'int'),
      c('createdAt', 'created_at', 'int'),
      c('updatedAt', 'updated_at', 'int'),
      c('deletedAt', 'deleted_at', 'int'),
    ],
  },
  intentions: {
    table: 'intentions',
    key: ['id'],
    cols: [
      c('id', 'id'),
      c('amount', 'amount', 'int'),
      c('categoryId', 'category_id'),
      c('label', 'label'),
      c('planned', 'planned'),
      c('createdAt', 'created_at', 'int'),
      c('updatedAt', 'updated_at', 'int'),
      c('reconsiderAt', 'reconsider_at', 'int'),
      c('status', 'status'),
      c('reflectionQuestion', 'reflection_question'),
      c('reflectionAnswer', 'reflection_answer'),
      c('decidedAt', 'decided_at', 'int'),
      c('deletedAt', 'deleted_at', 'int'),
    ],
  },
  obligations: {
    table: 'obligations',
    key: ['id'],
    cols: [
      c('id', 'id'),
      c('name', 'name'),
      c('amount', 'amount', 'int'),
      c('categoryId', 'category_id'),
      c('cadence', 'cadence'),
      c('anchorDate', 'anchor_date'),
      c('fundingAccountId', 'funding_account_id'),
      c('protect', 'protect', 'bool'),
      c('active', 'active', 'bool'),
      c('createdAt', 'created_at', 'int'),
      c('updatedAt', 'updated_at', 'int'),
      c('deletedAt', 'deleted_at', 'int'),
    ],
  },
  obligationSkips: {
    table: 'obligation_skips',
    key: ['obligation_id', 'occurrence_date'],
    cols: [c('obligationId', 'obligation_id'), c('occurrenceDate', 'occurrence_date'), c('createdAt', 'created_at', 'int')],
  },
  dayReviews: {
    table: 'day_reviews',
    key: ['local_date'],
    cols: [c('localDate', 'local_date'), c('status', 'status'), c('note', 'note'), c('reviewedAt', 'reviewed_at', 'int')],
  },
  dismissals: {
    table: 'dismissals',
    key: ['key'],
    cols: [c('key', 'key'), c('dismissedAt', 'dismissed_at', 'int')],
  },
} satisfies Record<string, Spec>;

export type EntityName = keyof typeof SPECS;

export interface EntityTypes {
  accounts: Account;
  cards: Card;
  categories: Category;
  periods: BudgetPeriod;
  reallocations: Reallocation;
  holds: Hold;
  envelopes: Envelope;
  reservations: Reservation;
  goals: Goal;
  intentions: Intention;
  obligations: Obligation;
  obligationSkips: ObligationSkip;
  dayReviews: DayReview;
  dismissals: Dismissal;
}

function toSql(value: unknown, type: ColType): SqlValue {
  if (value === null || value === undefined) return null;
  if (type === 'bool') return value ? 1 : 0;
  if (type === 'int') {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`Expected a whole number, got ${String(value)}`);
    return value;
  }
  if (type === 'real') return Number(value);
  return String(value);
}

function fromSql(value: unknown, type: ColType): unknown {
  if (value === null || value === undefined) return null;
  if (type === 'bool') return value === 1 || value === true;
  if (type === 'int' || type === 'real') return Number(value);
  return String(value);
}

function rowToEntity<T>(spec: Spec, row: Row): T {
  const out: Record<string, unknown> = {};
  for (const col of spec.cols) out[col.field] = fromSql(row[col.column], col.type);
  return out as T;
}

function upsertSql(spec: Spec): string {
  const cols = spec.cols.map((x) => x.column);
  const placeholders = cols.map(() => '?').join(', ');
  const updates = cols
    .filter((col) => !spec.key.includes(col))
    .map((col) => `${col} = excluded.${col}`)
    .join(', ');
  return `INSERT INTO ${spec.table} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT (${spec.key.join(', ')}) DO UPDATE SET ${updates}`;
}

function entityParams(spec: Spec, entity: object): SqlValue[] {
  const e = entity as Record<string, unknown>;
  return spec.cols.map((col) => toSql(e[col.field], col.type));
}

// ---------------------------------------------------------------------------
// Transactions

const TXN_COLUMNS = [
  'id',
  'kind',
  'amount',
  'currency',
  'occurred_at',
  'local_date',
  'created_at',
  'updated_at',
  'state',
  'basis',
  'from_account_id',
  'to_account_id',
  'card_id',
  'rail',
  'payment_app',
  'purpose',
  'payee',
  'note',
  'personal_share',
  'budget_bucket',
  'tag_necessity',
  'tag_planned',
  'tag_recurrence',
  'tag_worth',
  'refund_of_id',
  'refund_personal_part',
  'reimbursement_of_id',
  'intention_id',
  'hold_id',
  'obligation_id',
  'occurrence_date',
  'adjustment_reason',
  'deleted_at',
  'delete_batch_id',
];

function txnParams(t: Transaction): SqlValue[] {
  const int = (v: number | null) => toSql(v, 'int');
  return [
    t.id,
    t.kind,
    int(t.amount),
    t.currency,
    int(t.occurredAt),
    t.localDate,
    int(t.createdAt),
    int(t.updatedAt),
    t.state,
    t.basis,
    t.fromAccountId,
    t.toAccountId,
    t.cardId,
    t.rail,
    t.paymentApp,
    t.purpose,
    t.payee,
    t.note,
    int(t.personalShare),
    t.budgetBucket,
    t.tags.necessity,
    t.tags.planned,
    t.tags.recurrence,
    t.tags.worth,
    t.refundOfId,
    int(t.refundPersonalPart),
    t.reimbursementOfId,
    t.intentionId,
    t.holdId,
    t.obligationId,
    t.occurrenceDate,
    t.adjustmentReason,
    int(t.deletedAt),
    t.deleteBatchId,
  ];
}

function rowToTxn(r: Row, allocations: Transaction['allocations']): Transaction {
  const s = (k: string) => (r[k] === null || r[k] === undefined ? null : String(r[k]));
  const n = (k: string) => (r[k] === null || r[k] === undefined ? null : Number(r[k]));
  return {
    id: String(r.id),
    kind: r.kind as Transaction['kind'],
    amount: Number(r.amount),
    currency: 'INR',
    occurredAt: Number(r.occurred_at),
    localDate: String(r.local_date),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    state: r.state as Transaction['state'],
    basis: 'manual',
    fromAccountId: s('from_account_id'),
    toAccountId: s('to_account_id'),
    cardId: s('card_id'),
    rail: s('rail') as Transaction['rail'],
    paymentApp: s('payment_app'),
    purpose: s('purpose'),
    payee: s('payee'),
    note: s('note'),
    allocations,
    personalShare: n('personal_share'),
    budgetBucket: r.budget_bucket as Transaction['budgetBucket'],
    tags: {
      necessity: r.tag_necessity as Transaction['tags']['necessity'],
      planned: r.tag_planned as Transaction['tags']['planned'],
      recurrence: r.tag_recurrence as Transaction['tags']['recurrence'],
      worth: r.tag_worth as Transaction['tags']['worth'],
    },
    refundOfId: s('refund_of_id'),
    refundPersonalPart: n('refund_personal_part'),
    reimbursementOfId: s('reimbursement_of_id'),
    intentionId: s('intention_id'),
    holdId: s('hold_id'),
    obligationId: s('obligation_id'),
    occurrenceDate: s('occurrence_date'),
    adjustmentReason: s('adjustment_reason') as Transaction['adjustmentReason'],
    deletedAt: n('deleted_at'),
    deleteBatchId: s('delete_batch_id'),
  };
}

const ALL_TABLES = [
  'settings',
  'accounts',
  'cards',
  'categories',
  'txn_allocations',
  'transactions',
  'audit_log',
  'budget_periods',
  'reallocations',
  'holds',
  'envelopes',
  'reservations',
  'goals',
  'intentions',
  'obligations',
  'obligation_skips',
  'day_reviews',
  'dismissals',
  'evidence_candidates',
];

// ---------------------------------------------------------------------------

/** What a write can change, applied atomically in one database transaction. */
export interface ChangeSet {
  insertTxns?: Transaction[];
  updateTxns?: Transaction[];
  upserts?: { [K in EntityName]?: EntityTypes[K][] };
  deleteRows?: { entity: EntityName; keys: SqlValue[] }[];
  settings?: Settings;
}

export type InsertOutcome = 'inserted' | 'duplicate';

export class Repository {
  private readonly lock = new Mutex();

  constructor(private readonly db: SqlDriver) {}

  /** Run migrations and create first-run defaults. */
  async init(today: string, now: number): Promise<void> {
    await this.lock.run(async () => {
      await migrate(this.db);
      const existing = await this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM categories');
      if ((existing?.n ?? 0) === 0) {
        await this.db.transaction(async () => {
          for (const cat of defaultCategories(now)) {
            await this.db.run(upsertSql(SPECS.categories), entityParams(SPECS.categories, cat));
          }
          const hasSettings = await this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM settings');
          if ((hasSettings?.n ?? 0) === 0) await this.writeSettings(defaultSettings(today));
        });
      }
    });
  }

  get schemaVersion(): number {
    return SCHEMA_VERSION;
  }

  async load(): Promise<Snapshot> {
    return this.lock.run(() => this.loadUnlocked());
  }

  private async loadUnlocked(): Promise<Snapshot> {
    const settingsRows = await this.db.all<{ key: string; value: string }>('SELECT key, value FROM settings');
    const stored: Record<string, unknown> = {};
    for (const r of settingsRows) stored[r.key] = JSON.parse(r.value);
    const base = defaultSettings(new Date().toISOString().slice(0, 10));
    const settings = { ...base, ...stored } as Settings;

    const load = async <K extends EntityName>(name: K, where = ''): Promise<EntityTypes[K][]> => {
      const spec = SPECS[name];
      const rows = await this.db.all<Row>(`SELECT * FROM ${spec.table} ${where}`);
      return rows.map((row) => rowToEntity<EntityTypes[K]>(spec, row));
    };

    const transactions = await this.loadTxns('WHERE deleted_at IS NULL');
    return {
      settings,
      accounts: await load('accounts', 'ORDER BY created_at'),
      cards: await load('cards', 'ORDER BY created_at'),
      categories: await load('categories', 'ORDER BY sort, name'),
      transactions,
      periods: await load('periods', 'ORDER BY start_date'),
      reallocations: await load('reallocations', 'WHERE deleted_at IS NULL'),
      holds: await load('holds', 'WHERE deleted_at IS NULL'),
      envelopes: await load('envelopes', 'WHERE deleted_at IS NULL ORDER BY created_at'),
      reservations: await load('reservations', 'WHERE deleted_at IS NULL ORDER BY created_at'),
      goals: await load('goals', 'WHERE deleted_at IS NULL ORDER BY created_at'),
      intentions: await load('intentions', 'WHERE deleted_at IS NULL ORDER BY created_at DESC'),
      obligations: await load('obligations', 'WHERE deleted_at IS NULL ORDER BY anchor_date'),
      obligationSkips: await load('obligationSkips'),
      dayReviews: await load('dayReviews'),
      dismissals: await load('dismissals'),
    };
  }

  private async loadTxns(where: string, params: SqlValue[] = []): Promise<Transaction[]> {
    const rows = await this.db.all<Row>(`SELECT * FROM transactions ${where} ORDER BY occurred_at DESC, created_at DESC`, params);
    if (rows.length === 0) return [];
    const allocRows = await this.db.all<{ txn_id: string; category_id: string; amount: number }>(
      'SELECT txn_id, category_id, amount FROM txn_allocations ORDER BY txn_id, position',
    );
    const byTxn = new Map<string, Transaction['allocations']>();
    for (const a of allocRows) {
      const list = byTxn.get(a.txn_id) ?? [];
      list.push({ categoryId: a.category_id, amount: Number(a.amount) });
      byTxn.set(a.txn_id, list);
    }
    return rows.map((r) => rowToTxn(r, byTxn.get(String(r.id)) ?? []));
  }

  async loadDeleted(): Promise<Transaction[]> {
    return this.lock.run(() => this.loadTxns('WHERE deleted_at IS NOT NULL'));
  }

  // -------------------------------------------------------------------------
  // Writes

  private async writeSettings(s: Settings): Promise<void> {
    for (const [key, value] of Object.entries(s)) {
      await this.db.run(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
        [key, JSON.stringify(value)],
      );
    }
  }

  private async writeAllocations(t: Transaction): Promise<void> {
    await this.db.run('DELETE FROM txn_allocations WHERE txn_id = ?', [t.id]);
    let position = 0;
    for (const a of t.allocations) {
      await this.db.run('INSERT INTO txn_allocations (txn_id, category_id, amount, position) VALUES (?, ?, ?, ?)', [
        t.id,
        a.categoryId,
        toSql(a.amount, 'int'),
        position++,
      ]);
    }
  }

  private async audit(entity: string, id: string, action: string, before: unknown, after: unknown, at: number) {
    await this.db.run(
      'INSERT INTO audit_log (entity, entity_id, action, before_json, after_json, at) VALUES (?, ?, ?, ?, ?, ?)',
      [entity, id, action, before === undefined ? null : JSON.stringify(before), after === undefined ? null : JSON.stringify(after), at],
    );
  }

  /**
   * Apply a set of changes atomically. Inserting a transaction whose ID
   * already exists is a no-op (so a double tap can never save twice):
   * the whole change set is skipped and 'duplicate' is returned.
   */
  async apply(changes: ChangeSet, now: number): Promise<InsertOutcome> {
    return this.lock.run(async () => {
      // Idempotency: if any new entry ID already exists, nothing is written.
      for (const t of changes.insertTxns ?? []) {
        const existing = await this.db.get<{ id: string }>('SELECT id FROM transactions WHERE id = ?', [t.id]);
        if (existing) return 'duplicate' as InsertOutcome;
      }
      await this.db.transaction(async () => {
        for (const t of changes.insertTxns ?? []) {
          await this.db.run(
            `INSERT INTO transactions (${TXN_COLUMNS.join(', ')}) VALUES (${TXN_COLUMNS.map(() => '?').join(', ')})`,
            txnParams(t),
          );
          await this.writeAllocations(t);
          await this.audit('transaction', t.id, 'create', undefined, t, now);
        }
        for (const t of changes.updateTxns ?? []) {
          const beforeRows = await this.loadTxns('WHERE id = ?', [t.id]);
          if (beforeRows.length === 0) throw new Error('That entry no longer exists.');
          const sets = TXN_COLUMNS.filter((col) => col !== 'id').map((col) => `${col} = ?`).join(', ');
          const params = txnParams(t);
          await this.db.run(`UPDATE transactions SET ${sets} WHERE id = ?`, [...params.slice(1), t.id]);
          await this.writeAllocations(t);
          await this.audit('transaction', t.id, 'update', beforeRows[0], t, now);
        }
        for (const [name, list] of Object.entries(changes.upserts ?? {})) {
          const spec = SPECS[name as EntityName];
          for (const entity of list as object[]) {
            await this.db.run(upsertSql(spec), entityParams(spec, entity));
          }
        }
        for (const del of changes.deleteRows ?? []) {
          const spec = SPECS[del.entity];
          const where = spec.key.map((k) => `${k} = ?`).join(' AND ');
          await this.db.run(`DELETE FROM ${spec.table} WHERE ${where}`, del.keys);
        }
        if (changes.settings) await this.writeSettings(changes.settings);
      });
      return 'inserted' as InsertOutcome;
    });
  }

  /** Soft-delete entries together (e.g. a purchase and its refunds); undo restores the batch. */
  async softDelete(ids: string[], batchId: string, now: number): Promise<void> {
    await this.lock.run(() =>
      this.db.transaction(async () => {
        for (const id of ids) {
          await this.db.run('UPDATE transactions SET deleted_at = ?, delete_batch_id = ? WHERE id = ? AND deleted_at IS NULL', [
            now,
            batchId,
            id,
          ]);
          await this.audit('transaction', id, 'delete', undefined, { batchId }, now);
        }
      }),
    );
  }

  async restoreBatch(batchId: string, now: number): Promise<number> {
    return this.lock.run(async () => {
      let changed = 0;
      await this.db.transaction(async () => {
        const res = await this.db.run(
          'UPDATE transactions SET deleted_at = NULL, delete_batch_id = NULL WHERE delete_batch_id = ?',
          [batchId],
        );
        changed = res.changes;
        await this.audit('transaction', batchId, 'restore', undefined, { batchId }, now);
      });
      return changed;
    });
  }

  /** Erase soft-deleted entries older than `cutoff` for good. */
  async purgeDeleted(cutoff: number): Promise<number> {
    return this.lock.run(async () => {
      let removed = 0;
      await this.db.transaction(async () => {
        await this.db.run(
          'DELETE FROM txn_allocations WHERE txn_id IN (SELECT id FROM transactions WHERE deleted_at IS NOT NULL AND deleted_at < ?)',
          [cutoff],
        );
        const res = await this.db.run('DELETE FROM transactions WHERE deleted_at IS NOT NULL AND deleted_at < ?', [cutoff]);
        removed = res.changes;
      });
      return removed;
    });
  }

  /** Replace everything with a checked backup. All or nothing. */
  async replaceAll(snapshot: Snapshot, now: number): Promise<void> {
    await this.lock.run(() =>
      this.db.transaction(async () => {
        for (const table of ALL_TABLES) await this.db.run(`DELETE FROM ${table}`);
        await this.writeSettings(snapshot.settings);
        for (const name of Object.keys(SPECS) as EntityName[]) {
          const spec = SPECS[name];
          const list = (snapshot as unknown as Record<string, object[]>)[name] ?? [];
          for (const entity of list) await this.db.run(upsertSql(spec), entityParams(spec, entity));
        }
        for (const t of snapshot.transactions) {
          await this.db.run(
            `INSERT INTO transactions (${TXN_COLUMNS.join(', ')}) VALUES (${TXN_COLUMNS.map(() => '?').join(', ')})`,
            txnParams({ ...t, deletedAt: null, deleteBatchId: null }),
          );
          await this.writeAllocations(t);
        }
        await this.audit('database', 'all', 'restore', undefined, { transactions: snapshot.transactions.length }, now);
      }),
    );
  }

  /** Delete every row (used before deleting the database file itself). */
  async wipeRows(): Promise<void> {
    await this.lock.run(() =>
      this.db.transaction(async () => {
        for (const table of ALL_TABLES) await this.db.run(`DELETE FROM ${table}`);
      }),
    );
  }

  async close(): Promise<void> {
    await this.lock.run(() => this.db.close());
  }
}
