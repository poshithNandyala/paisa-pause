import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { buildAiReport } from '../domain/aiReport';
import { periodRangeFor } from '../domain/budget';
import { formatRange, isLocalDate, startOfMonth } from '../domain/dates';
import { buildReport } from '../domain/reports';
import { useReady } from '../state/store';
import { Banner, Button, Card, Chip, Muted, RowWrap, Screen, ToggleRow } from '../ui/kit';
import { useSnackbar } from '../ui/Snackbar';
import { RADIUS, SPACE, usePalette } from '../ui/theme';

/**
 * Builds a redacted summary + instructions that YOU paste into an AI tool of
 * your choice. The app never uploads it or calls any AI service.
 */
export default function CopyForAi() {
  const params = useLocalSearchParams<{ start?: string; end?: string }>();
  const { snapshot, derived } = useReady();
  const snack = useSnackbar();
  const c = usePalette();
  const week = periodRangeFor(derived.today, 'weekly', snapshot.settings.weekStartsOn, 1);
  const initial =
    params.start && params.end && isLocalDate(params.start) && isLocalDate(params.end) ? { start: params.start, end: params.end } : week;
  const [range, setRange] = useState(initial);
  const [purposes, setPurposes] = useState(false);
  const [daily, setDaily] = useState(true);

  const text = useMemo(() => {
    const report = buildReport(snapshot, range, derived.today);
    const budget = derived.budget && range.start <= derived.budget.period.endDate && range.end >= derived.budget.period.startDate ? derived.budget : null;
    return buildAiReport(snapshot, report, budget, derived.today, { includePurposes: purposes, includeDailyTotals: daily });
  }, [snapshot, derived, range, purposes, daily]);

  return (
    <Screen
      footer={
        <Button
          label="Copy to clipboard"
          onPress={async () => {
            await Clipboard.setStringAsync(text);
            snack({ message: 'Copied. Paste it into the AI tool you choose.' });
          }}
        />
      }
    >
      <Banner title="Nothing is sent from this app" body="You copy the text below and paste it yourself. Review it first — it's exactly what will be shared." />
      <RowWrap>
        <Chip label={`This week (${formatRange(week.start, week.end)})`} selected={range.start === week.start && range.end === week.end} onPress={() => setRange(week)} />
        <Chip
          label="This month"
          selected={range.start === startOfMonth(derived.today)}
          onPress={() => setRange({ start: startOfMonth(derived.today), end: derived.today })}
        />
        {params.start && params.end && (params.start !== week.start || params.end !== week.end) ? (
          <Chip label={`From Review (${formatRange(initial.start, initial.end)})`} selected={range.start === initial.start && range.end === initial.end} onPress={() => setRange(initial)} />
        ) : null}
      </RowWrap>
      <Card>
        <ToggleRow label="Include day-by-day totals" value={daily} onChange={setDaily} />
        <ToggleRow
          label="Include my short purposes"
          description="Off by default. Account names, payees, notes, apps and exact times are always removed."
          value={purposes}
          onChange={setPurposes}
        />
      </Card>
      <View style={{ backgroundColor: c.cardAlt, borderRadius: RADIUS.md, padding: SPACE.md }}>
        <Text selectable style={{ color: c.text, fontSize: 13, lineHeight: 19, fontFamily: 'monospace' }}>
          {snapshot.settings.hideAmounts ? 'Amounts are hidden on screen. Turn off "Hide amounts" to preview; copying still includes them.' : text}
        </Text>
      </View>
      <Muted>Tip: AI answers can be wrong. Treat them as ideas, not financial advice.</Muted>
    </Screen>
  );
}
