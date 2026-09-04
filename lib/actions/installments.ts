import { z } from "zod";
import { randomUUID } from "node:crypto";
import { defineAction } from "./define-action";
import { postEntry } from "@/lib/ledger/post-entry";
import { issueInvoiceForPayment } from "@/lib/services/invoicing";
import { buildSchedule, listPlans, markOverdue } from "@/lib/services/installments";
import { openDrawerIdFor } from "@/lib/services/cash-drawer";
import { resolveAccountForApartment } from "@/lib/services/resolve-account";
import { BusinessRuleError, NotFoundError } from "@/lib/errors";
import { now, startOfDayBaghdad } from "@/lib/dates";
import { formatIqd } from "@/lib/money";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  إجراءات الأقساط — الخطوة 3.5 · القرار `B1`.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ⚠️ `createInstallmentPlan` **إجراء مالي** ───────────────────────
 * القرار `B1` جعل الدفعة المقدّمة **مالاً مقبوضاً**. فالإجراء ينتج في
 * معاملة واحدة: خطة + جدول أقساط + قيد استحقاق بالمقدّمة + دفعة +
 * فاتورة. وفشلُ أيّها يتراجع بالكل — وإلا صارت خطةٌ بلا وصلٍ لمالٍ قُبض.
 *
 * ── والقدرة `INSTALLMENT_PLANS` ─────────────────────────────────────
 * أدمن كتابةً · مالك قراءةً · موظّف كتابةً **على المُسنَد إليه** (متابعة
 * وتعليم دفع) · ساكن يرى أقساطه.
 */

const iqd = z.coerce.bigint().nonnegative();

export const createInstallmentPlan = defineAction({
  name: "createInstallmentPlan",
  capability: "INSTALLMENT_PLANS",
  kind: "write",
  transactional: true,
  auditAction: "installment_plan.create",
  auditEntityType: "InstallmentPlan",
  schema: z.object({
    contractId: z.string().min(1),
    totalAmountIqd: iqd,
    /** `B1`: مقبوضة عند التوقيع — تُسجَّل دفعةً بوصل وفاتورة. */
    downPaymentIqd: iqd.default(0n),
    installmentsCount: z.number().int().min(1).max(240),
    intervalMonths: z.number().int().min(1).max(12).default(1),
    /** ⚠️ تاريخ **أوّل قسط** لا تاريخ العقد. */
    startDate: z.coerce.date(),
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
        holderUserId: true,
        plan: { select: { id: true } },
      },
    });
    if (!contract) throw new NotFoundError("العقد");

    /*
     * ⚠️ **العقد النشط وحده.** خطةٌ على مسوّدة تُقيّد مالاً على عقد قد
     * يُعدَّل أو يُلغى قبل أن يُوقَّع — والقيد لا يُحذف بعدها (‏R29).
     */
    if (contract.status !== "ACTIVE") {
      throw new BusinessRuleError(
        "خطة الأقساط تُنشأ على عقد نشط. فعّل العقد أولاً.",
      );
    }

    /* ⚠️ `contractId` فريد في المخطّط — الرسالة تسبق خطأ القاعدة الخام */
    if (contract.plan) {
      throw new BusinessRuleError(
        `العقد «${contract.contractNumber}» عليه خطة أقساط سلفاً. عدّلها بدل إنشاء ثانية.`,
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

    await tx.installment.createMany({
      data: schedule.map((s) => ({
        planId: plan.id,
        sequence: s.sequence,
        dueDate: s.dueDate,
        amountIqd: s.amountIqd,
        status: "PENDING" as const,
      })),
    });

    /*
     * ── الدفعة المقدّمة — قلب القرار `B1` ────────────────────────────
     * تُقيَّد استحقاقاً ثم تُسدَّد فوراً، فيعود الرصيد إلى ما كان. والنتيجة
     * أن للمقدّمة **وصلاً وفاتورة** كأي مال يدخل، ولا تبقى ديناً على من
     * دفعها.
     */
    let downPayment: { paymentId: string; invoiceNumber: string } | null = null;

    if (input.downPaymentIqd > 0n) {
      /**
       * ⚠️ **الحساب يُحلّ بـ`R28` لا يُختار.** والدفعة المقدّمة تخصّ عقد
       * التمليك، فالدافع `OWNER` — حتى لو كانت الشقة مؤجَّرة، إذ المستأجر
       * لا يشتريها. وتمريرُ `OCCUPANT` كان يقيّد ثمن البيع على المستأجر.
       */
      const resolved = await resolveAccountForApartment(
        contract.apartmentId,
        contract.type === "RENTAL" ? "OCCUPANT" : "OWNER",
        tx,
      );
      if (!resolved.ok) throw new BusinessRuleError(resolved.messageAr);
      const account = { accountId: resolved.accountId };

      const sessionId = await openDrawerIdFor(actor.userId, tx);
      if (!sessionId) {
        /*
         * ── 🔴 النقد يمرّ من الصندوق — لا استثناء للمقدّمة ────────────
         * قيد `payment_cash_needs_drawer` (‏B4) أوقف أوّل محاولة، **وكان
         * محقّاً**: المقدّمة **مال يُقبض**، وغالباً أكبر مبلغ في العقد كلّه.
         * وتسجيلُها بلا جلسة صندوق يفتح في الضابط ثغرةً بحجمها.
         */
        throw new BusinessRuleError(
          "لا صندوق مفتوح باسمك. افتح صندوقاً قبل قبض الدفعة المقدّمة — القرار B4.",
        );
      }

      const at = now();

      await postEntry(
        {
          accountId: account.accountId,
          type: "CHARGE",
          source: "INSTALLMENT",
          amountIqd: input.downPaymentIqd,
          descriptionAr: `دفعة مقدّمة — عقد ${contract.contractNumber}`,
          createdByUserId: actor.userId,
        },
        tx,
      );

      const payment = await tx.payment.create({
        data: {
          accountId: account.accountId,
          amountIqd: input.downPaymentIqd,
          method: "CASH_AT_CENTER",
          status: "PAID",
          purpose: "INSTALLMENT",
          referenceId: `DOWN-${randomUUID()}`,
          paidAt: at,
          receivedByUserId: actor.userId,
          cashDrawerSessionId: sessionId,
          notes: `دفعة مقدّمة عند توقيع العقد ${contract.contractNumber}`,
        },
        select: { id: true },
      });

      const entry = await postEntry(
        {
          accountId: account.accountId,
          type: "PAYMENT",
          source: "INSTALLMENT",
          amountIqd: input.downPaymentIqd,
          descriptionAr: `سداد الدفعة المقدّمة — عقد ${contract.contractNumber}`,
          paymentId: payment.id,
          createdByUserId: actor.userId,
        },
        tx,
      );

      const invoice = await issueInvoiceForPayment(tx, payment.id, {
        /* ⚠️ ما قبل = ما بعد + المبلغ: القيد `PAYMENT` يُطرَح (‏D2) */
        balanceBeforeIqd: entry.balanceIqd + input.downPaymentIqd,
        balanceAfterIqd: entry.balanceIqd,
      });

      downPayment = { paymentId: payment.id, invoiceNumber: invoice.number };
    }

    return {
      id: plan.id,
      planId: plan.id,
      installments: schedule.length,
      financedIqd: input.totalAmountIqd - input.downPaymentIqd,
      firstDueDate: schedule[0]?.dueDate ?? null,
      downPayment,
    };
  },
});

/**
 * تعليم قسط مدفوعاً.
 *
 * ── ⚠️ ذرّي: `updateMany` بشرط الحالة ───────────────────────────────
 * تعريف إنجاز 3.5 ينصّ على «تعليم الدفع ذرّي». نقرتان متزامنتان على نفس
 * القسط كانتا تُنتجان **دفعتين وقيدين** — أي سداداً مضاعفاً لدَينٍ واحد،
 * ورصيداً دائناً لا مصدر له. الشرط في جملة التحديث يجعل الثانية تُصيب صفراً.
 */
export const markInstallmentPaid = defineAction({
  name: "markInstallmentPaid",
  capability: "INSTALLMENT_PLANS",
  kind: "write",
  transactional: true,
  auditAction: "installment.mark_paid",
  auditEntityType: "Installment",
  schema: z.object({
    installmentId: z.string().min(1),
    notes: z.string().trim().max(300).optional(),
  }),
  handler: async ({ input, actor, tx }) => {
    const installment = await tx.installment.findUnique({
      where: { id: input.installmentId },
      select: {
        id: true,
        sequence: true,
        amountIqd: true,
        status: true,
        plan: {
          select: {
            id: true,
            installmentsCount: true,
            contract: {
              select: { contractNumber: true, apartmentId: true, type: true },
            },
          },
        },
      },
    });
    if (!installment) throw new NotFoundError("القسط");

    if (installment.status === "PAID") {
      throw new BusinessRuleError("القسط مدفوع سلفاً — لا يُسدَّد مرّتين.");
    }
    if (installment.status === "CANCELLED") {
      throw new BusinessRuleError("القسط ملغى. لا يُسدَّد الملغى.");
    }

    const resolved = await resolveAccountForApartment(
      installment.plan.contract.apartmentId,
      installment.plan.contract.type === "RENTAL" ? "OCCUPANT" : "OWNER",
      tx,
    );
    if (!resolved.ok) throw new BusinessRuleError(resolved.messageAr);
    const account = { accountId: resolved.accountId };

    /**
     * ── 🔴 النقد يمرّ من الصندوق — لا استثناء للأقساط ─────────────────
     * قيد `payment_cash_needs_drawer` (‏B4) أوقف أوّل محاولة، **وكان
     * محقّاً**: من يُعلّم قسطاً مدفوعاً **يقبض نقداً**. وتسجيلُه بلا جلسة
     * صندوق يفتح في الضابط نفسه ثغرةً بحجم الأقساط كلّها — أي معظم مال
     * المجمَّع.
     *
     * فالمسار واحد: يُفتح الصندوق، ويُقبض، ويُقفَل بمبلغ مُقرّ في نفس
     * اليوم. ولا طريق ثانٍ يلتفّ عليه.
     */
    const sessionId = await openDrawerIdFor(actor.userId, tx);
    if (!sessionId) {
      throw new BusinessRuleError(
        "لا صندوق مفتوح باسمك. افتح صندوقاً قبل قبض النقد — القرار B4.",
      );
    }

    const at = now();

    /* ⚠️ الحجز أوّلاً: من يُصِب صفراً هنا لا يُنشئ دفعةً ولا قيداً */
    const claimed = await tx.installment.updateMany({
      where: { id: installment.id, status: { in: ["PENDING", "OVERDUE"] } },
      data: { status: "PAID", paidAt: at },
    });
    if (claimed.count === 0) {
      throw new BusinessRuleError("القسط تغيّرت حالته للتوّ. أعد تحميل الصفحة.");
    }

    const payment = await tx.payment.create({
      data: {
        accountId: account.accountId,
        amountIqd: installment.amountIqd,
        method: "CASH_AT_CENTER",
        status: "PAID",
        purpose: "INSTALLMENT",
        referenceId: `INST-${randomUUID()}`,
        paidAt: at,
        receivedByUserId: actor.userId,
        cashDrawerSessionId: sessionId,
        notes: input.notes ?? null,
      },
      select: { id: true },
    });

    const entry = await postEntry(
      {
        accountId: account.accountId,
        type: "PAYMENT",
        source: "INSTALLMENT",
        amountIqd: installment.amountIqd,
        descriptionAr: `سداد القسط ${installment.sequence} من ${installment.plan.installmentsCount} — عقد ${installment.plan.contract.contractNumber}`,
        paymentId: payment.id,
        installmentId: installment.id,
        createdByUserId: actor.userId,
      },
      tx,
    );

    await tx.installment.update({
      where: { id: installment.id },
      data: { paymentId: payment.id },
    });

    const invoice = await issueInvoiceForPayment(tx, payment.id, {
      balanceBeforeIqd: entry.balanceIqd + installment.amountIqd,
      balanceAfterIqd: entry.balanceIqd,
    });

    /*
     * ⚠️ **الخطة تُقفَل حين لا يبقى ما يُدفع.** خطةٌ مكتملة تبقى `ACTIVE`
     * تظهر أبداً في «المتابعة»، فتُغرق الشاشة بما لا يحتاج متابعة.
     */
    const remaining = await tx.installment.count({
      where: { planId: installment.plan.id, status: { in: ["PENDING", "OVERDUE"] } },
    });
    if (remaining === 0) {
      await tx.installmentPlan.update({
        where: { id: installment.plan.id },
        data: { status: "COMPLETED" },
      });
    }

    return {
      id: installment.id,
      paymentId: payment.id,
      invoiceNumber: invoice.number,
      balanceIqd: entry.balanceIqd,
      planCompleted: remaining === 0,
      amountLabel: formatIqd(installment.amountIqd),
    };
  },
});

/**
 * تسجيل متابعة على قسط — من تابع، ومتى، وبماذا.
 *
 * ⚠️ **لا أثر مالي.** هذه ملاحظة تحصيل لا قيد. وخلطُها بالسداد كان يجعل
 * «كلّمتُه وسيدفع غداً» تُسقط الدَين.
 */
export const recordFollowUp = defineAction({
  name: "recordFollowUp",
  capability: "INSTALLMENT_PLANS",
  kind: "write",
  auditAction: "installment.follow_up",
  auditEntityType: "Installment",
  schema: z.object({
    installmentId: z.string().min(1),
    note: z.string().trim().min(3).max(500),
  }),
  handler: async ({ input, actor, tx }) => {
    const found = await tx.installment.findUnique({
      where: { id: input.installmentId },
      select: { id: true, status: true },
    });
    if (!found) throw new NotFoundError("القسط");
    if (found.status === "PAID" || found.status === "CANCELLED") {
      throw new BusinessRuleError("لا متابعة على قسط مدفوع أو ملغى.");
    }

    await tx.installment.update({
      where: { id: input.installmentId },
      data: {
        followUpStaffId: actor.userId,
        lastFollowUpAt: now(),
        followUpNote: input.note,
      },
    });

    return { id: input.installmentId, at: now() };
  },
});

export const listInstallmentPlans = defineAction({
  name: "listInstallmentPlans",
  capability: "INSTALLMENT_PLANS",
  kind: "read",
  schema: z
    .object({
      status: z.enum(["ACTIVE", "COMPLETED", "CANCELLED"]).optional(),
      search: z.string().trim().min(1).max(80).optional(),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(25),
    })
    .default({ page: 1, pageSize: 25 }),
  handler: async ({ input, tx }) => {
    const { rows, total } = await listPlans(
      {
        ...(input.status ? { status: input.status } : {}),
        ...(input.search ? { search: input.search } : {}),
      },
      input.page,
      input.pageSize,
      tx,
    );
    return { rows, total, page: input.page, pageSize: input.pageSize };
  },
});

export const getInstallmentPlan = defineAction({
  name: "getInstallmentPlan",
  capability: "INSTALLMENT_PLANS",
  kind: "read",
  schema: z.object({ planId: z.string().min(1) }),
  handler: async ({ input, tx }) => {
    const plan = await tx.installmentPlan.findUnique({
      where: { id: input.planId },
      select: {
        id: true,
        totalAmountIqd: true,
        downPaymentIqd: true,
        installmentsCount: true,
        intervalMonths: true,
        status: true,
        startDate: true,
        contract: {
          select: {
            contractNumber: true,
            type: true,
            apartment: { select: { displayNumber: true } },
            holder: { select: { fullName: true } },
          },
        },
        installments: {
          orderBy: { sequence: "asc" },
          select: {
            id: true,
            sequence: true,
            dueDate: true,
            amountIqd: true,
            status: true,
            paidAt: true,
            lastFollowUpAt: true,
            followUpNote: true,
            followUpStaff: { select: { user: { select: { fullName: true } } } },
          },
        },
      },
    });
    if (!plan) return null;
    return plan;
  },
});

/**
 * قلب المتأخّرات — تستدعيها `/api/cron/installments`.
 *
 * ⚠️ **لا قيد هنا.** القيد أنشأه توليدُ الاستحقاق؛ وهذا تغيير حالة يُبرز
 * ما تأخّر في شاشة المتابعة. وإضافة غرامة قرارٌ لم يُتّخذ.
 */
export const sweepOverdueInstallments = defineAction({
  name: "sweepOverdueInstallments",
  capability: "INSTALLMENT_PLANS",
  kind: "write",
  auditAction: "installment.sweep_overdue",
  auditEntityType: "Installment",
  schema: z.object({ at: z.coerce.date().optional() }),
  handler: async ({ input, tx }) =>
    markOverdue(startOfDayBaghdad(input.at ?? now()), tx),
});
