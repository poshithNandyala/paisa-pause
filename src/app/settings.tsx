import Constants from 'expo-constants';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { isLocalDate, parseTimeHHMM } from '../domain/dates';
import { formatPaise } from '../domain/money';
import type { Settings } from '../domain/types';
import { useReady, useStore } from '../state/store';
import { DateField } from '../ui/DatePicker';
import { Banner, Body, Button, Card, Chip, Divider, Field, H2, KeyValue, Label, LinkRow, Muted, RowWrap, Screen, Segmented, ToggleRow } from '../ui/kit';
import { useSnackbar } from '../ui/Snackbar';
import { SPACE } from '../ui/theme';

export default function SettingsScreen() {
  const { snapshot, derived, actions, storageKind } = useReady();
  const { encryption } = useStore();
  const snack = useSnackbar();
  const s = snapshot.settings;
  const set = (patch: Partial<Settings>) => actions.updateSettings(patch);
  const [reviewTime, setReviewTime] = useState(s.reviewTime ?? '');
  const [threshold, setThreshold] = useState(String(s.envelopeThresholdPct));
  const [paceDays, setPaceDays] = useState(String(s.minReviewedDaysForPace));
  const [payday, setPayday] = useState(String(s.paydayDay));

  return (
    <Screen>
      {storageKind === 'demo' ? (
        <Banner
          tone="warn"
          title="You're looking at sample data"
          body="Nothing here is yours. Exiting deletes the sample and opens your own records."
          actionLabel="Exit sample data"
          onAction={async () => {
            await actions.exitSample();
          }}
        />
      ) : null}

      <Card>
        <H2>Privacy</H2>
        {encryption?.on ? (
          <Body>🔒 Your records are encrypted on this phone (SQLCipher {encryption.cipherVersion}). The key is random and kept in Android's secure key storage.</Body>
        ) : (
          <Body>⚠ This build is not encrypting the database. Don't keep sensitive notes here until it is.</Body>
        )}
        <Muted>No internet permission: the app can't send your data anywhere. No bank login, no SMS, no notification reading, no ads.</Muted>
        <Muted>Permissions requested: none. Everything works with all permissions denied.</Muted>
        <ToggleRow label="Hide amounts" description="Shows ₹ ••• everywhere until you turn it off." value={s.hideAmounts} onChange={(v) => set({ hideAmounts: v })} />
      </Card>

      <Card>
        <H2>How you track</H2>
        <Segmented
          label="Mode"
          value={s.mode}
          onChange={(mode) => set({ mode })}
          options={[
            { value: 'budget_only', label: 'Budget-only' },
            { value: 'account_aware', label: 'Also estimate from accounts' },
          ]}
        />
        <Muted>
          {s.mode === 'budget_only'
            ? 'Tracks the flexible money you set. No bank balances needed.'
            : 'Also estimates available money from the balances you enter, minus protected money and card reserves.'}
        </Muted>
        <Divider />
        <Segmented
          label="Plan cycle"
          value={s.cycle}
          onChange={(cycle) => set({ cycle })}
          options={[
            { value: 'weekly', label: 'Weekly' },
            { value: 'monthly', label: 'Monthly' },
            { value: 'payday', label: 'Payday' },
          ]}
        />
        {s.cycle === 'weekly' ? (
          <Segmented
            label="Week starts on"
            value={String(s.weekStartsOn) as '0' | '1'}
            onChange={(v) => set({ weekStartsOn: Number(v) })}
            options={[
              { value: '1', label: 'Monday' },
              { value: '0', label: 'Sunday' },
            ]}
          />
        ) : null}
        {s.cycle === 'payday' ? (
          <Field
            label="Payday (day of month, 1–31)"
            value={payday}
            onChangeText={setPayday}
            keyboardType="number-pad"
            maxLength={2}
            onEndEditing={() => {
              const n = Number(payday);
              if (Number.isInteger(n) && n >= 1 && n <= 31) set({ paydayDay: n });
              else setPayday(String(s.paydayDay));
            }}
            help="In shorter months it falls on the last day."
          />
        ) : null}
        <Muted>A cycle change applies from the next period. The current period keeps its dates.</Muted>
        <KeyValue label="Amount for new periods" value={s.defaultAllocation ? formatPaise(s.defaultAllocation) : 'Not set'} />
        <Button label="Change plan amount" kind="quiet" compact onPress={() => router.push('/plan-amount')} />
      </Card>

      <Card>
        <H2>Money and time</H2>
        <KeyValue label="Currency" value="INR (₹) only in this version" />
        <Segmented
          label="Time zone"
          value={s.timezone}
          onChange={(timezone) => {
            void set({ timezone });
            snack({ message: 'New entries use this time zone. Past entries keep their dates.' });
          }}
          options={[
            { value: 'Asia/Kolkata', label: 'India (IST)' },
            { value: 'device', label: "Phone's time zone" },
          ]}
        />
        <Muted>Each entry keeps the date it was recorded on, so changing this never moves past entries between days.</Muted>
        <Divider />
        <Label>I've recorded everything since</Label>
        <DateField value={s.trackingStartDate} today={derived.today} onChange={(d) => isLocalDate(d) && set({ trackingStartDate: d })} />
        <Muted>Averages only use days from this date. Earlier periods are shown as partial.</Muted>
      </Card>

      <Card>
        <H2>Focus and reminders</H2>
        <Label>Focus categories (up to 3)</Label>
        <RowWrap>
          {derived.pickerCategories
            .filter((c) => c.id !== 'uncategorized')
            .map((c) => {
              const on = s.focusCategoryIds.includes(c.id);
              return (
                <Chip
                  key={c.id}
                  role="checkbox"
                  label={c.name}
                  selected={on}
                  onPress={() => {
                    if (on) set({ focusCategoryIds: s.focusCategoryIds.filter((x) => x !== c.id) });
                    else if (s.focusCategoryIds.length < 3) set({ focusCategoryIds: [...s.focusCategoryIds, c.id] });
                    else snack({ message: 'Up to 3 focus categories' });
                  }}
                />
              );
            })}
        </RowWrap>
        <Field
          label="Daily review time (optional, 24-hour)"
          value={reviewTime}
          onChangeText={setReviewTime}
          placeholder="21:00"
          keyboardType="numbers-and-punctuation"
          maxLength={5}
          onEndEditing={() => {
            if (!reviewTime.trim()) return void set({ reviewTime: null });
            if (parseTimeHHMM(reviewTime)) set({ reviewTime: reviewTime.trim() });
            else {
              setReviewTime(s.reviewTime ?? '');
              snack({ message: 'Use a time like 21:00' });
            }
          }}
          help="After this time, Today shows a gentle review prompt. This version doesn't send phone notifications, so no permission is needed. No streaks, no penalties."
        />
      </Card>

      <Card>
        <H2>Display and motion</H2>
        <Segmented
          label="Money left shows as"
          value={s.visualMode}
          onChange={(visualMode) => set({ visualMode })}
          options={[
            { value: 'envelope', label: 'Number + bar' },
            { value: 'plain', label: 'Plain number' },
          ]}
        />
        <Segmented
          label="Motion"
          value={s.motion}
          onChange={(motion) => set({ motion })}
          options={[
            { value: 'system', label: 'Follow phone' },
            { value: 'reduce', label: 'Reduce' },
            { value: 'full', label: 'Allow' },
          ]}
        />
        <Muted>Text size follows your phone's font size setting. Screen readers hear exact amounts in words.</Muted>
      </Card>

      <Card>
        <H2>Suggestions</H2>
        <ToggleRow
          label="Show suggestions in Review"
          description="At most three, from simple rules you can see. No AI."
          value={s.suggestionsEnabled}
          onChange={(v) => set({ suggestionsEnabled: v })}
        />
        <Field
          label="Category limit warning at (%)"
          value={threshold}
          onChangeText={setThreshold}
          keyboardType="number-pad"
          maxLength={3}
          onEndEditing={() => {
            const n = Number(threshold);
            if (Number.isInteger(n) && n >= 10 && n <= 200) set({ envelopeThresholdPct: n });
            else setThreshold(String(s.envelopeThresholdPct));
          }}
        />
        <Field
          label="Days you must mark complete before showing spending pace"
          value={paceDays}
          onChangeText={setPaceDays}
          keyboardType="number-pad"
          maxLength={2}
          onEndEditing={() => {
            const n = Number(paceDays);
            if (Number.isInteger(n) && n >= 7 && n <= 60) set({ minReviewedDaysForPace: n });
            else setPaceDays(String(s.minReviewedDaysForPace));
          }}
          help="A product setting, not a scientific threshold."
        />
        {snapshot.dismissals.length ? (
          <Button
            label={`Show ${snapshot.dismissals.length} dismissed suggestion${snapshot.dismissals.length === 1 ? '' : 's'} again`}
            kind="quiet"
            compact
            onPress={() => actions.apply({ deleteRows: snapshot.dismissals.map((d) => ({ entity: 'dismissals' as const, keys: [d.key] })) })}
          />
        ) : null}
      </Card>

      <Card>
        <H2>Your data</H2>
        <LinkRow label="Accounts & cards" onPress={() => router.push('/accounts')} />
        <Divider />
        <LinkRow label="Categories" detail="Rename, hide or add" onPress={() => router.push('/categories')} />
        <Divider />
        <LinkRow label="Recurring commitments" onPress={() => router.push('/recurring')} />
        <Divider />
        <LinkRow label="Backup, restore & delete" detail="Export a file, restore one, or erase everything" onPress={() => router.push('/backup')} />
        <Divider />
        <LinkRow label="Recently deleted" detail="Kept 30 days, then erased" onPress={() => router.push('/deleted')} />
      </Card>

      {storageKind === 'real' ? (
        <Card>
          <H2>Sample data</H2>
          <Muted>Explore the app with clearly fake records in a separate space. Your own records aren't touched or mixed.</Muted>
          <Button label="Try with sample data" kind="secondary" onPress={() => actions.startSample()} />
        </Card>
      ) : null}

      <Card>
        <H2>About this version</H2>
        <Muted>Paisa Pause {Constants.expoConfig?.version ?? ''} · works fully offline.</Muted>
        <Muted>
          Manual entry only: it can't read PhonePe, Google Pay, FamApp, SMS or bank data, and it doesn't pretend to. Entries are recorded
          by you, not bank-verified. Thresholds and the short spend animation are product defaults still being tested, not proven
          effects.
        </Muted>
      </Card>
      <View style={{ height: SPACE.lg }} />
    </Screen>
  );
}
