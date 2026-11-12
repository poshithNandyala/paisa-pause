import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { epochFromLocal, formatDateMedium } from '../domain/dates';
import { defaultRefundSplit, makeEntry } from '../domain/entries';
import { expenseStatus, personalShareOf } from '../domain/ledger';
import { divRound, formatPaise, parseRupeesToPaise } from '../domain/money';
import { UNCATEGORIZED_ID } from '../domain/types';
import { useReady } from '../state/store';
import { DateField } from '../ui/DatePicker';
import { Banner, Body, Button, Card, Chip, ErrorText, Field, Label, Muted, RowWrap, Screen } from '../ui/kit';
import { CategoryPicker } from '../ui/pickers';
import { useSnackbar } from '../ui/Snackbar';
import { SPACE } from '../ui/theme';
import { nowMs } from '../ui/clock';

function toText(paise: number): string {
  const r = Math.floor(paise / 100);
  const p = paise % 100;
  return p ? `${r}.${String(p).padStart(2, '0')}` : String(r);
}

/**
 * A refund reduces net spending once, on the date it arrives, and adds money
 * back to the account it went to (or reduces what you owe on a card).
 */
export default function Refund() {
  const params = useLocalSearchParams<{ of?: string; id?: string }>();
  const { snapshot, derived, actions } = useReady();
  const snack = useSnackbar();
  const editing = params.id ? snapshot.transactions.find((t) => t.id === params.id) : undefined;
  const original = snapshot.transactions.find((t) => t.id === (editing?.refundOfId ?? params.of));
  const others = snapshot.transactions.filter((t) => t.id !== editing?.id);
  const st = original ? expenseStatus(original, others) : null;

  const [refundId] = useState(() => editing?.id ?? actions.newId());
  const [amountText, setAmountText] = useState(editing ? toText(editing.amount) : st ? toText(st.refundableLeft) : '');
  const [toAccountId, setToAccountId] = useState<string | null>(editing?.toAccountId ?? original?.fromAccountId ?? null);
  const [date, setDate] = useState(editing?.localDate ?? derived.today);
  const [categoryId, setCategoryId] = useState(editing?.allocations[0]?.categoryId ?? original?.allocations[0]?.categoryId ?? UNCATEGORIZED_ID);
  const [personalText, setPersonalText] = useState(editing?.refundPersonalPart != null ? toText(editing.refundPersonalPart) : '');
  const [note, setNote] = useState(editing?.purpose ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const amount = parseRupeesToPaise(amountText);
  const isShared = original ? personalShareOf(original) !== original.amount : false;
  const defaultPersonal = original && amount ? defaultRefundSplit(original, amount).personalPart : null;

  async function save() {
    setError(null);
    if (!amount || amount <= 0) return setError('Enter the refund amount.');
    let personalPart: number | null = null;
    let allocations;
    if (original) {
      const split = defaultRefundSplit(original, amount);
      allocations = split.allocations;
      personalPart = split.personalPart;
      if (isShared && personalText.trim()) {
        const p = parseRupeesToPaise(personalText);
        if (p === null || p > amount) return setError('Your part must be between ₹0 and the refund.');
        personalPart = p;
      }
    }
    const entry = makeEntry({
      id: refundId,
      kind: 'refund',
      amount,
      occurredAt: date === derived.today ? nowMs() : epochFromLocal(date, 12, 0, snapshot.settings.timezone),
      localDate: date,
      now: nowMs(),
      toAccountId,
      refundOfId: original?.id ?? null,
      refundPersonalPart: personalPart,
      allocations: original ? allocations : [{ categoryId, amount }],
      purpose: note || (original ? `Refund: ${original.purpose ?? derived.categoryName(original.allocations[0]?.categoryId)}` : 'Refund'),
    });
    setBusy(true);
    try {
      if (editing) await actions.editEntry({ ...entry, createdAt: editing.createdAt });
      else await actions.addEntry(entry);
      router.back();
      snack({
        message: `Refund of ${formatPaise(amount)} saved`,
        actionLabel: editing ? undefined : 'Undo',
        onAction: editing ? undefined : async () => void (await actions.removeEntry(refundId)),
      });
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Screen footer={<View style={{ gap: SPACE.sm }}><ErrorText>{error}</ErrorText><Button label="Save refund" onPress={save} busy={busy} disabled={!amount} /></View>}>
      {original && st ? (
        <Card tone="soft">
          <Body style={{ fontWeight: '700' }}>
            For: {original.purpose ?? derived.categoryName(original.allocations[0]?.categoryId)} · {formatDateMedium(original.localDate)}
          </Body>
          <Muted>
            Paid {formatPaise(original.amount)} · already refunded {formatPaise(st.refunded)} · up to {formatPaise(st.refundableLeft)} left
          </Muted>
        </Card>
      ) : (
        <Banner
          title="A refund for something not recorded here"
          body="It will reduce spending in the category you pick, on the date it arrived. It isn't added to your plan unless you choose to on the Plan tab."
        />
      )}
      <Field label="Refund amount (₹)" value={amountText} onChangeText={setAmountText} keyboardType="decimal-pad" />
      {isShared && amount ? (
        <Field
          label="Part of the refund that was your share (₹)"
          value={personalText}
          onChangeText={setPersonalText}
          keyboardType="decimal-pad"
          placeholder={defaultPersonal !== null ? toText(defaultPersonal) : undefined}
          help={`Leave empty to split it the same way as the bill (${defaultPersonal !== null ? formatPaise(defaultPersonal) : '—'} yours). The rest reduces what others owe you.`}
        />
      ) : null}
      {!original ? <CategoryPicker value={categoryId} onChange={setCategoryId} /> : null}
      <View style={{ gap: SPACE.xs }}>
        <Label>Money went back to</Label>
        <RowWrap>
          <Chip label="Not set" selected={!toAccountId} onPress={() => setToAccountId(null)} />
          {snapshot.accounts
            .filter((a) => !a.archived)
            .map((a) => (
              <Chip key={a.id} label={a.nickname} selected={toAccountId === a.id} onPress={() => setToAccountId(a.id)} />
            ))}
        </RowWrap>
        {toAccountId && derived.accountsById.get(toAccountId)?.kind === 'credit_card' ? (
          <Muted>This lowers what you owe on the card. If it goes below zero it's card credit, not cash.</Muted>
        ) : null}
      </View>
      <View style={{ gap: SPACE.xs }}>
        <Label>Date the refund arrived</Label>
        <DateField value={date} today={derived.today} onChange={setDate} />
        <Muted>Refunds count on the day they arrive. Earlier periods aren't rewritten.</Muted>
      </View>
      <Field label="Note (optional)" value={note} onChangeText={setNote} maxLength={80} />
      {amount && original && st && amount > st.refundableLeft ? (
        <Muted>That's more than can still be refunded ({formatPaise(st.refundableLeft)}).</Muted>
      ) : null}
      {amount && original && !isShared ? <Muted>Your net spending on it becomes {formatPaise(original.amount - (st?.refunded ?? 0) - amount)}.</Muted> : null}
      {isShared && amount && original ? (
        <Muted>
          Split like the bill: about {formatPaise(divRound(amount * personalShareOf(original), original.amount))} of it was yours.
        </Muted>
      ) : null}
    </Screen>
  );
}
