import { router } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { previewPurchase } from '../domain/budget';
import { addDays, epochFromLocal } from '../domain/dates';
import { DIGITAL_PURCHASE_CATEGORY_IDS } from '../domain/defaults';
import { formatPaise, parseRupeesToPaise } from '../domain/money';
import type { Intention, PlannedTag } from '../domain/types';
import { UNCATEGORIZED_ID } from '../domain/types';
import { useReady } from '../state/store';
import { Keypad } from '../ui/Keypad';
import { Banner, Body, Button, Card, Chip, Field, KeyValue, Label, Money, Muted, RowWrap, Screen, Segmented, ToggleRow } from '../ui/kit';
import { CategoryPicker } from '../ui/pickers';
import { useSnackbar } from '../ui/Snackbar';
import { SPACE, usePalette } from '../ui/theme';
import { nowMs } from '../ui/clock';

const QUESTIONS: Record<string, { q: string; options: string[] }> = {
  learning: { q: 'When will you use it?', options: ['Today', 'This week', 'Later', 'Not sure'] },
  apps_subscriptions: { q: 'Do you already own something similar?', options: ['Yes', 'No', 'Not sure'] },
};

/**
 * Optional pause before an optional purchase. A preview never changes your
 * plan, your spending or any balance.
 */
export default function BeforeIBuy() {
  const { snapshot, derived, actions } = useReady();
  const snack = useSnackbar();
  const c = usePalette();
  const [amountText, setAmountText] = useState('');
  const [label, setLabel] = useState('');
  const [categoryId, setCategoryId] = useState<string>(UNCATEGORIZED_ID);
  const [planned, setPlanned] = useState<PlannedTag>('unknown');
  const [answer, setAnswer] = useState<string | null>(null);
  const [confirmPaid, setConfirmPaid] = useState(false);
  const [setAside, setSetAside] = useState(false);
  const [busy, setBusy] = useState(false);
  const amount = parseRupeesToPaise(amountText);
  const b = derived.budget;
  const preview = b && amount ? previewPurchase(b, amount, categoryId) : null;
  const question = DIGITAL_PURCHASE_CATEGORY_IDS.includes(categoryId) ? QUESTIONS[categoryId] : undefined;
  const goal = snapshot.goals.find((g) => g.deletedAt === null);

  const makeIntention = (status: Intention['status'], reconsiderAt: number | null, at: number): Intention => ({
    id: actions.newId(),
    amount: amount ?? 0,
    categoryId,
    label: label.trim() || null,
    planned,
    createdAt: at,
    updatedAt: at,
    reconsiderAt,
    status,
    reflectionQuestion: question && answer ? question.q : null,
    reflectionAnswer: question ? answer : null,
    decidedAt: null,
    deletedAt: null,
  });

  async function wait(tomorrow: boolean) {
    if (!amount) return;
    setBusy(true);
    const reconsiderAt = tomorrow ? epochFromLocal(addDays(derived.today, 1), 10, 0, snapshot.settings.timezone) : null;
    const intention = makeIntention(tomorrow ? 'deferred' : 'considering', reconsiderAt, nowMs());
    await actions.saveIntention(intention);
    if (setAside && b) await actions.addHold(amount, label.trim() || derived.categoryName(categoryId), intention.id);
    router.back();
    snack({
      message: tomorrow ? 'On your waiting list. It will show up again tomorrow.' : 'On your waiting list. Decide whenever you like.',
    });
  }

  function record() {
    if (!amount) return;
    router.replace({
      pathname: '/add',
      params: {
        amount: String(amount),
        categoryId,
        purpose: label.trim(),
        fromBuy: '1',
        planned,
        q: question && answer ? question.q : '',
        a: answer ?? '',
      },
    });
  }

  return (
    <Screen>
      <Muted>Optional. Use it for things you could skip — never needed for essentials or emergencies.</Muted>
      <View
        accessible
        accessibilityLabel={amount ? `Price ${formatPaise(amount)}` : 'Price, nothing entered yet'}
        style={{ alignItems: 'center' }}
      >
        <Body style={{ fontSize: 40, fontWeight: '800', color: amount ? c.text : c.muted }}>₹{amountText || '0'}</Body>
      </View>
      <Keypad value={amountText} onChange={setAmountText} />
      <Field label="What is it? (optional)" value={label} onChangeText={setLabel} placeholder="e.g. headphones, course, game pass" maxLength={80} />
      <CategoryPicker value={categoryId} onChange={(id) => { setCategoryId(id); setAnswer(null); }} />
      <Segmented
        label="Was it planned?"
        value={planned}
        onChange={setPlanned}
        options={[
          { value: 'planned', label: 'Planned' },
          { value: 'unplanned', label: 'Unplanned' },
          { value: 'unknown', label: 'Not sure' },
        ]}
      />

      {question ? (
        <View style={{ gap: SPACE.xs }}>
          <Label>{question.q} (optional)</Label>
          <RowWrap>
            {question.options.map((o) => (
              <Chip key={o} label={o} selected={answer === o} onPress={() => setAnswer(answer === o ? null : o)} />
            ))}
          </RowWrap>
          <Muted>Learning and apps can be well worth it. This is just a moment to check.</Muted>
        </View>
      ) : null}

      {amount ? (
        b && preview ? (
          <Card>
            <Label>IF YOU BUY IT</Label>
            <KeyValue label="Left in your plan now" value={<Money value={preview.before.remaining} />} />
            <KeyValue label="Left after this" value={<Money value={preview.after.remaining} style={{ fontWeight: '800' }} />} strong />
            {preview.daysLeft > 0 && preview.before.perDay !== null && preview.after.perDay !== null ? (
              <Body>
                About <Money value={preview.after.perDay} style={{ fontWeight: '700' }} /> a day for the {preview.daysLeft} day
                {preview.daysLeft === 1 ? '' : 's'} left, instead of <Money value={preview.before.perDay} />.
              </Body>
            ) : null}
            {preview.comparison.kind === 'envelope' ? (
              <Muted>
                {derived.categoryName(preview.comparison.categoryId)} limit: {formatPaise(preview.comparison.usedAfter)} of{' '}
                {formatPaise(preview.comparison.limit)} after this (now {formatPaise(preview.comparison.used)}).
              </Muted>
            ) : preview.comparison.kind === 'share_of_left' ? (
              <Muted>That's about {preview.comparison.pct}% of what's left in your plan.</Muted>
            ) : preview.comparison.kind === 'goes_over' ? (
              <Muted style={{ color: c.amber }}>This would put you {formatPaise(preview.comparison.overBy)} over your plan.</Muted>
            ) : (
              <Muted style={{ color: c.amber }}>You're already {formatPaise(preview.comparison.overBy)} over your plan.</Muted>
            )}
            {goal && goal.target > 0 ? (
              <Muted>
                That's {Math.min(100, Math.round((amount * 100) / goal.target))}% of your {goal.name} goal (
                {formatPaise(goal.target)}).
              </Muted>
            ) : null}
            <Muted>Just a preview. Nothing has changed.</Muted>
          </Card>
        ) : (
          <Banner title="No plan for this period yet" body="Set your flexible money on the Plan tab to see a before/after preview." />
        )
      ) : null}

      {amount ? (
        <View style={{ gap: SPACE.sm }}>
          <Card tone="soft">
            <ToggleRow
              label="I've already paid"
              description="Recording needs a real payment. Previews never count."
              value={confirmPaid}
              onChange={setConfirmPaid}
            />
            <Button label="Record purchase" disabled={!confirmPaid} onPress={record} />
          </Card>
          {b ? (
            <ToggleRow
              label="Set this money aside while I decide"
              description="Optional. Holds it in your plan; released if you skip, used if you buy."
              value={setAside}
              onChange={setSetAside}
            />
          ) : null}
          <Button label="Think tomorrow" kind="secondary" busy={busy} onPress={() => wait(true)} hint="Adds it to your waiting list for tomorrow" />
          <Button label="Decide later" kind="secondary" busy={busy} onPress={() => wait(false)} hint="Adds it to your waiting list with no date" />
          <Muted>Skipping a purchase keeps money in your plan. It doesn't add money to your bank balance.</Muted>
        </View>
      ) : null}
    </Screen>
  );
}
