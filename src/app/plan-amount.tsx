import { router } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { previewPlanChange, periodRangeForSettings } from '../domain/budget';
import { formatRange } from '../domain/dates';
import { formatPaise, parseRupeesToPaise } from '../domain/money';
import type { AnchorMode, BudgetPeriod } from '../domain/types';
import { useReady } from '../state/store';
import { Body, Button, Card, ErrorText, Field, KeyValue, Label, Money, Muted, Screen, Segmented, ToggleRow } from '../ui/kit';
import { useSnackbar } from '../ui/Snackbar';
import { SPACE } from '../ui/theme';

/**
 * Change the plan amount. Switching between "whole period" and "left right
 * now" changes which purchases count, so a preview is always shown first.
 */
export default function PlanAmount() {
  const { snapshot, derived, actions, now } = useReady();
  const snack = useSnackbar();
  const current = derived.period;
  const range = current ? { start: current.startDate, end: current.endDate } : periodRangeForSettings(derived.today, snapshot.settings);
  const [text, setText] = useState(current ? String(current.allocation / 100) : '');
  const [mode, setMode] = useState<AnchorMode>(current?.anchorMode ?? 'full_period');
  const [asDefault, setAsDefault] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const amount = parseRupeesToPaise(text);

  const draftPeriod: BudgetPeriod = current ?? {
    id: 'draft',
    startDate: range.start,
    endDate: range.end,
    allocation: 0,
    anchorMode: mode,
    anchoredAt: now,
    autoCreated: false,
    createdAt: now,
    updatedAt: now,
  };
  const preview = amount !== null ? previewPlanChange(snapshot, draftPeriod, amount, mode, now, derived.today) : null;
  const modeChanged = current && current.anchorMode !== mode;

  return (
    <Screen
      footer={
        <View style={{ gap: SPACE.sm }}>
          <ErrorText>{error}</ErrorText>
          <Button
            label={modeChanged ? 'Switch and recalculate' : 'Save plan'}
            busy={busy}
            disabled={amount === null}
            onPress={async () => {
              if (amount === null) return setError('Enter an amount (₹0 is allowed).');
              setBusy(true);
              try {
                await actions.setPlan(amount, mode, asDefault);
                router.back();
                snack({ message: `Plan set: ${formatPaise(amount)}` });
              } catch (e) {
                setBusy(false);
                setError(e instanceof Error ? e.message : String(e));
              }
            }}
          />
        </View>
      }
    >
      <Body>
        Period: <Body style={{ fontWeight: '700' }}>{formatRange(range.start, range.end)}</Body>
      </Body>
      <Field label="Flexible money (₹)" value={text} onChangeText={setText} keyboardType="decimal-pad" help="Money for everyday, optional spending. Not your bank balance." />
      <Segmented
        label="What does this amount mean?"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'full_period', label: 'Whole period' },
          { value: 'remaining_now', label: 'What I have left right now' },
        ]}
      />
      <Muted>
        {mode === 'full_period'
          ? `All flexible purchases from ${formatRange(range.start, range.end)} are subtracted from it.`
          : 'Only purchases from now on are subtracted. Earlier ones are already reflected in the number you entered.'}
      </Muted>

      {preview ? (
        <Card>
          <Label>PREVIEW</Label>
          {current ? <KeyValue label="Left now" value={<Money value={preview.current.remaining} />} /> : null}
          <KeyValue label="Spending that will count" value={<Money value={preview.proposed.countedSpending} />} />
          <KeyValue label="Left after saving" value={<Money value={preview.proposed.remaining} style={{ fontWeight: '800' }} />} strong />
          {modeChanged ? <Muted>Switching changes which purchases count. Your entries themselves don't change.</Muted> : null}
        </Card>
      ) : null}

      <ToggleRow
        label="Use this amount for future periods"
        description="When a period ends, the next one starts with this amount (you'll be told)."
        value={asDefault}
        onChange={setAsDefault}
      />
    </Screen>
  );
}
