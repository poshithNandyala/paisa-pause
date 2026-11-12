import { router } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { accountBalance, cardCredit, cardOwed } from '../domain/ledger';
import { formatPaise, parseRupeesToPaise } from '../domain/money';
import type { Account } from '../domain/types';
import { useReady } from '../state/store';
import { Body, Button, Card, Divider, EmptyState, ErrorText, Field, H2, KeyValue, LinkRow, Money, Muted, Pill, RowWrap, Screen } from '../ui/kit';
import { useSnackbar } from '../ui/Snackbar';
import { SPACE } from '../ui/theme';

const KIND_LABEL: Record<Account['kind'], string> = { bank: 'Bank', cash: 'Cash', wallet: 'Wallet', credit_card: 'Credit card' };

export default function Accounts() {
  const { snapshot } = useReady();
  const [showArchived, setShowArchived] = useState(false);
  const active = snapshot.accounts.filter((a) => !a.archived);
  const archived = snapshot.accounts.filter((a) => a.archived);
  const debit = snapshot.cards.filter((c) => c.type === 'debit');
  return (
    <Screen>
      <Muted>
        Optional. Without accounts the app still tracks your plan. With them, you get balances and an estimate of what's available.
      </Muted>
      {active.length === 0 ? (
        <EmptyState title="No accounts yet" body="Add the places your money is: a bank account, cash, a wallet, or a credit card." />
      ) : null}
      {active.map((a) => (
        <AccountCard key={a.id} account={a} />
      ))}
      {debit.length ? (
        <Card>
          <H2>Debit cards</H2>
          {debit.map((c) => (
            <View key={c.id} style={{ gap: SPACE.xs }}>
              <KeyValue label={c.nickname} value={`uses ${snapshot.accounts.find((a) => a.id === c.accountId)?.nickname ?? '?'}`} />
              <Button label="Edit" kind="quiet" compact onPress={() => router.push({ pathname: '/account', params: { cardId: c.id } })} />
            </View>
          ))}
        </Card>
      ) : null}
      <Card>
        <LinkRow label="Cards page" detail="What you owe on each card, repay, refunds, fees" onPress={() => router.push('/cards')} />
      </Card>
      <Card>
        <H2>Add</H2>
        <RowWrap>
          {(['bank', 'cash', 'wallet', 'credit_card', 'debit_card'] as const).map((k) => (
            <Button
              key={k}
              label={k === 'credit_card' ? 'Credit card' : k === 'debit_card' ? 'Debit card' : KIND_LABEL[k]}
              kind="secondary"
              compact
              onPress={() => router.push({ pathname: '/account', params: { kind: k } })}
            />
          ))}
        </RowWrap>
        <Muted>Nicknames only. Never enter a card number, CVV, PIN or bank login.</Muted>
      </Card>
      {archived.length ? (
        <Button label={showArchived ? 'Hide archived' : `Show archived (${archived.length})`} kind="quiet" onPress={() => setShowArchived(!showArchived)} />
      ) : null}
      {showArchived ? archived.map((a) => <AccountCard key={a.id} account={a} />) : null}
    </Screen>
  );
}

function AccountCard({ account }: { account: Account }) {
  const { snapshot, actions } = useReady();
  const snack = useSnackbar();
  const [checking, setChecking] = useState(false);
  const [actual, setActual] = useState('');
  const [error, setError] = useState<string | null>(null);
  const bal = accountBalance(account, snapshot.transactions);
  const isCard = account.kind === 'credit_card';

  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: SPACE.md }}>
        <Body style={{ fontWeight: '700', flex: 1 }}>{account.nickname}</Body>
        {isCard ? (
          cardCredit(bal) > 0 ? (
            <Money value={cardCredit(bal)} prefix="credit " />
          ) : (
            <Money value={cardOwed(bal)} prefix="owed " />
          )
        ) : (
          <Money value={bal.value} style={{ fontWeight: '700' }} />
        )}
      </View>
      <RowWrap>
        <Pill text={KIND_LABEL[account.kind]} />
        {!isCard ? <Pill text={account.includeInLiquid ? 'In available money' : 'Left out of available money'} /> : null}
        {account.isSavings ? <Pill text="Savings" tone="good" /> : null}
        {account.archived ? <Pill text="Archived" /> : null}
        {!bal.known ? <Pill text="No starting balance" tone="warn" /> : null}
        {bal.unresolvedCount ? <Pill text={`${bal.unresolvedCount} unresolved`} tone="warn" /> : null}
      </RowWrap>
      {checking ? (
        <View style={{ gap: SPACE.sm }}>
          <Field
            label={isCard ? 'Amount you owe right now (₹)' : 'Balance right now (₹)'}
            value={actual}
            onChangeText={setActual}
            keyboardType="numbers-and-punctuation"
            help="We'll add one 'Balance check' entry for any difference. It's never counted as income or spending."
          />
          <ErrorText>{error}</ErrorText>
          <RowWrap>
            <Button
              label="Save balance"
              compact
              onPress={async () => {
                setError(null);
                const neg = actual.trim().startsWith('-');
                const p = parseRupeesToPaise(actual.replace('-', ''));
                if (p === null) return setError('Enter an amount like 12500 or 12500.50');
                const value = neg ? -p : p;
                const before = isCard ? cardOwed(bal) - cardCredit(bal) : bal.value;
                const changed = await actions.reconcile(account, value);
                setChecking(false);
                setActual('');
                snack({ message: changed ? `Adjusted by ${formatPaise(value - before)}` : 'Already matched — nothing to change' });
              }}
            />
            <Button label="Cancel" kind="quiet" compact onPress={() => setChecking(false)} />
          </RowWrap>
        </View>
      ) : (
        <RowWrap>
          {!account.archived ? <Button label="Check balance" kind="secondary" compact onPress={() => setChecking(true)} /> : null}
          <Button
            label="Edit"
            kind="quiet"
            compact
            onPress={() => {
              const card = snapshot.cards.find((c) => c.accountId === account.id && c.type === 'credit');
              router.push({ pathname: '/account', params: card ? { cardId: card.id } : { id: account.id } });
            }}
          />
          <Button
            label={account.archived ? 'Unarchive' : 'Archive'}
            kind="quiet"
            compact
            hint="Archived accounts keep their history but are hidden from pickers"
            onPress={() => actions.saveAccount({ ...account, archived: !account.archived })}
          />
        </RowWrap>
      )}
      <Divider />
      <Muted>
        Starting balance{account.openingBalance === null ? ' not entered' : ` ${formatPaise(account.openingBalance)}`}. Entries before the
        start time aren't applied again.
      </Muted>
    </Card>
  );
}
