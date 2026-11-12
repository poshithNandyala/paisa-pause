import type { SqlDriver } from './sql';

/**
 * Schema migrations, applied in order inside a transaction each.
 * PRAGMA user_version records how many have run. Never edit a shipped
 * migration; add a new one.
 */
export const MIGRATIONS: string[] = [
  // 1 — first release
  `
  CREATE TABLE settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );

  CREATE TABLE accounts (
    id TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('bank','cash','wallet','credit_card')),
    nickname TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'INR',
    opening_balance INTEGER,
    opening_at INTEGER NOT NULL,
    include_in_liquid INTEGER NOT NULL DEFAULT 1,
    is_savings INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE cards (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('credit','debit')),
    nickname TEXT NOT NULL,
    account_id TEXT NOT NULL,
    statement_day INTEGER,
    due_day INTEGER,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE categories (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    hidden INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL,
    builtin INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE transactions (
    id TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('expense','refund','transfer','income','reimbursement','adjustment')),
    amount INTEGER NOT NULL CHECK (amount > 0),
    currency TEXT NOT NULL,
    occurred_at INTEGER NOT NULL,
    local_date TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('completed','pending','awaiting_reversal','reversed','failed')),
    basis TEXT NOT NULL DEFAULT 'manual',
    from_account_id TEXT,
    to_account_id TEXT,
    card_id TEXT,
    rail TEXT,
    payment_app TEXT,
    purpose TEXT,
    payee TEXT,
    note TEXT,
    personal_share INTEGER,
    budget_bucket TEXT NOT NULL DEFAULT 'flexible',
    tag_necessity TEXT NOT NULL DEFAULT 'unspecified',
    tag_planned TEXT NOT NULL DEFAULT 'unknown',
    tag_recurrence TEXT NOT NULL DEFAULT 'unspecified',
    tag_worth TEXT NOT NULL DEFAULT 'unspecified',
    refund_of_id TEXT,
    refund_personal_part INTEGER,
    reimbursement_of_id TEXT,
    intention_id TEXT,
    hold_id TEXT,
    obligation_id TEXT,
    occurrence_date TEXT,
    adjustment_reason TEXT,
    deleted_at INTEGER,
    delete_batch_id TEXT
  );
  CREATE INDEX idx_txn_date ON transactions (local_date);
  CREATE INDEX idx_txn_deleted ON transactions (deleted_at);
  CREATE INDEX idx_txn_refund ON transactions (refund_of_id);

  CREATE TABLE txn_allocations (
    txn_id TEXT NOT NULL REFERENCES transactions (id) ON DELETE CASCADE,
    category_id TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK (amount > 0),
    position INTEGER NOT NULL,
    PRIMARY KEY (txn_id, category_id)
  );

  CREATE TABLE audit_log (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    entity TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    action TEXT NOT NULL,
    before_json TEXT,
    after_json TEXT,
    at INTEGER NOT NULL
  );

  CREATE TABLE budget_periods (
    id TEXT PRIMARY KEY NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    allocation INTEGER NOT NULL,
    anchor_mode TEXT NOT NULL CHECK (anchor_mode IN ('full_period','remaining_now')),
    anchored_at INTEGER NOT NULL,
    auto_created INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE reallocations (
    id TEXT PRIMARY KEY NOT NULL,
    period_id TEXT NOT NULL,
    amount INTEGER NOT NULL,
    note TEXT,
    refund_id TEXT,
    created_at INTEGER NOT NULL,
    deleted_at INTEGER
  );

  CREATE TABLE holds (
    id TEXT PRIMARY KEY NOT NULL,
    period_id TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK (amount > 0),
    label TEXT NOT NULL,
    intention_id TEXT,
    created_at INTEGER NOT NULL,
    released_at INTEGER,
    deleted_at INTEGER
  );

  CREATE TABLE envelopes (
    id TEXT PRIMARY KEY NOT NULL,
    category_id TEXT NOT NULL,
    limit_amount INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    deleted_at INTEGER
  );

  CREATE TABLE reservations (
    id TEXT PRIMARY KEY NOT NULL,
    label TEXT NOT NULL,
    amount INTEGER NOT NULL,
    kind TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    deleted_at INTEGER
  );

  CREATE TABLE goals (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    target INTEGER NOT NULL,
    saved_so_far INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );

  CREATE TABLE intentions (
    id TEXT PRIMARY KEY NOT NULL,
    amount INTEGER NOT NULL CHECK (amount > 0),
    category_id TEXT NOT NULL,
    label TEXT,
    planned TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    reconsider_at INTEGER,
    status TEXT NOT NULL CHECK (status IN ('considering','deferred','skipped')),
    reflection_question TEXT,
    reflection_answer TEXT,
    decided_at INTEGER,
    deleted_at INTEGER
  );

  CREATE TABLE obligations (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK (amount > 0),
    category_id TEXT NOT NULL,
    cadence TEXT NOT NULL CHECK (cadence IN ('weekly','monthly','yearly')),
    anchor_date TEXT NOT NULL,
    funding_account_id TEXT,
    protect INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );

  CREATE TABLE obligation_skips (
    obligation_id TEXT NOT NULL,
    occurrence_date TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (obligation_id, occurrence_date)
  );

  CREATE TABLE day_reviews (
    local_date TEXT PRIMARY KEY NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('complete','missing')),
    note TEXT,
    reviewed_at INTEGER NOT NULL
  );

  CREATE TABLE dismissals (
    key TEXT PRIMARY KEY NOT NULL,
    dismissed_at INTEGER NOT NULL
  );

  -- Future: evidence from notifications/receipts linked to one transaction.
  -- Not used in this release (no capture is enabled).
  CREATE TABLE evidence_candidates (
    id TEXT PRIMARY KEY NOT NULL,
    source TEXT NOT NULL,
    source_id TEXT,
    parser_version TEXT,
    extracted_json TEXT,
    confidence REAL,
    txn_id TEXT,
    created_at INTEGER NOT NULL
  );
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export async function migrate(db: SqlDriver): Promise<number> {
  const row = await db.get<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  if (current > MIGRATIONS.length) {
    throw new Error('This data was saved by a newer version of the app. Please update the app.');
  }
  for (let v = current; v < MIGRATIONS.length; v++) {
    await db.transaction(async () => {
      await db.exec(MIGRATIONS[v]);
      await db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
  return MIGRATIONS.length;
}
