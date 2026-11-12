import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { formatDateMedium, formatTime } from '../../domain/dates';
import { expenseStatus } from '../../domain/ledger';
import { formatPaise } from '../../domain/money';
import type { AccountingState } from '../../domain/types';
import { asTransfer } from '../../data/operations';
import { useReady } from '../../state/store';
import { entryTitle, stateLabel } from '../../ui/EntryRow';
import { Banner, Body, Button, Card, Chip, Divider, EmptyState, ErrorText, H2, KeyValue, Label, Money, Muted, Pill, RowWrap, Screen, Title } from '../../ui/kit';
import { useSnackbar } from '../../ui/Snackbar';
import { SPACE } from '../../ui/theme';
import { nowMs } from '../../ui/clock';

const TAG_TEXT: Record<string, string> = {
  necessary: 'Necessary',
  optional: 'Optional',
  mixed: 'Mixed',
  planned: 'Planned',
  unplanned: 'Unplanned',
  recurring: 'Recurring',
  one_time: 'One-time',
  worth_it: 'Worth it',
  would_skip: 'Would skip',
  unsure: 'Unsure',
};

export default function EntryDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { snapshot, derived, actions } = useReady();
  const snack = useSnackbar();
  const [error, setError] = useState<string | null>(null);
  const [transferPick, setTransferPick] = useState(false);
  const t = snapshot.transactions.find((x) => x.id === id);

  if (!t) {
    return (
      <Screen>
        <EmptyState title="Entry not found" body="It may have been deleted." actionLabel="Back" onAction={() => router.back()} />
      </Screen>
    );
  }

  const st = t.kind === 'expense' ? expenseStatus(t, snapshot.transactions) : null;
  const original = t.refundOfId ? snapshot.transactions.find((x) => x.id === t.refundOfId) : t.reimbursementOfId ? snapshot.transactions.find((x) => x.id === t.reimbursementOfId) : undefined;
  const label = stateLabel(t);
  const tz = snapshot.settings.timezone;
  const tags = Object.values(t.tags).filter((v) => TAG_TEXT[v]);

  async function setState(state: AccountingState) {
    setError(null);
    try {
      await actions.editEntry({ ...t!, state });
      snack({ message: 'Status updated' });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function remove() {
    const batch = await actions.removeEntry(t!.id);
    router.back();
    snack({
      message: st && st.refundIds.length + st.reimbursementIds.length > 0 ? 'Deleted with its refunds/repayments' : 'Deleted',
      actionLabel: 'Undo',
      onAction: () => actions.undoRemove(batch),
    });
  }

  async function convert(toAccountId: string) {
    setError(null);
    try {
      await actions.editEntry(asTransfer(t!, toAccountId, nowMs()));
      setTransferPick(false);
      snack({ message: 'Changed to a transfer. It no longer counts as spending.' });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const editPath = t.kind === 'expense' ? { pathname: '/add' as const, params: { id: t.id } } : t.kind === 'refund' ? { pathname: '/refund' as const, params: { id: t.id } } : { pathname: '/move' as const, params: { id: t.id } };

  return (
    <Screen>
      <Title>{entryTitle(t, derived)}</Title>
      <Money value={t.amount} style={{ fontSize: 32, fontWeight: '800' }} />
      {label ? <Pill text={label.text} tone={label.tone} /> : null}
      <ErrorText>{error}</ErrorText>

      <Card>
        <KeyValue label="Type" value={t.kind === 'expense' ? 'Purchase' : t.kind === 'reimbursement' ? 'Paid back to you' : t.kind[0].toUpperCase() + t.kind.slice(1)} />
        <KeyValue label="Date" value={`${formatDateMedium(t.localDate)}, ${formatTime(t.occurredAt, tz)}`} />
        {t.fromAccountId ? <KeyValue label="From" value={derived.accountsById.get(t.fromAccountId)?.nickname ?? 'Unknown'} /> : null}
        {t.toAccountId ? <KeyValue label="To" value={derived.accountsById.get(t.toAccountId)?.nickname ?? 'Unknown'} /> : null}
        {t.kind === 'expense' && !t.fromAccountId ? <KeyValue label="From" value="Not set" /> : null}
        {t.cardId ? <KeyValue label="Card" value={derived.cardsById.get(t.cardId)?.nickname ?? 'Unknown'} /> : null}
        {t.rail ? <KeyValue label="Method" value={t.rail === 'upi' ? 'UPI' : t.rail === 'netbanking' ? 'Net banking' : t.rail[0].toUpperCase() + t.rail.slice(1)} /> : null}
        {t.paymentApp ? <KeyValue label="App" value={t.paymentApp} /> : null}
        {t.payee ? <KeyValue label="Paid to" value={t.payee} /> : null}
        {t.kind === 'expense' ? <KeyValue label="Flexible plan" value={t.budgetBucket === 'flexible' ? 'Counts' : 'Protected cost — not counted'} /> : null}
        <KeyValue label="Recorded" value="By you, not bank-verified" />
      </Card>

      {t.allocations.length ? (
        <Card>
          <Label>CATEGORIES</Label>
          {t.allocations.map((a) => (
            <KeyValue key={a.categoryId} label={derived.categoryName(a.categoryId)} value={<Money value={a.amount} />} />
          ))}
        </Card>
      ) : null}

      {st && st.others > 0 ? (
        <Card>
          <Label>SHARED</Label>
          <KeyValue label="You paid" value={<Money value={st.gross} />} />
          <KeyValue label="Your share (your spending)" value={<Money value={st.personal} />} strong />
          <KeyValue label="Others' share" value={<Money value={st.others} />} />
          <KeyValue label="Paid back so far" value={<Money value={st.reimbursed} />} />
          <KeyValue label="Still owed to you" value={<Money value={st.receivableOutstanding} />} strong />
          {st.receivableOutstanding > 0 ? (
            <Button
              label="Someone paid me back"
              kind="secondary"
              onPress={() => router.push({ pathname: '/move', params: { kind: 'reimbursement', of: t.id } })}
            />
          ) : null}
        </Card>
      ) : null}

      {st && st.refunded > 0 ? (
        <Card>
          <Label>REFUNDS</Label>
          <KeyValue label="Refunded" value={<Money value={st.refunded} />} />
          <KeyValue label="Can still be refunded" value={<Money value={st.refundableLeft} />} />
          {st.refundIds.map((rid) => {
            const r = snapshot.transactions.find((x) => x.id === rid);
            return r ? (
              <Button
                key={rid}
                label={`Refund on ${formatDateMedium(r.localDate)}: ${formatPaise(r.amount)}`}
                kind="quiet"
                compact
                onPress={() => router.push(`/entry/${rid}`)}
              />
            ) : null;
          })}
        </Card>
      ) : null}

      {original ? (
        <Card>
          <Body>
            {t.kind === 'refund' ? 'Refund for' : 'Pays back'}: {entryTitle(original, derived)} ({formatDateMedium(original.localDate)})
          </Body>
          <Button label="Open original purchase" kind="quiet" compact onPress={() => router.push(`/entry/${original.id}`)} />
        </Card>
      ) : null}

      {tags.length ? (
        <Card>
          <Label>YOUR LABELS</Label>
          <RowWrap>
            {tags.map((v) => (
              <Pill key={v} text={TAG_TEXT[v]} />
            ))}
          </RowWrap>
        </Card>
      ) : null}

      {t.note ? (
        <Card>
          <Label>NOTES</Label>
          <Body>{t.note}</Body>
        </Card>
      ) : null}

      {t.state === 'pending' ? (
        <Card tone="soft">
          <H2>What happened?</H2>
          <Muted>Pending entries are kept out of your spending until you choose.</Muted>
          <Button label="It went through" onPress={() => setState('completed')} />
          <Button label="It failed — no money was taken" kind="secondary" onPress={() => setState('failed')} />
          <Button label="It failed but money was taken" kind="secondary" onPress={() => setState('awaiting_reversal')} />
        </Card>
      ) : null}
      {t.state === 'awaiting_reversal' ? (
        <Card tone="soft">
          <H2>Waiting for the money to come back</H2>
          <Muted>This isn't counted as spending. Check your bank app before paying again.</Muted>
          <Button label="The money came back" onPress={() => setState('reversed')} />
          <Button label="It actually went through" kind="secondary" onPress={() => setState('completed')} />
        </Card>
      ) : null}

      <Card>
        <H2>Actions</H2>
        <View style={{ gap: SPACE.sm }}>
          <Button label="Edit" kind="secondary" onPress={() => router.push(editPath)} />
          {t.kind === 'expense' && t.state === 'completed' && st && st.refundableLeft > 0 ? (
            <Button label="Record a refund" kind="secondary" onPress={() => router.push({ pathname: '/refund', params: { of: t.id } })} />
          ) : null}
          {t.kind === 'expense' && st && st.others === 0 ? (
            <Button label="Split / set my share" kind="secondary" onPress={() => router.push({ pathname: '/add', params: { id: t.id } })} />
          ) : null}
          {t.kind === 'expense' && t.fromAccountId && st && st.refundIds.length === 0 && st.reimbursementIds.length === 0 ? (
            <Button label="This was a transfer, not a purchase" kind="secondary" onPress={() => setTransferPick(!transferPick)} />
          ) : null}
          {transferPick ? (
            <View style={{ gap: SPACE.xs }}>
              <Muted>Where did the money go? (e.g. wallet top-up, ATM cash, savings)</Muted>
              <RowWrap>
                {snapshot.accounts
                  .filter((a) => a.id !== t.fromAccountId && !a.archived)
                  .map((a) => (
                    <Chip key={a.id} label={a.nickname} role="button" onPress={() => convert(a.id)} />
                  ))}
              </RowWrap>
              {snapshot.accounts.length < 2 ? <Muted>Add the other account first in Accounts & cards.</Muted> : null}
            </View>
          ) : null}
          {t.kind === 'expense' ? (
            <Button
              label="Add a similar one"
              kind="quiet"
              onPress={() =>
                router.push({
                  pathname: '/add',
                  params: { amount: String(t.amount), categoryId: t.allocations[0]?.categoryId, purpose: t.purpose ?? '' },
                })
              }
            />
          ) : null}
          <Divider />
          <Button label="Delete" kind="danger" onPress={remove} hint="You can undo for a few seconds, or restore it later from Recently deleted" />
        </View>
      </Card>
      {t.kind === 'expense' && st && st.refundIds.length > 0 ? (
        <Banner title="Deleting this also deletes its refunds" body="They only make sense together. Undo restores all of them." />
      ) : null}
    </Screen>
  );
}

