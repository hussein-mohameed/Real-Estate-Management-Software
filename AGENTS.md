# Compound Management System — Agent Context

Single residential compound. Arabic-only RTL UI. Iraqi Dinar. Next.js + TypeScript + Prisma + Supabase.

## Source of truth — read this order, top wins on conflict

1. `docs/BRIDGE-PLAN.md` — **the arbiter.** Corrections to the spec (S1–S9), resolved decisions, blocked decisions (B1–B7), added steps (N1–N7).
2. `docs/IMPLEMENTATION-PLAN.md` — build order, per-step Definition of Done.
3. `docs/spec.md` — field-level domain model, rules R1–R39, flows.

The spec contains **proven internal contradictions**. Where the spec and the bridge plan disagree, the bridge plan wins — always. Do not "fix" the bridge plan to match the spec.

## Non-negotiable invariants

- All money is `BigInt` minor-unit-free IQD. Field names end in `Iqd`. No floats, no decimals, ever.
- `LedgerEntry` is append-only. No `UPDATE`, no `DELETE`, no `deletedAt` on it.
- Exactly one function writes ledger entries: `postEntry()` in `lib/ledger`. No Server Action, cron job, or webhook writes `ledgerEntry.create` directly.
- Every balance recomputation happens inside the same transaction as the entry insert, with a row lock on the account.
- Every write path that can be retried (cron, webhook, double-click) must be idempotent by a database constraint, not by an application check.
- Authorization is enforced **inside each Server Action**, never only in a layout or middleware.
- UI is RTL-first: logical CSS properties only (`ms-*`, `me-*`, `ps-*`, `pe-*`). `ml-*` / `mr-*` / `pl-*` / `pr-*` are forbidden.
- Arabic UI copy, Gregorian dates, `Asia/Baghdad` timezone, Western digits.

## Hard stop — do not invent answers

Seven decisions (`B1`–`B7` in the bridge plan) are **unresolved business decisions**. If a task requires one of them, stop and ask. Do not pick a default. See `.agents/rules/50-blocked-decisions.md`.

Beyond those seven, if behaviour is not described in any of the three documents: **raise it as a question, do not invent it.** Silence in the spec is a gap, not permission.

## Verify, don't recall

The framework version is pinned in `package.json`. Before using any framework API (caching, middleware, route conventions), verify it against the installed version in `node_modules`, not from memory. The spec says "latest" — that is a defect, not an instruction.

## Working agreement

- Implement **one numbered step at a time**, in the order set by the bridge plan §4.2. Use `/implement-step` .
- A step is not done until its Definition of Done in `IMPLEMENTATION-PLAN.md` passes as an actual test.
- Never write `schema.prisma` incrementally. It is written **once**, complete, per `/schema-audit`.
- Do not add dependencies not listed in `docs/spec.md` §2.1 without asking.
