# Paisa Pause

An India-first personal spending app for Android. It helps you see where your money goes, pause before optional purchases, and keep money for what matters to you — without shame, streaks or pressure.

Version 0.1.0 — manual entry, fully offline.

## What it does

- **Today** — money left in your plan, days left, about how much per day, today's recorded total, things that need a look, *Add expense* and *Before I buy*.
- **Activity** — every entry by date with exact amounts, category, purpose, source and status. Search and filter. Open an entry to edit, refund, split, turn it into a transfer, or delete (with undo).
- **Plan** — weekly, monthly or payday plan; category limits; money set aside; protected money; goal; waiting list; upcoming commitments.
- **Review** — day/week/month totals, calendar, category ranking, exact daily average, up to three plain-rule suggestions, export, and *Copy for AI review*.
- **Cards** — what you owe on each credit card, due dates, purchase/repay/refund/fee actions. A credit limit is never shown as spendable money.
- **Settings** — time zone, mode, cycle, reminders, display and motion, privacy, accounts, categories, backup/restore/delete, sample data.

## What it deliberately does not do (this version)

- No bank login, SMS reading, notification reading, OCR, payment processing, ads, lending or investment offers.
- No AI calls. *Copy for AI review* builds a redacted text you paste into a tool yourself.
- No phone notifications. Reminders show inside the app. (Expo's notifications module bundles Firebase, which would add a network component to an offline app. Left out on purpose.)
- It cannot read PhonePe, Google Pay or FamApp. Every entry is typed by you and labelled "not bank-verified".

## Privacy

- **No internet permission.** The release build removes `android.permission.INTERNET`, so the app can't send data anywhere.
- **Encrypted database.** SQLite is built with SQLCipher. A random 256-bit key is created on first launch and stored with `expo-secure-store` (Android Keystore-backed). The app checks `PRAGMA cipher_version` at runtime and only claims encryption when SQLCipher answers. Encryption does not work in Expo Go — it needs a native build.
- **No runtime permissions requested.** Everything works with all permissions denied.
- **Backups are not encrypted.** The export is plain JSON/CSV. The app says so before you export.
- `allowBackup` is off, so Android won't copy the database (whose key couldn't be restored anyway).

## Money rules (all tested)

- All amounts are integer **paise**, INR only. No floating-point rupees.
- One ledger feeds every screen. Kinds: purchase, refund, transfer, income, paid-back (reimbursement), balance check (adjustment).
- Card purchase → spending and card debt rise now. Card repayment → bank falls, debt falls, no extra spending.
- Top-ups, ATM, moves to savings → transfers, not spending. Income is never negative spending.
- Refunds link to the purchase, count once on the day they arrive, can make a category negative, and never rewrite past periods. A refund for an older purchase is "not in your plan" until you add it.
- Shared bill: ₹1,200 paid, ₹400 your share → ₹400 spending, ₹800 owed to you (not cash). Being paid back settles it; it isn't income.
- Pending and "failed but money taken" entries are shown separately and pause the account-aware estimate.
- Recurring commitments are reminders until you record the real charge. A ₹1,200 yearly charge is one ₹1,200 entry; ₹100/month is only a labelled planning equivalent.
- Plan: `remaining = plan + added − net flexible spending since anchor − money set aside`. Never clamped. "What I have left right now" ignores purchases from before that moment.
- Account-aware: `capacity = included liquid balances − protected money inside them (unpaid protected commitments, kept-aside money, full card balance)`; `available = min(plan remaining, capacity)`.
- Daily average = net spending ÷ calendar days observed (zero-entry days count), with completeness shown.
- Deleting an entry removes it (and its refunds/repayments) from all totals at once. Undo is offered; deleted entries can be restored for 30 days, then they're erased. "Delete all my data" erases everything, including the key.

## Product defaults still to validate

Not proven effects: the 80% category-limit warning, the 300 ms spend transition, and the 14 reviewed days needed before showing spending pace. All are settings.

## Build the APK

**On GitHub (no Android tools needed):** every push to `main` runs `.github/workflows/android-apk.yml` — typecheck, lint, tests, `expo prebuild`, then `./gradlew assembleRelease` for `arm64-v8a` and `armeabi-v7a`. Download the APK from the run's *Artifacts*.

**Locally** (JDK 17, Android SDK):

```sh
npm ci
npx expo prebuild --platform android
cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a
# android/app/build/outputs/apk/release/app-release.apk
```

The release APK is signed with the React Native template's debug key. That's fine for installing on your own phone (updates install over each other). For the Play Store, create your own upload key.

## Develop and test

```sh
npm run typecheck     # TypeScript
npm run lint          # Expo ESLint config
npm test              # money, ledger and database tests (Vitest + Node's SQLite)
npm run test:render   # renders every screen with the real store (Jest + Expo Router testing library)
```

## Layout

```
src/domain/   pure money logic — no React, no storage (money, dates, ledger, budget, availability, reports, suggestions, AI report, backup)
src/data/     SQLite schema/migrations, repository, operations, encrypted open
src/state/    store (React context), derived view model, sample data
src/ui/       theme, components, keypad, pickers, snackbar, motion
src/app/      Expo Router screens (four tabs + stack screens)
```

Future capture (notification/SMS evidence) has a table (`evidence_candidates`) but nothing is enabled and no fake connect buttons exist.
