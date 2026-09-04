import { z } from "zod";
import { formatIqd } from "@/lib/money";
import { randomUUID } from "node:crypto";
import { defineAction } from "./define-action";
import { postEntry } from "@/lib/ledger/post-entry";
import {
  closeDrawer,
  collectionByStaff,
  drawerHistoryFor,
  drawerSummary,
  openDrawerFor,
  openDrawerIdFor,
} from "@/lib/services/cash-drawer";
import { BusinessRuleError, NotFoundError } from "@/lib/errors";
import { now, startOfDayBaghdad } from "@/lib/dates";
import { issueInvoiceForPayment } from "@/lib/services/invoicing";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  النقد — القرار `B4` (‏2026-09-01).
 * ═══════════════════════════════════════════════════════════════════════
 *
 * القرار: **موظفون مُصرَّح لهم بالعلم · إقفال صندوق يومي إلزامي · لا
 * تأريخ في الماضي.**
 *
 * والمنطق في `lib/services/cash-drawer.ts` حيث يُختبَر بلا صلاحيات.
 * هنا الوصل بالصلاحية والدفتر.
 */

// ═══════════════════════════════════════════════════════════════════════
//  الصندوق
// ═══════════════════════════════════════════════════════════════════════

/**
 * فتح صندوقي.
 *
 * ⚠️ **`RECORD_CASH_PAYMENT` لا `LEDGER_AND_ACCOUNTS`.** الصندوق أداة من
 * يقبض النقد، ومن يقرأ الدفتر ليس بالضرورة من يقبض. وربطُه بقدرة الدفتر
 * كان سيفتحه لكل من يقرأ الحسابات.
 */
export const openMyCashDrawer = defineAction({
  name: "openMyCashDrawer",
  capability: "RECORD_CASH_PAYMENT",
  kind: "write",
  schema: z.object({}),
  auditAction: "cash_drawer.open",
  auditEntityType: "CashDrawerSession",
  handler: async ({ actor }) => {
    const summary = await openDrawerFor(actor.userId);
    return { id: summary.sessionId, ...summary };
  },
});

/**
 * إقفال صندوق بمبلغ مُقرّ.
 *
 * ⚠️ **يُقفله صاحبه أو محاسب.** والمحاسب يحتاج نفس القدرة، فالإقفال فعل
 * على نقد لا قراءة له. أما «أيّ صندوق» فيأتي بالمعرّف لا من الجلسة: من
 * يستلم من غيره يُقفل صندوق غيره.
 */
export const closeCashDrawer = defineAction({
  name: "closeCashDrawer",
  capability: "RECORD_CASH_PAYMENT",
  kind: "write",
  transactional: true,
  schema: z.object({
    sessionId: z.string().min(1),
    /** ما يُقرّ الموظف بتوريده. صفرٌ مسموح: يوم بلا تحصيل يُقفَل بصفر. */
    declaredIqd: z.coerce.bigint().min(0n),
    notes: z.string().trim().max(300).optional(),
  }),
  auditAction: "cash_drawer.close",
  auditEntityType: "CashDrawerSession",
  handler: async ({ input, actor, tx }) => {
    const summary = await closeDrawer(
      input.sessionId,
      input.declaredIqd,
      actor.userId,
      input.notes ?? null,
      tx,
    );

    /**
     * ⚠️ **الفرق يُذكر في المخرَج نصّاً.** رقمٌ سالب في حقل اسمه
     * `varianceIqd` يُقرأ بلمحة من كتبه، ولا يُقرأ من يفتح الشاشة بعد شهر.
     * والنصّ العربي يجعل «نقص 40,000» ظاهراً في التدقيق نفسه.
     */
    const variance = summary.varianceIqd ?? 0n;
    return {
      id: summary.sessionId,
      ...summary,
      varianceLabelAr:
        variance === 0n
          ? "مطابق"
          : variance < 0n
            ? `نقص ${-variance}`
            : `زيادة ${variance}`,
    };
  },
});

export const getCashDrawer = defineAction({
  name: "getCashDrawer",
  capability: "RECORD_CASH_PAYMENT",
  kind: "read",
  schema: z.object({ sessionId: z.string().min(1) }),
  handler: ({ input }) => drawerSummary(input.sessionId),
});

/**
 * تقرير «تحصيل الموظف س».
 *
 * ── ⚠️ قدرته `FINANCIAL_REPORTS` ────────────────────────────────────
 * كانت `DEPARTMENTS_SKILLS_STAFF` بحجّة أنه «تقرير على موظف». وكان ذلك
 * **خطأً كشفه اختبار**: تلك القدرة تمنح الموظف `READ` على كل الموظفين —
 * وهو مقصود للدليل (الأسماء والأقسام والمهارات)، لكنه يعني أن كل موظف
 * يقرأ فروق صناديق زملائه وأرقام تحصيلهم.
 *
 * والفرق ليس نظرياً: هذا هو **الضابط** على الثغرة الموصوفة في رأس
 * `cash-drawer.ts`، ومن يُراقَب لا يقرأ تقرير رقابته على زملائه.
 *
 * `FINANCIAL_REPORTS` تصفه بدقّة: تقرير مالي — أدمن كتابةً، مالك قراءةً،
 * وموظف لا شيء.
 */
export const staffCashHistory = defineAction({
  name: "staffCashHistory",
  capability: "FINANCIAL_REPORTS",
  kind: "read",
  schema: z.object({
    staffUserId: z.string().min(1),
    limit: z.number().int().min(1).max(90).default(30),
  }),
  handler: ({ input }) => drawerHistoryFor(input.staffUserId, input.limit),
});

// ═══════════════════════════════════════════════════════════════════════
//  الدفعة النقدية
// ═══════════════════════════════════════════════════════════════════════

export const recordCashPayment = defineAction({
  name: "recordCashPayment",
  capability: "RECORD_CASH_PAYMENT",
  kind: "write",
  transactional: true,
  schema: z.object({
    accountId: z.string().min(1),
    amountIqd: z.coerce.bigint().positive(),
    notes: z.string().trim().max(300).optional(),
  }),
  auditAction: "payment.record_cash",
  auditEntityType: "Payment",
  handler: async ({ input, actor, tx }) => {
    /**
     * ⚠️ **الصندوق أولاً.** دفعةٌ بلا جلسة مفتوحة = نقدٌ لا يسأل عنه أحد،
     * والقيد `payment_cash_needs_drawer` يمنعها في القاعدة أيضاً. الشرط
     * هنا يعطي رسالة عربية مفهومة، والقيد يحرس المسار الذي يُكتب بعد سنة
     * وينسى الشرط.
     */
    const sessionId = await openDrawerIdFor(actor.userId, tx);
    if (!sessionId) {
      throw new BusinessRuleError(
        "لا صندوق مفتوح باسمك. افتح صندوقك قبل قبض أي نقد.",
        "B4",
      );
    }

    /**
     * ⚠️ **القفل الحصري على الحساب أولاً — قبل أي إدراج.**
     *
     * كُتبت هذه أولاً بـ`findUnique` عادية، فانفجرت عشرون دفعة متوازية
     * بـ`deadlock detected` (‏Postgres 40P01). والسبب ترتيب أقفال:
     *   1. إدراج `Payment` يأخذ **قفلاً مشتركاً** على صفّ الحساب بحكم
     *      المفتاح الأجنبي (‏`FOR KEY SHARE`).
     *   2. ثم `postEntry` يطلب **قفلاً حصرياً** على نفس الصفّ.
     * فمعاملتان تحملان المشترك وتنتظران الحصري ← كلٌّ تنتظر الأخرى.
     *
     * أخذُ الحصري **قبل** الإدراج يُسلسِل المعاملات من أوّلها، فلا تحمل
     * أي منها مشتركاً وهي تنتظر. والقفل يبقى إلى نهاية المعاملة، فطلبُه
     * ثانيةً داخل `postEntry` لا يكلّف شيئاً.
     *
     * ⚠️ ولا يُستبدل بـ`findUnique` مهما بدا أنظف: الفارق ليس أسلوبياً.
     */
    const locked = await tx.$queryRaw<Array<{ id: string; status: string }>>`
      SELECT "id", "status"::text AS status
      FROM "Account"
      WHERE "id" = ${input.accountId}
      FOR UPDATE
    `;

    const account = locked[0];
    if (!account) throw new NotFoundError("الحساب");
    if (account.status !== "OPEN") {
      throw new BusinessRuleError("لا تُقبَل دفعة على حساب مغلق.", "R16");
    }

    /**
     * ⚠️ **`paidAt` هو `now()` لا مُدخَلاً** — `N4`.
     * تأريخ الدفعة في الماضي يجعل الموظف يسجّل تحصيل أمس اليوم، فيهرب من
     * إقفال أمس ويصير الضابط بلا معنى. ولا حقل تاريخ في المخطّط هنا أصلاً:
     * غيابُه من المُدخل هو التنفيذ.
     */
    const at = now();

    const payment = await tx.payment.create({
      data: {
        accountId: account.id,
        amountIqd: input.amountIqd,
        method: "CASH_AT_CENTER",
        status: "PAID",
        purpose: "MANUAL",
        // ⚠️ مرجع فريد إلزامي في المخطّط — يُولَّد لا يُطلَب من المستخدم
        referenceId: `CASH-${randomUUID()}`,
        paidAt: at,
        receivedByUserId: actor.userId,
        cashDrawerSessionId: sessionId,
        notes: input.notes ?? null,
      },
      select: { id: true },
    });

    /**
     * ⚠️ القيد **في نفس المعاملة**. دفعةٌ بلا قيد تُنقص النقد ولا تُنقص
     * الدَين — وهو ما يُنتج «إسقاط دَين مقابل سرقة» من الجهة المعاكسة.
     */
    const entry = await postEntry(
      {
        accountId: account.id,
        type: "PAYMENT",
        source: "MANUAL",
        amountIqd: input.amountIqd,
        descriptionAr: "دفعة نقدية في المركز",
        // ⚠️ `MANUAL` يوجب سبباً — والسبب هنا **المسار** لا نصّ حرّ
        reason: "دفعة نقدية مستلمة في مركز الخدمة",
        paymentId: payment.id,
        createdByUserId: actor.userId,
      },
      tx,
    );

    /**
     * ── الفاتورة — الخطوة 3.1 ──────────────────────────────────────
     *
     * ⚠️ **في نفس المعاملة.** الرقم يُحجَز من العدّاد، ولو جرى في معاملة
     * مستقلّة لبقي محجوزاً عند فشل الدفع. و`R34` يقبل الفجوات ويمنع
     * التكرار — لكن فجوةً بلا سبب تبقى سؤالاً عند التدقيق.
     *
     * ⚠️ والرصيد **قبل** يُشتقّ من بعد: القيد `PAYMENT` يُطرَح (‏D2)، فما
     * قبله = ما بعده **زائد** المبلغ. قراءتُه باستعلام ثانٍ قبل القيد كانت
     * تفتح نافذة سباق يمكن أن يقع فيها قيدٌ آخر.
     */
    const invoice = await issueInvoiceForPayment(tx, payment.id, {
      balanceBeforeIqd: entry.balanceIqd + input.amountIqd,
      balanceAfterIqd: entry.balanceIqd,
    });

    return {
      id: payment.id,
      paymentId: payment.id,
      entryId: entry.entryId,
      balanceIqd: entry.balanceIqd,
      cashDrawerSessionId: sessionId,
      paidAt: at,
      invoiceId: invoice.invoiceId,
      invoiceNumber: invoice.number,
    };
  },
});

export type { DrawerSummary } from "@/lib/services/cash-drawer";

/**
 * تحصيل اليوم لمجموعة موظفين — عمود شاشة الموظفين (‏B4).
 *
 * ⚠️ قدرته `FINANCIAL_REPORTS` لا قدرة إدارة الموظفين ولا قدرة القبض —
 * للسبب المشروح فوق `staffCashHistory`.
 */
export const staffCollectionToday = defineAction({
  name: "staffCollectionToday",
  kind: "read",
  capability: "FINANCIAL_REPORTS",
  schema: z.object({ staffUserIds: z.array(z.string().min(1)).max(200) }),
  handler: async ({ input }) => {
    const map = await collectionByStaff(input.staffUserIds, startOfDayBaghdad(now()));
    /*
     * ⚠️ يعود **مصفوفةً** لا `Map`: الـ`Map` لا تعبر حدّ الخادم/العميل في
     * RSC، وتصل `{}` بلا خطأ — فيبدو أن أحداً لم يحصّل شيئاً اليوم.
     */
    return [...map.values()].map((v) => ({
      staffUserId: v.staffUserId,
      collectedLabel: formatIqd(v.collectedIqd),
      payments: v.payments,
      hasOpenDrawer: v.hasOpenDrawer,
      staleDrawer: v.staleDrawer,
    }));
  },
});
