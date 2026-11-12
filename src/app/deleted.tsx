import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { formatDateMedium, localDateOf } from '../domain/dates';
import type { Transaction } from '../domain/types';
import { useReady } from '../state/store';
import { entryTitle } from '../ui/EntryRow';
import { Body, Button, Card, EmptyState, Money, Muted, Screen } from '../ui/kit';
import { useSnackbar } from '../ui/Snackbar';
import { SPACE } from '../ui/theme';

/**
 * Deleted entries leave every total immediately. They're kept here for 30
 * days so a mistake can be undone, then erased for good. "Delete all my data"
 * erases them at once.
 */
export default function RecentlyDeleted() {
  const { derived, actions, snapshot } = useReady();
  const snack = useSnackbar();
  const [list, setList] = useState<Transaction[] | null>(null);
  const load = useCallback(async () => setList(await actions.loadDeleted()), [actions]);
  useEffect(() => {
    let cancelled = false;
    actions.loadDeleted().then((rows) => {
      if (!cancelled) setList(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [actions, snapshot]);

  const batches = new Map<string, Transaction[]>();
  for (const t of list ?? []) {
    const key = t.deleteBatchId ?? t.id;
    batches.set(key, [...(batches.get(key) ?? []), t]);
  }

  return (
    <Screen>
      <Muted>Deleted entries don't count anywhere. They're erased for good 30 days after deletion.</Muted>
      {list && list.length === 0 ? <EmptyState title="Nothing deleted" body="Entries you delete show up here for 30 days." /> : null}
      {[...batches.entries()].map(([batchId, items]) => (
        <Card key={batchId}>
          {items.map((t) => (
            <View key={t.id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: SPACE.md }}>
              <Body style={{ flex: 1 }}>
                {entryTitle(t, derived)} · {formatDateMedium(t.localDate)}
              </Body>
              <Money value={t.amount} />
            </View>
          ))}
          <Muted>Deleted {items[0].deletedAt ? formatDateMedium(localDateOf(items[0].deletedAt, snapshot.settings.timezone)) : ''}</Muted>
          <Button
            label={items.length > 1 ? `Restore these ${items.length}` : 'Restore'}
            kind="secondary"
            compact
            onPress={async () => {
              await actions.undoRemove(batchId);
              await load();
              snack({ message: 'Restored' });
            }}
          />
        </Card>
      ))}
    </Screen>
  );
}
