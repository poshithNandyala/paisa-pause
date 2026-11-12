import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { checkBackup, makeBackup, type Backup } from '../domain/backup';
import type { LocalDate } from '../domain/dates';
import { localDateOf } from '../domain/dates';
import type { Paise } from '../domain/money';
import type {
  Account,
  AnchorMode,
  BudgetPeriod,
  Card,
  Category,
  DayStatus,
  Envelope,
  Goal,
  Hold,
  Intention,
  Obligation,
  Reservation,
  Settings,
  Snapshot,
  Transaction,
} from '../domain/types';
import type { ChangeSet } from '../data/repository';
import {
  createEntry,
  deleteEntry,
  nextPeriodIfNeeded,
  newPeriod,
  reconciliationEntry,
  updateEntry,
} from '../data/operations';
import { destroyStorage, LockedError, newId, openStorage, type OpenedStorage, type StorageKind } from '../data/storage';
import { derive, type Derived } from './derive';
import { buildSampleSnapshot } from './sampleData';

const DAY_MS = 86_400_000;

export type StoreStatus =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'locked'; message: string }
  | { kind: 'error'; message: string };

export interface StoreValue {
  status: StoreStatus;
  snapshot: Snapshot | null;
  derived: Derived | null;
  now: number;
  storageKind: StorageKind;
  encryption: OpenedStorage['encryption'] | null;
  actions: Actions;
}

export interface Actions {
  newId: () => string;
  reload: () => Promise<void>;
  /** Try opening the database again (after an error). */
  retryOpen: () => Promise<void>;
  /** Saves a new entry (idempotent by ID). Returns false if it was already saved. */
  addEntry: (t: Transaction, extra?: ChangeSet) => Promise<boolean>;
  editEntry: (t: Transaction) => Promise<void>;
  /** Deletes the entry (and its refunds/repayments). Returns a batch ID for undo. */
  removeEntry: (id: string) => Promise<string>;
  undoRemove: (batchId: string) => Promise<void>;
  loadDeleted: () => Promise<Transaction[]>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  apply: (changes: ChangeSet) => Promise<void>;
  setPlan: (allocation: Paise, mode: AnchorMode, alsoDefault: boolean) => Promise<void>;
  reallocate: (amount: Paise, note: string | null, refundId?: string | null) => Promise<void>;
  addHold: (amount: Paise, label: string, intentionId?: string | null) => Promise<void>;
  releaseHold: (hold: Hold) => Promise<void>;
  saveEnvelope: (e: Envelope) => Promise<void>;
  saveReservation: (r: Reservation) => Promise<void>;
  saveGoal: (g: Goal) => Promise<void>;
  saveIntention: (i: Intention) => Promise<void>;
  saveObligation: (o: Obligation) => Promise<void>;
  skipOccurrence: (obligationId: string, date: LocalDate) => Promise<void>;
  setDayReview: (date: LocalDate, status: DayStatus | null, note?: string | null) => Promise<void>;
  dismissSuggestion: (key: string) => Promise<void>;
  saveAccount: (a: Account) => Promise<void>;
  saveCard: (c: Card, account?: Account) => Promise<void>;
  saveCategory: (c: Category) => Promise<void>;
  reconcile: (account: Account, actual: Paise) => Promise<boolean>;
  exportBackup: () => Backup | null;
  restoreBackup: (raw: unknown) => Promise<{ ok: boolean; errors: string[] }>;
  wipeEverything: () => Promise<void>;
  startSample: () => Promise<void>;
  exitSample: () => Promise<void>;
}

const StoreContext = createContext<StoreValue | null>(null);

export function useStore(): StoreValue {
  const v = useContext(StoreContext);
  if (!v) throw new Error('useStore must be used inside StoreProvider');
  return v;
}

/** Ready-state helpers for screens that only render once data is loaded. */
export function useReady(): { snapshot: Snapshot; derived: Derived; actions: Actions; now: number; storageKind: StorageKind } {
  const { snapshot, derived, actions, now, storageKind } = useStore();
  if (!snapshot || !derived) throw new Error('Data not loaded yet');
  return { snapshot, derived, actions, now, storageKind };
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<StoreStatus>({ kind: 'loading' });
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [storageKind, setStorageKind] = useState<StorageKind>('real');
  const [encryption, setEncryption] = useState<OpenedStorage['encryption'] | null>(null);
  const storageRef = useRef<OpenedStorage | null>(null);
  const snapshotRef = useRef<Snapshot | null>(null);

  const reload = useCallback(async () => {
    const repo = storageRef.current?.repo;
    if (!repo) return;
    const snap = await repo.load();
    snapshotRef.current = snap;
    setSnapshot(snap);
    setNow(Date.now());
  }, []);

  const open = useCallback(
    async (kind: StorageKind, prepare?: (opened: OpenedStorage) => Promise<void>) => {
      setStatus({ kind: 'loading' });
      try {
        if (storageRef.current) {
          await storageRef.current.repo.close().catch(() => undefined);
          storageRef.current = null;
        }
        const opened = await openStorage(kind);
        const t = Date.now();
        await opened.repo.init(localDateOf(t, 'Asia/Kolkata'), t);
        await opened.repo.purgeDeleted(t - 30 * DAY_MS);
        if (prepare) await prepare(opened);
        storageRef.current = opened;
        setStorageKind(kind);
        setEncryption(opened.encryption);
        await reload();
        setStatus({ kind: 'ready' });
      } catch (e) {
        if (e instanceof LockedError) setStatus({ kind: 'locked', message: e.message });
        else setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    },
    [reload],
  );

  useEffect(() => {
    // Opening the on-device database is an external system; its status updates arrive from it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void open('real');
    return () => {
      void storageRef.current?.repo.close();
    };
  }, [open]);

  // Keep "now" fresh: every minute and whenever the app comes back.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNow(Date.now());
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, []);

  const derived = useMemo(() => (snapshot ? derive(snapshot, now) : null), [snapshot, now]);

  // Start the next plan period when the last one has ended.
  const today = derived?.today;
  useEffect(() => {
    const snap = snapshotRef.current;
    const repo = storageRef.current?.repo;
    if (!snap || !repo || !today) return;
    const next = nextPeriodIfNeeded(snap, today, newId, Date.now());
    if (next) void repo.apply({ upserts: { periods: [next] } }, Date.now()).then(reload);
  }, [today, snapshot, reload]);

  const actions = useMemo<Actions>(() => {
    const repo = () => {
      const r = storageRef.current?.repo;
      if (!r) throw new Error('Storage is not open');
      return r;
    };
    const snap = () => {
      const s = snapshotRef.current;
      if (!s) throw new Error('Data not loaded');
      return s;
    };
    const apply = async (changes: ChangeSet) => {
      await repo().apply(changes, Date.now());
      await reload();
    };
    const todayNow = () => localDateOf(Date.now(), snap().settings.timezone);

    return {
      newId,
      reload,
      retryOpen: () => open(storageRef.current?.kind ?? 'real'),
      addEntry: async (t, extra) => {
        const outcome = await createEntry(repo(), snap(), t, Date.now(), extra);
        await reload();
        return outcome === 'inserted';
      },
      editEntry: async (t) => {
        await updateEntry(repo(), snap(), t, Date.now());
        await reload();
      },
      removeEntry: async (id) => {
        const batchId = newId();
        await deleteEntry(repo(), snap(), id, batchId, Date.now());
        await reload();
        return batchId;
      },
      undoRemove: async (batchId) => {
        await repo().restoreBatch(batchId, Date.now());
        await reload();
      },
      loadDeleted: () => repo().loadDeleted(),
      updateSettings: async (patch) => {
        await apply({ settings: { ...snap().settings, ...patch } });
      },
      apply,
      setPlan: async (allocation, mode, alsoDefault) => {
        const s = snap();
        const t = Date.now();
        const day = todayNow();
        const current = derive(s, t).period;
        const period: BudgetPeriod = current
          ? { ...current, allocation, anchorMode: mode, anchoredAt: mode === 'remaining_now' ? t : current.anchoredAt, autoCreated: false, updatedAt: t }
          : newPeriod(s, day, allocation, mode, newId, t);
        await apply({
          upserts: { periods: [period] },
          settings: alsoDefault ? { ...s.settings, defaultAllocation: allocation } : undefined,
        });
      },
      reallocate: async (amount, note, refundId = null) => {
        const period = derive(snap(), Date.now()).period;
        if (!period) throw new Error('Set up a plan first.');
        await apply({
          upserts: {
            reallocations: [{ id: newId(), periodId: period.id, amount, note, refundId, createdAt: Date.now(), deletedAt: null }],
          },
        });
      },
      addHold: async (amount, label, intentionId = null) => {
        const period = derive(snap(), Date.now()).period;
        if (!period) throw new Error('Set up a plan first.');
        await apply({
          upserts: {
            holds: [{ id: newId(), periodId: period.id, amount, label, intentionId, createdAt: Date.now(), releasedAt: null, deletedAt: null }],
          },
        });
      },
      releaseHold: async (hold) => {
        await apply({ upserts: { holds: [{ ...hold, releasedAt: Date.now() }] } });
      },
      saveEnvelope: (e) => apply({ upserts: { envelopes: [e] } }),
      saveReservation: (r) => apply({ upserts: { reservations: [r] } }),
      saveGoal: (g) => apply({ upserts: { goals: [{ ...g, updatedAt: Date.now() }] } }),
      saveIntention: (i) => apply({ upserts: { intentions: [{ ...i, updatedAt: Date.now() }] } }),
      saveObligation: (o) => apply({ upserts: { obligations: [{ ...o, updatedAt: Date.now() }] } }),
      skipOccurrence: (obligationId, date) =>
        apply({ upserts: { obligationSkips: [{ obligationId, occurrenceDate: date, createdAt: Date.now() }] } }),
      setDayReview: async (date, status, note = null) => {
        if (status === null) {
          await apply({ deleteRows: [{ entity: 'dayReviews', keys: [date] }] });
        } else {
          await apply({ upserts: { dayReviews: [{ localDate: date, status, note, reviewedAt: Date.now() }] } });
        }
      },
      dismissSuggestion: (key) => apply({ upserts: { dismissals: [{ key, dismissedAt: Date.now() }] } }),
      saveAccount: (a) => apply({ upserts: { accounts: [{ ...a, updatedAt: Date.now() }] } }),
      saveCard: (c, account) =>
        apply({
          upserts: {
            accounts: account ? [{ ...account, updatedAt: Date.now() }] : [],
            cards: [{ ...c, updatedAt: Date.now() }],
          },
        }),
      saveCategory: (c) => apply({ upserts: { categories: [c] } }),
      reconcile: async (account, actual) => {
        const s = snap();
        const entry = reconciliationEntry(account, s, actual, newId, Date.now(), todayNow());
        if (!entry) return false;
        await createEntry(repo(), s, entry, Date.now());
        await reload();
        return true;
      },
      exportBackup: () => {
        const s = snapshotRef.current;
        const r = storageRef.current?.repo;
        if (!s || !r) return null;
        return makeBackup(s, r.schemaVersion, Date.now());
      },
      restoreBackup: async (raw) => {
        const check = checkBackup(raw);
        if (!check.ok || !check.backup) return { ok: false, errors: check.errors };
        await repo().replaceAll(check.backup.data, Date.now());
        await reload();
        return { ok: true, errors: [] };
      },
      wipeEverything: async () => {
        const kind = storageRef.current?.kind ?? 'real';
        await destroyStorage(kind, storageRef.current);
        storageRef.current = null;
        snapshotRef.current = null;
        setSnapshot(null);
        await open(kind);
      },
      startSample: async () => {
        if (storageRef.current?.kind === 'demo') return;
        await destroyStorage('demo', null);
        await open('demo', async (opened) => {
          const t = Date.now();
          await opened.repo.replaceAll(buildSampleSnapshot(localDateOf(t, 'Asia/Kolkata'), t, newId), t);
        });
      },
      exitSample: async () => {
        const opened = storageRef.current;
        if (opened?.kind === 'demo') await destroyStorage('demo', opened);
        storageRef.current = null;
        await open('real');
      },
    };
  }, [open, reload]);

  const value = useMemo<StoreValue>(
    () => ({ status, snapshot, derived, now, storageKind, encryption, actions }),
    [status, snapshot, derived, now, storageKind, encryption, actions],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
