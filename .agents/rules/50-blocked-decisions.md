---
trigger: always_on
description: Seven unresolved business decisions. Any task touching these must stop and ask rather than choose a default.
---

# Blocked Decisions — Stop, Do Not Guess

Seven questions remain unanswered. Each is a **business** decision whose wrong answer is expensive and hard to reverse. If a task depends on one of these, stop and ask. Do not pick the reasonable-looking option.

When answered: implement, then record the answer in the changelog of `docs/BRIDGE-PLAN.md` and delete the item from this file.

---

**B1 — Down payment semantics.** Are installments divided over the full contract amount or over amount-minus-down-payment? Is the down payment already collected (post a `Payment`) or is it due?
*Blocks:* installment plan creation, `cron/installments`, and N3 opening balances.
*Cost of guessing:* millions of dinars per contract.

**B2 — First subscription period.** A subscription approved mid-month: charge immediately for the full period, wait until the next cycle (the current wording gives a free month), or shift the period start to the approval date?
*Blocks:* the billing engine and `cron/billing`.
*Cost of guessing:* recurring revenue, compounding every month.

**B3 — Which account.** After S1, an apartment can have two open accounts. Which one carries a badge fee? Does "apartment balance" show a sum or two separate columns?
*Blocks:* `schema.prisma`, badge issuance, every financial report.
*Note:* summing an owner's and a tenant's balance merges two people's liabilities. Do not do it without an explicit instruction.

**B4 — Cash handling policy.** Who may receive cash, and under what daily control?
*Blocks:* `StaffProfile.canReceiveCash`, payment recording, step N4.

**B5 — Settlement ceiling.** Above what amount does a manual settlement entry require owner approval?
*Blocks:* step N5 and the manual entry path.

**B6 — Wayl webhook authentication.** Where does the shared secret arrive — header, body field, HMAC signature? No documentation, no sample payload.
*Never guess this.* It authenticates a money-receiving endpoint.
*Fallback already approved:* if documentation has not arrived by the start of P3, ship cash-only and defer online payments to a later release. Do not stall the phase.

**B7 — Cost and policy items.** Hosting plan (the required per-minute cron exceeds the free tier's one-daily-job limit) · badge fee one-time or annual · mandatory services on vacant units · legal invoice fields and template.
*Blocks:* cron scheduling and the invoice PDF, which must not be built twice.

---

## Two decisions that must be taken together

**B1 and N3 are one decision.** An opening balance for an installment contract cannot be computed before the down payment's meaning is fixed. Do not implement either half alone.
