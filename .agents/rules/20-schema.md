---
trigger: glob
globs: prisma/**, **/*.prisma, prisma/migrations/**
description: Every correction and decision that must be present when schema.prisma is written. The schema is written once, complete.
---

# Schema — Written Once, Complete

`schema.prisma` is authored in a single pass combining: spec §5 + corrections S1–S9 + the resolved decisions below. Corrective migrations after real data exists cost far more than getting this right now.

Blocked on decisions **B3** (which account) and **B4** (`canReceiveCash`) — see `50-blocked-decisions.md`. Do not write the schema before those are answered.

## Partial unique indexes (raw SQL, not Prisma attributes)

Prisma cannot express partial uniqueness. These go in a hand-written migration:

| Table | Index | Why |
|---|---|---|
| `Apartment` | `(buildingId, floorNumber, unitNumber) WHERE deletedAt IS NULL` | T1 — soft delete otherwise blocks regeneration forever |
| `Apartment` | `(buildingId, displayNumber) WHERE deletedAt IS NULL` | same |
| `Contract` | `(apartmentId, type) WHERE status = 'ACTIVE'` | **S1** — one active contract per apartment *per type* |
| `LedgerEntry` | `(accountId, source, periodStart) WHERE source = 'RENT'` | Q3 — a cron re-run must not double every tenant's rent |
| `LedgerEntry` | `(installmentId) WHERE type = 'CHARGE'` | Q3 |
| `Vehicle` | `(plateNumber) WHERE status <> 'REMOVED'` | **S7** — a resold car must be registrable again |
| `Badge` | `(vehicleId) WHERE status <> 'REVOKED'` | **S4** — described in the spec text, absent from the schema |
| `ApartmentResident` | `(apartmentId) WHERE isContractHolder AND endDate IS NULL` | one contract holder at a time |

## Field-level corrections

- `Badge.code` → `String?` unique. Assigned at **issue**, not at request. (**S5** — spec §7.9 creates a badge with no code against a non-null unique column.)
- `Attachment.paymentId` → add, nullable. (**S6** — referenced in §4.19, missing from the schema.)
- `LedgerEntry.deletedAt` → **must not exist.** Same for `Invoice`. (**S3**)
- `Apartment.tenureType` → **remove.** Derived from the active contract's type. Add `deliveredAt DateTime?` and an explicit delivery action for the `DELIVERED` state. (Q33)
- `ServiceRequest.apartmentId` → nullable, plus `scope` enum `APARTMENT | COMMON_AREA`. Required when the creator is a resident. (Q35)
- `Subscription.accountId` → nullable until approval.
- `StaffProfile.canReceiveCash` → `Boolean @default(false)`. (B4)
- `Notification.readAt` → `DateTime?`. (Q44 — without it the in-app bell is decoration.)
- `Payment.expiresAt` → `DateTime?`. (Q40 — an expired unpaid payment must not linger as pending.)
- `LedgerSource` enum → add `OPENING` for migrated opening balances. (N3)
- `LedgerEntry.amountIqd` → add `CHECK (amountIqd > 0)`.
- `ResidentRelation` enum → remove `CONTRACT_HOLDER`. The relation describes family relationship only; the boolean `isContractHolder` carries the role because the partial index depends on it. (Q32)
- `ApartmentResident.userId` → drop the "must be RESIDENT role" constraint. A live-in guard is a normal case. (Q41)
- Split `ServiceAppliesTo` (`APARTMENT | RESIDENT | BOTH`) from `SubscriptionSubjectType` (no `BOTH`). (Q6)
- `Building.constructionStatus` → keep as a manual field describing the shell itself; the roll-up from apartments is a query, not a stored column. (Q8)
- New model `Counter` keyed `(kind, year)` for `INV` / `CTR` / `REQ` numbering, read with `SELECT … FOR UPDATE`. Gaps acceptable, duplicates never. (Q17)
- New model `LoginLink` — hashed token, 24h expiry, single use. Do not reuse `OtpCode`; the security properties differ. (Q46)
- New model `RateLimitHit` — rate limiting lives in Postgres. No Redis in v1. (Q20)

## Conventions

- IDs are `cuid()`. Money is `BigInt` with an `Iqd` suffix. Timestamps are `DateTime` in UTC, rendered in `Asia/Baghdad`.
- Every foreign key gets an index. Every status column used in a filter gets an index.
- Enum values that no code path can produce are a defect — either wire them or delete them.
