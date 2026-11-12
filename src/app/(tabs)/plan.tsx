import { router } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { formatDateShort, formatRange, formatTime, localDateOf } from '../../domain/dates';
import { formatPaise, parseRupeesToPaise } from '../../domain/money';
import { monthlyPlanningEquivalent } from '../../domain/recurring';
import type { Envelope, Goal, Reservation } from '../../domain/types';
import { useReady } from '../../state/store';
import {
  Banner,
  Bar,
  Body,
  Button,
  Card,
  Divider,
  EmptyState,
  ErrorText,
  Field,
  H2,
  KeyValue,
  LinkRow,
  Money,
  Muted,
  RowWrap,
  Screen,
  Segmented,
} from '../../ui/kit';
import { CategoryPicker } from '../../ui/pickers';
import { useSnackbar } from '../../ui/Snackbar';
import { SPACE } from '../../ui/theme';

const CYCLE_LABEL = { weekly: 'Weekly', monthly: 'Monthly', payday: 'Payday to payday' };

export default function Plan() {
  const { snapshot, derived } = useReady();
  const b = derived.budget;
  const s = snapshot.settings;
  return (
    <Screen>
      {b ? (
        <Card>
          <H2>
            {CYCLE_LABEL[s.cycle]} plan · {formatRange(b.period.startDate, b.period.endDate)}
          </H2>
          <KeyValue
            label={b.period.anchorMode === 'full_period' ? 'Plan for the whole period' : `Left when you set it (${formatDateShort(localDateOf(b.period.anchoredAt, s.timezone))}, ${formatTime(b.period.anchoredAt, s.timezone)})`}
            value={<Money value={b.allocation} />}
          />
          {b.reallocated ? <KeyValue label="Added / taken out since" value={<Money value={b.reallocated} options={{ signed: true }} />} /> : null}
          <KeyValue label="Spent (after refunds)" value={<Money value={b.netSpent} />} />
          {b.holdsTotal ? <KeyValue label="Set aside" value={<Money value={b.holdsTotal} />} /> : null}
          <Divider />
          <KeyValue label="Left" value={<Money value={b.remaining} style={{ fontWeight: '800' }} />} strong />
          {b.remaining < 0 ? <Muted>Over plan by {formatPaise(-b.remaining)}. It stays visible; nothing is reset.</Muted> : null}
          <RowWrap>
            <Button label="Change plan amount" kind="secondary" compact onPress={() => router.push('/plan-amount')} />
          </RowWrap>
          <Reallocate />
        </Card>
      ) : (
        <EmptyState
          title="No plan for this period"
          body="Set how much flexible money you have until the period ends."
          actionLabel="Set plan amount"
          onAction={() => router.push('/plan-amount')}
        />
      )}

      {b && b.unallocatedRefunds.length ? (
        <Card>
          <H2>Refunds not in your plan yet</H2>
          <Muted>These refunds are for older or non-plan purchases. They already count in reports on the day they arrived. Add one to this plan only if you want to spend it.</Muted>
          {b.unallocatedRefunds.map((u) => (
            <UnassignedRefund key={u.refund.id} refundId={u.refund.id} amount={u.amount} label={u.refund.purpose ?? 'Refund'} date={u.refund.localDate} />
          ))}
        </Card>
      ) : null}

      {b ? <Holds /> : null}
      <Envelopes />
      <Protected />
      <Upcoming />
      <GoalCard />

      <Card>
        <LinkRow
          label="Waiting list"
          detail={derived.waiting.length ? `${derived.waiting.length} item${derived.waiting.length === 1 ? '' : 's'} waiting` : 'Nothing waiting'}
          onPress={() => router.push('/waiting')}
        />
        <Divider />
        <LinkRow
          label="Mode"
          detail={s.mode === 'budget_only' ? 'Budget-only (no bank balances needed)' : 'Account-aware estimate is on'}
          onPress={() => router.push('/settings')}
        />
      </Card>
    </Screen>
  );
}

function Reallocate() {
  const { actions } = useReady();
  const [open, setOpen] = useState(false);
  const [dir, setDir] = useState<'add' | 'remove'>('add');
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!open) return <Button label="Add or take out money" kind="quiet" compact onPress={() => setOpen(true)} />;
  return (
    <View style={{ gap: SPACE.sm }}>
      <Segmented value={dir} onChange={setDir} options={[{ value: 'add', label: 'Add to plan' }, { value: 'remove', label: 'Take out' }]} />
      <Field label="Amount (₹)" value={text} onChangeText={setText} keyboardType="decimal-pad" />
      <Field label="Why? (optional)" value={note} onChangeText={setNote} maxLength={60} />
      <ErrorText>{error}</ErrorText>
      <RowWrap>
        <Button
          label="Save"
          compact
          onPress={async () => {
            const p = parseRupeesToPaise(text);
            if (!p) return setError('Enter an amount.');
            await actions.reallocate(dir === 'add' ? p : -p, note.trim() || null);
            setOpen(false);
            setText('');
            setNote('');
          }}
        />
        <Button label="Cancel" kind="quiet" compact onPress={() => setOpen(false)} />
      </RowWrap>
    </View>
  );
}

function UnassignedRefund({ refundId, amount, label, date }: { refundId: string; amount: number; label: string; date: string }) {
  const { actions } = useReady();
  return (
    <View style={{ gap: SPACE.xs }}>
      <KeyValue label={`${label} · ${formatDateShort(date)}`} value={<Money value={amount} />} />
      <Button label="Add to this plan" kind="secondary" compact onPress={() => actions.reallocate(amount, `Refund: ${label}`, refundId)} />
    </View>
  );
}

function Holds() {
  const { derived, actions } = useReady();
  const snack = useSnackbar();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [label, setLabel] = useState('');
  const holds = derived.budget?.activeHolds ?? [];
  return (
    <Card>
      <H2>Set aside</H2>
      <Muted>Reserve part of your plan for something coming up. It's used up when you record that purchase, so it never counts twice.</Muted>
      {holds.map((h) => (
        <View key={h.id} style={{ gap: SPACE.xs }}>
          <KeyValue label={h.label} value={<Money value={h.amount} />} />
          <Button
            label={`Release ${formatPaise(h.amount)}`}
            kind="quiet"
            compact
            onPress={async () => {
              await actions.releaseHold(h);
              snack({ message: 'Released back to your plan' });
            }}
          />
        </View>
      ))}
      {open ? (
        <View style={{ gap: SPACE.sm }}>
          <Field label="Amount (₹)" value={text} onChangeText={setText} keyboardType="decimal-pad" />
          <Field label="For what?" value={label} onChangeText={setLabel} maxLength={60} placeholder="e.g. movie on Saturday" />
          <RowWrap>
            <Button
              label="Set aside"
              compact
              disabled={!parseRupeesToPaise(text) || !label.trim()}
              onPress={async () => {
                const p = parseRupeesToPaise(text);
                if (!p) return;
                await actions.addHold(p, label.trim());
                setOpen(false);
                setText('');
                setLabel('');
              }}
            />
            <Button label="Cancel" kind="quiet" compact onPress={() => setOpen(false)} />
          </RowWrap>
        </View>
      ) : (
        <Button label="Set aside money" kind="secondary" compact onPress={() => setOpen(true)} />
      )}
    </Card>
  );
}

function Envelopes() {
  const { snapshot, derived, actions } = useReady();
  const [editing, setEditing] = useState<Envelope | null>(null);
  const [categoryId, setCategoryId] = useState('eating_out');
  const [text, setText] = useState('');
  const list = derived.budget?.envelopes ?? snapshot.envelopes.map((e) => ({ envelope: e, used: 0, limit: e.limit, pct: 0 }));
  const startNew = () => {
    setEditing({ id: actions.newId(), categoryId: 'eating_out', limit: 0, createdAt: Date.now(), deletedAt: null });
    setCategoryId('eating_out');
    setText('');
  };
  return (
    <Card>
      <H2>Category limits</H2>
      <Muted>A few limits inside your plan for this period. Up to 5.</Muted>
      {list.map((e) => (
        <View key={e.envelope.id} style={{ gap: SPACE.xs }}>
          <KeyValue
            label={derived.categoryName(e.envelope.categoryId)}
            value={
              <Body>
                {snapshot.settings.hideAmounts ? '₹ •••' : `${formatPaise(e.used)} of ${formatPaise(e.limit)}`}
              </Body>
            }
          />
          <Bar used={e.used} total={e.limit} label={`${derived.categoryName(e.envelope.categoryId)}: ${formatPaise(e.used)} of ${formatPaise(e.limit)}`} />
          {e.used > e.limit ? <Muted>Over by {formatPaise(e.used - e.limit)}</Muted> : null}
          <RowWrap>
            <Button
              label="Edit"
              kind="quiet"
              compact
              onPress={() => {
                setEditing(e.envelope);
                setCategoryId(e.envelope.categoryId);
                setText(String(e.envelope.limit / 100));
              }}
            />
            <Button label="Remove" kind="quiet" compact onPress={() => actions.saveEnvelope({ ...e.envelope, deletedAt: Date.now() })} />
          </RowWrap>
        </View>
      ))}
      {editing ? (
        <View style={{ gap: SPACE.sm }}>
          <CategoryPicker value={categoryId} onChange={setCategoryId} />
          <Field label="Limit per period (₹)" value={text} onChangeText={setText} keyboardType="decimal-pad" />
          <RowWrap>
            <Button
              label="Save limit"
              compact
              disabled={!parseRupeesToPaise(text)}
              onPress={async () => {
                const p = parseRupeesToPaise(text);
                if (!p) return;
                await actions.saveEnvelope({ ...editing, categoryId, limit: p });
                setEditing(null);
              }}
            />
            <Button label="Cancel" kind="quiet" compact onPress={() => setEditing(null)} />
          </RowWrap>
        </View>
      ) : list.length < 5 ? (
        <Button label="Add a category limit" kind="secondary" compact onPress={startNew} />
      ) : null}
    </Card>
  );
}

function Protected() {
  const { snapshot, actions } = useReady();
  const [editing, setEditing] = useState<Reservation | null>(null);
  const [label, setLabel] = useState('');
  const [text, setText] = useState('');
  const [kind, setKind] = useState<Reservation['kind']>('essential');
  if (snapshot.settings.mode !== 'account_aware') {
    return (
      <Card>
        <H2>Protected costs</H2>
        <Muted>
          Rent, bills and other essentials. Mark a purchase as a protected cost (Add expense → More) to keep it out of your flexible
          plan. Turn on the account-aware estimate in Settings to also keep money aside inside your bank balances.
        </Muted>
        <LinkRow label="Recurring commitments" detail="Bills and subscriptions with due dates" onPress={() => router.push('/recurring')} />
      </Card>
    );
  }
  return (
    <Card>
      <H2>Protected money</H2>
      <Muted>
        Money kept aside inside your included accounts (rent, emergency fund). It's subtracted once from the estimate. Don't add money
        that sits in an excluded savings account — it's already left out.
      </Muted>
      {snapshot.reservations
        .filter((r) => r.active)
        .map((r) => (
          <View key={r.id} style={{ gap: SPACE.xs }}>
            <KeyValue label={`${r.label} (${r.kind})`} value={<Money value={r.amount} />} />
            <RowWrap>
              <Button
                label="Edit"
                kind="quiet"
                compact
                onPress={() => {
                  setEditing(r);
                  setLabel(r.label);
                  setText(String(r.amount / 100));
                  setKind(r.kind);
                }}
              />
              <Button label="Remove" kind="quiet" compact onPress={() => actions.saveReservation({ ...r, active: false, deletedAt: Date.now() })} />
            </RowWrap>
          </View>
        ))}
      {editing ? (
        <View style={{ gap: SPACE.sm }}>
          <Field label="Name" value={label} onChangeText={setLabel} maxLength={40} placeholder="Rent" />
          <Field label="Amount (₹)" value={text} onChangeText={setText} keyboardType="decimal-pad" />
          <Segmented
            value={kind}
            onChange={setKind}
            options={[
              { value: 'essential', label: 'Essential' },
              { value: 'savings', label: 'Savings' },
              { value: 'other', label: 'Other' },
            ]}
          />
          <RowWrap>
            <Button
              label="Save"
              compact
              disabled={!label.trim() || !parseRupeesToPaise(text)}
              onPress={async () => {
                const p = parseRupeesToPaise(text);
                if (!p) return;
                await actions.saveReservation({ ...editing, label: label.trim(), amount: p, kind });
                setEditing(null);
              }}
            />
            <Button label="Cancel" kind="quiet" compact onPress={() => setEditing(null)} />
          </RowWrap>
        </View>
      ) : (
        <Button
          label="Add protected money"
          kind="secondary"
          compact
          onPress={() => {
            setEditing({ id: actions.newId(), label: '', amount: 0, kind: 'essential', active: true, createdAt: Date.now(), deletedAt: null });
            setLabel('');
            setText('');
          }}
        />
      )}
      <LinkRow label="Recurring commitments" detail="Unpaid ones due soon are protected automatically" onPress={() => router.push('/recurring')} />
    </Card>
  );
}

function Upcoming() {
  const { derived } = useReady();
  const list = derived.upcoming.slice(0, 5);
  return (
    <Card>
      <H2>Coming up</H2>
      {list.length === 0 ? (
        <Muted>No recurring commitments due in the next 30 days.</Muted>
      ) : (
        list.map((o) => (
          <View key={`${o.obligation.id}@${o.date}`} style={{ gap: 2 }}>
            <KeyValue label={`${o.obligation.name} · ${formatDateShort(o.date)}`} value={<Money value={o.obligation.amount} />} />
            <Muted>
              {o.state === 'overdue' ? 'Was due — not recorded yet' : o.state === 'pending_payment' ? 'Recorded as pending' : 'Not paid yet'}
              {o.obligation.cadence === 'yearly' ? ` · ≈ ${formatPaise(monthlyPlanningEquivalent(o.obligation))}/month planning equivalent` : ''}
            </Muted>
          </View>
        ))
      )}
      <Button label="Manage recurring commitments" kind="quiet" compact onPress={() => router.push('/recurring')} />
    </Card>
  );
}

function GoalCard() {
  const { snapshot, actions } = useReady();
  const goal = snapshot.goals[0];
  const [editing, setEditing] = useState<Goal | null>(null);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [saved, setSaved] = useState('');
  return (
    <Card>
      <H2>Goal</H2>
      {goal && !editing ? (
        <>
          <Body style={{ fontWeight: '700' }}>{goal.name}</Body>
          <Bar used={goal.savedSoFar} total={goal.target} label={`${formatPaise(goal.savedSoFar)} of ${formatPaise(goal.target)} saved`} />
          <Muted>
            {snapshot.settings.hideAmounts ? '₹ •••' : `${formatPaise(goal.savedSoFar)} of ${formatPaise(goal.target)}`} · your own
            tracking. Updating this never moves real money.
          </Muted>
          <RowWrap>
            <Button
              label="Update"
              kind="secondary"
              compact
              onPress={() => {
                setEditing(goal);
                setName(goal.name);
                setTarget(String(goal.target / 100));
                setSaved(String(goal.savedSoFar / 100));
              }}
            />
            <Button label="Remove goal" kind="quiet" compact onPress={() => actions.saveGoal({ ...goal, deletedAt: Date.now() })} />
          </RowWrap>
        </>
      ) : null}
      {!goal && !editing ? (
        <>
          <Muted>Optional. Something you're keeping money for.</Muted>
          <Button
            label="Add a goal"
            kind="secondary"
            compact
            onPress={() => {
              setEditing({ id: actions.newId(), name: '', target: 0, savedSoFar: 0, createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null });
              setName('');
              setTarget('');
              setSaved('0');
            }}
          />
        </>
      ) : null}
      {editing ? (
        <View style={{ gap: SPACE.sm }}>
          <Field label="Goal name" value={name} onChangeText={setName} maxLength={40} placeholder="e.g. new phone" />
          <Field label="Target (₹)" value={target} onChangeText={setTarget} keyboardType="decimal-pad" />
          <Field label="Saved so far (₹)" value={saved} onChangeText={setSaved} keyboardType="decimal-pad" help="Your own record. It doesn't move money between accounts." />
          <RowWrap>
            <Button
              label="Save goal"
              compact
              disabled={!name.trim() || !parseRupeesToPaise(target)}
              onPress={async () => {
                const t = parseRupeesToPaise(target);
                const sv = parseRupeesToPaise(saved || '0') ?? 0;
                if (!t) return;
                await actions.saveGoal({ ...editing, name: name.trim(), target: t, savedSoFar: sv });
                setEditing(null);
              }}
            />
            <Button label="Cancel" kind="quiet" compact onPress={() => setEditing(null)} />
          </RowWrap>
        </View>
      ) : null}
      {goal && derived_planHint(snapshot.settings.mode)}
    </Card>
  );
}

function derived_planHint(mode: string) {
  if (mode !== 'account_aware') return null;
  return <Banner title="Goal money in your main account?" body="If it sits inside an included account, add it under Protected money so the estimate leaves it alone." />;
}
