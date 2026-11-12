import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import Onboarding from '../screens/Onboarding';
import { StoreProvider, useStore } from '../state/store';
import { Body, Button, Card, Field, Muted, Screen, Title } from '../ui/kit';
import { SnackbarProvider } from '../ui/Snackbar';
import { SPACE, usePalette } from '../ui/theme';

export default function RootLayout() {
  return (
    <StoreProvider>
      <SnackbarProvider>
        <ThemedStatusBar />
        <Gate />
      </SnackbarProvider>
    </StoreProvider>
  );
}

function ThemedStatusBar() {
  const c = usePalette();
  return <StatusBar style={c.scheme === 'dark' ? 'light' : 'dark'} />;
}

function Gate() {
  const { status, snapshot } = useStore();
  const c = usePalette();
  if (status.kind === 'locked') return <Locked message={status.message} />;
  if (status.kind === 'error') return <OpenError message={status.message} />;
  if (status.kind === 'loading' || !snapshot) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center', gap: SPACE.md }}>
        <ActivityIndicator color={c.green} size="large" />
        <Muted>Opening your records…</Muted>
      </View>
    );
  }
  if (!snapshot.settings.onboarded) return <Onboarding />;
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: c.bg },
        headerTintColor: c.text,
        headerTitleStyle: { color: c.text, fontWeight: '700' },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: c.bg },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="add" options={{ title: 'Add expense', presentation: 'modal' }} />
      <Stack.Screen name="buy" options={{ title: 'Before I buy', presentation: 'modal' }} />
      <Stack.Screen name="waiting" options={{ title: 'Waiting list', presentation: 'card' }} />
      <Stack.Screen name="entry/[id]" options={{ title: 'Entry', presentation: 'card' }} />
      <Stack.Screen name="refund" options={{ title: 'Record a refund', presentation: 'card' }} />
      <Stack.Screen name="move" options={{ title: 'Move money', presentation: 'card' }} />
      <Stack.Screen name="cards" options={{ title: 'Cards', presentation: 'card' }} />
      <Stack.Screen name="accounts" options={{ title: 'Accounts & cards', presentation: 'card' }} />
      <Stack.Screen name="account" options={{ title: 'Account', presentation: 'card' }} />
      <Stack.Screen name="recurring" options={{ title: 'Recurring commitments', presentation: 'card' }} />
      <Stack.Screen name="settings" options={{ title: 'Settings', presentation: 'card' }} />
      <Stack.Screen name="categories" options={{ title: 'Categories', presentation: 'card' }} />
      <Stack.Screen name="backup" options={{ title: 'Backup, restore & delete', presentation: 'card' }} />
      <Stack.Screen name="ai" options={{ title: 'Copy for AI review', presentation: 'card' }} />
      <Stack.Screen name="day" options={{ title: 'Review a day', presentation: 'card' }} />
      <Stack.Screen name="deleted" options={{ title: 'Recently deleted', presentation: 'card' }} />
      <Stack.Screen name="plan-amount" options={{ title: 'Plan amount', presentation: 'card' }} />
    </Stack>
  );
}

function Locked({ message }: { message: string }) {
  const { actions } = useStore();
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Screen noHeader>
      <Title>Can't open your data</Title>
      <Body>{message}</Body>
      <Muted>
        Your entries are encrypted with a key kept only on this phone. Without that key they can't be read — not by
        this app, and not by anyone else. If you have a backup file, you can restore it after starting fresh.
      </Muted>
      <Card>
        <Body style={{ fontWeight: '700' }}>Start fresh</Body>
        <Muted>This permanently erases the locked data on this phone. Type ERASE to confirm.</Muted>
        <Field label="Type ERASE" value={confirm} onChangeText={setConfirm} autoCapitalize="characters" />
        <Button
          label="Erase and start fresh"
          kind="danger"
          busy={busy}
          disabled={confirm.trim() !== 'ERASE'}
          onPress={async () => {
            setBusy(true);
            await actions.wipeEverything();
            setBusy(false);
          }}
        />
      </Card>
    </Screen>
  );
}

function OpenError({ message }: { message: string }) {
  const { actions } = useStore();
  return (
    <Screen noHeader>
      <Title>Something went wrong</Title>
      <Body>The app couldn't open its local database.</Body>
      <Muted>{message}</Muted>
      <Button label="Try again" onPress={() => actions.retryOpen()} />
    </Screen>
  );
}
