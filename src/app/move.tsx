import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { epochFromLocal } from '../domain/dates';
import { makeEntry } from '../domain/entries';
import { accountBalance, cardOwed, expenseStatus, receivables } from '../domain/ledger';
import { formatPaise, parseRupeesToPaise } from '../domain/money';
import type { Transaction, TxnKind } from '../domain/types';
import { useReady } from '../state/store';
import { DateField } from '../ui/DatePicker';
import { Banner, Button, Chip, EmptyState, ErrorText, Field, Label, Muted, RowWrap, Screen, Segmented } from '../ui/kit';
import { useSnackbar } from '../ui/Snackbar';
import { SPACE } from '../ui/theme';

type MoveKind = 'repayment' | 'transfer' | 'income' | 'reimbursement';

function toText(paise: number): string {
  const r = Math.floor(paise / 100);
  const p = paise % 100;
  return p ? `${r}.${String(p).padStart(2, '0')}` : String(r);
}

const EXPLAIN: Record<MoveKind, string> = {
  repayment: 'Paying your card bill moves money from a bank or cash to the card. It is not extra spending — the purchases were already counted.',
  transfer: 'Money moving between your own accounts: wallet top-up, ATM cash, or into savings. Not spending.',
  income: 'Money you actually received. Expected salary is never counted until it arrives.',
  reimbursement: 'Someone paying you back their share of a shared purchase. Not income, and it does not change your spending.',
};

export default function MoveMoney() {
  const params = useLocalSearchParams<{ kind?: MoveKind; of?: string; to?: string; id?: string }>();
  const { snapshot, derived, actions } = useReady();
  const snack = useSnackbar();
  const editing = params.id ? snapshot.transactions.find((t) => t.id === params.id) : undefined;
  const editingKind: MoveKind | undefined = editing
    ? editing.kind === 'transfer'
      ? derived.accountsById.get(editing.toAccountId ?? '')?.kind === 'credit_card'
        ? 'repayment'
        : 'transfer'
      : (editing.kind as MoveKind)
    : undefined;
  const [kind, setKind] = useState<MoveKind>(editingKind ?? params.kind ?? 'repayment');
  const [entryId] = useState(() => editing?.id ?? actions.newId());
  const accounts = snapshot.accounts.filter((a) => !a.archived);
  const assets = accounts.filter((a) => a.kind !== 'credit_card');
  const cards = accounts.filter((a) => a.kind === 'credit_card');

  const [fromId, setFromId] = useState<string | null>(editing?.fromAccountId ?? assets[0]?.id ?? null);
  const [toId, setToId] = useState<string | null>(editing?.toAccountId ?? params.to ?? (kind === 'repayment' ? cards[0]?.id : assets[0]?.id) ?? null);
  const [ofId, setOfId] = useState<string | null>(editing?.reimbursementOfId ?? params.of ?? null);
  const [amountText, setAmountText] = useState(editing ? toText(editing.amount) : '');
  const [date, setDate] = useState(editing?.localDate ?? derived.today);
  const [note, setNote] = useState(editing?.purpose ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const amount = parseRupeesToPaise(amountText);

  const owedList = receivables(snapshot);
  const selectedCard = kind === 'repayment' && toId ? accounts.find((a) => a.id === toId) : undefined;
  const owedOnCard = selectedCard ? cardOwed(accountBalance(selectedCard, snapshot.transactions)) : 0;
  const ofExpense = ofId ? snapshot.transactions.find((t) => t.id === ofId) : undefined;
  const stillOwed = ofExpense ? expenseStatus(ofExpense, snapshot.transactions.filter((t) => t.id !== editing?.id)).receivableOutstanding : 0;

  async function save() {
    setError(null);
    if (!amount) return setError('Enter an amount above ₹0.');
    const txnKind: TxnKind = kind === 'repayment' ? 'transfer' : kind;
    const entry: Transaction = makeEntry({
      id: entryId,
      kind: txnKind,
      amount,
      occurredAt: date === derived.today ? Date.now() : epochFromLocal(date, 12, 0, snapshot.settings.timezone),
      localDate: date,
      now: Date.now(),
      fromAccountId: kind === 'transfer' || kind === 'repayment' ? fromId : null,
      toAccountId: toId,
      reimbursementOfId: kind === 'reimbursement' ? ofId : null,
      purpose: note || (kind === 'repayment' ? 'Card repayment' : kind === 'reimbursement' ? 'Paid back' : null),
      rail: null,
    });
    setBusy(true);
    try {
      if (editing) await actions.editEntry({ ...entry, createdAt: editing.createdAt });
      else await actions.addEntry(entry);
      router.back();
      snack({
        message: `${kind === 'repayment' ? 'Card repayment' : kind === 'income' ? 'Income' : kind === 'reimbursement' ? 'Repayment' : 'Transfer'} of ${formatPaise(amount)} saved`,
        actionLabel: editing ? undefined : 'Undo',
        onAction: editing ? undefined : async () => void (await actions.removeEntry(entryId)),
      });
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const pick = (label: string, value: string | null, set: (v: string) => void, list = accounts) => (
    <View style={{ gap: SPACE.xs }} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <Label>{label}</Label>
      <RowWrap>
        {list.map((a) => (
          <Chip key={a.id} label={a.nickname} selected={value === a.id} onPress={() => set(a.id)} />
        ))}
      </RowWrap>
    </View>
  );

  if (accounts.length === 0 && kind !== 'reimbursement') {
    return (
      <Screen>
        <EmptyState
          title="Add an account first"
          body="Transfers, card repayments and income move money between accounts. Budget-only tracking doesn't need any of this."
          actionLabel="Add an account"
          onAction={() => router.push('/account')}
        />
      </Screen>
    );
  }

  return (
    <Screen footer={<View style={{ gap: SPACE.sm }}><ErrorText>{error}</ErrorText><Button label="Save" onPress={save} busy={busy} disabled={!amount} /></View>}>
      {!editing ? (
        <Segmented
          label="What kind of move?"
          value={kind}
          onChange={(k) => {
            setKind(k);
            if (k === 'repayment') setToId(cards[0]?.id ?? null);
            if (k === 'transfer' || k === 'income' || k === 'reimbursement') setToId(assets[0]?.id ?? null);
          }}
          options={[
            { value: 'repayment', label: 'Card repayment' },
            { value: 'transfer', label: 'Between my accounts' },
            { value: 'income', label: 'Income received' },
            { value: 'reimbursement', label: 'Someone paid me back' },
          ]}
        />
      ) : null}
      <Muted>{EXPLAIN[kind]}</Muted>

      {kind === 'reimbursement' ? (
        owedList.length === 0 && !ofExpense ? (
          <Banner title="Nobody owes you anything right now" body="Mark a purchase as split with others (Add expense → More) to track who owes you." />
        ) : (
          <View style={{ gap: SPACE.xs }}>
            <Label>For which shared purchase?</Label>
            <RowWrap>
              {(ofExpense && !owedList.some((r) => r.expenseId === ofExpense.id)
                ? [{ expenseId: ofExpense.id, label: ofExpense.purpose ?? 'Shared purchase', outstanding: stillOwed }]
                : owedList
              ).map((r) => (
                <Chip key={r.expenseId} label={`${r.label} · ${formatPaise(r.outstanding)} owed`} selected={ofId === r.expenseId} onPress={() => {
                  setOfId(r.expenseId);
                  if (!amountText) setAmountText(toText(r.outstanding));
                }} />
              ))}
            </RowWrap>
          </View>
        )
      ) : null}

      <Field label="Amount (₹)" value={amountText} onChangeText={setAmountText} keyboardType="decimal-pad" />
      {kind === 'repayment' && selectedCard ? (
        <Muted>
          Recorded amount owed on {selectedCard.nickname}: {formatPaise(owedOnCard)}.
          {owedOnCard > 0 ? '' : ' Paying more than you owe creates card credit, which is not cash.'}
        </Muted>
      ) : null}
      {kind === 'reimbursement' && ofExpense ? <Muted>Still owed for this purchase: {formatPaise(stillOwed)}.</Muted> : null}

      {kind === 'repayment' ? (
        <>
          {pick('Paid from', fromId, setFromId, assets)}
          {cards.length ? pick('Card', toId, setToId, cards) : <Banner title="No credit cards yet" actionLabel="Add a card" onAction={() => router.push({ pathname: '/account', params: { kind: 'credit_card' } })} />}
        </>
      ) : null}
      {kind === 'transfer' ? (
        <>
          {pick('From', fromId, setFromId)}
          {pick('To', toId, setToId)}
        </>
      ) : null}
      {kind === 'income' || kind === 'reimbursement' ? pick('Money arrived in', toId, setToId, assets) : null}

      <View style={{ gap: SPACE.xs }}>
        <Label>Date</Label>
        <DateField value={date} today={derived.today} onChange={setDate} />
      </View>
      <Field label="Note (optional)" value={note} onChangeText={setNote} maxLength={80} />
    </Screen>
  );
}
