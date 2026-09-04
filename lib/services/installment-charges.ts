import { prisma } from "@/lib/prisma";
import { postEntry } from "@/lib/ledger/post-entry";
import { resolveAccountForApartment } from "@/lib/services/resolve-account";
import { markOverdue } from "@/lib/services/installments";
import { now, startOfDayBaghdad } from "@/lib/dates";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  قيد استحقاق الأقساط — الخطوة 3.5 · تُشغَّل من `/api/cron/installments`.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ما تفعله ─────────────────────────────────────────────────────────
 *   1. تُقيّد استحقاق كل قسط حلّ موعده ولم يُقيَّد بعد.
 *   2. تقلب ما مضى موعده إلى `OVERDUE`.
 *
 * ── ⚠️ ولا تتكرّر عند إعادة التشغيل ─────────────────────────────────
 * تعريف إنجاز 3.5 ينصّ عليه حرفياً. والضمانة **ليست علماً على الصفّ** بل
 * وجود القيد نفسه: يُبحَث عن `LedgerEntry` بـ`installmentId` قبل الكتابة.
 *
 * وعلمٌ منفصل كان يتقادم عند أول قيد يُكتب من مسار آخر، ويبدو صحيحاً
 * دائماً. أما الدفتر فهو المرجع الوحيد — وهو `append-only` فلا يكذب.
 *
 * ── ⚠️ وفشل قسط لا يُوقف البقيّة ────────────────────────────────────
 * شقةٌ بلا عقد نشط لا يُحلّ حسابها (‏R28). ولو رمى الخطأ لتوقّفت المهمّة
 * عند أول خطة معطوبة وبقيت مئات الأقساط بلا قيد — بلا أن يعرف أحد.
 * فيُجمَع الخطأ ويُعاد في التقرير، ويُكمل الباقي.
 */

export interface ChargeReport {
  ranAt: Date;
  charged: number;
  skipped: number;
  markedOverdue: number;
  errors: Array<{ installmentId: string; reason: string }>;
}

export async function runInstallmentCharges(at: Date = now()): Promise<ChargeReport> {
  const today = startOfDayBaghdad(at);
  const errors: ChargeReport["errors"] = [];
  let charged = 0;
  let skipped = 0;

  const due = await prisma.installment.findMany({
    where: {
      status: { in: ["PENDING", "OVERDUE"] },
      dueDate: { lte: today },
      plan: { status: "ACTIVE" },
    },
    orderBy: { dueDate: "asc" },
    select: {
      id: true,
      sequence: true,
      amountIqd: true,
      plan: {
        select: {
          installmentsCount: true,
          contract: {
            select: { contractNumber: true, apartmentId: true, type: true },
          },
        },
      },
    },
  });

  for (const item of due) {
    try {
      /*
       * ⚠️ **الدفتر هو الضمانة.** قيدٌ بهذا `installmentId` يعني أن
       * الاستحقاق قُيّد سلفاً — مهما تكرّر تشغيل المهمّة.
       */
      const existing = await prisma.ledgerEntry.count({
        where: { installmentId: item.id, type: "CHARGE" },
      });
      if (existing > 0) {
        skipped += 1;
        continue;
      }

      const resolved = await resolveAccountForApartment(
        item.plan.contract.apartmentId,
        item.plan.contract.type === "RENTAL" ? "OCCUPANT" : "OWNER",
      );
      if (!resolved.ok) {
        errors.push({ installmentId: item.id, reason: resolved.messageAr });
        continue;
      }

      await postEntry({
        accountId: resolved.accountId,
        type: "CHARGE",
        source: "INSTALLMENT",
        amountIqd: item.amountIqd,
        descriptionAr: `القسط ${item.sequence} من ${item.plan.installmentsCount} — عقد ${item.plan.contract.contractNumber}`,
        installmentId: item.id,
        /* ⚠️ `null` لأن النظام كتبه لا إنسان — والتدقيق يقرأ ذلك */
        createdByUserId: null,
      });

      charged += 1;
    } catch (error) {
      errors.push({
        installmentId: item.id,
        reason: error instanceof Error ? error.message : "خطأ غير متوقَّع",
      });
    }
  }

  /*
   * ⚠️ **القلب بعد القيد لا قبله.** لو قُلبت الحالة أولاً لصار القسط
   * `OVERDUE` قبل أن يُقيَّد استحقاقه — أي متأخّراً عن دَينٍ لم يُسجَّل بعد.
   */
  const swept = await markOverdue(today);

  return {
    ranAt: at,
    charged,
    skipped,
    markedOverdue: swept.marked,
    errors,
  };
}
