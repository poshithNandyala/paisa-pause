import React, { useState } from 'react';
import { View } from 'react-native';
import { periodRangeFor } from '../domain/budget';
import { formatRange, localDateOf, parseTimeHHMM } from '../domain/dates';
import { formatPaise, parseRupeesToPaise } from '../domain/money';
import type { AnchorMode, CycleKind, Goal, Mode, Settings } from '../domain/types';
import { newPeriod } from '../data/operations';
import { useStore } from '../state/store';
import { Banner, Body, Button, Card, Chip, ErrorText, Field, H2, Label, Muted, RowWrap, Screen, Segmented, Title } from '../ui/kit';
import { SPACE } from '../ui/theme';
import { nowMs } from '../ui/clock';

export default function Onboarding() {
  const { snapshot, actions, now, encryption } = useStore();
  const [step, setStep] = useState(0);
  const [cycle, setCycle] = useState<CycleKind>('monthly');
  const [payday, setPayday] = useState('1');
  const [amountText, setAmountText] = useState('');
  const [mode, setMode] = useState<AnchorMode>('remaining_now');
  const [focus, setFocus] = useState<string[]>([]);
  const [goalName, setGoalName] = useState('');
  const [goalTarget, setGoalTarget] = useState('');
  const [reviewTime, setReviewTime] = useState('');
  const [trackMode, setTrackMode] = useState<Mode>('budget_only');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!snapshot) return null;

  const today = localDateOf(now, snapshot.settings.timezone);
  const paydayDay = Math.min(31, Math.max(1, Number(payday) || 1));
  const range = periodRangeFor(today, cycle, snapshot.settings.weekStartsOn, paydayDay);
  const amount = parseRupeesToPaise(amountText);
  const midPeriod = today !== range.start;
  const categories = snapshot.categories.filter((c) => !c.hidden && c.id !== 'uncategorized');

  async function finish() {
    setError(null);
    if (amount === null) return setError('Enter your flexible money (₹0 is fine).');
    if (reviewTime.trim() && !parseTimeHHMM(reviewTime)) return setError('Review time should look like 21:00.');
    const target = goalTarget.trim() ? parseRupeesToPaise(goalTarget) : null;
    if (goalName.trim() && !target) return setError('Add a target amount for your goal, or clear the goal name.');
    setBusy(true);
    const t = nowMs();
    const settings: Settings = {
      ...snapshot!.settings,
      cycle,
      paydayDay,
      defaultAllocation: amount,
      focusCategoryIds: focus,
      reviewTime: reviewTime.trim() || null,
      trackingStartDate: today,
      mode: trackMode,
      onboarded: true,
    };
    const period = newPeriod({ ...snapshot!, settings }, today, amount, mode, actions.newId, t);
    const goals: Goal[] =
      goalName.trim() && target
        ? [{ id: actions.newId(), name: goalName.trim(), target, savedSoFar: 0, createdAt: t, updatedAt: t, deletedAt: null }]
        : [];
    try {
      // One atomic write: settings, the first plan period and the optional goal.
      await actions.apply({ settings, upserts: { periods: [period], goals } });
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const steps = [
    // 0 — welcome
    <View key="welcome" style={{ gap: SPACE.md }}>
      <Title>Paisa Pause</Title>
      <Body>See where your money goes, pause before optional buys, and keep money for what matters to you. No shame, no streaks.</Body>
      <Card tone="soft">
        <Body>• Works offline. Your records stay on this phone{encryption?.on ? ', encrypted' : ''}.</Body>
        <Body>• No bank login, no SMS reading, no ads, no AI calls.</Body>
        <Body>• You type entries yourself — they're yours to edit any time.</Body>
      </Card>
      <Button label="Get started" onPress={() => setStep(1)} />
      <Button label="Try with sample data first" kind="secondary" onPress={() => actions.startSample()} />
      <Muted>Sample data opens in a separate space and is clearly labelled. It never mixes with your records.</Muted>
    </View>,
    // 1 — cycle
    <View key="cycle" style={{ gap: SPACE.md }}>
      <H2>How do you plan your money?</H2>
      <Segmented
        value={cycle}
        onChange={setCycle}
        options={[
          { value: 'weekly', label: 'Weekly' },
          { value: 'monthly', label: 'Monthly' },
          { value: 'payday', label: 'Payday to payday' },
        ]}
      />
      {cycle === 'payday' ? (
        <Field label="Payday (day of month)" value={payday} onChangeText={setPayday} keyboardType="number-pad" maxLength={2} help="In shorter months it falls on the last day." />
      ) : null}
      <Muted>This period: {formatRange(range.start, range.end)}</Muted>
      <Button label="Next" onPress={() => setStep(2)} />
      <Button label="Back" kind="quiet" onPress={() => setStep(0)} />
    </View>,
    // 2 — amount
    <View key="amount" style={{ gap: SPACE.md }}>
      <H2>Flexible money until {formatRange(range.end, range.end)}</H2>
      <Body>How much can you spend freely — food, travel, apps, shopping — until this period ends? Leave out rent and bills.</Body>
      <Field label="Amount (₹)" value={amountText} onChangeText={setAmountText} keyboardType="decimal-pad" placeholder="e.g. 6000" />
      <Label>Is this…</Label>
      <RowWrap>
        <Chip label="What I have left today" selected={mode === 'remaining_now'} onPress={() => setMode('remaining_now')} />
        <Chip label={`My whole budget for ${formatRange(range.start, range.end)}`} selected={mode === 'full_period'} onPress={() => setMode('full_period')} />
      </RowWrap>
      <Muted>
        {mode === 'remaining_now'
          ? 'Good for starting mid-period: nothing you spent earlier is subtracted again.'
          : 'Anything you record from earlier in this period will be subtracted.'}
      </Muted>
      {midPeriod ? <Banner title="Starting mid-period" body="This period's reports will be marked partial. No need to fill in the past." /> : null}
      <Muted>This is a plan, not your bank balance. You can change it any time.</Muted>
      <Button label="Next" disabled={amount === null} onPress={() => setStep(3)} />
      <Button label="Back" kind="quiet" onPress={() => setStep(1)} />
    </View>,
    // 3 — focus, goal, review time
    <View key="focus" style={{ gap: SPACE.md }}>
      <H2>A few optional extras</H2>
      <Label>Categories you want to keep an eye on (up to 3)</Label>
      <RowWrap>
        {categories.map((c) => {
          const on = focus.includes(c.id);
          return (
            <Chip
              key={c.id}
              role="checkbox"
              label={c.name}
              selected={on}
              onPress={() => setFocus(on ? focus.filter((x) => x !== c.id) : focus.length < 3 ? [...focus, c.id] : focus)}
            />
          );
        })}
      </RowWrap>
      <Field label="A goal (optional)" value={goalName} onChangeText={setGoalName} placeholder="e.g. trip, new phone" maxLength={40} />
      {goalName.trim() ? <Field label="Goal target (₹)" value={goalTarget} onChangeText={setGoalTarget} keyboardType="decimal-pad" /> : null}
      <Field
        label="Daily review time (optional)"
        value={reviewTime}
        onChangeText={setReviewTime}
        placeholder="21:00"
        keyboardType="numbers-and-punctuation"
        maxLength={5}
        help="A gentle prompt inside the app. No notifications in this version."
      />
      <Button label="Next" onPress={() => setStep(4)} />
      <Button label="Back" kind="quiet" onPress={() => setStep(2)} />
    </View>,
    // 4 — mode
    <View key="mode" style={{ gap: SPACE.md }}>
      <H2>Bank balances?</H2>
      <Segmented
        value={trackMode}
        onChange={setTrackMode}
        options={[
          { value: 'budget_only', label: 'Just my plan (recommended)' },
          { value: 'account_aware', label: 'Also my account balances' },
        ]}
      />
      <Muted>
        {trackMode === 'budget_only'
          ? 'Simplest. You track your flexible money; no balances needed. You can add accounts later.'
          : 'You can add bank, cash, wallet and card balances after this. The app then estimates what is available, and holds back when data is unclear.'}
      </Muted>
      <Card tone="soft">
        <Body>
          Plan: {amount !== null ? formatPaise(amount) : '—'} ({mode === 'full_period' ? 'whole period' : 'left today'}) ·{' '}
          {formatRange(range.start, range.end)}
        </Body>
      </Card>
      <ErrorText>{error}</ErrorText>
      <Button label="Start using Paisa Pause" busy={busy} onPress={finish} />
      <Button label="Back" kind="quiet" onPress={() => setStep(3)} />
    </View>,
  ];

  return (
    <Screen noHeader>
      {step > 0 ? <Muted>Step {step} of 4</Muted> : null}
      {steps[step]}
    </Screen>
  );
}
