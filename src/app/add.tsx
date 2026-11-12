import { router, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { epochFromLocal, isLocalDate, localTimeOf, parseTimeHHMM } from '../domain/dates';
import { makeEntry, repeatTemplates } from '../domain/entries';
import { formatPaise, parseRupeesToPaise } from '../domain/money';
import type { AccountingState, BudgetBucket, CategoryAllocation, Tags, Transaction } from '../domain/types';
import { DEFAULT_TAGS, UNCATEGORIZED_ID } from '../domain/types';
import { ValidationError } from '../data/operations';
import { useReady } from '../state/store';
import { DateField } from '../ui/DatePicker';
import { Keypad } from '../ui/Keypad';
import {
  Banner,
  Body,
  Button,
  Card,
  Chip,
  ErrorText,
  Field,
  Label,
  Muted,
  RowWrap,
  Screen,
  Segmented,
  ToggleRow,
} from '../ui/kit';
import { CategoryPicker, MoreToggle, PaymentAppPicker, RailPicker, railFor, SourcePicker, type SourceValue } from '../ui/pickers';
import { useSnackbar } from '../ui/Snackbar';
import { SPACE, usePalette } from '../ui/theme';

type Params = {
  id?: string;
  template?: string;
  intentionId?: string;
  holdId?: string;
  obligationId?: string;
  occurrenceDate?: string;
  amount?: string;
  categoryId?: string;
  purpose?: string;
  /** Pre-filled date (e.g. adding a missing entry for a past day). */
  date?: string;
  /** Pre-filled funding source. */
  fromAccountId?: string;
  cardId?: string;
  /** Came from "Before I buy" after confirming the payment happened. */
  fromBuy?: string;
  planned?: string;
  q?: string;
  a?: string;
};

function toText(paise: number): string {
  const r = Math.floor(paise / 100);
  const p = paise % 100;
  return p ? `${r}.${String(p).padStart(2, '0')}` : String(r);
}

export default function AddExpense() {
  const params = useLocalSearchParams<Params>();
  const { snapshot, derived, actions } = useReady();
  const snack = useSnackbar();
  const c = usePalette();
  const tz = snapshot.settings.timezone;

  const editing = params.id ? snapshot.transactions.find((t) => t.id === params.id) : undefined;
  const template = params.template ? repeatTemplates(snapshot.transactions, derived.today).find((t) => t.key === params.template) : undefined;
  const intention = params.intentionId ? snapshot.intentions.find((i) => i.id === params.intentionId) : undefined;
  const obligation = params.obligationId ? snapshot.obligations.find((o) => o.id === params.obligationId) : undefined;
  const hold = params.holdId ? snapshot.holds.find((h) => h.id === params.holdId) : undefined;

  // One ID per form: a double tap or a retry can never create two entries.
  const [entryId] = useState(() => editing?.id ?? actions.newId());
  const initialAmount =
    editing?.amount ?? template?.amount ?? intention?.amount ?? obligation?.amount ?? hold?.amount ?? (params.amount ? Number(params.amount) : 0);
  const [amountText, setAmountText] = useState(initialAmount ? toText(initialAmount) : '');
  const [categoryId, setCategoryId] = useState<string>(
    editing?.allocations[0]?.categoryId ?? template?.categoryId ?? intention?.categoryId ?? obligation?.categoryId ?? params.categoryId ?? UNCATEGORIZED_ID,
  );
  const presetAccount = params.fromAccountId ? derived.accountsById.get(params.fromAccountId) : undefined;
  const [source, setSource] = useState<SourceValue>({
    accountId: editing?.fromAccountId ?? template?.fromAccountId ?? presetAccount?.id ?? obligation?.fundingAccountId ?? null,
    cardId: editing?.cardId ?? template?.cardId ?? params.cardId ?? null,
    rail: editing?.rail ?? template?.rail ?? (presetAccount ? railFor(presetAccount, Boolean(params.cardId)) : null),
  });
  const [purpose, setPurpose] = useState(editing?.purpose ?? template?.purpose ?? intention?.label ?? obligation?.name ?? params.purpose ?? hold?.label ?? '');
  const [date, setDate] = useState(
    editing?.localDate ??
      params.occurrenceDate ??
      (params.date && isLocalDate(params.date) && params.date <= derived.today ? params.date : derived.today),
  );
  const initialTime = editing ? localTimeOf(editing.occurredAt, tz) : null;
  const [timeText, setTimeText] = useState(initialTime ? `${String(initialTime.h).padStart(2, '0')}:${String(initialTime.min).padStart(2, '0')}` : '');
  const [payee, setPayee] = useState(editing?.payee ?? '');
  const [note, setNote] = useState(editing?.note ?? '');
  const [paymentApp, setPaymentApp] = useState<string | null>(editing?.paymentApp ?? template?.paymentApp ?? null);
  const [state, setState] = useState<AccountingState>(editing?.state ?? 'completed');
  const [bucket, setBucket] = useState<BudgetBucket>(editing?.budgetBucket ?? (obligation?.protect ? 'protected' : 'flexible'));
  const fromBuy = params.fromBuy === '1' && !editing;
  const plannedParam = params.planned === 'planned' || params.planned === 'unplanned' ? params.planned : 'unknown';
  const [tags, setTags] = useState<Tags>(
    editing?.tags ?? { ...DEFAULT_TAGS, planned: intention ? intention.planned : fromBuy ? plannedParam : 'unknown' },
  );
  const [shared, setShared] = useState(editing ? editing.personalShare !== null : false);
  const [shareText, setShareText] = useState(editing?.personalShare != null ? toText(editing.personalShare) : '');
  const [splitCats, setSplitCats] = useState(editing ? editing.allocations.length > 1 : false);
  const [splits, setSplits] = useState<{ categoryId: string; text: string }[]>(
    editing && editing.allocations.length > 1
      ? editing.allocations.map((a) => ({ categoryId: a.categoryId, text: toText(a.amount) }))
      : [],
  );
  const [more, setMore] = useState(false);
  const [paidConfirmed, setPaidConfirmed] = useState(!intention);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A second tap can arrive before the button re-renders as busy; this ref stops it immediately.
  const saving = useRef(false);

  const amount = parseRupeesToPaise(amountText);
  const share = shared ? parseRupeesToPaise(shareText) : null;
  const splitTotal = splits.reduce((s, x) => s + (parseRupeesToPaise(x.text) ?? 0), 0);

  const allocations: CategoryAllocation[] | null = useMemo(() => {
    if (!amount) return null;
    if (!splitCats) return [{ categoryId, amount }];
    const list = splits
      .map((x) => ({ categoryId: x.categoryId, amount: parseRupeesToPaise(x.text) ?? 0 }))
      .filter((x) => x.amount > 0);
    return list;
  }, [amount, splitCats, splits, categoryId]);

  async function save() {
    if (saving.current) return;
    setError(null);
    if (!amount || amount <= 0) return setError('Enter an amount above ₹0.');
    if (shared && (share === null || share > amount)) return setError('Your share must be between ₹0 and the amount paid.');
    if (splitCats && splitTotal !== amount) return setError(`Category parts add up to ${formatPaise(splitTotal)}, not ${formatPaise(amount)}.`);
    if (!paidConfirmed) return setError('Confirm that you actually paid before recording it.');
    let occurredAt: number;
    const t = parseTimeHHMM(timeText);
    if (timeText.trim() && !t) return setError('Time should look like 14:30.');
    if (t) occurredAt = epochFromLocal(date, t.h, t.min, tz);
    else if (editing && editing.localDate === date) occurredAt = editing.occurredAt;
    else if (date === derived.today) occurredAt = Date.now();
    else occurredAt = epochFromLocal(date, 12, 0, tz);

    const base = makeEntry({
      id: entryId,
      kind: 'expense',
      amount,
      occurredAt,
      localDate: date,
      now: Date.now(),
      state,
      fromAccountId: source.accountId,
      cardId: source.cardId,
      rail: source.rail,
      paymentApp,
      purpose,
      payee,
      note,
      allocations: allocations ?? undefined,
      personalShare: shared ? share : null,
      budgetBucket: bucket,
      tags,
      intentionId: editing?.intentionId ?? intention?.id ?? null,
      holdId: editing?.holdId ?? hold?.id ?? null,
      obligationId: editing?.obligationId ?? obligation?.id ?? null,
      occurrenceDate: editing?.occurrenceDate ?? (obligation ? (params.occurrenceDate ?? null) : null),
    });

    setBusy(true);
    saving.current = true;
    try {
      if (editing) {
        const updated: Transaction = { ...base, createdAt: editing.createdAt, refundOfId: null };
        await actions.editEntry(updated);
        router.back();
        snack({ message: 'Changes saved' });
      } else {
        // From "Before I buy": the check and the purchase are saved together, linked, counted once.
        let entry = base;
        let extra = {};
        if (fromBuy) {
          const t0 = Date.now();
          const intentionId = actions.newId();
          entry = { ...base, intentionId };
          extra = {
            upserts: {
              intentions: [
                {
                  id: intentionId,
                  amount,
                  categoryId: allocations?.[0]?.categoryId ?? categoryId,
                  label: purpose.trim() || null,
                  planned: plannedParam,
                  createdAt: t0,
                  updatedAt: t0,
                  reconsiderAt: null,
                  status: 'considering' as const,
                  reflectionQuestion: params.q || null,
                  reflectionAnswer: params.a || null,
                  decidedAt: t0,
                  deletedAt: null,
                },
              ],
            },
          };
        }
        const inserted = await actions.addEntry(entry, extra);
        router.back();
        if (inserted) {
          snack({
            message: `Saved ${formatPaise(amount)}${state === 'pending' ? ' as pending' : ''}`,
            actionLabel: 'Undo',
            onAction: async () => {
              const batch = await actions.removeEntry(entryId);
              snack({ message: 'Removed', actionLabel: 'Redo', onAction: () => actions.undoRemove(batch) });
            },
          });
        }
      }
    } catch (e) {
      saving.current = false;
      setBusy(false);
      setError(e instanceof ValidationError ? e.message : e instanceof Error ? e.message : String(e));
    }
  }

  const tagRow = <K extends keyof Tags>(key: K, label: string, options: { value: Tags[K]; label: string }[]) => (
    <View style={{ gap: SPACE.xs }} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <Label>{label}</Label>
      <RowWrap>
        {options.map((o) => (
          <Chip
            key={o.value}
            label={o.label}
            selected={tags[key] === o.value}
            onPress={() => setTags({ ...tags, [key]: tags[key] === o.value ? DEFAULT_TAGS[key] : o.value })}
          />
        ))}
      </RowWrap>
    </View>
  );

  return (
    <Screen
      footer={
        <View style={{ gap: SPACE.sm }}>
          <ErrorText>{error}</ErrorText>
          <Button
            label={editing ? 'Save changes' : amount ? `Save ${formatPaise(amount)}` : 'Save'}
            onPress={save}
            busy={busy}
            disabled={!amount}
          />
        </View>
      }
    >
      {intention ? (
        <Banner
          title={`Recording "${intention.label ?? derived.categoryName(intention.categoryId)}" from your waiting list`}
          body="It will count once, as this purchase."
        />
      ) : null}
      {obligation ? <Banner title={`Recording ${obligation.name}`} body="Linked to its due date so it isn't counted twice." /> : null}

      <View
        accessible
        accessibilityLabel={amount ? `Amount ${formatPaise(amount)}` : 'Amount, nothing entered yet'}
        style={{ alignItems: 'center', paddingVertical: SPACE.sm }}
      >
        <Text style={{ color: amount ? c.text : c.muted, fontSize: 44, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
          ₹{amountText || '0'}
        </Text>
      </View>
      <Keypad value={amountText} onChange={setAmountText} />

      {!splitCats ? <CategoryPicker value={categoryId} onChange={setCategoryId} /> : null}
      <SourcePicker value={source} onChange={setSource} />
      <Field label="What was it for? (optional)" value={purpose} onChangeText={setPurpose} placeholder="e.g. lunch, auto, notes PDF" maxLength={80} />

      {intention ? (
        <ToggleRow
          label="I've actually paid for this"
          description="Previews and waiting items never count as spending. Only a confirmed payment does."
          value={paidConfirmed}
          onChange={setPaidConfirmed}
        />
      ) : null}

      <MoreToggle open={more} onToggle={() => setMore(!more)} label="date, split, labels, status" />
      {more ? (
        <View style={{ gap: SPACE.lg }}>
          <View style={{ gap: SPACE.xs }}>
            <Label>Date</Label>
            <DateField value={date} today={derived.today} onChange={setDate} />
          </View>
          <Field
            label="Time (optional, 24-hour)"
            value={timeText}
            onChangeText={setTimeText}
            placeholder="14:30"
            keyboardType="numbers-and-punctuation"
            maxLength={5}
          />
          <Segmented
            label="Status"
            value={state}
            onChange={setState}
            options={[
              { value: 'completed', label: 'Paid' },
              { value: 'pending', label: 'Not sure it went through' },
              { value: 'awaiting_reversal', label: 'Failed but money was taken' },
            ]}
          />
          {state === 'awaiting_reversal' ? (
            <Muted>Kept out of your spending and shown as unresolved until the money comes back. Don't pay twice by mistake.</Muted>
          ) : null}

          <Card tone="soft">
            <ToggleRow
              label="Split with others"
              description="You paid the whole bill but only part of it is yours."
              value={shared}
              onChange={setShared}
            />
            {shared ? (
              <>
                <Field label="My share (₹)" value={shareText} onChangeText={setShareText} keyboardType="decimal-pad" placeholder="400" />
                {amount && share !== null && share <= amount ? (
                  <Muted>
                    Your spending: {formatPaise(share)}. Others owe you {formatPaise(amount - share)} (not counted as cash).
                  </Muted>
                ) : null}
              </>
            ) : null}
          </Card>

          <Card tone="soft">
            <ToggleRow
              label="Split across categories"
              description="Parts must add up exactly to the total."
              value={splitCats}
              onChange={(v) => {
                setSplitCats(v);
                if (v && splits.length === 0) setSplits([{ categoryId, text: amountText }, { categoryId: UNCATEGORIZED_ID === categoryId ? 'other' : UNCATEGORIZED_ID, text: '' }]);
              }}
            />
            {splitCats ? (
              <View style={{ gap: SPACE.md }}>
                {splits.map((sp, i) => (
                  <View key={i} style={{ gap: SPACE.xs }}>
                    <CategoryPicker
                      label={`Part ${i + 1} category`}
                      value={sp.categoryId}
                      onChange={(id) => setSplits(splits.map((x, j) => (j === i ? { ...x, categoryId: id } : x)))}
                    />
                    <Field
                      label={`Part ${i + 1} amount (₹)`}
                      value={sp.text}
                      keyboardType="decimal-pad"
                      onChangeText={(text) => setSplits(splits.map((x, j) => (j === i ? { ...x, text } : x)))}
                    />
                    {splits.length > 2 ? (
                      <Button label={`Remove part ${i + 1}`} kind="quiet" compact onPress={() => setSplits(splits.filter((_, j) => j !== i))} />
                    ) : null}
                  </View>
                ))}
                <Button label="Add another part" kind="secondary" compact onPress={() => setSplits([...splits, { categoryId: 'other', text: '' }])} />
                <Body style={{ fontWeight: '700', color: amount && splitTotal === amount ? c.green : c.amber }}>
                  Parts: {formatPaise(splitTotal)} of {formatPaise(amount ?? 0)}
                  {amount && splitTotal === amount ? ' ✓' : ''}
                </Body>
              </View>
            ) : null}
          </Card>

          <ToggleRow
            label="Counts toward my flexible plan"
            description="Turn off for protected costs like rent or bills."
            value={bucket === 'flexible'}
            onChange={(v) => setBucket(v ? 'flexible' : 'protected')}
          />

          <Body style={{ fontWeight: '700' }}>Your own labels (optional)</Body>
          {tagRow('necessity', 'Need', [
            { value: 'necessary', label: 'Necessary' },
            { value: 'optional', label: 'Optional' },
            { value: 'mixed', label: 'Mixed' },
          ])}
          {tagRow('planned', 'Planned?', [
            { value: 'planned', label: 'Planned' },
            { value: 'unplanned', label: 'Unplanned' },
          ])}
          {tagRow('recurrence', 'Happens', [
            { value: 'recurring', label: 'Recurring' },
            { value: 'one_time', label: 'One-time' },
          ])}
          {tagRow('worth', 'Looking back', [
            { value: 'worth_it', label: 'Worth it' },
            { value: 'mixed', label: 'Mixed' },
            { value: 'would_skip', label: 'Would skip' },
            { value: 'unsure', label: 'Unsure' },
          ])}

          <RailPicker value={source.rail} onChange={(rail) => setSource({ ...source, rail })} />
          <PaymentAppPicker value={paymentApp} onChange={setPaymentApp} />
          <Field label="Paid to (optional)" value={payee} onChangeText={setPayee} placeholder="Shop or person" maxLength={80} />
          <Field label="Notes (optional)" value={note} onChangeText={setNote} multiline maxLength={500} />
        </View>
      ) : null}
      <Muted>Recorded by you, not bank-verified.</Muted>
    </Screen>
  );
}
