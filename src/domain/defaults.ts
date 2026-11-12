import type { LocalDate } from './dates';
import type { Category, Settings } from './types';
import { UNCATEGORIZED_ID } from './types';

/** Stable IDs so exports, rules and suggestions keep working after renames. */
export const DEFAULT_CATEGORIES: { id: string; name: string }[] = [
  { id: 'everyday_food', name: 'Everyday food' },
  { id: 'groceries', name: 'Groceries' },
  { id: 'eating_out', name: 'Eating out & delivery' },
  { id: 'transport', name: 'Transport' },
  { id: 'apps_subscriptions', name: 'Apps & subscriptions' },
  { id: 'learning', name: 'Learning & PDFs' },
  { id: 'shopping', name: 'Shopping' },
  { id: 'home_bills', name: 'Home & bills' },
  { id: 'health', name: 'Health' },
  { id: 'family_gifts', name: 'Family & gifts' },
  { id: 'leisure', name: 'Leisure' },
  { id: 'other', name: 'Other' },
  { id: UNCATEGORIZED_ID, name: 'Uncategorized' },
];

/** Categories where "Before I buy" may ask one optional question. */
export const DIGITAL_PURCHASE_CATEGORY_IDS = ['apps_subscriptions', 'learning'];

export function defaultCategories(now: number): Category[] {
  return DEFAULT_CATEGORIES.map((c, i) => ({
    id: c.id,
    name: c.name,
    hidden: false,
    archived: false,
    sort: i,
    builtin: true,
    createdAt: now,
  }));
}

export function defaultSettings(today: LocalDate): Settings {
  return {
    currency: 'INR',
    timezone: 'Asia/Kolkata',
    mode: 'budget_only',
    cycle: 'monthly',
    weekStartsOn: 1,
    paydayDay: 1,
    defaultAllocation: 0,
    focusCategoryIds: [],
    reviewTime: null,
    trackingStartDate: today,
    hideAmounts: false,
    visualMode: 'envelope',
    motion: 'system',
    suggestionsEnabled: true,
    envelopeThresholdPct: 80,
    minReviewedDaysForPace: 14,
    onboarded: false,
  };
}
