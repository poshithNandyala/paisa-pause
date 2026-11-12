import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { periodRangeFor, type DateRange } from '../../domain/budget';
import {
  addDays,
  addMonthsClamped,
  endOfMonth,
  formatDateMedium,
  formatDateShort,
  formatRange,
  monthName,
  parts,
  startOfMonth,
  weekday,
} from '../../domain/dates';
import { formatPaise } from '../../domain/money';
import { buildReport, compareWithPrevious } from '../../domain/reports';
import type { Suggestion } from '../../domain/suggestions';
import { useReady } from '../../state/store';
import { Banner, Bar, Body, Button, Card, Divider, H2, KeyValue, Label, Money, Muted, RowWrap, Screen, Segmented } from '../../ui/kit';
import { SPACE, usePalette } from '../../ui/theme';

type Zoom = 'day' | 'week' | 'month';

function rangeFor(zoom: Zoom, today: string, offset: number, weekStartsOn: number): { range: DateRange; previous: DateRange } {
  if (zoom === 'day') {
    const d = addDays(today, offset);
    return { range: { start: d, end: d }, previous: { start: addDays(d, -1), end: addDays(d, -1) } };
  }
  if (zoom === 'week') {
    const range = periodRangeFor(addDays(today, 7 * offset), 'weekly', weekStartsOn, 1);
    return { range, previous: { start: addDays(range.start, -7), end: addDays(range.end, -7) } };
  }
  const start = addMonthsClamped(startOfMonth(today), offset, 1);
  const prevStart = addMonthsClamped(start, -1, 1);
  return { range: { start, end: endOfMonth(start) }, previous: { start: prevStart, end: endOfMonth(prevStart) } };
}

export default function Review() {
  const { snapshot, derived } = useReady();
  const c = usePalette();
  const [zoom, setZoom] = useState<Zoom>('week');
  const [offset, setOffset] = useState(0);
  const { range, previous } = rangeFor(zoom, derived.today, offset, snapshot.settings.weekStartsOn);
  const report = buildReport(snapshot, range, derived.today);
  const comparison = zoom === 'day' ? null : compareWithPrevious(snapshot, range, previous, derived.today);
  const title =
    zoom === 'day'
      ? formatDateMedium(range.start)
      : zoom === 'week'
        ? formatRange(range.start, range.end)
        : `${monthName(parts(range.start).m, true)} ${parts(range.start).y}`;
  const maxCat = Math.max(1, ...report.byCategory.map((l) => Math.abs(l.net)));
  const m = report.movements;

  return (
    <Screen>
      <Segmented
        value={zoom}
        onChange={(z) => {
          setZoom(z);
          setOffset(0);
        }}
        options={[
          { value: 'day', label: 'Day' },
          { value: 'week', label: 'Week' },
          { value: 'month', label: 'Month' },
        ]}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Button label="‹ Earlier" kind="quiet" compact onPress={() => setOffset(offset - 1)} />
        <Text accessibilityRole="header" style={{ color: c.text, fontSize: 17, fontWeight: '700', flexShrink: 1, textAlign: 'center' }}>
          {title}
        </Text>
        <Button label="Later ›" kind="quiet" compact disabled={offset >= 0} onPress={() => setOffset(offset + 1)} />
      </View>

      <Card>
        <KeyValue label="Purchases (your share)" value={<Money value={report.gross} />} />
        <KeyValue label="Refunds" value={<Money value={report.refunds} prefix="− " />} />
        <Divider />
        <KeyValue label="Net spending" value={<Money value={report.net} style={{ fontWeight: '800', fontSize: 20 }} />} strong />
        {report.observed ? (
          <>
            <KeyValue
              label="Daily average"
              value={report.dailyAverage !== null ? <Money value={report.dailyAverage} style={{ fontWeight: '700' }} /> : '—'}
            />
            <Muted>
              {formatPaise(report.observedNet)} ÷ {report.observed.days} calendar day{report.observed.days === 1 ? '' : 's'} (
              {formatRange(report.observed.start, report.observed.end)}), counting days with no entries.{' '}
              {report.completeness.complete} marked complete
              {report.completeness.missing ? `, ${report.completeness.missing} missing data` : ''}
              {report.completeness.unknown ? `, ${report.completeness.unknown} not reviewed` : ''}.
            </Muted>
            {report.partial ? <Muted>Partial period — only the days shown above are observed.</Muted> : null}
          </>
        ) : (
          <Muted>No observed days in this range yet.</Muted>
        )}
        {report.beforeCoverageNet ? (
          <Muted>{formatPaise(report.beforeCoverageNet)} was recorded before you started tracking everything; it's in the total but not the average.</Muted>
        ) : null}
        {report.pending.count ? <Muted style={{ color: c.amber }}>⏳ {formatPaise(report.pending.amount)} pending, not included.</Muted> : null}
        {report.awaitingReversal.count ? (
          <Muted style={{ color: c.amber }}>⏳ {formatPaise(report.awaitingReversal.amount)} debited and waiting to come back, not included.</Muted>
        ) : null}
        {comparison ? (
          <Muted>
            First {comparison.days} day{comparison.days === 1 ? '' : 's'}: {formatPaise(comparison.current.net)} now vs{' '}
            {formatPaise(comparison.previous.net)} in {formatRange(comparison.previous.start, comparison.previous.end)}.
          </Muted>
        ) : zoom !== 'day' ? (
          <Muted>No fair comparison yet — the previous {zoom} isn't fully tracked.</Muted>
        ) : null}
      </Card>

      {zoom !== 'day' ? <Calendar days={report.days} zoom={zoom} /> : <DayActions date={range.start} />}

      <Suggestions list={derived.suggestions} />

      <Card>
        <H2>By category</H2>
        {report.byCategory.length === 0 ? <Muted>No purchases in this range.</Muted> : null}
        {report.byCategory.map((l) => (
          <View key={l.categoryId} style={{ gap: 4 }}>
            <KeyValue label={`${derived.categoryName(l.categoryId)} · ${l.purchases}`} value={<Money value={l.net} />} />
            {l.net > 0 ? <Bar used={l.net} total={maxCat} label={`${derived.categoryName(l.categoryId)} ${formatPaise(l.net)}`} /> : null}
            {l.refunds ? <Muted>includes {formatPaise(l.refunds)} refunds{l.net < 0 ? ' (more refunded than bought here)' : ''}</Muted> : null}
          </View>
        ))}
      </Card>

      <Card>
        <H2>Money movements</H2>
        <Muted>Kept separate from spending so nothing is counted twice.</Muted>
        <KeyValue label="Bought on credit cards (in spending above)" value={<Money value={m.cardPurchases} />} />
        <KeyValue label="Card repayments (not extra spending)" value={<Money value={m.cardRepayments} />} />
        <KeyValue label="Moved to savings (not spending)" value={<Money value={m.savingsTransfers} />} />
        <KeyValue label="Other transfers" value={<Money value={m.otherTransfers} />} />
        <KeyValue label="Income received" value={<Money value={m.income} />} />
        <KeyValue label="Paid back by others (not income)" value={<Money value={m.reimbursements} />} />
      </Card>

      <Labels report={report} />

      <Card>
        <H2>Share or keep a copy</H2>
        <Button label="Copy for AI review" kind="secondary" onPress={() => router.push({ pathname: '/ai', params: { start: range.start, end: range.end } })} />
        <Button label="Backup & export" kind="secondary" onPress={() => router.push('/backup')} />
      </Card>
    </Screen>
  );
}

function DayActions({ date }: { date: string }) {
  const { snapshot } = useReady();
  const review = snapshot.dayReviews.find((r) => r.localDate === date);
  return (
    <Card>
      <Body>
        {review ? (review.status === 'complete' ? '✓ You marked this day complete.' : '! You marked this day as missing entries.') : 'This day isn’t reviewed yet.'}
      </Body>
      <Button label="Review this day" kind="secondary" onPress={() => router.push({ pathname: '/day', params: { date } })} />
    </Card>
  );
}

function Calendar({ days, zoom }: { days: ReturnType<typeof buildReport>['days']; zoom: Zoom }) {
  const c = usePalette();
  const { snapshot } = useReady();
  const hidden = snapshot.settings.hideAmounts;
  const lead = zoom === 'month' && days.length ? (weekday(days[0].date) + 6) % 7 : 0;
  const cells: (typeof days[number] | null)[] = [...Array(lead).fill(null), ...days];
  while (cells.length % 7 !== 0) cells.push(null);
  return (
    <Card>
      <H2>Calendar</H2>
      <Muted>✓ complete · ! missing entries · tap a day to review it</Muted>
      <View style={{ flexDirection: 'row' }}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <Text key={i} importantForAccessibility="no" style={{ flex: 1, textAlign: 'center', color: c.muted, fontWeight: '600' }}>
            {zoom === 'week' ? '' : d}
          </Text>
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {cells.map((d, i) => {
          if (!d) return <View key={i} style={{ width: `${100 / 7}%`, minHeight: 56 }} />;
          const mark = d.review === 'complete' ? '✓' : d.review === 'missing' ? '!' : '';
          const label = `${formatDateShort(d.date)}. ${d.future ? 'Future.' : `Net ${formatPaise(d.net)}, ${d.entries} entries.`} ${
            d.review === 'complete' ? 'Marked complete.' : d.review === 'missing' ? 'Marked missing entries.' : d.beforeCoverage ? 'Before tracking started.' : 'Not reviewed.'
          }`;
          return (
            <Pressable
              key={i}
              accessibilityRole="button"
              accessibilityLabel={label}
              disabled={d.future}
              onPress={() => router.push({ pathname: '/day', params: { date: d.date } })}
              style={{
                width: `${100 / 7}%`,
                minHeight: 56,
                padding: 2,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 8,
                backgroundColor: d.net > 0 && !d.future ? c.greenSoft : 'transparent',
                opacity: d.future || d.beforeCoverage ? 0.4 : 1,
              }}
            >
              <Text style={{ color: c.text, fontSize: 13, fontWeight: '700' }}>
                {zoom === 'week' ? `${['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'][(weekday(d.date) + 6) % 7]} ` : ''}
                {parts(d.date).d}
                {mark ? ` ${mark}` : ''}
              </Text>
              {!d.future && d.net !== 0 ? (
                <Text adjustsFontSizeToFit numberOfLines={1} style={{ color: c.muted, fontSize: 11, fontVariant: ['tabular-nums'] }}>
                  {hidden ? '•••' : formatPaise(d.net, { noSymbol: true })}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </Card>
  );
}

function Suggestions({ list }: { list: Suggestion[] }) {
  const { actions, snapshot } = useReady();
  if (!snapshot.settings.suggestionsEnabled) return null;
  return (
    <Card>
      <H2>Worth a look</H2>
      {list.length === 0 ? <Muted>Nothing new. That's fine — suggestions only appear when there's something useful.</Muted> : null}
      {list.map((s) => (
        <View key={s.key} style={{ gap: SPACE.xs }}>
          <Banner tone={s.ruleId.startsWith('data.') ? 'warn' : 'info'} title={s.title} body={s.explanation} />
          <RowWrap>
            {s.action ? (
              <Button
                label={s.action.kind === 'entries' ? `Show ${s.action.ids.length} entr${s.action.ids.length === 1 ? 'y' : 'ies'}` : s.action.kind === 'review_day' ? 'Review that day' : s.action.kind === 'recurring' ? 'Open commitments' : 'Open plan'}
                kind="secondary"
                compact
                onPress={() => {
                  const a = s.action!;
                  if (a.kind === 'entries') router.push({ pathname: '/activity', params: { ids: a.ids.join(',') } });
                  else if (a.kind === 'review_day') router.push({ pathname: '/day', params: { date: a.date } });
                  else if (a.kind === 'recurring') router.push('/recurring');
                  else router.push('/plan');
                }}
              />
            ) : null}
            <Button label="Dismiss" kind="quiet" compact onPress={() => actions.dismissSuggestion(s.key)} />
          </RowWrap>
          <Label>Rule: {s.ruleId}</Label>
        </View>
      ))}
    </Card>
  );
}

function Labels({ report }: { report: ReturnType<typeof buildReport> }) {
  const t = report.tagTotals;
  const rows: [string, number][] = [
    ['Necessary', t.necessity.necessary],
    ['Optional', t.necessity.optional],
    ['Planned', t.planned.planned],
    ['Unplanned', t.planned.unplanned],
    ['Worth it', t.worth.worth_it],
    ['Would skip', t.worth.would_skip],
    ['Unsure', t.worth.unsure],
  ];
  const used = rows.filter(([, v]) => v !== 0);
  if (!used.length) return null;
  return (
    <Card>
      <H2>Your labels</H2>
      <Muted>Only labels you chose. Nothing is guessed.</Muted>
      {used.map(([k, v]) => (
        <KeyValue key={k} label={k} value={<Money value={v} />} />
      ))}
    </Card>
  );
}
