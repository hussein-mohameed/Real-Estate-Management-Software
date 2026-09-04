"use server";

import { z } from "zod";
import { defineAction } from "./define-action";
import { BusinessRuleError, ConflictError, NotFoundError } from "@/lib/errors";
import { violates } from "@/lib/db-errors";
import { customFieldsSchema } from "@/lib/domain/custom-fields";
import {
  BILLING_CYCLE,
  PAYER_TYPE,
  PRICING_MODEL,
  SERVICE_APPLIES_TO,
  SERVICE_BILLING_TYPE,
} from "@/lib/domain/enums";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  كتالوج الخدمات — الخطوة 2.1. «خدمة جديدة بلا كود جديد».
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── التوافقات بين الحقول فحوصٌ صريحة ────────────────────────────────
 * المخطّط يجعل `basePriceIqd` و`unitPriceIqd` و`billingCycle` كلَّها
 * اختيارية، لأن كلاً منها يلزم في نموذج تسعير دون غيره. لكن **الاختيارية
 * في المخطّط ليست اختيارية في الواقع**: خدمة `PER_UNIT` بلا سعر وحدة
 * لا يمكن تسعيرها أصلاً، وتُحفظ بلا شكوى ثم تُنتج قيداً بصفر.
 *
 * ── `R23` — تغيير السعر لا يرتدّ ────────────────────────────────────
 * لكل اشتراك **لقطة سعره** (`unitPriceSnapshotIqd`). تعديل سعر الخدمة
 * يغيّر ما يُعرَض للاشتراكات الجديدة **ولا يمسّ القائمة**. الارتداد
 * إعادةُ كتابة تاريخ مالي: فاتورة صدرت بسعر، ومراجعتها بعد سنة تُظهر
 * سعراً آخر، ولا شيء يفسّر الفرق.
 *
 * ── `R24` — خدمة لها اشتراكات لا تُحذف ─────────────────────────────
 * الحذف يقتل مراجع في الدفتر: قيدٌ يشير إلى اشتراك يشير إلى خدمة
 * محذوفة. `isAvailable = false` يمنع الجديد ويُبقي القائم مفهوماً.
 */

const iqdField = (label: string) =>
  z.union([z.string(), z.number(), z.bigint()]).transform((v, ctx) => {
    const n = typeof v === "bigint" ? v : BigInt(String(v).replace(/[\s,]/g, "") || "0");
    if (n <= 0n) {
      ctx.addIssue({ code: "custom", message: `${label} يجب أن يكون أكبر من صفر.` });
      return z.NEVER;
    }
    return n;
  });

const serviceFields = z.object({
  name: z.string().trim().min(2, "اسم الخدمة مطلوب."),
  description: z.string().trim().max(500).optional(),
  iconKey: z.string().trim().max(40).optional(),
  billingType: z.enum(SERVICE_BILLING_TYPE),
  billingCycle: z.enum(BILLING_CYCLE).optional(),
  pricingModel: z.enum(PRICING_MODEL),
  basePriceIqd: iqdField("سعر الخدمة").optional(),
  unitLabel: z.string().trim().max(30).optional(),
  unitPriceIqd: iqdField("سعر الوحدة").optional(),
  minUnits: z.number().int().min(1).optional(),
  maxUnits: z.number().int().min(1).optional(),
  payerType: z.enum(PAYER_TYPE),
  isMandatory: z.boolean().default(false),
  appliesTo: z.enum(SERVICE_APPLIES_TO),
  customFieldsSchema: customFieldsSchema.optional(),
  notes: z.string().trim().max(1000).optional(),
});

/** التوافقات — تُطبَّق على الإنشاء وعلى التعديل معاً. */
function refineService(
  v: z.infer<typeof serviceFields>,
  ctx: z.RefinementCtx,
): void {
  if (v.billingType === "RECURRING" && !v.billingCycle) {
    ctx.addIssue({
      code: "custom",
      path: ["billingCycle"],
      message: "دورة الفوترة مطلوبة للخدمة الدورية.",
    });
  }
  if (v.billingType === "ONE_TIME" && v.billingCycle) {
    ctx.addIssue({
      code: "custom",
      path: ["billingCycle"],
      message: "الخدمة لمرّة واحدة لا دورة فوترة لها.",
    });
  }

  if (v.pricingModel === "FLAT" && !v.basePriceIqd) {
    ctx.addIssue({
      code: "custom",
      path: ["basePriceIqd"],
      message: "سعر الخدمة مطلوب للتسعير الثابت.",
    });
  }

  if (v.pricingModel === "PER_UNIT") {
    if (!v.unitPriceIqd) {
      ctx.addIssue({
        code: "custom",
        path: ["unitPriceIqd"],
        message: "سعر الوحدة مطلوب للتسعير بالوحدة.",
      });
    }
    if (!v.unitLabel) {
      // بلا تسمية يقرأ المستخدم «الكمية: 5» ولا يعرف خمسة ماذا
      ctx.addIssue({
        code: "custom",
        path: ["unitLabel"],
        message: "اسم الوحدة مطلوب (مثل: أمبير · م³).",
      });
    }
  }

  if (v.pricingModel === "PER_PERSON" && !v.basePriceIqd) {
    ctx.addIssue({
      code: "custom",
      path: ["basePriceIqd"],
      message: "سعر الفرد مطلوب للتسعير بالشخص.",
    });
  }

  /**
   * ⚠️ حدود الكمية للتسعير بالوحدة وحده.
   * `PER_PERSON` عدده **مشتقّ** من السكان النشطين (‏Q5) لا مُدخَل، فحدٌّ
   * عليه يمنع الفوترة على أسرة كبيرة بلا أن يفهم أحد لماذا.
   */
  if (v.pricingModel !== "PER_UNIT" && (v.minUnits !== undefined || v.maxUnits !== undefined)) {
    ctx.addIssue({
      code: "custom",
      path: ["minUnits"],
      message: "حدود الكمية للتسعير بالوحدة فقط.",
    });
  }
  if (v.minUnits !== undefined && v.maxUnits !== undefined && v.minUnits > v.maxUnits) {
    ctx.addIssue({
      code: "custom",
      path: ["maxUnits"],
      message: "الحدّ الأعلى للكمية أصغر من الأدنى.",
    });
  }

  /**
   * ⚠️ **`V11`** — «إلزامية على ساكن» تركيبة صالحة في المخطّط
   * **لا يُنشئها أي تدفق أبداً**: §7.3 يحصر الإنشاء التلقائي فيما ينطبق
   * على الشقق. فتبقى «إلزامية» في الكتالوج وغير مطبَّقة في الواقع، بلا
   * خطأ ولا تحذير — أسوأ أنواع الفراغ: يبدو مضبوطاً وليس كذلك.
   *
   * القيد الحقيقي في قاعدة البيانات (`service_mandatory_not_resident_only`)،
   * وهذا الفحص يسبقه ليعطي رسالة عربية على الحقل الصحيح.
   */
  if (v.isMandatory && v.appliesTo === "RESIDENT") {
    ctx.addIssue({
      code: "custom",
      path: ["appliesTo"],
      message:
        "الخدمة الإلزامية تنطبق على الشقق. الإلزامية على الساكن لا يُنشئها أي تدفق، فتبقى بلا أثر.",
    });
  }
}

const createSchema = serviceFields.superRefine(refineService);

export const createService = defineAction({
  name: "createService",
  capability: "SERVICES_CATALOGUE",
  kind: "write",
  transactional: true,
  auditAction: "service.create",
  auditEntityType: "Service",
  schema: createSchema,
  handler: async ({ input, tx }) => {
    try {
      return await tx.service.create({
        data: {
          name: input.name,
          description: input.description ?? null,
          iconKey: input.iconKey ?? null,
          billingType: input.billingType,
          billingCycle: input.billingCycle ?? null,
          pricingModel: input.pricingModel,
          basePriceIqd: input.basePriceIqd ?? null,
          unitLabel: input.unitLabel ?? null,
          unitPriceIqd: input.unitPriceIqd ?? null,
          minUnits: input.minUnits ?? null,
          maxUnits: input.maxUnits ?? null,
          payerType: input.payerType,
          isMandatory: input.isMandatory,
          appliesTo: input.appliesTo,
          customFieldsSchema: input.customFieldsSchema ?? undefined,
          notes: input.notes ?? null,
        },
        select: {
          id: true, name: true, billingType: true, pricingModel: true,
          isMandatory: true, isAvailable: true, appliesTo: true,
        },
      });
    } catch (error) {
      if (violates(error, "Service_name_key")) {
        throw new ConflictError(`الخدمة «${input.name}» موجودة بالفعل.`);
      }
      if (violates(error, "service_mandatory_not_resident_only")) {
        throw new BusinessRuleError("الخدمة الإلزامية تنطبق على الشقق لا على الساكن.", "V11");
      }
      throw error;
    }
  },
});

const updateSchema = serviceFields.extend({ serviceId: z.string().min(1) }).superRefine(refineService);

/**
 * تعديل خدمة.
 *
 * ⚠️ **`R23`: لا أثر رجعي.** الاشتراكات القائمة تحمل لقطة سعرها ولا
 * تُمسّ. الإجراء يُبلّغ بعددها صراحةً، فيرى الأدمن أن تعديله **لن**
 * يسري عليها ولا يظنّه سرى.
 *
 * وتغيير `pricingModel` على خدمة لها اشتراكات **مرفوض**: الاشتراك
 * القائم يحمل `quantity` و`periodAmountIqd` محسوبَين بالنموذج القديم،
 * والتحوّل يجعلهما بلا معنى — كمية بالأمبير على تسعيرة بالشخص.
 */
export const updateService = defineAction({
  name: "updateService",
  capability: "SERVICES_CATALOGUE",
  kind: "write",
  transactional: true,
  auditAction: "service.update",
  auditEntityType: "Service",
  schema: updateSchema,
  handler: async ({ input, tx }) => {
    const existing = await tx.service.findFirst({
      where: { id: input.serviceId },
      select: {
        id: true, name: true, pricingModel: true, billingType: true,
        basePriceIqd: true, unitPriceIqd: true,
        _count: { select: { subscriptions: true } },
      },
    });
    if (!existing) throw new NotFoundError("الخدمة");

    const liveSubscriptions = await tx.subscription.count({
      where: { serviceId: input.serviceId, status: { in: ["ACTIVE", "PAUSED"] }, deletedAt: null },
    });

    if (existing.pricingModel !== input.pricingModel && existing._count.subscriptions > 0) {
      throw new BusinessRuleError(
        `لا يمكن تغيير نموذج تسعير «${existing.name}» ولها ` +
          `${existing._count.subscriptions} اشتراكاً: الكمية والمبلغ المحفوظان محسوبان بالنموذج القديم. ` +
          "أوقف الخدمة وأنشئ خدمة جديدة بالنموذج المطلوب.",
        "R23",
      );
    }
    if (existing.billingType !== input.billingType && existing._count.subscriptions > 0) {
      throw new BusinessRuleError(
        `لا يمكن تغيير نوع فوترة «${existing.name}» ولها اشتراكات قائمة.`,
        "R23",
      );
    }

    const priceChanged =
      existing.basePriceIqd !== (input.basePriceIqd ?? null) ||
      existing.unitPriceIqd !== (input.unitPriceIqd ?? null);

    try {
      const updated = await tx.service.update({
        where: { id: input.serviceId },
        data: {
          name: input.name,
          description: input.description ?? null,
          iconKey: input.iconKey ?? null,
          billingType: input.billingType,
          billingCycle: input.billingCycle ?? null,
          pricingModel: input.pricingModel,
          basePriceIqd: input.basePriceIqd ?? null,
          unitLabel: input.unitLabel ?? null,
          unitPriceIqd: input.unitPriceIqd ?? null,
          minUnits: input.minUnits ?? null,
          maxUnits: input.maxUnits ?? null,
          payerType: input.payerType,
          isMandatory: input.isMandatory,
          appliesTo: input.appliesTo,
          customFieldsSchema: input.customFieldsSchema ?? undefined,
          notes: input.notes ?? null,
        },
        select: { id: true, name: true, isAvailable: true },
      });

      return {
        ...updated,
        priceChanged,
        /** R23: عددٌ **لم** يتأثّر — يُعرض كي لا يظنّ الأدمن أن التعديل سرى. */
        unaffectedSubscriptions: priceChanged ? liveSubscriptions : 0,
      };
    } catch (error) {
      if (violates(error, "Service_name_key")) {
        throw new ConflictError(`الخدمة «${input.name}» موجودة بالفعل.`);
      }
      if (violates(error, "service_mandatory_not_resident_only")) {
        throw new BusinessRuleError("الخدمة الإلزامية تنطبق على الشقق لا على الساكن.", "V11");
      }
      throw error;
    }
  },
});

/**
 * إتاحة/إيقاف خدمة — **البديل الوحيد عن الحذف** (‏R24).
 *
 * الخدمة الموقوفة لا تقبل اشتراكات جديدة، **واشتراكاتها القائمة تستمرّ**:
 * إيقافُها في الكتالوج قرار عرض لا قرار فوترة. من أراد إيقاف الفوترة
 * فليوقف الاشتراكات صراحةً.
 */
export const setServiceAvailability = defineAction({
  name: "setServiceAvailability",
  capability: "SERVICES_CATALOGUE",
  kind: "write",
  transactional: true,
  auditAction: "service.availability.set",
  auditEntityType: "Service",
  schema: z.object({ serviceId: z.string().min(1), isAvailable: z.boolean() }),
  handler: async ({ input, tx }) => {
    const service = await tx.service.findFirst({
      where: { id: input.serviceId },
      select: { id: true, name: true, isMandatory: true },
    });
    if (!service) throw new NotFoundError("الخدمة");

    /**
     * ⚠️ خدمة **إلزامية** موقوفة تناقض نفسها: `R27` يقول تُنشأ تلقائياً
     * مع كل إشغال، و`isAvailable = false` يقول لا تُنشأ. النتيجة سلوك
     * يعتمد على أيّ الشرطين يُفحص أولاً — وهو ما لا يجوز تركه للصدفة.
     */
    if (service.isMandatory && !input.isAvailable) {
      throw new BusinessRuleError(
        `«${service.name}» خدمة إلزامية: تُنشأ تلقائياً مع كل إشغال، فلا معنى لإيقافها. ` +
          "أزل صفة الإلزامية أولاً.",
      );
    }

    const activeCount = await tx.subscription.count({
      where: { serviceId: input.serviceId, status: "ACTIVE", deletedAt: null },
    });

    const updated = await tx.service.update({
      where: { id: input.serviceId },
      data: { isAvailable: input.isAvailable },
      select: { id: true, name: true, isAvailable: true },
    });

    return {
      ...updated,
      /** R24: الاشتراكات القائمة تستمرّ — يُعرض العدد كي لا يُفاجأ أحد. */
      continuingSubscriptions: input.isAvailable ? 0 : activeCount,
    };
  },
});

export const listServices = defineAction({
  name: "listServices",
  capability: "SERVICES_CATALOGUE",
  kind: "read",
  schema: z
    .object({
      includeUnavailable: z.boolean().default(false),
      onlyMandatory: z.boolean().default(false),
    })
    .default({ includeUnavailable: false, onlyMandatory: false }),
  handler: async ({ input, actor, tx }) => {
    /**
     * ⚠️ §3.2 يعطي الساكن «‏R (available ones)» — **المتاحة وحدها**.
     * والقيد ليس تجميلياً: خدمة أُوقفت لسبب (سعر يُراجَع، مورّد انقطع)
     * تظهر له فيطلبها، فيُرفض طلبه بلا أن يفهم لماذا عُرضت أصلاً.
     *
     * الحدّ **هنا لا في الواجهة**: الإجراء نقطة نهاية HTTP، والمُدخل
     * `includeUnavailable` يصل من العميل. تجاهله للساكن قسراً.
     */
    const includeUnavailable =
      actor.role === "RESIDENT" ? false : input.includeUnavailable;

    const services = await tx.service.findMany({
      where: {
        ...(includeUnavailable ? {} : { isAvailable: true }),
        ...(input.onlyMandatory ? { isMandatory: true } : {}),
      },
      orderBy: [{ isMandatory: "desc" }, { name: "asc" }],
      select: {
        id: true, name: true, description: true, iconKey: true,
        billingType: true, billingCycle: true, pricingModel: true,
        basePriceIqd: true, unitLabel: true, unitPriceIqd: true,
        minUnits: true, maxUnits: true, payerType: true,
        isMandatory: true, isAvailable: true, appliesTo: true,
        customFieldsSchema: true, notes: true,
      },
    });

    /**
     * R22: إحصاءات المشتركين **محسوبة دائماً** — وباستعلام مجمَّع واحد
     * لا بواحد لكل خدمة. `_count` على العلاقة كان سيعدّ الملغاة أيضاً.
     */
    const counts = await tx.subscription.groupBy({
      by: ["serviceId"],
      where: { status: "ACTIVE", deletedAt: null },
      _count: { _all: true },
    });
    const activeBy = new Map(counts.map((c) => [c.serviceId, c._count._all]));

    return services.map((s) => ({ ...s, activeSubscriptions: activeBy.get(s.id) ?? 0 }));
  },
});
