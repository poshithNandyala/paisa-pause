import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import React, { useState } from 'react';
import { View } from 'react-native';
import { checkBackup, transactionsCsv, type BackupCheck } from '../domain/backup';
import { useReady } from '../state/store';
import { Banner, Body, Button, Card, ErrorText, Field, H2, KeyValue, Muted, Screen } from '../ui/kit';
import { useSnackbar } from '../ui/Snackbar';
import { SPACE } from '../ui/theme';

async function shareText(name: string, content: string, mimeType: string) {
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  await file.write(content);
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this phone.');
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: 'Save or send your Paisa Pause file' });
}

export default function BackupScreen() {
  const { snapshot, derived, actions, storageKind } = useReady();
  const snack = useSnackbar();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<{ raw: unknown; check: BackupCheck; name: string } | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const stamp = derived.today;

  async function exportJson() {
    setError(null);
    setBusy('json');
    try {
      const backup = actions.exportBackup();
      if (!backup) throw new Error('Nothing to export yet.');
      await shareText(`paisa-pause-backup-${stamp}.json`, JSON.stringify(backup, null, 1), 'application/json');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function exportCsv() {
    setError(null);
    setBusy('csv');
    try {
      await shareText(`paisa-pause-entries-${stamp}.csv`, transactionsCsv(snapshot, snapshot.settings.timezone), 'text/csv');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function pickBackup() {
    setError(null);
    setPending(null);
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain', '*/*'], copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.length) return;
      const asset = res.assets[0];
      const text = await new File(asset.uri).text();
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        throw new Error("That file isn't a Paisa Pause backup (not valid JSON).");
      }
      const check = checkBackup(raw);
      setPending({ raw, check, name: asset.name });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function restore() {
    if (!pending) return;
    setBusy('restore');
    try {
      const res = await actions.restoreBackup(pending.raw);
      if (!res.ok) throw new Error(res.errors.join(' '));
      setPending(null);
      setConfirmText('');
      snack({ message: 'Backup restored' });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen>
      <ErrorText>{error}</ErrorText>
      <Card>
        <H2>Back up</H2>
        <Body>Save a full copy of your records as a file, then keep it somewhere private (your own Drive, a pen drive, email to yourself).</Body>
        <Banner tone="warn" title="Backup files are not encrypted" body="Anyone who opens the file can read your entries. Store it carefully." />
        <Button label="Export full backup (.json)" onPress={exportJson} busy={busy === 'json'} />
        <Button label="Export entries for spreadsheets (.csv)" kind="secondary" onPress={exportCsv} busy={busy === 'csv'} />
        <Muted>Nothing is uploaded by the app. Android's share sheet lets you choose where the file goes.</Muted>
      </Card>

      <Card>
        <H2>Restore</H2>
        <Body>Replace everything on this phone with a backup file. The file is checked first; nothing changes unless it's valid and you confirm.</Body>
        <Button label="Choose a backup file" kind="secondary" onPress={pickBackup} />
        {pending ? (
          pending.check.ok ? (
            <View style={{ gap: SPACE.sm }}>
              <Banner tone="good" title={`${pending.name} looks good`} />
              <KeyValue label="Entries" value={String(pending.check.counts.transactions ?? 0)} />
              <KeyValue label="Accounts" value={String(pending.check.counts.accounts ?? 0)} />
              <KeyValue label="Commitments" value={String(pending.check.counts.obligations ?? 0)} />
              <Muted>Your current {snapshot.transactions.length} entries will be replaced. Type REPLACE to confirm.</Muted>
              <Field label="Type REPLACE" value={confirmText} onChangeText={setConfirmText} autoCapitalize="characters" />
              <Button label="Replace with this backup" kind="danger" disabled={confirmText.trim() !== 'REPLACE'} busy={busy === 'restore'} onPress={restore} />
            </View>
          ) : (
            <Banner tone="warn" title="This file can't be restored" body={pending.check.errors.slice(0, 5).join(' ')} />
          )
        ) : null}
      </Card>

      <DeleteAll demo={storageKind === 'demo'} />
    </Screen>
  );
}

function DeleteAll({ demo }: { demo: boolean }) {
  const { actions } = useReady();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Card>
      <H2>{demo ? 'Delete the sample data' : 'Delete all my data'}</H2>
      <Body>
        {demo
          ? 'Erases the sample records.'
          : 'Permanently erases every entry, account, plan and setting on this phone, plus the encryption key. This cannot be undone. Export a backup first if you might want it later.'}
      </Body>
      <Field label="Type DELETE to confirm" value={text} onChangeText={setText} autoCapitalize="characters" />
      <Button
        label={demo ? 'Delete sample data' : 'Delete everything'}
        kind="danger"
        busy={busy}
        disabled={text.trim() !== 'DELETE'}
        onPress={async () => {
          setBusy(true);
          await actions.wipeEverything();
        }}
      />
    </Card>
  );
}
