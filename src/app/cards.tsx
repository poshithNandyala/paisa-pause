import { router } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { addMonthsClamped, daysInMonth, formatDateShort, makeDate, parts } from '../domain/dates';
import { accountBalance, cardCredit, cardOwed } from '../domain/ledger';
import { useReady } from '../state/store';
import { Banner, Body, Button, Card, EmptyState, H2, KeyValue, Money, Muted, Pill, RowWrap, Screen } from '../ui/kit';
import { SPACE } from '../ui/theme';

/** Next date on `day` of the month, today or later (clamped for short months). */
function nextDayOfMonth(today: string, day: number): string {
  const { y, m, d } = parts(today);
  const thisMonth = makeDate(y, m, Math.min(day, daysInMonth(y, m)));
  if (Math.min(day, daysInMonth(y, m)) >= d) return thisMonth;
  const next = addMonthsClamped(makeDate(y, m, 1), 1, 1);
  const p = parts(next);
  return makeDate(p.y, p.m, Math.min(day, daysInMonth(p.y, p.m)));
}

export default function Cards() {
  const { snapshot, derived } = useReady();
  const credit = snapshot.cards.filter((c) => c.type === 'credit' && !c.archived);
  const debit = snapshot.cards.filter((c) => c.type === 'debit' && !c.archived);

  return (
    <Screen>
      <Muted>
        A card's amount owed is what you've recorded here. A credit limit is never shown as money you can spend.
      </Muted>
      {credit.length === 0 && debit.length === 0 ? (
        <EmptyState
          title="No cards yet"
          body="Add a credit card to track what you owe. Just a nickname — never the card number, CVV or PIN."
          actionLabel="Add a card"
          onAction={() => router.push({ pathname: '/account', params: { kind: 'credit_card' } })}
        />
      ) : null}

      {credit.map((card) => {
        const account = derived.accountsById.get(card.accountId);
        if (!account) return null;
        const bal = accountBalance(account, snapshot.transactions);
        const owed = cardOwed(bal);
        const creditAmt = cardCredit(bal);
        return (
          <Card key={card.id}>
            <H2>{card.nickname}</H2>
            <Pill text="Credit card" />
            {creditAmt > 0 ? (
              <>
                <KeyValue label="Card credit" value={<Money value={creditAmt} style={{ fontWeight: '800' }} />} strong />
                <Muted>From an overpayment or refund. It's not cash unless the bank sends it back to your account.</Muted>
              </>
            ) : (
              <KeyValue label="Recorded amount owed" value={<Money value={owed} style={{ fontWeight: '800' }} />} strong />
            )}
            {!bal.known ? <Muted>No starting amount entered — this only counts what you've recorded since.</Muted> : null}
            {card.statementDay ? <KeyValue label="Statement" value={`${formatDateShort(nextDayOfMonth(derived.today, card.statementDay))}`} /> : null}
            {card.dueDay ? <KeyValue label="Payment due" value={`${formatDateShort(nextDayOfMonth(derived.today, card.dueDay))}`} /> : null}
            {bal.unresolvedCount ? (
              <Banner tone="warn" title={`${bal.unresolvedCount} unresolved payment${bal.unresolvedCount === 1 ? '' : 's'} on this card`} />
            ) : null}
            <RowWrap style={{ marginTop: SPACE.xs }}>
              <Button
                label="Purchase"
                compact
                onPress={() => router.push({ pathname: '/add', params: { fromAccountId: account.id, cardId: card.id } })}
              />
              <Button
                label="Pay the card"
                kind="secondary"
                compact
                onPress={() => router.push({ pathname: '/move', params: { kind: 'repayment', to: account.id } })}
              />
              <Button
                label="Refund"
                kind="secondary"
                compact
                hint="Pick the purchase that was refunded"
                onPress={() => router.push({ pathname: '/activity', params: { account: account.id } })}
              />
              <Button
                label="Fee or interest"
                kind="quiet"
                compact
                onPress={() =>
                  router.push({
                    pathname: '/add',
                    params: { fromAccountId: account.id, cardId: card.id, categoryId: 'other', purpose: 'Card fee / interest' },
                  })
                }
              />
              <Button label="Edit" kind="quiet" compact onPress={() => router.push({ pathname: '/account', params: { cardId: card.id } })} />
            </RowWrap>
          </Card>
        );
      })}

      {debit.map((card) => (
        <Card key={card.id}>
          <H2>{card.nickname}</H2>
          <Pill text="Debit card" />
          <Body>Uses {derived.accountsById.get(card.accountId)?.nickname ?? 'its bank account'} — no separate balance.</Body>
          <RowWrap>
            <Button
              label="Purchase"
              compact
              onPress={() => router.push({ pathname: '/add', params: { fromAccountId: card.accountId, cardId: card.id } })}
            />
            <Button label="Edit" kind="quiet" compact onPress={() => router.push({ pathname: '/account', params: { cardId: card.id } })} />
          </RowWrap>
        </Card>
      ))}

      <View style={{ gap: SPACE.sm }}>
        <Button label="Add a credit card" kind="secondary" onPress={() => router.push({ pathname: '/account', params: { kind: 'credit_card' } })} />
        <Button label="Add a debit card" kind="secondary" onPress={() => router.push({ pathname: '/account', params: { kind: 'debit_card' } })} />
      </View>
    </Screen>
  );
}
