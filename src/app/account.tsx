import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { parseRupeesToPaise } from '../domain/money';
import type { Account, Card as CardRecord } from '../domain/types';
import { useReady } from '../state/store';
import { Button, Chip, ErrorText, Field, Label, Muted, RowWrap, Screen, Segmented, ToggleRow } from '../ui/kit';
import { useSnackbar } from '../ui/Snackbar';
import { SPACE } from '../ui/theme';

type Kind = 'bank' | 'cash' | 'wallet' | 'credit_card' | 'debit_card';

function toText(paise: number | null): string {
  if (paise === null) return '';
  const neg = paise < 0;
  const abs = Math.abs(paise);
  const r = Math.floor(abs / 100);
  const p = abs % 100;
  return `${neg ? '-' : ''}${p ? `${r}.${String(p).padStart(2, '0')}` : r}`;
}

/** Card numbers are never stored. Block anything that looks like one. */
function looksLikeCardNumber(text: string): boolean {
  return (text.match(/\d/g) ?? []).length >= 12;
}

function parseSigned(text: string): number | null | 'invalid' {
  const t = text.trim();
  if (t === '') return null;
  const neg = t.startsWith('-');
  const p = parseRupeesToPaise(t.replace('-', ''));
  if (p === null) return 'invalid';
  return neg ? -p : p;
}

function parseDay(text: string): number | null | 'invalid' {
  if (!text.trim()) return null;
  const n = Number(text);
  return Number.isInteger(n) && n >= 1 && n <= 31 ? n : 'invalid';
}

export default function AccountEditor() {
  const params = useLocalSearchParams<{ id?: string; cardId?: string; kind?: Kind }>();
  const { snapshot, actions } = useReady();
  const snack = useSnackbar();
  const existingCard = params.cardId ? snapshot.cards.find((c) => c.id === params.cardId) : undefined;
  const existingAccount = params.id
    ? snapshot.accounts.find((a) => a.id === params.id)
    : existingCard?.type === 'credit'
      ? snapshot.accounts.find((a) => a.id === existingCard.accountId)
      : undefined;
  const initialKind: Kind = existingCard ? (existingCard.type === 'credit' ? 'credit_card' : 'debit_card') : (existingAccount?.kind ?? params.kind ?? 'bank');

  const [kind, setKind] = useState<Kind>(initialKind);
  const [nickname, setNickname] = useState(existingCard?.nickname ?? existingAccount?.nickname ?? '');
  const [opening, setOpening] = useState(toText(existingAccount?.openingBalance ?? null));
  const [include, setInclude] = useState(existingAccount?.includeInLiquid ?? true);
  const [savings, setSavings] = useState(existingAccount?.isSavings ?? false);
  const [statementDay, setStatementDay] = useState(existingCard?.statementDay ? String(existingCard.statementDay) : '');
  const [dueDay, setDueDay] = useState(existingCard?.dueDay ? String(existingCard.dueDay) : '');
  const banks = snapshot.accounts.filter((a) => a.kind === 'bank' && !a.archived);
  const [linkedBank, setLinkedBank] = useState<string | null>(existingCard?.type === 'debit' ? existingCard.accountId : (banks[0]?.id ?? null));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isNew = !existingAccount && !existingCard;

  async function save() {
    setError(null);
    const name = nickname.trim();
    if (!name) return setError('Give it a nickname, like "SBI salary" or "Wallet".');
    if (looksLikeCardNumber(name)) return setError("That looks like a card or account number. Use a nickname instead — numbers are never stored.");
    const now = Date.now();
    setBusy(true);
    try {
      if (kind === 'debit_card') {
        if (!linkedBank) throw new Error('Add the bank account this debit card uses first.');
        const card: CardRecord = {
          id: existingCard?.id ?? actions.newId(),
          type: 'debit',
          nickname: name,
          accountId: linkedBank,
          statementDay: null,
          dueDay: null,
          archived: existingCard?.archived ?? false,
          createdAt: existingCard?.createdAt ?? now,
          updatedAt: now,
        };
        await actions.saveCard(card);
      } else {
        const openingValue = parseSigned(opening);
        if (openingValue === 'invalid') throw new Error('Starting amount should look like 12500 or 12500.50');
        const sDay = parseDay(statementDay);
        const dDay = parseDay(dueDay);
        if (sDay === 'invalid' || dDay === 'invalid') throw new Error('Days must be between 1 and 31.');
        const account: Account = {
          id: existingAccount?.id ?? actions.newId(),
          kind: kind,
          nickname: name,
          currency: 'INR',
          openingBalance: openingValue,
          // A new starting balance is "as of now"; editing keeps the original snapshot time.
          openingAt: existingAccount && existingAccount.openingBalance === openingValue ? existingAccount.openingAt : now,
          includeInLiquid: kind === 'credit_card' ? false : include,
          isSavings: kind === 'bank' ? savings : false,
          archived: existingAccount?.archived ?? false,
          createdAt: existingAccount?.createdAt ?? now,
          updatedAt: now,
        };
        if (kind === 'credit_card') {
          const card: CardRecord = {
            id: existingCard?.id ?? actions.newId(),
            type: 'credit',
            nickname: name,
            accountId: account.id,
            statementDay: sDay,
            dueDay: dDay,
            archived: existingCard?.archived ?? false,
            createdAt: existingCard?.createdAt ?? now,
            updatedAt: now,
          };
          await actions.saveCard(card, account);
        } else {
          await actions.saveAccount(account);
        }
      }
      router.back();
      snack({ message: isNew ? 'Added' : 'Saved' });
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Screen footer={<View style={{ gap: SPACE.sm }}><ErrorText>{error}</ErrorText><Button label={isNew ? 'Add' : 'Save'} onPress={save} busy={busy} /></View>}>
      {isNew ? (
        <Segmented
          label="Type"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'bank', label: 'Bank' },
            { value: 'cash', label: 'Cash' },
            { value: 'wallet', label: 'Wallet' },
            { value: 'credit_card', label: 'Credit card' },
            { value: 'debit_card', label: 'Debit card' },
          ]}
        />
      ) : null}
      <Field
        label="Nickname"
        value={nickname}
        onChangeText={setNickname}
        maxLength={40}
        placeholder={kind === 'credit_card' ? 'e.g. Rewards card' : kind === 'debit_card' ? 'e.g. SBI debit' : 'e.g. SBI salary'}
        help="Only a nickname. Never a card number, CVV, PIN or login."
      />

      {kind === 'debit_card' ? (
        <View style={{ gap: SPACE.xs }}>
          <Label>Uses which bank account?</Label>
          {banks.length === 0 ? <Muted>Add the bank account first. A debit card spends from it — it has no balance of its own.</Muted> : null}
          <RowWrap>
            {banks.map((b) => (
              <Chip key={b.id} label={b.nickname} selected={linkedBank === b.id} onPress={() => setLinkedBank(b.id)} />
            ))}
          </RowWrap>
        </View>
      ) : (
        <>
          <Field
            label={kind === 'credit_card' ? 'Amount you owe right now (₹, optional)' : 'Balance right now (₹, optional)'}
            value={opening}
            onChangeText={setOpening}
            keyboardType="numbers-and-punctuation"
            help={
              kind === 'credit_card'
                ? 'Leave empty if unsure. Your credit limit is not needed and is never counted as money.'
                : 'Leave empty to skip. Entries before now are treated as already included in this number.'
            }
          />
          {kind === 'credit_card' ? (
            <>
              <Field label="Statement day of month (optional)" value={statementDay} onChangeText={setStatementDay} keyboardType="number-pad" maxLength={2} />
              <Field label="Payment due day of month (optional)" value={dueDay} onChangeText={setDueDay} keyboardType="number-pad" maxLength={2} />
            </>
          ) : (
            <>
              <ToggleRow
                label="Count it in available money"
                description="Turn off for money you don't want to spend from, like savings."
                value={include}
                onChange={setInclude}
              />
              {kind === 'bank' ? (
                <ToggleRow
                  label="This is a savings account"
                  description="Moving money here counts as saving, not spending."
                  value={savings}
                  onChange={(v) => {
                    setSavings(v);
                    if (v) setInclude(false);
                  }}
                />
              ) : null}
            </>
          )}
        </>
      )}
    </Screen>
  );
}
