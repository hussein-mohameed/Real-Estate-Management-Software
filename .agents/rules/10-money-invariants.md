---
trigger: always_on
description: Money representation, the append-only ledger, the single write path, idempotency, and cash controls. Applies to any code that touches amounts, balances, payments, invoices, or billing.
---

# Financial Invariants

These are not preferences. Violating any of them produces wrong balances in a system that handles other people's money.

## Representation

- Every monetary value is `BigInt`, whole Iraqi Dinars, no fractional unit. Field and variable names end in `Iqd`.
- Never `Float`, never `Decimal`, never `number` for money. Never `parseFloat` on an amount.
- `BigInt` does not cross the Server→Client boundary natively. Serialize with the project's configured serializer. Never `JSON.stringify` a payload containing `BigInt`.
- Display goes through the single `<Money>` component. No ad-hoc formatting, no inline `toLocaleString` on an amount.
- Amounts are always positive. Direction is carried by `type` (`CHARGE` | `PAYMENT`), never by a negative number.

## The ledger

- `LedgerEntry` is **append-only**. No update, no delete, no soft delete. An error is corrected by a new compensating entry, never by editing history.
- Corrections are posted as a `CHARGE` or `PAYMENT` with source `MANUAL` and a mandatory reason. **There is no `ADJUSTMENT` flow** — the spec mentions one in three places; all three are obsolete (decision D2).
- Balance is always `sum(CHARGE) - sum(PAYMENT)`. Positive means the resident owes. There is no sign branch in the formula. If you find yourself writing `if (type === ...)` inside a balance calculation, stop — you are reintroducing the bug D2 removed.

## The single write path

Exactly one function creates ledger entries: `postEntry()` in `lib/ledger`.

- Cron jobs, webhooks, Server Actions, and seed scripts all call `postEntry()`.
- `postEntry()` inserts the entry and recomputes the account balance **inside one transaction**, holding a row lock on the account.
- Nothing outside `lib/ledger` may call `prisma.ledgerEntry.create` or write `account.balanceIqd`.

## Idempotency is a database constraint

Application-level "check then insert" is not idempotency — it loses the race. Every repeatable write is protected by a partial unique index:

- Rent charges: unique on `(accountId, source, periodStart)` where source is RENT.
- Installment charges: unique on `(installmentId)` where type is CHARGE.
- Subscription charges: unique on `(subscriptionId, periodStart)`.
- Payment webhooks: unique on the provider's idempotency key.

Test standard: run the job twice, assert the entry count and the balance are unchanged. A second run must be a no-op, not an error the caller has to catch.

## Cash controls (decision B4/B5, step N4/N5)

- Only staff with `canReceiveCash` may record a cash payment.
- Cash payments cannot be back-dated.
- Every cash-collecting day must be closable: collected-per-staff must be reportable and reconcilable.
- Manual settlement entries above the configured threshold require owner approval before they post.

## Never
- Never store a derived value that can be computed (balances are the single sanctioned exception, and only via `postEntry`).
- Never let an invoice be mutated after issue.
- Never delete a payment. Cancel it and post the compensating entry.
