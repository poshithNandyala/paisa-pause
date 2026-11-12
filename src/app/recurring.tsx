import { router } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { formatDateShort } from '../domain/dates';
import { formatPaise, parseRupeesToPaise } from '../domain/money';
import { cadenceLabel, monthlyPlanningEquivalent } from '../domain/recurring';
import type { Cadence, Obligation } from '../domain/types';
import { useReady } from '../state/store';
import { DateField } from '../ui/DatePicker';
import { Body, Button, Card, Chip, EmptyState, ErrorText, Field, H2, KeyValue, Label, Money, Muted, Pill, RowWrap, Screen, Segmented, ToggleRow } from '../ui/kit';
import { CategoryPicker } from '../ui/pickers';
import { useSnackbar } from '../ui/Snackbar';
import { SPACE } from '../ui/theme';

export default function Recurring() {
  const { snapshot, derived, actions } = useReady();
  const snack = useSnackbar();
  const [editing, setEditing] = useState<Obligation | null>(null);

  const blank = (): Obligation => ({
    id: actions.newId(),
    name: '',
    amount: 0,
    categoryId: 'apps_subscriptions',
    cadence: 'monthly',
    anchorDate: derived.today,
    fundingAccountId: null,
    protect: true,
    active: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deletedAt: null,
  });

  if (editing) return <ObligationForm initial={editing} onDone={() => setEditing(null)} />;

  return (
    <Screen>
      <Muted>
        Bills and subscriptions you expect. These are reminders and forecasts only — nothing counts as spending until you record the
        real charge.
      </Muted>

      <Card>
        <H2>Due in the next 30 days</H2>
        {derived.upcoming.length === 0 ? <Muted>Nothing due.</Muted> : null}
        {derived.upcoming.map((o) => (
          <View key={`${o.obligation.id}@${o.date}`} style={{ gap: SPACE.xs }}>
            <KeyValue label={`${o.obligation.name} · ${formatDateShort(o.date)}`} value={<Money value={o.obligation.amount} />} />
            {o.state === 'overdue' ? <Pill text="Was due — not recorded" tone="warn" /> : null}
            {o.state === 'pending_payment' ? <Pill text="Recorded as pending" tone="warn" /> : null}
            {o.state !== 'pending_payment' ? (
              <RowWrap>
                <Button
                  label="It was charged"
                  compact
                  onPress={() => router.push({ pathname: '/add', params: { obligationId: o.obligation.id, occurrenceDate: o.date } })}
                />
                <Button
                  label="Not this time"
                  kind="quiet"
                  compact
                  onPress={async () => {
                    await actions.skipOccurrence(o.obligation.id, o.date);
                    snack({ message: `Skipped ${formatDateShort(o.date)}. Nothing recorded.` });
                  }}
                />
              </RowWrap>
            ) : null}
          </View>
        ))}
      </Card>

      {snapshot.obligations.length === 0 ? (
        <EmptyState title="No commitments yet" body="Add rent, phone bills or subscriptions to see them coming." />
      ) : null}
      {snapshot.obligations.map((o) => (
        <Card key={o.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: SPACE.md }}>
            <Body style={{ fontWeight: '700', flex: 1 }}>{o.name}</Body>
            <Money value={o.amount} style={{ fontWeight: '700' }} />
          </View>
          <Muted>
            {cadenceLabel(o.cadence)} from {formatDateShort(o.anchorDate)} · {derived.categoryName(o.categoryId)}
          </Muted>
          {o.cadence !== 'monthly' ? (
            <Muted>
              Planning equivalent ≈ {formatPaise(monthlyPlanningEquivalent(o))}/month (for planning only — the real charge is{' '}
              {formatPaise(o.amount)} {o.cadence === 'yearly' ? 'once a year' : 'each week'}).
            </Muted>
          ) : null}
          <RowWrap>
            {!o.active ? <Pill text="Paused" /> : null}
            {o.protect ? <Pill text="Protected until paid" tone="good" /> : null}
          </RowWrap>
          <RowWrap>
            <Button label="Edit" kind="secondary" compact onPress={() => setEditing(o)} />
            <Button label={o.active ? 'Pause' : 'Resume'} kind="quiet" compact onPress={() => actions.saveObligation({ ...o, active: !o.active })} />
            <Button
              label="Delete"
              kind="quiet"
              compact
              onPress={async () => {
                await actions.saveObligation({ ...o, deletedAt: Date.now() });
                snack({ message: 'Deleted. Past charges you recorded stay.', actionLabel: 'Undo', onAction: () => actions.saveObligation(o) });
              }}
            />
          </RowWrap>
        </Card>
      ))}
      <Button label="Add a commitment" onPress={() => setEditing(blank())} />
      <Muted>Cancelling a subscription happens in that service, not here.</Muted>
    </Screen>
  );
}

function ObligationForm({ initial, onDone }: { initial: Obligation; onDone: () => void }) {
  const { snapshot, derived, actions } = useReady();
  const [name, setName] = useState(initial.name);
  const [amountText, setAmountText] = useState(initial.amount ? String(initial.amount / 100) : '');
  const [categoryId, setCategoryId] = useState(initial.categoryId);
  const [cadence, setCadence] = useState<Cadence>(initial.cadence);
  const [anchorDate, setAnchorDate] = useState(initial.anchorDate);
  const [account, setAccount] = useState<string | null>(initial.fundingAccountId);
  const [protect, setProtect] = useState(initial.protect);
  const [error, setError] = useState<string | null>(null);
  const amount = parseRupeesToPaise(amountText);
  return (
    <Screen
      footer={
        <View style={{ gap: SPACE.sm }}>
          <ErrorText>{error}</ErrorText>
          <Button
            label="Save commitment"
            onPress={async () => {
              if (!name.trim()) return setError('Give it a name.');
              if (!amount) return setError('Enter the amount charged each time.');
              await actions.saveObligation({ ...initial, name: name.trim(), amount, categoryId, cadence, anchorDate, fundingAccountId: account, protect });
              onDone();
            }}
          />
          <Button label="Cancel" kind="quiet" onPress={onDone} />
        </View>
      }
    >
      <Field label="Name" value={name} onChangeText={setName} maxLength={40} placeholder="e.g. Phone bill, Rent, Music app" />
      <Field label="Amount each time (₹)" value={amountText} onChangeText={setAmountText} keyboardType="decimal-pad" />
      <Segmented
        label="How often"
        value={cadence}
        onChange={setCadence}
        options={[
          { value: 'weekly', label: 'Weekly' },
          { value: 'monthly', label: 'Monthly' },
          { value: 'yearly', label: 'Yearly' },
        ]}
      />
      {amount && cadence === 'yearly' ? (
        <Muted>One {formatPaise(amount)} charge a year. Planning equivalent ≈ {formatPaise(monthlyPlanningEquivalent({ amount, cadence }))}/month — never recorded as 12 charges.</Muted>
      ) : null}
      <View style={{ gap: SPACE.xs }}>
        <Label>Next due date</Label>
        <DateField value={anchorDate} today={derived.today} onChange={setAnchorDate} allowFuture />
      </View>
      <CategoryPicker value={categoryId} onChange={setCategoryId} />
      <View style={{ gap: SPACE.xs }}>
        <Label>Usually paid from (optional)</Label>
        <RowWrap>
          <Chip label="Not set" selected={!account} onPress={() => setAccount(null)} />
          {snapshot.accounts
            .filter((a) => !a.archived)
            .map((a) => (
              <Chip key={a.id} label={a.nickname} selected={account === a.id} onPress={() => setAccount(a.id)} />
            ))}
        </RowWrap>
      </View>
      <ToggleRow
        label="Protect this money until it's paid"
        description="Used by the account-aware estimate. Recorded charges are kept out of your flexible plan."
        value={protect}
        onChange={setProtect}
      />
    </Screen>
  );
}
