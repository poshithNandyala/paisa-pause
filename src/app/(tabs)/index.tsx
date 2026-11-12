import { router } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { formatDateShort, formatRange } from '../../domain/dates';
import { repeatTemplates } from '../../domain/entries';
import { formatPaise } from '../../domain/money';
import { useReady } from '../../state/store';
import {
  Banner,
  Bar,
  Body,
  Button,
  Card,
  Chip,
  Divider,
  EmptyState,
  H2,
  KeyValue,
  Label,
  LinkRow,
  Money,
  Muted,
  RowWrap,
  Screen,
} from '../../ui/kit';
import { AnimatedMoney } from '../../ui/motion';
import { SPACE, usePalette } from '../../ui/theme';

export default function Today() {
  const { snapshot, derived } = useReady();
  const c = usePalette();
  const s = snapshot.settings;
  const b = derived.budget;
  const templates = repeatTemplates(snapshot.transactions, derived.today);
  const owed = derived.receivables.reduce((sum, r) => sum + r.outstanding, 0);

  return (
    <Screen>
      <Muted>{formatDateShort(derived.today)}</Muted>

      {b ? (
        <Card>
          <Label>MONEY LEFT IN YOUR PLAN</Label>
          <AnimatedMoney
            value={b.remaining}
            style={{ color: b.remaining < 0 ? c.amber : c.text, fontSize: 40, fontWeight: '800', fontVariant: ['tabular-nums'] }}
          />
          {b.remaining < 0 ? (
            <Body style={{ color: c.amber, fontWeight: '700' }}>Over plan by {formatPaise(-b.remaining)}</Body>
          ) : null}
          <Muted>
            {b.daysLeft > 0
              ? `Until ${formatDateShort(b.period.endDate)} · ${b.daysLeft} day${b.daysLeft === 1 ? '' : 's'} left`
              : `Period ended ${formatDateShort(b.period.endDate)}`}
          </Muted>
          {b.perDay !== null && b.remaining > 0 ? (
            <Body>
              About <Money value={b.perDay} style={{ fontWeight: '700' }} /> a day
            </Body>
          ) : null}
          {s.visualMode === 'envelope' ? (
            <View style={{ gap: SPACE.xs, marginTop: SPACE.xs }}>
              <Bar
                used={b.netSpent + b.holdsTotal}
                total={b.allocation + b.reallocated}
                label={`Used ${formatPaise(b.netSpent + b.holdsTotal)} of ${formatPaise(b.allocation + b.reallocated)}`}
              />
              <Muted>
                Spent {formatPaise(b.netSpent)}
                {b.holdsTotal ? ` · set aside ${formatPaise(b.holdsTotal)}` : ''} of {formatPaise(b.allocation + b.reallocated)}
              </Muted>
            </View>
          ) : null}
          {b.pendingCount > 0 ? (
            <Muted style={{ color: c.amber }}>
              ⏳ {formatPaise(b.pendingAmount)} pending — not included until you confirm it.
            </Muted>
          ) : null}
          {s.mode === 'budget_only' ? (
            <Muted>This is your plan, not your bank balance.</Muted>
          ) : null}
          {b.period.autoCreated ? (
            <Banner
              title={`New period started: ${formatRange(b.period.startDate, b.period.endDate)}`}
              body={`Using ${formatPaise(b.allocation)}, the same as before.`}
              actionLabel="Change plan amount"
              onAction={() => router.push('/plan-amount')}
            />
          ) : null}
        </Card>
      ) : (
        <EmptyState
          title="Set your flexible money"
          body="How much can you spend freely until your period ends? This is a plan, not your bank balance."
          actionLabel="Set plan amount"
          onAction={() => router.push('/plan-amount')}
        />
      )}

      {s.mode === 'account_aware' && derived.availability ? <AvailabilityCard /> : null}

      {derived.kept.count > 0 ? (
        <Card tone="soft">
          <Label>KEPT BY PAUSING</Label>
          <Money value={derived.kept.kept} style={{ fontSize: 26, fontWeight: '800' }} />
          <Muted>
            {derived.kept.count} optional purchase{derived.kept.count === 1 ? '' : 's'} you decided against since{' '}
            {formatDateShort(derived.keptRange.start)}. Nothing was spent, so it stays in your plan.
          </Muted>
          {derived.kept.waitingCount > 0 ? (
            <Muted>
              {formatPaise(derived.kept.waiting)} more is still paused, not spent, on {derived.kept.waitingCount} item
              {derived.kept.waitingCount === 1 ? '' : 's'}.
            </Muted>
          ) : null}
          <Button label="Open waiting list" kind="quiet" compact onPress={() => router.push('/waiting')} />
        </Card>
      ) : null}

      <View style={{ gap: SPACE.sm }}>
        <Button label="Add expense" onPress={() => router.push('/add')} hint="Opens the amount keypad" />
        <Button label="Before I buy" kind="secondary" onPress={() => router.push('/buy')} hint="Preview a purchase without recording it" />
      </View>

      {templates.length ? (
        <View style={{ gap: SPACE.xs }}>
          <Label>REPEAT A RECENT ONE</Label>
          <RowWrap>
            {templates.map((t) => (
              <Chip
                key={t.key}
                role="button"
                label={`${formatPaise(t.amount)} ${t.purpose ?? derived.categoryName(t.categoryId)}`}
                onPress={() => router.push({ pathname: '/add', params: { template: t.key } })}
              />
            ))}
          </RowWrap>
        </View>
      ) : null}

      <Card>
        <KeyValue label="Recorded today" value={<Money value={derived.todayNet} style={{ fontWeight: '700' }} />} />
        <Muted>
          {derived.todayCount === 0
            ? 'Nothing recorded today yet. No entries doesn’t prove zero spending.'
            : `${derived.todayCount} entr${derived.todayCount === 1 ? 'y' : 'ies'}, recorded by you (not bank-verified).`}
        </Muted>
        {derived.incomplete.length > 0 ? (
          <Banner
            tone="warn"
            title={`${derived.incomplete.length} entr${derived.incomplete.length === 1 ? 'y needs' : 'ies need'} a look`}
            body="Pending, waiting for a reversal, or missing a category."
            actionLabel="Show them"
            onAction={() => router.push({ pathname: '/activity', params: { filter: 'incomplete' } })}
          />
        ) : null}
        {derived.reviewDue ? (
          <Banner
            title="Time for today's review"
            body="Check today's entries and mark the day complete or missing something."
            actionLabel="Review today"
            onAction={() => router.push({ pathname: '/day', params: { date: derived.today } })}
          />
        ) : null}
      </Card>

      {derived.reconsiderReady.length > 0 ? (
        <Banner
          title={`${derived.reconsiderReady.length} waiting item${derived.reconsiderReady.length === 1 ? ' is' : 's are'} ready to look at again`}
          body="No rush. Decide when it suits you."
          actionLabel="Open waiting list"
          onAction={() => router.push('/waiting')}
        />
      ) : null}

      {owed > 0 ? (
        <Card tone="soft">
          <KeyValue label="Others owe you" value={<Money value={owed} />} />
          <Muted>From shared purchases. Not counted as money you have until it's paid back.</Muted>
        </Card>
      ) : null}

      <Card>
        <H2>More</H2>
        <LinkRow
          label="Waiting list"
          detail={derived.waiting.length ? `${derived.waiting.length} item${derived.waiting.length === 1 ? '' : 's'}` : 'Nothing waiting'}
          onPress={() => router.push('/waiting')}
        />
        <Divider />
        <LinkRow label="Cards" detail="What you owe on each card" onPress={() => router.push('/cards')} />
        <Divider />
        <LinkRow label="Accounts & cards" detail="Balances, reconcile, add or archive" onPress={() => router.push('/accounts')} />
        <Divider />
        <LinkRow label="Move money" detail="Card repayment, transfer, income, paid back" onPress={() => router.push('/move')} />
        <Divider />
        <LinkRow label="Settings" onPress={() => router.push('/settings')} />
      </Card>
    </Screen>
  );
}

function AvailabilityCard() {
  const { derived } = useReady();
  const [open, setOpen] = useState(false);
  const a = derived.availability!;
  const c = usePalette();
  return (
    <Card tone="soft">
      <Label>ESTIMATED AVAILABLE (ACCOUNTS)</Label>
      {a.status === 'no_accounts' ? (
        <>
          <Body>Add a bank, cash or wallet account to see an estimate.</Body>
          <Button label="Add an account" kind="secondary" compact onPress={() => router.push('/account')} />
        </>
      ) : a.status === 'unresolved' ? (
        <>
          <Body style={{ color: c.amber, fontWeight: '700' }}>Estimate paused until a few things are sorted</Body>
          {a.reasons.map((r) => (
            <Muted key={r}>• {r}</Muted>
          ))}
        </>
      ) : (
        <>
          <Money value={a.availableWithinPlan} style={{ fontSize: 28, fontWeight: '800' }} />
          <Muted>An estimate from the balances you entered — not a guarantee.</Muted>
        </>
      )}
      {a.status !== 'no_accounts' ? (
        <Button label={open ? 'Hide how this is worked out' : 'How is this worked out?'} kind="quiet" compact onPress={() => setOpen(!open)} />
      ) : null}
      {open ? (
        <View style={{ gap: SPACE.xs }}>
          {a.liquidAccounts.map((b) => (
            <KeyValue key={b.account.id} label={`${b.account.nickname}${b.known ? '' : ' (no start balance)'}`} value={<Money value={b.value} />} />
          ))}
          <KeyValue label="Included money" value={<Money value={a.includedLiquid} />} strong />
          {a.protectedItems.map((p, i) => (
            <KeyValue key={`${p.label}${i}`} label={`− ${p.label} (${p.detail})`} value={<Money value={p.amount} />} />
          ))}
          <KeyValue label="Money free after protections" value={<Money value={a.liquidCapacity} />} strong />
          {a.planRemaining !== null ? <KeyValue label="Your plan has left" value={<Money value={a.planRemaining} />} /> : null}
          <Muted>
            Shown: the smaller of the two. Never counted: credit limits, expected salary, money others owe you, card credit,
            and accounts you excluded (like savings).
          </Muted>
        </View>
      ) : null}
    </Card>
  );
}
