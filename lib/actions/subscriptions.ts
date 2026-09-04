import { z } from "zod";
import { defineAction } from "./define-action";
import { prisma } from "@/lib/prisma";
import { resolveAccountForApartment } from "@/lib/services/resolve-account";
import { computePeriodAmount, prorateFirstPeriod } from "@/lib/domain/pricing";
import { alignedCycleWindow, now } from "@/lib/dates";
import { activateSubscription } from "@/lib/services/subscription-activation";
import { BusinessRuleError, NotFoundError } from "@/lib/errors";
import { residentApartmentIds } from "@/lib/auth/scope";
import { residentsCountByApartment } from "@/lib/services/statistics";
import { writeAudit } from "@/lib/audit";
import { SUBSCRIPTION_SUBJECT_TYPE } from "@/lib/domain/enums";
import type { BillingCycle, Prisma, PricingModel } from "@/lib/generated/prisma/client";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  دورة حياة الاشتراك — الخطوة 2.4.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ما فُتح بـ`B2` ──────────────────────────────────────────────────
 * القرار (‏2026-08-28): **التقسيط بالتناسب**. الفترة الأولى تبدأ يوم
 * الموافقة وتنتهي مع الدورة المحاذية، ويُقيَّد عليها ما يقابل أيامها.
 * الحساب نفسه في `prorateFirstPeriod`، وهنا وصلُه بالبيانات.
 *
 * ── ⚠️ `R25` — الطلب لا يُنتج قيداً ────────────────────────────────
 * `PENDING_APPROVAL` **لا مال فيه**. الساكن يطلب، ولا شيء يُقيَّد على
 * حسابه حتى يوافق الأدمن. ولهذا `accountId` قابل لـnull حتى الموافقة
 * (‏Q26): ساكنٌ في وحدة مؤجّرة من الشركة قد لا يكون له حساب أصلاً وقت
 * الطلب، وإلزامُه به يمنعه من **الطلب** لا من الاشتراك.
 *
 * ── ⚠️ `Q39` — التكرار يمنعه فهرس لا شرط في الكود ──────────────────
 * `uniq_subscription_charge_per_period` فريد على `(subscriptionId,
 * periodStart)`. ونقرة مزدوجة على «موافقة» تصل الخادم مرّتين متوازيتين،
 * فتقرأ كلتاهما `PENDING_APPROVAL` قبل أن تكتب الأخرى. الشرط في الكود
 * لا يمنع ذلك؛ الفهرس يمنعه. وخدمة `ONE_TIME` تأخذ
 * `periodStart = startDate` لا `null` كي يعمل الفهرس عليها أيضاً.
 */


// ═══════════════════════════════════════════════════════════════════════
//  الإنشاء والطلب — كلاهما `PENDING_APPROVAL` بلا قيد
// ═══════════════════════════════════════════════════════════════════════

const createSchema = z.object({
  serviceId: z.string().min(1),
  subjectType: z.enum(SUBSCRIPTION_SUBJECT_TYPE),
  /** إلزامي في الحالتين — قيد `subscription_subject_consistent`. */
  apartmentId: z.string().min(1),
  /** إلزامي حين `subjectType = RESIDENT`. */
  residentUserId: z.string().min(1).optional(),
  quantity: z.number().int().min(1).optional(),
  notes: z.string().trim().max(500).optional(),
});

/**
 * يبني صفّ الاشتراك المعلّق — مشترك بين مسار الأدمن ومسار الساكن.
 *
 * ⚠️ **لا تسعير هنا.** السعر يُحسب **يوم الموافقة** لا يوم الطلب: طلبٌ
 * ينتظر أسبوعاً ثم يُوافَق عليه بسعرٍ تغيّر يجب أن يحمل السعر الجديد،
 * و`R23` يحمي **الاشتراك القائم** من تغيّر السعر لا الطلبَ المعلّق.
 */
async function createPending(
  input: z.infer<typeof createSchema>,
  requestedByUserId: string,
) {
  const service = await prisma.service.findUnique({
    where: { id: input.serviceId },
    select: { id: true, isAvailable: true, appliesTo: true, payerType: true, billingCycle: true },
  });
  if (!service) throw new NotFoundError("الخدمة");

  if (!service.isAvailable) {
    throw new BusinessRuleError(
      "الخدمة غير متاحة للاشتراك حالياً.",
      "R24",
    );
  }

  if (input.subjectType === "RESIDENT" && !input.residentUserId) {
    throw new BusinessRuleError("اشتراك على ساكن يحتاج تحديد الساكن.");
  }

  /**
   * ⚠️ `appliesTo` يُفحص هنا لا في القاعدة: القيد يضمن اتّساق الحقول
   * (‏`apartmentId` موجود) ولا يعرف أن الخدمة «على الشقق» فلا تُشترَك
   * على ساكن. `BOTH` تقبل الاثنين.
   */
  if (service.appliesTo !== "BOTH" && service.appliesTo !== input.subjectType) {
    throw new BusinessRuleError(
      service.appliesTo === "APARTMENT"
        ? "هذه الخدمة تنطبق على الشقق لا على الأفراد."
        : "هذه الخدمة تنطبق على الأفراد لا على الشقق.",
    );
  }

  return prisma.subscription.create({
    data: {
      serviceId: service.id,
      subjectType: input.subjectType,
      apartmentId: input.apartmentId,
      residentUserId: input.subjectType === "RESIDENT" ? input.residentUserId! : null,
      // ⚠️ R25: لا حساب ولا قيد حتى الموافقة (‏Q26)
      accountId: null,
      payerType: service.payerType,
      quantity: input.quantity ?? 1,
      // لقطتان مؤقّتتان — تُكتبان بالسعر الحقيقي عند الموافقة
      unitPriceSnapshotIqd: 0n,
      periodAmountIqd: 0n,
      billingCycle: service.billingCycle,
      status: "PENDING_APPROVAL",
      startDate: now(),
      requestedByUserId,
      notes: input.notes ?? null,
    },
    select: { id: true, status: true },
  });
}

export const createSubscription = defineAction({
  name: "createSubscription",
  capability: "SUBSCRIPTIONS",
  kind: "write",
  schema: createSchema,
  auditAction: "subscription.create",
  auditEntityType: "Subscription",
  handler: ({ input, actor }) => createPending(input, actor.userId),
});

/**
 * طلب الساكن.
 *
 * ── ⚠️ **لماذا ليست `defineAction`** ────────────────────────────────
 * خليّة §3.2 للساكن على `SUBSCRIPTIONS`:
 *
 *     { level: "OWN", specValue: "R (own) + request subscribe/unsubscribe",
 *       requestBased: true }
 *
 * و`LEVEL_ACTIONS.OWN = {read}` — أي أن `can("RESIDENT", …, "update")`
 * يُرجع `false`. فمرّرتُها أولاً عبر `defineAction` فرُفض **طلبُ الساكن
 * نفسه** بـ«لا تملك صلاحية». كشفه اختبار لا قراءة.
 *
 * والعلم `requestBased: true` هو الجواب: كتابة الساكن **تمرّ بنظام الطلب
 * لا بصلاحية مباشرة** (‏§3.3). ورفعُه إلى `WRITE` كان سيمنحه تعديل
 * اشتراكات المجمّع كلّه — تجاوزاً هائلاً لـ«طلبٌ على وحدتي».
 *
 * فالنطاق **بنيويّ**: الشقة تُطابَق على `residentApartmentIds` من الجلسة،
 * لا على مُدخل المتصل. ولا وسيط يمكن التلاعب به ليطلب على شقة غيره.
 * نفس نمط جرس الإخطارات وتواجد الموظف.
 */
export async function requestSubscription(
  input: z.infer<typeof createSchema>,
  requesterUserId: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<{ id: string }> {
  const parsed = createSchema.parse(input);

  const mine = await residentApartmentIds(requesterUserId);
  if (!mine.includes(parsed.apartmentId)) {
    throw new BusinessRuleError("لا يمكنك الطلب على شقة غير مرتبطة بحسابك.");
  }

  /**
   * ⚠️ وطلبٌ على **ساكن آخر** مرفوض أيضاً. سكنُهما في وحدة واحدة يجعل
   * الشقة مشتركة، ولا يجعل أحدهما وكيلاً عن الآخر في التزام مالي.
   */
  if (parsed.subjectType === "RESIDENT" && parsed.residentUserId !== requesterUserId) {
    throw new BusinessRuleError("لا يمكنك طلب خدمة شخصية باسم ساكن آخر.");
  }

  const created = await createPending(parsed, requesterUserId);

  await writeAudit({
    actorUserId: requesterUserId,
    action: "subscription.request",
    entityType: "Subscription",
    entityId: created.id,
    after: { status: created.status, serviceId: parsed.serviceId },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  return { id: created.id };
}

// ═══════════════════════════════════════════════════════════════════════
//  الموافقة — هنا يُقيَّد المال أول مرّة
// ═══════════════════════════════════════════════════════════════════════

const approveSchema = z.object({ subscriptionId: z.string().min(1) });

export const approveSubscription = defineAction({
  name: "approveSubscription",
  capability: "SUBSCRIPTIONS",
  kind: "write",
  transactional: true,
  schema: approveSchema,
  auditAction: "subscription.approve",
  auditEntityType: "Subscription",
  handler: async ({ input, actor, tx }) => {
    const sub = await tx.subscription.findFirst({
      where: { id: input.subscriptionId, deletedAt: null },
      select: { id: true, status: true, apartmentId: true },
    });
    if (!sub) throw new NotFoundError("الاشتراك");
    if (!sub.apartmentId) throw new BusinessRuleError("اشتراك بلا شقة لا يُقيَّد.");

    if (sub.status !== "PENDING_APPROVAL") {
      throw new BusinessRuleError(
        `الاشتراك ليس بانتظار الموافقة — حالته الآن «${sub.status}».`,
      );
    }

    /**
     * ⚠️ **الانتقال يُحرَس بـ`updateMany` لا بالشرط أعلاه.**
     * موافقتان متوازيتان تقرآن `PENDING_APPROVAL` كلتاهما قبل أن تكتب
     * الأخرى، فالشرط أعلاه لا يرى شيئاً. و`updateMany` بشرط الحالة
     * يُسلسِلهما على قفل الصفّ: الأولى تُصيب صفّاً، والثانية صفراً.
     *
     * جرّبتُ الاعتماد على فهرس `uniq_subscription_charge_per_period` وحده
     * فمرّت الموافقتان على اشتراك **دوري**: `periodStart` هو لحظة التفعيل
     * فيختلف بالمللي ثانية، والفهرس لا يرى تكراراً. كشفه اختبار التزامن.
     *
     * ⚠️ و`accountId` يُكتب مع الحالة: قيد
     * `subscription_active_needs_account` يوجب حساباً لكل ما ليس معلّقاً،
     * فقلبُ الحالة وحدها يخرق القيد. والحساب يُحلّ قبل الحراسة لهذا.
     */
    const resolved = await resolveAccountForApartment(sub.apartmentId, (await tx.subscription.findUniqueOrThrow({ where: { id: sub.id }, select: { payerType: true } })).payerType, tx);
    if (!resolved.ok) throw new BusinessRuleError(resolved.messageAr, "R28");

    const claimed = await tx.subscription.updateMany({
      where: { id: sub.id, status: "PENDING_APPROVAL" },
      data: { status: "ACTIVE", accountId: resolved.accountId },
    });
    if (claimed.count === 0) {
      throw new BusinessRuleError("جرت الموافقة على هذا الاشتراك بالفعل.");
    }

    // التسعير والتقسيط والقيد — في موضع واحد يشترك فيه مسار الإشغال
    const result = await activateSubscription(tx, sub.id, { actorUserId: actor.userId });

    return { id: sub.id, ...result };
  },
});

export const rejectSubscription = defineAction({
  name: "rejectSubscription",
  capability: "SUBSCRIPTIONS",
  kind: "write",
  schema: z.object({
    subscriptionId: z.string().min(1),
    reason: z.string().trim().min(3).max(500),
  }),
  auditAction: "subscription.reject",
  auditEntityType: "Subscription",
  handler: async ({ input }) => {
    const sub = await prisma.subscription.findFirst({
      where: { id: input.subscriptionId, deletedAt: null },
      select: { status: true, notes: true },
    });
    if (!sub) throw new NotFoundError("الاشتراك");
    if (sub.status !== "PENDING_APPROVAL") {
      throw new BusinessRuleError("لا يُرفض إلا اشتراك بانتظار الموافقة.");
    }

    await prisma.subscription.update({
      where: { id: input.subscriptionId },
      // ⚠️ `CANCELLED` لا حالة «مرفوض»: الـenum لا يحملها، والسبب في
      // الملاحظات وفي التدقيق. اختراع حالة يوجب هجرة مخطّط لا تخصّ 2.4.
      data: {
        status: "CANCELLED",
        endDate: now(),
        nextChargeDate: null,
        notes: [sub.notes, `رُفض: ${input.reason}`].filter(Boolean).join(" · "),
      },
    });
    return { id: input.subscriptionId, subscriptionId: input.subscriptionId };
  },
});

// ═══════════════════════════════════════════════════════════════════════
//  تغيير الكمية · الإلغاء
// ═══════════════════════════════════════════════════════════════════════

export const updateSubscriptionQuantity = defineAction({
  name: "updateSubscriptionQuantity",
  capability: "SUBSCRIPTIONS",
  kind: "write",
  schema: z.object({
    subscriptionId: z.string().min(1),
    quantity: z.number().int().min(1),
  }),
  auditAction: "subscription.quantity.change",
  auditEntityType: "Subscription",
  handler: async ({ input }) => {
    const sub = await prisma.subscription.findFirst({
      where: { id: input.subscriptionId, deletedAt: null },
      select: {
        status: true,
        quantity: true,
        periodAmountIqd: true,
        unitPriceSnapshotIqd: true,
        apartmentId: true,
        service: {
          select: {
            pricingModel: true,
            basePriceIqd: true,
            unitPriceIqd: true,
            minUnits: true,
            maxUnits: true,
          },
        },
      },
    });
    if (!sub) throw new NotFoundError("الاشتراك");
    if (sub.status === "CANCELLED") {
      throw new BusinessRuleError("لا تُغيَّر كمية اشتراك ملغى.");
    }
    if (sub.service.pricingModel !== "PER_UNIT") {
      throw new BusinessRuleError(
        "الكمية تُغيَّر لخدمات «سعر الوحدة» وحدها. عدد الأفراد مشتقّ من السكان (‏Q5).",
        "Q5",
      );
    }

    /**
     * ⚠️ **لقطة سعر جديدة، والقيود السابقة لا تُمسّ.**
     * `R23` يحمي ما قُيّد فعلاً: تغيير الكمية اليوم يغيّر ما يُقيَّد **من
     * الدورة القادمة**. تعديل قيد ماضٍ ممنوع في القاعدة أصلاً بـtrigger،
     * فالمحاولة هنا كانت سترمي لا تنجح.
     */
    const pricing = computePeriodAmount(sub.service, { quantity: input.quantity });

    await prisma.subscription.update({
      where: { id: input.subscriptionId },
      data: {
        quantity: pricing.quantity,
        periodAmountIqd: pricing.periodAmountIqd,
        unitPriceSnapshotIqd: pricing.unitPriceSnapshotIqd,
      },
    });

    return {
      // ⚠️ `id` كي يلتقطه `extractId` في `defineAction` فيكتب التدقيق على
      // الكيان الصحيح. بلا مفتاح `id` كان `entityId` يُكتب `null`.
      id: input.subscriptionId,
      subscriptionId: input.subscriptionId,
      before: { quantity: sub.quantity, periodAmountIqd: sub.periodAmountIqd },
      after: { quantity: pricing.quantity, periodAmountIqd: pricing.periodAmountIqd },
    };
  },
});

export const cancelSubscription = defineAction({
  name: "cancelSubscription",
  capability: "SUBSCRIPTIONS",
  kind: "write",
  schema: z.object({
    subscriptionId: z.string().min(1),
    reason: z.string().trim().max(500).optional(),
  }),
  auditAction: "subscription.cancel",
  auditEntityType: "Subscription",
  handler: async ({ input }) => {
    const sub = await prisma.subscription.findFirst({
      where: { id: input.subscriptionId, deletedAt: null },
      select: { status: true, notes: true },
    });
    if (!sub) throw new NotFoundError("الاشتراك");
    if (sub.status === "CANCELLED") {
      throw new BusinessRuleError("الاشتراك ملغى أصلاً.");
    }

    /**
     * ⚠️ **الإلغاء لا يمسّ قيداً سابقاً.** ما استُهلك يُدفع: خدمةٌ قُيّدت
     * عن فترة جرت فعلاً تبقى مستحقّة. وتصفير `nextChargeDate` هو ما يوقف
     * الفوترة القادمة — لا حذف قيد ولا تعديله.
     */
    await prisma.subscription.update({
      where: { id: input.subscriptionId },
      data: {
        status: "CANCELLED",
        endDate: now(),
        nextChargeDate: null,
        ...(input.reason
          ? { notes: [sub.notes, `أُلغي: ${input.reason}`].filter(Boolean).join(" · ") }
          : {}),
      },
    });

    return { id: input.subscriptionId, subscriptionId: input.subscriptionId };
  },
});

// ═══════════════════════════════════════════════════════════════════════
//  الخدمة الإلزامية الجديدة — تعميمها على الشقق المسكونة (‏2.6)
// ═══════════════════════════════════════════════════════════════════════

const rolloutSchema = z.object({ serviceId: z.string().min(1) });

/**
 * معاينة تعميم خدمة إلزامية — **بلا كتابة**.
 *
 * ── لماذا معاينة إلزامية قبل التنفيذ ────────────────────────────────
 * ⚠️ تعميم خدمة إلزامية على مجمّع قائم يُقيّد مالاً على **مئات الحسابات
 * دفعةً واحدة**. وزرٌّ ينفّذ ذلك بلا رقم أمام العين هو أخطر زرّ في النظام:
 * الأدمن يضيف خدمة بـ50 ألفاً ظنّاً أنها تُطبَّق على الجديد وحده، فيكتشف
 * بعد ساعة أنه قيّد 15 مليوناً على 300 شقة.
 *
 * تعريف إنجاز 2.6 ينصّ عليه حرفياً: «يعرض **عدد الشقق والمبلغ الإجمالي
 * قبل التأكيد**».
 *
 * ── والمبلغ **مقسَّط** لا كامل ──────────────────────────────────────
 * ما سيُقيَّد فعلاً هو الفترة الأولى بالتناسب (‏B2). وعرضُ المبلغ الكامل
 * يجعل الرقم المعروض مخالفاً للرقم المُقيَّد — وهو أسوأ من عدم العرض.
 */
export const previewMandatoryRollout = defineAction({
  name: "previewMandatoryRollout",
  capability: "SUBSCRIPTIONS",
  kind: "read",
  schema: rolloutSchema,
  handler: async ({ input }) => {
    const service = await prisma.service.findUnique({
      where: { id: input.serviceId },
      select: {
        id: true,
        name: true,
        isMandatory: true,
        isAvailable: true,
        appliesTo: true,
        billingType: true,
        billingCycle: true,
        pricingModel: true,
        basePriceIqd: true,
        unitPriceIqd: true,
        minUnits: true,
        maxUnits: true,
      },
    });
    if (!service) throw new NotFoundError("الخدمة");
    if (!service.isMandatory) {
      throw new BusinessRuleError("التعميم للخدمات الإلزامية وحدها.");
    }
    if (service.appliesTo === "RESIDENT") {
      // V11: إلزامية على ساكن تركيبة لا يُنشئها أي تدفق
      throw new BusinessRuleError("خدمة إلزامية على الأفراد لا تُعمَّم بالإشغال (‏V11).");
    }

    const targets = await eligibleApartments(service.id);
    const totalIqd = await rolloutTotal(service, targets, now());

    return {
      serviceName: service.name,
      apartments: targets.length,
      totalIqd,
      /** ⚠️ يُقال صراحةً: الرقم مقسَّط لا كامل، وإلا قُرئ خطأً. */
      note:
        targets.length === 0
          ? "لا شقة مسكونة تنقصها هذه الخدمة."
          : "المبلغ مجموع الفترات الأولى مقسَّمةً بالتناسب حتى نهاية الدورة الحالية.",
    };
  },
});

/**
 * تعميم الخدمة فعلاً — يوجب `confirm` صريحاً.
 *
 * ⚠️ **`confirm` ليس تزيّناً.** الإجراء نقطة نهاية HTTP، والمعاينة تعيش في
 * الواجهة. فبلا علم صريح في المُدخل يستطيع استدعاءٌ مباشر أن يتخطّى
 * المعاينة كلها — وهي بالضبط الحماية التي وُضعت من أجلها.
 */
export const applyMandatoryRollout = defineAction({
  name: "applyMandatoryRollout",
  capability: "SUBSCRIPTIONS",
  kind: "write",
  transactional: true,
  schema: rolloutSchema.extend({
    confirm: z.literal(true, { message: "التعميم يحتاج تأكيداً صريحاً بعد المعاينة." }),
    /**
     * ما رآه الأدمن في المعاينة.
     *
     * ⚠️ **يُقارَن بما سيُنفَّذ.** بين المعاينة والتأكيد قد تُسكن شقة أو
     * تُخلى، فينفّذ الأدمن على عدد غير الذي وافق عليه. الاختلاف يُوقف
     * العملية ويطلب معاينة جديدة بدل أن يمضي على رقم لم يره أحد.
     */
    expectedApartments: z.number().int().min(0),
  }),
  auditAction: "subscription.mandatory.rollout",
  auditEntityType: "Service",
  handler: async ({ input, tx }) => {
    const service = await tx.service.findUnique({
      where: { id: input.serviceId },
      select: {
        id: true,
        name: true,
        isMandatory: true,
        isAvailable: true,
        appliesTo: true,
        billingCycle: true,
        payerType: true,
      },
    });
    if (!service) throw new NotFoundError("الخدمة");
    if (!service.isMandatory) {
      throw new BusinessRuleError("التعميم للخدمات الإلزامية وحدها.");
    }
    if (!service.isAvailable) {
      throw new BusinessRuleError("الخدمة غير متاحة — لا تُعمَّم وهي موقوفة.");
    }
    if (service.appliesTo === "RESIDENT") {
      throw new BusinessRuleError("خدمة إلزامية على الأفراد لا تُعمَّم بالإشغال (‏V11).");
    }

    const targets = await eligibleApartments(service.id, tx);

    if (targets.length !== input.expectedApartments) {
      throw new BusinessRuleError(
        `تغيّر عدد الشقق منذ المعاينة: رأيتَ ${input.expectedApartments} والآن ${targets.length}. ` +
          "أعد المعاينة قبل التأكيد.",
      );
    }

    const at = now();
    let chargedIqd = 0n;

    for (const apartmentId of targets) {
      const row = await tx.subscription.create({
        data: {
          serviceId: service.id,
          subjectType: "APARTMENT",
          apartmentId,
          accountId: null,
          payerType: service.payerType,
          quantity: 1,
          unitPriceSnapshotIqd: 0n,
          periodAmountIqd: 0n,
          billingCycle: service.billingCycle,
          status: "PENDING_APPROVAL",
          startDate: at,
          notes: `تعميم خدمة إلزامية «${service.name}».`,
        },
        select: { id: true },
      });

      /**
       * ⚠️ **فشلٌ على شقة واحدة يُرجع المعاملة كلها.**
       * التعميم عملية **واحدة** يوافق عليها الأدمن برقم واحد. وتنفيذُ 280
       * من 300 يترك النظام في حالة لا يعرفها أحد ولا رقم يصفها: بعض الشقق
       * عليها الخدمة وبعضها لا، والأدمن يظنّ أنها عُمّمت.
       *
       * فلا `try/catch` هنا عمداً: شقةٌ بلا عقد نشط لا يُحلّ حسابها (‏R28)،
       * والخطأ يصعد فيتراجع كل شيء ويُسمّى السبب.
       */
      const activated = await activateSubscription(tx, row.id, {
        actorUserId: null,
        at,
      });
      chargedIqd += activated.amountIqd;
    }

    return {
      id: service.id,
      serviceName: service.name,
      apartments: targets.length,
      chargedIqd,
    };
  },
});

/**
 * الشقق المسكونة التي تنقصها هذه الخدمة.
 *
 * ⚠️ **المسكونة وحدها.** الفارغة لا تُفوتَر خدماتها الدورية (‏§7.3)،
 * وتعميمُها عليها يُنتج قيوداً على وحدات لا يسكنها أحد.
 *
 * ⚠️ و`PAUSED` و`PENDING_APPROVAL` تُحتسبان موجودتين: الأولى اشتراك قائم
 * ينتظر استئنافاً، والثانية طلبٌ قيد النظر. وإنشاء ثالث بجانبهما يزدوج.
 */
async function eligibleApartments(
  serviceId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<string[]> {
  const rows = await db.apartment.findMany({
    where: {
      deletedAt: null,
      occupancyStatus: { not: "VACANT" },
      subscriptions: {
        none: {
          serviceId,
          status: { in: ["ACTIVE", "PAUSED", "PENDING_APPROVAL"] },
          deletedAt: null,
        },
      },
    },
    select: { id: true },
    orderBy: { displayNumber: "asc" },
  });
  return rows.map((r) => r.id);
}

/** مجموع الفترات الأولى المقسَّطة — للمعاينة وحدها، بلا كتابة. */
async function rolloutTotal(
  service: {
    billingType: string;
    billingCycle: BillingCycle | null;
    pricingModel: PricingModel;
    basePriceIqd: bigint | null;
    unitPriceIqd: bigint | null;
    minUnits: number | null;
    maxUnits: number | null;
  },
  apartmentIds: string[],
  at: Date,
): Promise<bigint> {
  if (apartmentIds.length === 0) return 0n;

  /**
   * ⚠️ عدد الأشخاص **دفعةً واحدة** لا استعلاماً لكل شقة (‏Q5).
   * معاينة على 300 شقة كانت ستُطلق 300 استعلام وتستغرق ثوانيَ — والمعاينة
   * تُفتح قبل كل تعميم.
   */
  const persons =
    service.pricingModel === "PER_PERSON"
      ? await residentsCountByApartment(apartmentIds)
      : null;

  const settings = await prisma.compoundSettings.findFirst({
    select: { billingDayOfMonth: true },
  });
  const isOneTime = service.billingType === "ONE_TIME";
  const window = isOneTime
    ? null
    : alignedCycleWindow(
        at,
        settings?.billingDayOfMonth ?? 1,
        service.billingCycle ?? "MONTHLY",
      );

  let total = 0n;
  for (const apartmentId of apartmentIds) {
    const pricing = computePeriodAmount(service, {
      quantity: 1,
      ...(persons ? { personsCount: persons.get(apartmentId) ?? 0 } : {}),
    });

    total += window
      ? prorateFirstPeriod({
          periodAmountIqd: pricing.periodAmountIqd,
          alignedStart: window.start,
          alignedNextStart: window.nextStart,
          activeFrom: at,
        }).amountIqd
      : pricing.periodAmountIqd;
  }
  return total;
}

// ═══════════════════════════════════════════════════════════════════════
//  القائمة — شاشة الإدارة
// ═══════════════════════════════════════════════════════════════════════

const listSchema = z.object({
  status: z.enum(["PENDING_APPROVAL", "ACTIVE", "PAUSED", "CANCELLED"]).optional(),
  apartmentId: z.string().optional(),
  serviceId: z.string().optional(),
  /** بحث على اسم الخدمة أو رقم الشقة — ما يعرفه الأدمن عن ظهر قلب. */
  search: z.string().trim().max(60).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
});

/**
 * قائمة الاشتراكات للإدارة.
 *
 * ⚠️ **`take` إلزامي** — بلا سقف تُجلب كل اشتراكات المجمّع: ثلاث مئة شقة
 * × أربع خدمات = 1200 صفّ في شاشة تُفتح كل صباح.
 *
 * ⚠️ و`periodAmountIqd` هو **مبلغ الدورة الكاملة** لا المقسَّط. القيد الأول
 * وحده مقسَّط (‏B2)، والشاشة تعرض ما سيُقيَّد كل دورة — وهو ما يسأل عنه
 * الأدمن. أما ما قُيّد فعلاً فيُقرأ من الدفتر.
 */
export const listSubscriptions = defineAction({
  name: "listSubscriptions",
  capability: "SUBSCRIPTIONS",
  kind: "read",
  schema: listSchema,
  handler: async ({ input }) => {
    const where = {
      deletedAt: null,
      ...(input.status ? { status: input.status } : {}),
      ...(input.apartmentId ? { apartmentId: input.apartmentId } : {}),
      ...(input.serviceId ? { serviceId: input.serviceId } : {}),
      ...(input.search
        ? {
            OR: [
              { service: { name: { contains: input.search, mode: "insensitive" as const } } },
              {
                apartment: {
                  displayNumber: { contains: input.search, mode: "insensitive" as const },
                },
              },
            ],
          }
        : {}),
    };

    const [rows, total, pendingCount] = await Promise.all([
      prisma.subscription.findMany({
        where,
        select: {
          id: true,
          status: true,
          subjectType: true,
          quantity: true,
          periodAmountIqd: true,
          billingCycle: true,
          payerType: true,
          startDate: true,
          nextChargeDate: true,
          service: { select: { id: true, name: true, pricingModel: true, isMandatory: true } },
          apartment: { select: { id: true, displayNumber: true, occupancyStatus: true } },
          residentUser: { select: { id: true, fullName: true } },
        },
        /**
         * ⚠️ المعلّق أولاً **بلا ترتيب ثانٍ على الحالة**: هو ما ينتظر فعلاً
         * تدخّل الأدمن. وترتيبٌ أبجدي على الحالة كان سيدفن `PENDING_APPROVAL`
         * تحت `ACTIVE` أبداً (الألف قبل الباء في الإنجليزية).
         */
        orderBy: [{ status: "asc" }, { startDate: "desc" }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      prisma.subscription.count({ where }),
      // العدّاد على **كل** المعلّق لا على الصفحة — الشاشة تقول كم ينتظر
      prisma.subscription.count({
        where: { deletedAt: null, status: "PENDING_APPROVAL" },
      }),
    ]);

    return { rows, total, page: input.page, pageSize: input.pageSize, pendingCount };
  },
});
