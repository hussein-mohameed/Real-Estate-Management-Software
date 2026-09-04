import { z } from "zod";
import { defineAction } from "./define-action";
import { postEntry } from "@/lib/ledger/post-entry";
import { buildSchedule } from "@/lib/services/installments";
import { resolveAccountForApartment } from "@/lib/services/resolve-account";
import { BusinessRuleError, NotFoundError } from "@/lib/errors";
import { startOfDayBaghdad } from "@/lib/dates";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  ترحيل عقد قائم قبل النظام — `N3` (محسوم 2026-09-02).
 * ═══════════════════════════════════════════════════════════════════════
 *
 * > القرار: **خطة كاملة بأقساط ماضية مُعلَّمة مدفوعة** — لا قيد افتتاحي
 * > واحد مجمَّع. السجلّ الكامل يجيب عن «متى دُفع هذا؟» بعد سنتين؛
 * > والمجمَّع يعطي رصيداً صحيحاً وتاريخاً مفقوداً لا يُسترجَع.
 *
 * ── ⚠️ ولا دفعة ولا فاتورة للماضي — أهمّ قرار هنا ───────────────────
 * المال الماضي **لم يمرّ بهذا النظام**: لم يُقبض في صندوقه، ولا صدر عنه
 * وصل. وإصدارُ فاتورة له تزويرُ إيصالٍ بمالٍ لم نستلمه — ورقةٌ تبدو
 * رسمية ولا تسندها واقعة.
 *
 * وأثرٌ ثانٍ عملي: الدفعة النقدية تحتاج جلسة صندوق (‏B4)، فترحيل مئة
 * عقد كان سيُضخّم **تحصيل اليوم** بمالٍ قُبض قبل سنتين، ويكسر أهمّ
 * ضابط في النظام.
 *
 * فالمُسجَّل **قيود دفتر بمصدر `OPENING`** وحدها: هي مرجع الرصيد وهي ما
 * يُقرأ في كشف الحساب. و`Payment` إيصالُ مالٍ مرّ من هنا — ولم يمرّ.
 *
 * ── ⚠️ والتاريخ التقريبي يُعلَن لا يُخفى ────────────────────────────
 * القرار ذكر الثمن صراحةً: يحتاج **تاريخ كل دفعة ماضية**، وقد لا تكون
 * موجودة. فما لا تاريخ له يأخذ تاريخ الترحيل، **ويقول القيد ذلك بنصّه**،
 * ويُعاد عددها إلى الأدمن. تاريخٌ مقرَّب معلَن أفضل من تاريخ يبدو دقيقاً
 * وليس كذلك.
 *
 * ── ولماذا وحدة منفصلة ──────────────────────────────────────────────
 * الترحيل يجري **مرّة واحدة** عند إدخال النظام، ويكسر قواعد التشغيل
 * اليومي عمداً (بلا صندوق، بتواريخ ماضية). خلطُه مع `installments.ts`
 * كان يجعل استثناءاته تبدو قاعدة.
 */

const iqd = z.coerce.bigint().nonnegative();

export const migrateInstallmentPlan = defineAction({
  name: "migrateInstallmentPlan",
  capability: "INSTALLMENT_PLANS",
  kind: "write",
  transactional: true,
  auditAction: "installment_plan.migrate",
  auditEntityType: "InstallmentPlan",
  schema: z.object({
    contractId: z.string().min(1),
    totalAmountIqd: iqd,
    downPaymentIqd: iqd.default(0n),
    installmentsCount: z.number().int().min(1).max(240),
    intervalMonths: z.number().int().min(1).max(12).default(1),
    /** تاريخ أوّل قسط — في الماضي بحكم أن العقد قائم. */
    startDate: z.coerce.date(),
    /** الأقساط المسدَّدة: تسلسلها، وتاريخها حين يُعرف. */
    paid: z
      .array(
        z.object({
          sequence: z.number().int().min(1),
          paidAt: z.coerce.date().optional(),
        }),
      )
      .max(240)
      .default([]),
    /** ⚠️ تاريخ الترحيل — يُستعمل لما لا تاريخ له، ويُعلَن في القيد. */
    migratedAt: z.coerce.date(),
    /** إلزامي: يُكتب في كل قيد ويُقرأ عند التدقيق بعد سنوات. */
    reason: z.string().trim().min(3).max(300),
  }),
  handler: async ({ input, actor, tx }) => {
    const contract = await tx.contract.findUnique({
      where: { id: input.contractId },
      select: {
        id: true,
        status: true,
        type: true,
        contractNumber: true,
        apartmentId: true,
        plan: { select: { id: true } },
      },
    });
    if (!contract) throw new NotFoundError("العقد");
    if (contract.status !== "ACTIVE") {
      throw new BusinessRuleError("الترحيل يكون على عقد نشط. فعّل العقد أولاً.");
    }
    if (contract.plan) {
      throw new BusinessRuleError(
        `العقد «${contract.contractNumber}» عليه خطة سلفاً — لا يُرحَّل مرّتين.`,
      );
    }

    const schedule = buildSchedule({
      contractId: input.contractId,
      totalAmountIqd: input.totalAmountIqd,
      downPaymentIqd: input.downPaymentIqd,
      installmentsCount: input.installmentsCount,
      intervalMonths: input.intervalMonths,
      startDate: input.startDate,
    });

    /* ⚠️ تسلسل خارج الجدول يعني بيانات ترحيل خاطئة — يُرفض لا يُتجاهَل */
    for (const item of input.paid) {
      if (item.sequence > schedule.length) {
        throw new BusinessRuleError(
          `القسط ${item.sequence} خارج الجدول: الخطة ${schedule.length} قسطاً.`,
        );
      }
    }

    const resolved = await resolveAccountForApartment(
      contract.apartmentId,
      contract.type === "RENTAL" ? "OCCUPANT" : "OWNER",
      tx,
    );
    if (!resolved.ok) throw new BusinessRuleError(resolved.messageAr);
    const accountId = resolved.accountId;

    const plan = await tx.installmentPlan.create({
      data: {
        contractId: contract.id,
        totalAmountIqd: input.totalAmountIqd,
        downPaymentIqd: input.downPaymentIqd,
        installmentsCount: input.installmentsCount,
        intervalMonths: input.intervalMonths,
        startDate: input.startDate,
        status: "ACTIVE",
      },
      select: { id: true },
    });

    const paidBySequence = new Map(input.paid.map((x) => [x.sequence, x.paidAt]));
    const today = startOfDayBaghdad(input.migratedAt);

    let approximateDates = 0;
    let chargedIqd = 0n;
    let settledIqd = 0n;

    for (const item of schedule) {
      const isPaid = paidBySequence.has(item.sequence);
      const exactDate = paidBySequence.get(item.sequence);
      const due = item.dueDate.getTime() <= today.getTime();

      const created = await tx.installment.create({
        data: {
          planId: plan.id,
          sequence: item.sequence,
          dueDate: item.dueDate,
          amountIqd: item.amountIqd,
          status: isPaid ? "PAID" : due ? "OVERDUE" : "PENDING",
          paidAt: isPaid ? (exactDate ?? input.migratedAt) : null,
          /* ⚠️ `paymentId` يبقى فارغاً: لا دفعة في هذا النظام لمالٍ ماضٍ */
        },
        select: { id: true },
      });

      /*
       * ⚠️ **ما لم يستحقّ لا يُقيَّد.** الأقساط القادمة تبقى مجدولة،
       * ويُقيّدها `cron/installments` في موعدها — وهو يتخطّى ما قُيّد سلفاً
       * بوجود القيد نفسه، فلا يزدوج مع ما رُحِّل.
       */
      if (!due && !isPaid) continue;

      const approximate = isPaid && exactDate === undefined;
      if (approximate) approximateDates += 1;

      await postEntry(
        {
          accountId,
          type: "CHARGE",
          source: "OPENING",
          amountIqd: item.amountIqd,
          descriptionAr: `القسط ${item.sequence} من ${schedule.length} — عقد ${contract.contractNumber} (ترحيل)`,
          installmentId: created.id,
          reason: input.reason,
          createdByUserId: actor.userId,
        },
        tx,
      );
      chargedIqd += item.amountIqd;

      if (!isPaid) continue;

      await postEntry(
        {
          accountId,
          type: "PAYMENT",
          source: "OPENING",
          amountIqd: item.amountIqd,
          descriptionAr: approximate
            ? `سداد القسط ${item.sequence} — مُرحَّل، والتاريخ تقريبي`
            : `سداد القسط ${item.sequence} — مُرحَّل`,
          installmentId: created.id,
          reason: input.reason,
          createdByUserId: actor.userId,
        },
        tx,
      );
      settledIqd += item.amountIqd;
    }

    /*
     * ── الدفعة المقدّمة المُرحَّلة ─────────────────────────────────────
     * ⚠️ قيدان يتعادلان، بلا دفعة ولا فاتورة — لنفس سبب الأقساط الماضية.
     * ووجودُها في الكشف يجعل قيمة العقد مكتملة ظاهرةً، بدل أن يبدو الفرق
     * نقصاً لا تفسير له.
     */
    if (input.downPaymentIqd > 0n) {
      await postEntry(
        {
          accountId,
          type: "CHARGE",
          source: "OPENING",
          amountIqd: input.downPaymentIqd,
          descriptionAr: `دفعة مقدّمة — عقد ${contract.contractNumber} (ترحيل)`,
          reason: input.reason,
          createdByUserId: actor.userId,
        },
        tx,
      );
      await postEntry(
        {
          accountId,
          type: "PAYMENT",
          source: "OPENING",
          amountIqd: input.downPaymentIqd,
          descriptionAr: "سداد الدفعة المقدّمة — مُرحَّل",
          reason: input.reason,
          createdByUserId: actor.userId,
        },
        tx,
      );
      chargedIqd += input.downPaymentIqd;
      settledIqd += input.downPaymentIqd;
    }

    /* خطةٌ سُدّدت كلّها قبل الترحيل تُقفَل فوراً */
    const remaining = await tx.installment.count({
      where: { planId: plan.id, status: { in: ["PENDING", "OVERDUE"] } },
    });
    if (remaining === 0) {
      await tx.installmentPlan.update({
        where: { id: plan.id },
        data: { status: "COMPLETED" },
      });
    }

    return {
      id: plan.id,
      planId: plan.id,
      installments: schedule.length,
      paidCount: input.paid.length,
      /** ⚠️ يُعرَض للأدمن: كم تاريخاً دخل تقريبياً لا دقيقاً. */
      approximateDates,
      openingBalanceIqd: chargedIqd - settledIqd,
      planCompleted: remaining === 0,
    };
  },
});
