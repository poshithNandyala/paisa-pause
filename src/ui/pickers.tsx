import React, { useState } from 'react';
import { View } from 'react-native';
import { recentCategoryIds } from '../domain/entries';
import type { Account, Rail } from '../domain/types';
import { useReady } from '../state/store';
import { Button, Chip, Label, Muted, RowWrap } from './kit';
import { SPACE } from './theme';

/** Recent categories first, then the rest on request. Uncategorized is always allowed. */
export function CategoryPicker({ value, onChange, label = 'Category' }: { value: string; onChange: (id: string) => void; label?: string }) {
  const { snapshot, derived } = useReady();
  const [all, setAll] = useState(false);
  const recent = recentCategoryIds(snapshot.transactions, 6).filter((id) => derived.categoriesById.get(id) && !derived.categoriesById.get(id)?.hidden);
  const focus = snapshot.settings.focusCategoryIds.filter((id) => !recent.includes(id));
  const quick = [...recent, ...focus].slice(0, 6);
  const shown = all || quick.length < 3 ? derived.pickerCategories.map((c) => c.id) : [...quick, 'uncategorized'];
  if (!shown.includes(value) && value) shown.unshift(value);
  return (
    <View style={{ gap: SPACE.xs }} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <Label>{label}</Label>
      <RowWrap>
        {[...new Set(shown)].map((id) => (
          <Chip key={id} label={derived.categoryName(id)} selected={id === value} onPress={() => onChange(id)} />
        ))}
        {!all && quick.length >= 3 ? <Chip label="All categories…" role="button" onPress={() => setAll(true)} /> : null}
      </RowWrap>
    </View>
  );
}

export interface SourceValue {
  accountId: string | null;
  cardId: string | null;
  rail: Rail | null;
}

/** Suggested rail for a funding source; the person can still change it. */
export function railFor(account: Account | undefined, viaCard: boolean): Rail | null {
  if (!account) return null;
  if (viaCard || account.kind === 'credit_card') return 'card';
  if (account.kind === 'cash') return 'cash';
  if (account.kind === 'wallet') return 'wallet';
  return 'upi';
}

/**
 * Where the money came from. A debit card points at its linked bank account
 * (no second balance). A credit card is its own liability account.
 */
export function SourcePicker({
  value,
  onChange,
  label = 'Paid from',
}: {
  value: SourceValue;
  onChange: (v: SourceValue) => void;
  label?: string;
}) {
  const { snapshot, derived } = useReady();
  const accounts = snapshot.accounts.filter((a) => !a.archived);
  const debitCards = snapshot.cards.filter((c) => c.type === 'debit' && !c.archived);
  const creditCardFor = (accountId: string) => snapshot.cards.find((c) => c.type === 'credit' && c.accountId === accountId);
  return (
    <View style={{ gap: SPACE.xs }} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <Label>{label}</Label>
      <RowWrap>
        <Chip label="Not set" selected={!value.accountId} onPress={() => onChange({ accountId: null, cardId: null, rail: value.rail })} />
        {accounts.map((a) => (
          <Chip
            key={a.id}
            label={a.nickname}
            selected={value.accountId === a.id && (a.kind === 'credit_card' || !value.cardId)}
            onPress={() =>
              onChange({
                accountId: a.id,
                cardId: a.kind === 'credit_card' ? (creditCardFor(a.id)?.id ?? null) : null,
                rail: railFor(a, false),
              })
            }
          />
        ))}
        {debitCards.map((card) => (
          <Chip
            key={card.id}
            label={`${card.nickname} (debit)`}
            selected={value.cardId === card.id}
            onPress={() => onChange({ accountId: card.accountId, cardId: card.id, rail: 'card' })}
          />
        ))}
      </RowWrap>
      {accounts.length === 0 ? (
        <Muted>No accounts yet. That's fine — add them later in Settings → Accounts & cards if you want balances.</Muted>
      ) : null}
      {value.cardId && derived.cardsById.get(value.cardId)?.type === 'debit' ? (
        <Muted>Debit card spending comes out of {derived.accountsById.get(value.accountId ?? '')?.nickname ?? 'its bank account'}.</Muted>
      ) : null}
    </View>
  );
}

const RAILS: { value: Rail; label: string }[] = [
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
  { value: 'cash', label: 'Cash' },
  { value: 'netbanking', label: 'Net banking' },
  { value: 'wallet', label: 'Wallet' },
  { value: 'other', label: 'Other' },
];

export function RailPicker({ value, onChange }: { value: Rail | null; onChange: (r: Rail | null) => void }) {
  return (
    <View style={{ gap: SPACE.xs }} accessibilityRole="radiogroup" accessibilityLabel="Payment method">
      <Label>Payment method</Label>
      <RowWrap>
        {RAILS.map((r) => (
          <Chip key={r.value} label={r.label} selected={value === r.value} onPress={() => onChange(value === r.value ? null : r.value)} />
        ))}
      </RowWrap>
    </View>
  );
}

const APPS = ['PhonePe', 'Google Pay', 'Paytm', 'FamApp', 'BHIM', 'Bank app'];

export function PaymentAppPicker({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  return (
    <View style={{ gap: SPACE.xs }} accessibilityRole="radiogroup" accessibilityLabel="Payment app (optional)">
      <Label>Payment app (optional)</Label>
      <RowWrap>
        {APPS.map((a) => (
          <Chip key={a} label={a} selected={value === a} onPress={() => onChange(value === a ? null : a)} />
        ))}
      </RowWrap>
      <Muted>Just a label. The app never connects to these.</Muted>
    </View>
  );
}

export function MoreToggle({ open, onToggle, label }: { open: boolean; onToggle: () => void; label: string }) {
  return <Button label={open ? `Hide ${label}` : `More: ${label}`} kind="quiet" onPress={onToggle} />;
}
