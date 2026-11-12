import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { formatDateMedium, isLocalDate } from '../domain/dates';
import { spendComponents } from '../domain/ledger';
import { useReady } from '../state/store';
import { EntryRow } from '../ui/EntryRow';
import { Banner, Body, Button, Card, Field, H2, KeyValue, Money, Muted, Screen } from '../ui/kit';
import { useSnackbar } from '../ui/Snackbar';
import { SPACE } from '../ui/theme';

export default function DayReview() {
  const params = useLocalSearchParams<{ date?: string }>();
  const { snapshot, derived, actions } = useReady();
  const snack = useSnackbar();
  const date = params.date && isLocalDate(params.date) ? params.date : derived.today;
  const review = snapshot.dayReviews.find((r) => r.localDate === date);
  const [note, setNote] = useState(review?.note ?? '');
  const entries = snapshot.transactions.filter((t) => t.localDate === date).sort((a, b) => a.occurredAt - b.occurredAt);
  let gross = 0;
  let refunds = 0;
  for (const t of entries) {
    for (const c of spendComponents(t)) {
      if (c.amount > 0) gross += c.amount;
      else refunds -= c.amount;
    }
  }
  const pending = entries.filter((t) => t.state === 'pending' || t.state === 'awaiting_reversal');
  const future = date > derived.today;

  async function mark(status: 'complete' | 'missing' | null) {
    await actions.setDayReview(date, status, note.trim() || null);
    snack({ message: status === 'complete' ? 'Day marked complete' : status === 'missing' ? 'Marked as missing entries' : 'Mark cleared' });
    if (status) router.back();
  }

  return (
    <Screen>
      <H2>{formatDateMedium(date)}</H2>
      <Card>
        <KeyValue label="Purchases (your share)" value={<Money value={gross} />} />
        {refunds ? <KeyValue label="Refunds" value={<Money value={refunds} prefix="− " />} /> : null}
        <KeyValue label="Net recorded" value={<Money value={gross - refunds} style={{ fontWeight: '800' }} />} strong />
        <Muted>
          {review
            ? review.status === 'complete'
              ? '✓ You said this day is complete.'
              : '! You said some entries are missing.'
            : 'Not reviewed yet.'}
        </Muted>
      </Card>
      {pending.length ? <Banner tone="warn" title={`${pending.length} unresolved entr${pending.length === 1 ? 'y' : 'ies'}`} body="Open them below to say what happened." /> : null}

      {entries.length === 0 ? (
        <Card tone="soft">
          <Body>No entries for this day.</Body>
          <Muted>That could mean no spending — or that something wasn't recorded. Only you know which.</Muted>
        </Card>
      ) : (
        <View style={{ borderRadius: 16, overflow: 'hidden' }}>
          {entries.map((t) => (
            <EntryRow key={t.id} t={t} derived={derived} onPress={() => router.push(`/entry/${t.id}`)} />
          ))}
        </View>
      )}

      {!future ? (
        <View style={{ gap: SPACE.sm }}>
          <Button label="Add a missing entry" kind="secondary" onPress={() => router.push({ pathname: '/add', params: { date } })} />
          <Field
            label="Note to yourself (optional)"
            value={note}
            onChangeText={setNote}
            multiline
            maxLength={300}
            help="Stays on this phone. Only included in exports if you export."
          />
          <Button label="Everything's recorded — mark complete" onPress={() => mark('complete')} />
          <Button label="Some entries are missing" kind="secondary" onPress={() => mark('missing')} />
          {review ? <Button label="Clear this day's mark" kind="quiet" onPress={() => mark(null)} /> : null}
        </View>
      ) : (
        <Muted>This day hasn't happened yet.</Muted>
      )}
    </Screen>
  );
}
