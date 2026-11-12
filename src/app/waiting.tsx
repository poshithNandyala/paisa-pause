import { router } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { isHoldConsumed } from '../domain/budget';
import { addDays, epochFromLocal, formatDateMedium, formatDateShort, localDateOf } from '../domain/dates';
import type { Intention } from '../domain/types';
import { useReady } from '../state/store';
import { Body, Button, Card, EmptyState, H2, KeyValue, Money, Muted, Pill, RowWrap, Screen } from '../ui/kit';
import { useSnackbar } from '../ui/Snackbar';
import { SPACE } from '../ui/theme';

export default function WaitingList() {
  const { snapshot, derived, actions, now } = useReady();
  const snack = useSnackbar();
  const tz = snapshot.settings.timezone;
  const ready = derived.reconsiderReady;
  const waiting = derived.waiting.filter((i) => !ready.includes(i));
  const decided = snapshot.intentions
    .filter((i) => i.status === 'skipped' || derived.boughtIntentionIds.has(i.id))
    .slice(0, 20);
  const activeHold = (i: Intention) =>
    snapshot.holds.find((h) => h.intentionId === i.id && h.releasedAt === null && h.deletedAt === null && !isHoldConsumed(h, snapshot.transactions));

  async function skip(i: Intention) {
    const hold = activeHold(i);
    await actions.apply({
      upserts: {
        intentions: [{ ...i, status: 'skipped', decidedAt: Date.now(), updatedAt: Date.now() }],
        holds: hold ? [{ ...hold, releasedAt: Date.now() }] : [],
      },
    });
    snack({
      message: 'Skipped. The money stays in your plan — no extra money is created.',
      actionLabel: 'Undo',
      onAction: () =>
        actions.apply({
          upserts: { intentions: [i], holds: hold ? [hold] : [] },
        }),
    });
  }

  async function later(i: Intention) {
    const at = epochFromLocal(addDays(derived.today, 1), 10, 0, tz);
    await actions.saveIntention({ ...i, status: 'deferred', reconsiderAt: at });
    snack({ message: 'It will show up again tomorrow.' });
  }

  async function remove(i: Intention) {
    const hold = activeHold(i);
    await actions.apply({
      upserts: {
        intentions: [{ ...i, deletedAt: Date.now(), updatedAt: Date.now() }],
        holds: hold ? [{ ...hold, releasedAt: Date.now() }] : [],
      },
    });
    snack({ message: 'Removed from the list', actionLabel: 'Undo', onAction: () => actions.apply({ upserts: { intentions: [i], holds: hold ? [hold] : [] } }) });
  }

  const item = (i: Intention, showActions: boolean) => {
    const hold = activeHold(i);
    const bought = derived.boughtIntentionIds.has(i.id);
    return (
      <Card key={i.id}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: SPACE.md }}>
          <Body style={{ fontWeight: '700', flex: 1 }}>{i.label ?? derived.categoryName(i.categoryId)}</Body>
          <Money value={i.amount} style={{ fontWeight: '700' }} />
        </View>
        <Muted>
          {derived.categoryName(i.categoryId)} · added {formatDateMedium(localDateOf(i.createdAt, tz))}
          {i.planned !== 'unknown' ? ` · ${i.planned}` : ''}
        </Muted>
        {i.reflectionQuestion ? <Muted>{i.reflectionQuestion} — {i.reflectionAnswer}</Muted> : null}
        {hold ? <Pill text="Money set aside in plan" tone="good" /> : null}
        {bought ? <Pill text="Bought" /> : i.status === 'skipped' ? <Pill text="Skipped" /> : null}
        {i.reconsiderAt && !bought && i.status !== 'skipped' ? (
          <Muted>{i.reconsiderAt <= now ? 'Ready to look at again' : `Look again on ${formatDateMedium(localDateOf(i.reconsiderAt, tz))}`}</Muted>
        ) : null}
        {showActions ? (
          <RowWrap style={{ marginTop: SPACE.xs }}>
            <Button
              label="I bought it"
              compact
              onPress={() => router.push({ pathname: '/add', params: { intentionId: i.id, holdId: hold?.id } })}
            />
            <Button label="Skip it" kind="secondary" compact onPress={() => skip(i)} />
            <Button label="Tomorrow" kind="quiet" compact onPress={() => later(i)} />
            <Button label="Remove" kind="quiet" compact onPress={() => remove(i)} />
          </RowWrap>
        ) : null}
      </Card>
    );
  };

  return (
    <Screen>
      <Muted>
        Things you paused on. There's no deadline. Skipping keeps money in your plan; it doesn't add money to your accounts.
      </Muted>
      {derived.kept.count > 0 ? (
        <Card tone="soft">
          <KeyValue
            label={`Kept by skipping since ${formatDateShort(derived.keptRange.start)}`}
            value={<Money value={derived.kept.kept} style={{ fontWeight: '800' }} />}
            strong
          />
          <Muted>
            {derived.kept.count} purchase{derived.kept.count === 1 ? '' : 's'} you decided against. This is money you didn't spend,
            not money you earned.
          </Muted>
        </Card>
      ) : null}
      {ready.length ? <H2>Ready to look at again</H2> : null}
      {ready.map((i) => item(i, true))}
      {waiting.length ? <H2>Waiting</H2> : null}
      {waiting.map((i) => item(i, true))}
      {ready.length + waiting.length === 0 ? (
        <EmptyState
          title="Nothing waiting"
          body="Use “Before I buy” to pause on an optional purchase and decide later."
          actionLabel="Before I buy"
          onAction={() => router.push('/buy')}
        />
      ) : null}
      {decided.length ? <H2>Decided</H2> : null}
      {decided.map((i) => item(i, false))}
    </Screen>
  );
}
