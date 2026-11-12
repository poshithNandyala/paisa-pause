import type { LocalDate, TimeZoneSetting } from './dates';
import type { CurrencyCode, Paise } from './money';

// ---------------------------------------------------------------------------
// Accounts and cards

export type AccountKind = 'bank' | 'cash' | 'wallet' | 'credit_card';

export interface Account {
  id: string;
  kind: AccountKind;
  nickname: string;
  currency: CurrencyCode;
  /**
   * Snapshot of the balance as of `openingAt`.
   * Asset accounts: money in the account. Credit cards: amount OWED (positive = you owe).
   * null = not entered (fine in budget-only mode).
   */
  openingBalance: Paise | null;
  openingAt: number;
  /** Count this account's money as liquid in the account-aware estimate. */
  includeInLiquid: boolean;
  /** A savings account: moving money here is saving, not spending. */
  isSavings: boolean;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
}

export type CardType = 'credit' | 'debit';

export interface Card {
  id: string;
  type: CardType;
  /** A nickname only. Never a card number, CVV, PIN or login. */
  nickname: string;
  /** Credit: the card's own liability account. Debit: the linked bank account. */
  accountId: string;
  statementDay: number | null;
  dueDay: number | null;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Categories

export interface Category {
  id: string;
  name: string;
  hidden: boolean;
  archived: boolean;
  sort: number;
  builtin: boolean;
  createdAt: number;
}

export const UNCATEGORIZED_ID = 'uncategorized';

// ---------------------------------------------------------------------------
// Ledger

export type TxnKind =
  /** A purchase. Personal spending = personal share (all of it unless split). */
  | 'expense'
  /** Money back for a purchase. Reduces net spending once, on the refund date. */
  | 'refund'
  /** Between your own accounts: top-up, ATM, to savings, credit-card repayment. */
  | 'transfer'
  /** Money received. Never counted as negative spending. */
  | 'income'
  /** Someone paying back their share of a shared purchase. Not income. */
  | 'reimbursement'
  /** Reconciliation correction. Neither income nor spending. */
  | 'adjustment';

export type AccountingState =
  /** Happened. Counts. */
  | 'completed'
  /** Not sure it went through yet. Shown separately, never as completed spending. */
  | 'pending'
  /** Money left the account but the payment failed; waiting for it to come back. */
  | 'awaiting_reversal'
  /** The failed debit came back. No effect. */
  | 'reversed'
  /** Failed or cancelled with no debit. No effect. */
  | 'failed';

export type ConfirmationBasis = 'manual';

export type Rail = 'upi' | 'card' | 'cash' | 'netbanking' | 'wallet' | 'other';

export type BudgetBucket =
  /** Comes out of the flexible plan. */
  | 'flexible'
  /** A protected cost (rent, bills, EMI). Doesn't reduce the flexible plan. */
  | 'protected'
  /** Not part of any plan. */
  | 'outside';

export type NecessityTag = 'necessary' | 'optional' | 'mixed' | 'unspecified';
export type PlannedTag = 'planned' | 'unplanned' | 'unknown';
export type RecurrenceTag = 'recurring' | 'one_time' | 'unspecified';
export type WorthTag = 'worth_it' | 'mixed' | 'would_skip' | 'unsure' | 'unspecified';

export interface Tags {
  necessity: NecessityTag;
  planned: PlannedTag;
  recurrence: RecurrenceTag;
  worth: WorthTag;
}

export const DEFAULT_TAGS: Tags = {
  necessity: 'unspecified',
  planned: 'unknown',
  recurrence: 'unspecified',
  worth: 'unspecified',
};

export interface CategoryAllocation {
  categoryId: string;
  amount: Paise;
}

export interface Transaction {
  id: string;
  kind: TxnKind;
  /** Always > 0. The gross amount of the movement. */
  amount: Paise;
  currency: CurrencyCode;
  occurredAt: number;
  /** Calendar date it belongs to, fixed when recorded (see Settings → time zone). */
  localDate: LocalDate;
  createdAt: number;
  updatedAt: number;
  state: AccountingState;
  basis: ConfirmationBasis;
  /** Money left this account (expense funding source, transfer source, decrease adjustment). */
  fromAccountId: string | null;
  /** Money arrived here (refund, income, reimbursement, transfer target, increase adjustment). */
  toAccountId: string | null;
  cardId: string | null;
  rail: Rail | null;
  paymentApp: string | null;
  purpose: string | null;
  payee: string | null;
  note: string | null;
  /** expense/refund: category split; always sums exactly to `amount`. */
  allocations: CategoryAllocation[];
  /** expense: your part of `amount`; null means all of it. The rest is owed to you. */
  personalShare: Paise | null;
  budgetBucket: BudgetBucket;
  tags: Tags;
  refundOfId: string | null;
  /** refund: part of the refund that reduces YOUR spending; the rest reduces what others owe. null = all. */
  refundPersonalPart: Paise | null;
  reimbursementOfId: string | null;
  intentionId: string | null;
  holdId: string | null;
  obligationId: string | null;
  occurrenceDate: LocalDate | null;
  adjustmentReason: 'reconcile' | null;
  deletedAt: number | null;
  deleteBatchId: string | null;
}

// ---------------------------------------------------------------------------
// Plan

export type CycleKind = 'weekly' | 'monthly' | 'payday';
export type AnchorMode =
  /** The amount is the whole period's flexible money. */
  | 'full_period'
  /** The amount is what was left at `anchoredAt`; earlier spending is already reflected. */
  | 'remaining_now';

export interface BudgetPeriod {
  id: string;
  startDate: LocalDate;
  endDate: LocalDate;
  allocation: Paise;
  anchorMode: AnchorMode;
  anchoredAt: number;
  autoCreated: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Reallocation {
  id: string;
  periodId: string;
  /** Signed: + adds to the plan, - takes away. */
  amount: Paise;
  note: string | null;
  /** When an unallocated refund is assigned to the plan. */
  refundId: string | null;
  createdAt: number;
  deletedAt: number | null;
}

export interface Hold {
  id: string;
  periodId: string;
  amount: Paise;
  label: string;
  intentionId: string | null;
  createdAt: number;
  releasedAt: number | null;
  deletedAt: number | null;
}

export interface Envelope {
  id: string;
  categoryId: string;
  limit: Paise;
  createdAt: number;
  deletedAt: number | null;
}

export type ReservationKind = 'essential' | 'savings' | 'other';

/** Money kept aside INSIDE included accounts (account-aware mode). */
export interface Reservation {
  id: string;
  label: string;
  amount: Paise;
  kind: ReservationKind;
  active: boolean;
  createdAt: number;
  deletedAt: number | null;
}

export interface Goal {
  id: string;
  name: string;
  target: Paise;
  /** Your own tracking. Updating it never moves real money. */
  savedSoFar: Paise;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

// ---------------------------------------------------------------------------
// Before I buy

export type IntentionStatus = 'considering' | 'deferred' | 'skipped';

export interface Intention {
  id: string;
  amount: Paise;
  categoryId: string;
  label: string | null;
  planned: PlannedTag;
  createdAt: number;
  updatedAt: number;
  reconsiderAt: number | null;
  status: IntentionStatus;
  reflectionQuestion: string | null;
  reflectionAnswer: string | null;
  decidedAt: number | null;
  deletedAt: number | null;
}

// ---------------------------------------------------------------------------
// Recurring commitments

export type Cadence = 'weekly' | 'monthly' | 'yearly';

export interface Obligation {
  id: string;
  name: string;
  amount: Paise;
  categoryId: string;
  cadence: Cadence;
  /** First due date; later ones follow the cadence. */
  anchorDate: LocalDate;
  fundingAccountId: string | null;
  /** Keep it out of "available" in the account-aware estimate until paid. */
  protect: boolean;
  active: boolean;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface ObligationSkip {
  obligationId: string;
  occurrenceDate: LocalDate;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Review

export type DayStatus = 'complete' | 'missing';

export interface DayReview {
  localDate: LocalDate;
  status: DayStatus;
  note: string | null;
  reviewedAt: number;
}

export interface Dismissal {
  key: string;
  dismissedAt: number;
}

// ---------------------------------------------------------------------------
// Settings

export type Mode = 'budget_only' | 'account_aware';
export type VisualMode = 'envelope' | 'plain';
export type MotionSetting = 'system' | 'reduce' | 'full';

export interface Settings {
  currency: CurrencyCode;
  timezone: TimeZoneSetting;
  mode: Mode;
  cycle: CycleKind;
  /** 0 = Sunday … 6 = Saturday */
  weekStartsOn: number;
  /** 1–31; clamped to short months. */
  paydayDay: number;
  /** Used when a new period starts on its own. */
  defaultAllocation: Paise;
  focusCategoryIds: string[];
  /** 'HH:MM' or null */
  reviewTime: string | null;
  /** First day you were recording everything (coverage start). */
  trackingStartDate: LocalDate;
  hideAmounts: boolean;
  visualMode: VisualMode;
  motion: MotionSetting;
  suggestionsEnabled: boolean;
  /** Envelope warning threshold, percent. */
  envelopeThresholdPct: number;
  /** Reviewed days needed before showing spending pace. A product setting, not science. */
  minReviewedDaysForPace: number;
  onboarded: boolean;
}

export interface Snapshot {
  settings: Settings;
  accounts: Account[];
  cards: Card[];
  categories: Category[];
  /** Non-deleted transactions only. */
  transactions: Transaction[];
  periods: BudgetPeriod[];
  reallocations: Reallocation[];
  holds: Hold[];
  envelopes: Envelope[];
  reservations: Reservation[];
  goals: Goal[];
  intentions: Intention[];
  obligations: Obligation[];
  obligationSkips: ObligationSkip[];
  dayReviews: DayReview[];
  dismissals: Dismissal[];
}
