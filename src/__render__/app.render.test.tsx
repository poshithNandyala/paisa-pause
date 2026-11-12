/// <reference types="jest" />
/**
 * Smoke tests that render the real routes with the real store and SQL,
 * backed by Node's SQLite instead of the phone's. They catch screens that
 * crash on render and check the main flows end to end.
 */
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

jest.mock('../data/storage', () => {
  const { Repository } = jest.requireActual('../data/repository');
  const { nodeDriver } = jest.requireActual('../data/__tests__/nodeDriver');
  const { randomUUID } = jest.requireActual('node:crypto');
  const dbs: Record<string, unknown> = {};
  class LockedError extends Error {}
  return {
    LockedError,
    newId: () => randomUUID(),
    openStorage: async (kind: string) => {
      if (!dbs[kind]) dbs[kind] = nodeDriver();
      const driver = dbs[kind] as { close: () => Promise<void> };
      // Keep the in-memory database alive across close/open in tests.
      const keepOpen = { ...driver, close: async () => undefined };
      return { kind, repo: new Repository(keepOpen), encryption: { on: true, cipherVersion: 'test' } };
    },
    destroyStorage: async (kind: string) => {
      delete dbs[kind];
    },
  };
});

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => undefined) }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn(async () => ({ canceled: true, assets: null })) }));
jest.mock('expo-file-system', () => ({
  Paths: { cache: 'file:///cache' },
  File: class {
    uri = 'file:///cache/x';
    exists = false;
    create() {}
    delete() {}
    async write() {}
    async text() {
      return '';
    }
  },
}));

jest.setTimeout(60_000);

async function start(initialUrl: string) {
  await renderRouter('./src/app', { initialUrl });
}

/** The router test helper uses fake timers with a frozen clock; on a phone time moves on. */
async function letTimePass(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

async function go(path: string, expectText: string | RegExp) {
  await act(async () => {
    const { router } = jest.requireActual('expo-router');
    router.push(path);
  });
  await screen.findAllByText(expectText, {}, { timeout: 8000 });
}

describe('Paisa Pause screens', () => {
  it('onboards, records an expense with undo, and renders every screen', async () => {
    await start('/');

    // Onboarding
    await fireEvent.press(await screen.findByText('Get started', {}, { timeout: 8000 }));
    await fireEvent.press(await screen.findByText('Weekly'));
    await fireEvent.press(screen.getByText('Next'));
    await fireEvent.changeText(await screen.findByLabelText('Amount (₹)'), '900');
    await fireEvent.press(screen.getByText('Next'));
    await fireEvent.press(await screen.findByText('Next'));
    await fireEvent.press(await screen.findByText('Start using Paisa Pause'));

    // Today
    await screen.findByText('MONEY LEFT IN YOUR PLAN', {}, { timeout: 8000 });
    expect(screen.getByLabelText('900 rupees')).toBeTruthy();

    // Add ₹199 via the keypad, a little after setting "what I have left right now"
    await letTimePass(2000);
    await fireEvent.press(screen.getByText('Add expense'));
    await screen.findByLabelText('Amount, nothing entered yet');
    await fireEvent.press(screen.getByLabelText('1'));
    await fireEvent.press(screen.getByLabelText('9'));
    await fireEvent.press(screen.getByLabelText('9'));
    await fireEvent.press(screen.getByText('Shopping'));
    await fireEvent.changeText(screen.getByLabelText('What was it for? (optional)'), 'Phone cover');
    // A second tap while saving must not create a second entry (or navigate back twice)
    const save = screen.getByText('Save ₹199');
    await fireEvent.press(save);
    if (screen.queryByText('Save ₹199')) await fireEvent.press(save);
    await screen.findByText('Saved ₹199', {}, { timeout: 8000 });
    await waitFor(() => expect(screen.getByLabelText('701 rupees')).toBeTruthy());
    expect(screen.getByLabelText('199 rupees')).toBeTruthy(); // recorded today: exactly one entry

    // Undo removes it again
    await fireEvent.press(screen.getByText('Undo'));
    await waitFor(() => expect(screen.getByLabelText('900 rupees')).toBeTruthy());
    await fireEvent.press(await screen.findByText('Redo'));
    await waitFor(() => expect(screen.getByLabelText('701 rupees')).toBeTruthy());

    // Every other screen renders
    await go('/activity', 'Phone cover');
    await go('/plan', /plan ·/);
    await go('/review', 'By category');
    await go('/buy', 'Optional. Use it for things you could skip — never needed for essentials or emergencies.');
    await go('/waiting', 'Nothing waiting');
    await go('/cards', 'No cards yet');
    await go('/accounts', 'No accounts yet');
    await go('/account?kind=credit_card', 'Nickname');
    await go('/move', 'Add an account first');
    await go('/recurring', 'No commitments yet');
    await go('/settings', 'Privacy');
    await go('/categories', 'Eating out & delivery');
    await go('/backup', 'Back up');
    await go('/ai', 'Copy to clipboard');
    await go('/day', /Not reviewed yet|No entries/);
    await go('/deleted', /Nothing deleted|Restore/);
    await go('/plan-amount', 'PREVIEW');
  });

  it('sample data opens separately and every screen renders with rich data', async () => {
    // The real database is already set up by the first test; sample data is opened from Settings.
    await start('/settings');
    await fireEvent.press(await screen.findByText('Try with sample data', {}, { timeout: 8000 }));
    await screen.findByText('MONEY LEFT IN YOUR PLAN', {}, { timeout: 10000 });
    expect(screen.getAllByText('Sample data — not your records. Exit from Settings.').length).toBeGreaterThan(0);
    await screen.findByText('ESTIMATED AVAILABLE (ACCOUNTS)');

    await go('/activity', 'Tea and snacks');
    await go('/plan', 'Category limits');
    await go('/review', 'Worth a look');
    await go('/cards', 'Sample credit card');
    await go('/accounts', 'Sample bank');
    await go('/waiting', 'Headphones');
    await go('/recurring', 'Music app (sample)');
    await go('/move?kind=reimbursement', 'Someone paying you back their share of a shared purchase. Not income, and it does not change your spending.');
    await go('/ai', /SPENDING SUMMARY/);
    await go('/settings', /looking at sample data/);
  });
});
