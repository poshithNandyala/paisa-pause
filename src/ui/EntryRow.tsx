import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { formatPaise } from '../domain/money';
import type { Transaction } from '../domain/types';
import type { Derived } from '../state/derive';
import { useMoneyText, Pill } from './kit';
import { SPACE, usePalette } from './theme';

const KIND_LABEL: Record<Transaction['kind'], string> = {
  expense: 'Purchase',
  refund: 'Refund',
  transfer: 'Transfer',
  income: 'Income',
  reimbursement: 'Paid back to you',
  adjustment: 'Balance check',
};

export function stateLabel(t: Transaction): { text: string; tone: 'warn' | 'neutral' } | null {
  switch (t.state) {
    case 'pending':
      return { text: 'Pending', tone: 'warn' };
    case 'awaiting_reversal':
      return { text: 'Waiting for money back', tone: 'warn' };
    case 'reversed':
      return { text: 'Reversed', tone: 'neutral' };
    case 'failed':
      return { text: 'Failed, no debit', tone: 'neutral' };
    default:
      return null;
  }
}

export function entryTitle(t: Transaction, derived: Derived): string {
  if (t.purpose) return t.purpose;
  if (t.kind === 'expense' || t.kind === 'refund') {
    const names = t.allocations.map((a) => derived.categoryName(a.categoryId));
    return t.kind === 'refund' ? `Refund · ${names.join(', ')}` : names.join(', ');
  }
  if (t.kind === 'transfer') {
    const to = t.toAccountId ? derived.accountsById.get(t.toAccountId) : undefined;
    return to?.kind === 'credit_card' ? `Card repayment` : 'Transfer';
  }
  return KIND_LABEL[t.kind];
}

export function sourceText(t: Transaction, derived: Derived): string {
  const from = t.fromAccountId ? derived.accountsById.get(t.fromAccountId)?.nickname : null;
  const to = t.toAccountId ? derived.accountsById.get(t.toAccountId)?.nickname : null;
  const card = t.cardId ? derived.cardsById.get(t.cardId) : null;
  if (t.kind === 'transfer') return `${from ?? '?'} → ${to ?? '?'}`;
  if (t.kind === 'expense') {
    if (card?.type === 'debit') return `${card.nickname} (debit) · ${from ?? ''}`;
    return from ?? 'Source not set';
  }
  return to ?? from ?? '';
}

export function EntryRow({ t, derived, onPress }: { t: Transaction; derived: Derived; onPress: () => void }) {
  const c = usePalette();
  const money = useMoneyText();
  const st = stateLabel(t);
  const muted = t.state === 'failed' || t.state === 'reversed';
  const shared = t.kind === 'expense' && t.personalShare !== null;
  let amountText = money(t.amount);
  if (t.kind === 'refund' || t.kind === 'income' || t.kind === 'reimbursement') amountText = `+${amountText}`;
  if (t.kind === 'transfer') amountText = `↔ ${amountText}`;
  if (t.kind === 'adjustment') amountText = `${t.toAccountId ? '+' : '−'}${amountText}`;
  const category = t.kind === 'expense' || t.kind === 'refund' ? t.allocations.map((a) => derived.categoryName(a.categoryId)).join(', ') : KIND_LABEL[t.kind];
  const label = `${entryTitle(t, derived)}, ${KIND_LABEL[t.kind]}, ${formatPaise(t.amount)}${shared ? `, your share ${formatPaise(t.personalShare ?? 0)}` : ''}${st ? `, ${st.text}` : ''}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Opens details to edit, refund or delete"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACE.md,
        paddingVertical: SPACE.md,
        paddingHorizontal: SPACE.lg,
        backgroundColor: pressed ? c.cardAlt : c.card,
        minHeight: 60,
      })}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1} style={{ color: c.text, fontSize: 16, fontWeight: '600', opacity: muted ? 0.6 : 1 }}>
          {entryTitle(t, derived)}
        </Text>
        <Text numberOfLines={1} style={{ color: c.muted, fontSize: 13 }}>
          {t.purpose && category ? `${category} · ` : ''}
          {sourceText(t, derived)}
        </Text>
        {st ? <Pill text={st.text} tone={st.tone} /> : null}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text
          style={{
            color: t.kind === 'refund' || t.kind === 'income' || t.kind === 'reimbursement' ? c.green : c.text,
            fontSize: 16,
            fontWeight: '700',
            fontVariant: ['tabular-nums'],
            textDecorationLine: muted ? 'line-through' : 'none',
          }}
        >
          {amountText}
        </Text>
        {shared ? <Text style={{ color: c.muted, fontSize: 12 }}>yours {money(t.personalShare ?? 0)}</Text> : null}
      </View>
    </Pressable>
  );
}
