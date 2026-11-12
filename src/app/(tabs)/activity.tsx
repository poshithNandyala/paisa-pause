import { router, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { SectionList, Text, View } from 'react-native';
import { periodRangeFor } from '../../domain/budget';
import { addDays, formatDateShort, startOfMonth } from '../../domain/dates';
import { spendComponents } from '../../domain/ledger';
import { formatPaise } from '../../domain/money';
import type { Transaction } from '../../domain/types';
import { useReady } from '../../state/store';
import { EntryRow } from '../../ui/EntryRow';
import { Button, Chip, EmptyState, Field, Label, Muted, RowWrap, SampleBanner } from '../../ui/kit';
import { SPACE, usePalette } from '../../ui/theme';

type Span = 'week' | 'month' | '90' | 'all';
type KindFilter = 'all' | 'purchases' | 'refunds' | 'moves';

export default function Activity() {
  const params = useLocalSearchParams<{ filter?: string; ids?: string; account?: string }>();
  const { snapshot, derived } = useReady();
  const c = usePalette();
  const [query, setQuery] = useState('');
  const [span, setSpan] = useState<Span>('all');
  const [kind, setKind] = useState<KindFilter>('all');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(params.account ?? null);
  const [onlyIncomplete, setOnlyIncomplete] = useState(params.filter === 'incomplete');
  const [idFilter, setIdFilter] = useState<string[] | null>(params.ids ? params.ids.split(',') : null);
  const [showFilters, setShowFilters] = useState(false);

  // Re-apply filters when this tab is opened again with new params.
  const paramKey = `${params.filter ?? ''}|${params.ids ?? ''}|${params.account ?? ''}`;
  const [seenParamKey, setSeenParamKey] = useState(paramKey);
  if (paramKey !== seenParamKey) {
    setSeenParamKey(paramKey);
    if (params.filter === 'incomplete') setOnlyIncomplete(true);
    if (params.ids) setIdFilter(params.ids.split(','));
    if (params.account) {
      setAccountId(params.account);
      setShowFilters(true);
    }
  }

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const incompleteIds = new Set(derived.incomplete.map((t) => t.id));
    const from =
      span === 'week'
        ? periodRangeFor(derived.today, 'weekly', snapshot.settings.weekStartsOn, 1).start
        : span === 'month'
          ? startOfMonth(derived.today)
          : span === '90'
            ? addDays(derived.today, -89)
            : '0000-01-01';
    const list = snapshot.transactions.filter((t) => {
      if (idFilter && !idFilter.includes(t.id)) return false;
      if (onlyIncomplete && !incompleteIds.has(t.id)) return false;
      if (t.localDate < from) return false;
      if (kind === 'purchases' && t.kind !== 'expense') return false;
      if (kind === 'refunds' && t.kind !== 'refund') return false;
      if (kind === 'moves' && (t.kind === 'expense' || t.kind === 'refund')) return false;
      if (categoryId && !t.allocations.some((a) => a.categoryId === categoryId)) return false;
      if (accountId && t.fromAccountId !== accountId && t.toAccountId !== accountId) return false;
      if (q) {
        const hay = [
          t.purpose,
          t.payee,
          t.note,
          t.paymentApp,
          ...t.allocations.map((a) => derived.categoryName(a.categoryId)),
          formatPaise(t.amount),
          String(t.amount / 100),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const byDate = new Map<string, Transaction[]>();
    for (const t of list) {
      const arr = byDate.get(t.localDate) ?? [];
      arr.push(t);
      byDate.set(t.localDate, arr);
    }
    return [...byDate.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([date, data]) => {
        const net = data.reduce((s, t) => s + spendComponents(t).reduce((x, y) => x + y.amount, 0), 0);
        return { title: date, net, data: data.sort((a, b) => b.occurredAt - a.occurredAt) };
      });
  }, [snapshot, derived, query, span, kind, categoryId, accountId, onlyIncomplete, idFilter]);

  const usedCategories = useMemo(() => {
    const ids = new Set<string>();
    snapshot.transactions.forEach((t) => t.allocations.forEach((a) => ids.add(a.categoryId)));
    return [...ids];
  }, [snapshot.transactions]);

  const header = (
    <View style={{ padding: SPACE.lg, gap: SPACE.md }}>
      <Field label="Search" value={query} onChangeText={setQuery} placeholder="Purpose, category, amount…" returnKeyType="search" />
      {idFilter || onlyIncomplete ? (
        <RowWrap>
          <Chip
            label={idFilter ? `Showing ${idFilter.length} picked entries · Clear` : 'Needs a look · Clear'}
            selected
            role="button"
            onPress={() => {
              setIdFilter(null);
              setOnlyIncomplete(false);
              router.setParams({ filter: undefined, ids: undefined });
            }}
          />
        </RowWrap>
      ) : null}
      <RowWrap>
        {(
          [
            ['all', 'All time'],
            ['week', 'This week'],
            ['month', 'This month'],
            ['90', 'Last 90 days'],
          ] as [Span, string][]
        ).map(([v, l]) => (
          <Chip key={v} label={l} selected={span === v} onPress={() => setSpan(v)} />
        ))}
      </RowWrap>
      <Button label={showFilters ? 'Hide filters' : 'More filters'} kind="quiet" compact onPress={() => setShowFilters(!showFilters)} />
      {showFilters ? (
        <View style={{ gap: SPACE.md }}>
          <Label>Type</Label>
          <RowWrap>
            {(
              [
                ['all', 'Everything'],
                ['purchases', 'Purchases'],
                ['refunds', 'Refunds'],
                ['moves', 'Transfers & income'],
              ] as [KindFilter, string][]
            ).map(([v, l]) => (
              <Chip key={v} label={l} selected={kind === v} onPress={() => setKind(v)} />
            ))}
          </RowWrap>
          <Label>Category</Label>
          <RowWrap>
            <Chip label="Any" selected={!categoryId} onPress={() => setCategoryId(null)} />
            {usedCategories.map((id) => (
              <Chip key={id} label={derived.categoryName(id)} selected={categoryId === id} onPress={() => setCategoryId(id)} />
            ))}
          </RowWrap>
          {snapshot.accounts.length ? (
            <>
              <Label>Account</Label>
              <RowWrap>
                <Chip label="Any" selected={!accountId} onPress={() => setAccountId(null)} />
                {snapshot.accounts.map((a) => (
                  <Chip key={a.id} label={a.nickname} selected={accountId === a.id} onPress={() => setAccountId(a.id)} />
                ))}
              </RowWrap>
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <SampleBanner />
      <SectionList
        sections={sections}
        keyExtractor={(t) => t.id}
        ListHeaderComponent={header}
        stickySectionHeadersEnabled={false}
        keyboardShouldPersistTaps="handled"
        renderSectionHeader={({ section }) => (
          <View
            accessibilityRole="header"
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              paddingHorizontal: SPACE.lg,
              paddingTop: SPACE.lg,
              paddingBottom: SPACE.xs,
            }}
          >
            <Text style={{ color: c.text, fontWeight: '700', fontSize: 15 }}>{formatDateShort(section.title)}</Text>
            <Text style={{ color: c.muted, fontSize: 14 }}>
              {snapshot.settings.hideAmounts ? '' : `net ${formatPaise(section.net)}`}
            </Text>
          </View>
        )}
        renderItem={({ item }) => <EntryRow t={item} derived={derived} onPress={() => router.push(`/entry/${item.id}`)} />}
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: c.border, marginLeft: SPACE.lg }} />}
        ListEmptyComponent={
          <View style={{ paddingHorizontal: SPACE.lg }}>
            {snapshot.transactions.length === 0 ? (
              <EmptyState
                title="No entries yet"
                body="Add your first expense from Today. Everything stays on this phone."
                actionLabel="Add expense"
                onAction={() => router.push('/add')}
              />
            ) : (
              <EmptyState title="Nothing matches" body="Try a different search or filter." />
            )}
          </View>
        }
        ListFooterComponent={
          <View style={{ padding: SPACE.lg }}>
            <Muted>All amounts are exact and recorded by you. Tap an entry to edit, refund, split or delete it.</Muted>
          </View>
        }
      />
    </View>
  );
}
