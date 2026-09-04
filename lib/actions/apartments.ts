"use server";

import { z } from "zod";
import { defineAction } from "./define-action";
import { BusinessRuleError, NotFoundError, PendingDecisionError } from "@/lib/errors";
import {
  CONSTRUCTION_STATUS,
  OCCUPANCY_STATUS,
  OWNERSHIP_STATUS,
} from "@/lib/domain/enums";
import { now, startOfDayBaghdad } from "@/lib/dates";
import {
  generateMandatorySubscriptions,
  pauseRecurringOnVacancy,
} from "@/lib/services/mandatory-subscriptions";

/**
 * الشقق والمحاور الثلاثة — الخطوة 1.2.
 *
 * ── لماذا ثلاثة محاور مستقلة لا حالة واحدة ──────────────────────────
 * دمجها في enum واحد هو الخطأ الشائع، ويُفقد النظام قدرته على تمثيل
 * «مباعة لكن فارغة» و«مكتملة وغير مباعة» — وكلتاهما حالة يومية.
 *   إنشاء : هل الوحدة جاهزة ومُسلَّمة؟
 *   تمليك : مباعة · مخزون شركة · مؤجّرة من الشركة؟
 *   سكن   : من يسكنها الآن، وهل هو المالك أم مستأجر؟
 */

// ── الثوابت المفروضة في الخادم لا في الواجهة ────────────────────────

/**
 * `R10`: شقة تحت الإنشاء **لا تخرج من `VACANT`**.
 * إعلان سكن وحدة لم تُبنَ يعني فوترة خدمات على هواء.
 */
function assertR10(constructionStatus: string, occupancyStatus: string): void {
  if (constructionStatus === "UNDER_CONSTRUCTION" && occupancyStatus !== "VACANT") {
    throw new BusinessRuleError(
      "لا يمكن تعيين حالة سكن لشقة تحت الإنشاء. أنهِ الإنشاء أولاً.",
      "R10",
    );
  }
}

const listSchema = z.object({
  buildingId: z.string().optional(),
  floorNumber: z.number().int().min(1).optional(),
  constructionStatus: z.enum(CONSTRUCTION_STATUS).optional(),
  ownershipStatus: z.enum(OWNERSHIP_STATUS).optional(),
  occupancyStatus: z.enum(OCCUPANCY_STATUS).optional(),
  /** مرشّح «وجود رصيد مفتوح» — يحتاج ضمّاً على Account وفهرساً. */
  hasOpenBalance: z.boolean().optional(),
  search: z.string().trim().max(60).optional(),
  page: z.number().int().min(1).default(1),
  /**
   * ⚠️ سقف 200 مقصود. الشاشات تعرض 25، لكن **القوائم المنسدلة** (اختيار
   * الشقة في نموذج العقد مثلاً) تحتاج الكل لا الصفحة الأولى — وبلا هذا
   * الحقل كانت تُقصّ عند 25 **صامتةً**: الشقة موجودة والمستخدم لا يجدها
   * في القائمة، فيظنّها غير منشأة. والسقف يمنع أن يصير الترقيم زينة.
   */
  pageSize: z.number().int().min(1).max(200).default(25),
});

export const listApartments = defineAction({
  name: "listApartments",
  capability: "APARTMENTS",
  kind: "read",
  schema: listSchema,
  handler: async ({ input, tx }) => {
    const PAGE_SIZE = input.pageSize;
    const where = {
      ...(input.buildingId ? { buildingId: input.buildingId } : {}),
      ...(input.floorNumber ? { floorNumber: input.floorNumber } : {}),
      ...(input.constructionStatus ? { constructionStatus: input.constructionStatus } : {}),
      ...(input.ownershipStatus ? { ownershipStatus: input.ownershipStatus } : {}),
      ...(input.occupancyStatus ? { occupancyStatus: input.occupancyStatus } : {}),
      ...(input.search ? { displayNumber: { contains: input.search, mode: "insensitive" as const } } : {}),
      // ⚠️ الضمّ على الحساب يحتاج فهرساً على Account(apartmentId, status)
      // وإلا صار الجدول بطيئاً مع 500 شقة — الفهرس موجود في المخطّط.
      ...(input.hasOpenBalance
        ? { accounts: { some: { status: "OPEN" as const, balanceIqd: { gt: 0 } } } }
        : {}),
    };

    const [rows, total] = await Promise.all([
      tx.apartment.findMany({
        where,
        select: {
          id: true, displayNumber: true, floorNumber: true, unitNumber: true,
          constructionStatus: true, ownershipStatus: true, occupancyStatus: true,
          occupancyChangedAt: true, areaSqm: true, roomsCount: true,
          building: { select: { id: true, code: true } },
          // §4.20 · R9: عدد الأفراد **محسوب** لا مخزَّن
          _count: { select: { residents: true } },
        },
        orderBy: [{ buildingId: "asc" }, { floorNumber: "asc" }, { unitNumber: "asc" }],
        skip: (input.page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      tx.apartment.count({ where }),
    ]);

    return { rows, total, page: input.page, pageSize: PAGE_SIZE };
  },
});

const constructionSchema = z.object({
  apartmentId: z.string().min(1),
  status: z.enum(CONSTRUCTION_STATUS),
  completionPercentage: z.number().int().min(0).max(100).optional(),
});

export const setApartmentConstructionStatus = defineAction({
  name: "setApartmentConstructionStatus",
  capability: "APARTMENTS",
  kind: "write",
  transactional: true,
  auditAction: "apartment.construction.set",
  auditEntityType: "Apartment",
  schema: constructionSchema,
  handler: async ({ input, tx }) => {
    const apartment = await tx.apartment.findFirst({
      where: { id: input.apartmentId },
      select: { id: true, displayNumber: true, occupancyStatus: true },
    });
    if (!apartment) throw new NotFoundError("الشقة");

    // العودة إلى «تحت الإنشاء» لشقة مسكونة تخرق R10 من الجهة الأخرى
    assertR10(input.status, apartment.occupancyStatus);

    const updated = await tx.apartment.update({
      where: { id: apartment.id },
      data: {
        constructionStatus: input.status,
        completionPercentage: input.completionPercentage ?? undefined,
        // Q33: «التسليم» حدث تجاري له تاريخ — ولا تدفق ينقل
        // COMPLETED → DELIVERED في المواصفة. هذا العمود يسدّ الفراغ.
        deliveredAt: input.status === "DELIVERED" ? now() : undefined,
      },
      select: { id: true, displayNumber: true, constructionStatus: true, deliveredAt: true },
    });
    return updated;
  },
});

const bulkConstructionSchema = z.object({
  buildingId: z.string().min(1),
  fromFloor: z.number().int().min(1),
  toFloor: z.number().int().min(1),
  status: z.enum(CONSTRUCTION_STATUS),
});

/**
 * التحديث الجماعي لحالة الإنشاء.
 *
 * ‏§8.2/1 يطلبه صراحةً و§9.2 لا تحتوي إجراءً له — أحد الإجراءات التسعة
 * المفقودة التي كشفها التدقيق.
 *
 * ⚠️ **يُبلّغ عن المتخطَّى.** شقة مسكونة لا يجوز إعادتها «تحت الإنشاء»
 * (‏R10)، فتُستثنى ويُذكر اسمها بدل أن تُترك بصمت.
 */
export const bulkSetApartmentConstructionStatus = defineAction({
  name: "bulkSetApartmentConstructionStatus",
  capability: "APARTMENTS",
  kind: "write",
  transactional: true,
  auditAction: "apartment.construction.bulk_set",
  auditEntityType: "Building",
  schema: bulkConstructionSchema,
  handler: async ({ input, tx }) => {
    if (input.toFloor < input.fromFloor) {
      throw new BusinessRuleError("نطاق الطوابق غير صحيح: الطابق الأخير قبل الأول.");
    }

    const candidates = await tx.apartment.findMany({
      where: {
        buildingId: input.buildingId,
        floorNumber: { gte: input.fromFloor, lte: input.toFloor },
      },
      select: { id: true, displayNumber: true, occupancyStatus: true },
    });
    if (candidates.length === 0) throw new NotFoundError("شقق في هذا النطاق");

    const blocked =
      input.status === "UNDER_CONSTRUCTION"
        ? candidates.filter((a) => a.occupancyStatus !== "VACANT")
        : [];
    const allowed = candidates.filter((a) => !blocked.includes(a));

    if (allowed.length > 0) {
      await tx.apartment.updateMany({
        where: { id: { in: allowed.map((a) => a.id) } },
        data: {
          constructionStatus: input.status,
          ...(input.status === "DELIVERED" ? { deliveredAt: now() } : {}),
        },
      });
    }

    return {
      id: input.buildingId,
      updated: allowed.length,
      skipped: blocked.map((a) => a.displayNumber),
    };
  },
});

const occupancySchema = z.object({
  apartmentId: z.string().min(1),
  occupancyStatus: z.enum(OCCUPANCY_STATUS),
  /** §9.2 يمرّره — ودلالته في الماضي **غير محسومة**. انظر أدناه. */
  effectiveDate: z.coerce.date().optional(),
});

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  `setApartmentOccupancy` — **مفتاح الفوترة** (‏§7.3 · R7).
 * ═══════════════════════════════════════════════════════════════════════
 *
 * أهمّ عملية غير مالية في النظام، لأنها **تُنتج مالاً**: الانتقال إلى
 * مسكونة يُنشئ اشتراكات إلزامية ويبدأ الفوترة، والانتقال إلى `VACANT`
 * يوقفها **ويُبقي الرصيد مستحقاً** — الإخلاء لا يُلغي ديناً.
 *
 * ── ⚠️ السؤال المفتوح `effectiveDate` ────────────────────────────────
 * التوقيع في §9.2 يقبل تاريخاً، **ودلالته في الماضي غير محسومة**: هل
 * إعلان إشغال بأثر رجعي ثلاثة أشهر يُنتج **ثلاث دورات فوترة** أم صفراً؟
 * خطة التنفيذ تطرحه خمس مرات وتصفه بأن «الفرق مالي كبير»، وخطة الجسر لا
 * تذكره ولا مرة (سؤال غير مرقّم فسقط من التغطية).
 *
 * **القرار هنا: نقبل ما له معنى محدَّد ونرفض ما ليس له.**
 * التاريخ الحاضر أو المستقبل يعمل. التاريخ **الماضي يُرفض صراحةً** بخطأ
 * يسمّي السؤال — لا نختار له دلالة، ولا نمنع العملية كلها.
 * راجع docs/OPEN-DECISIONS.md — النتيجة `F2`.
 */
export const setApartmentOccupancy = defineAction({
  name: "setApartmentOccupancy",
  capability: "APARTMENT_OCCUPANCY",
  kind: "write",
  transactional: true,
  auditAction: "apartment.occupancy.change",
  auditEntityType: "Apartment",
  schema: occupancySchema,
  handler: async ({ input, tx }) => {
    const apartment = await tx.apartment.findFirst({
      where: { id: input.apartmentId },
      select: {
        id: true, displayNumber: true,
        constructionStatus: true, occupancyStatus: true, ownershipStatus: true,
        contracts: {
          where: { status: "ACTIVE", deletedAt: null },
          select: { id: true, type: true },
        },
      },
    });
    if (!apartment) throw new NotFoundError("الشقة");

    // ── R10 ───────────────────────────────────────────────────────────
    assertR10(apartment.constructionStatus, input.occupancyStatus);

    // ── R8: السكن بمستأجر يتطلّب عقد إيجار نشطاً ─────────────────────
    if (input.occupancyStatus === "OCCUPIED_BY_TENANT") {
      const hasRental = apartment.contracts.some((c) => c.type === "RENTAL");
      if (!hasRental) {
        throw new BusinessRuleError(
          "لا يمكن تعيين «يسكنها مستأجر» بلا عقد إيجار نشط على هذه الشقة.",
          "R8",
        );
      }
    }
    if (input.occupancyStatus === "OCCUPIED_BY_OWNER") {
      const hasSale = apartment.contracts.some((c) => c.type === "SALE");
      if (!hasSale) {
        throw new BusinessRuleError(
          "لا يمكن تعيين «يسكنها المالك» بلا عقد تمليك نشط على هذه الشقة.",
          "R8",
        );
      }
    }

    // ── ⚠️ التاريخ الماضي: قرار غير مُتَّخذ، لا تخمين ─────────────────
    const effective = input.effectiveDate ?? now();
    if (startOfDayBaghdad(effective) < startOfDayBaghdad(now())) {
      throw new PendingDecisionError(
        "effectiveDate",
        "تأريخ تغيير السكن في الماضي — هل يُنتج قيود فوترة رجعية للفترات الفائتة أم أنه توثيقي فقط؟",
      );
    }

    if (apartment.occupancyStatus === input.occupancyStatus) {
      throw new BusinessRuleError("الشقة في هذه الحالة أصلاً.");
    }

    const updated = await tx.apartment.update({
      where: { id: apartment.id },
      data: {
        occupancyStatus: input.occupancyStatus,
        // R7: كل انتقال **يُؤرَّخ** — هو ما تقرأه مهمة الفوترة
        occupancyChangedAt: effective,
      },
      select: {
        id: true, displayNumber: true,
        occupancyStatus: true, occupancyChangedAt: true,
      },
    });

    /**
     * ── فرعا المال (‏§7.3 · R27) ──────────────────────────────────
     *
     * الترتيب مقصود: **بعد** تحديث الشقة وداخل المعاملة نفسها. لو جرى
     * قبله وفشل التحديث لبقيت اشتراكات موقوفة على شقة ما زالت مسكونة.
     */
    let mandatory = { created: 0, services: [] as string[], chargedIqd: 0n };
    let paused = 0;

    if (input.occupancyStatus === "VACANT") {
      // الإخلاء: إيقاف مؤقّت لا إلغاء، **والرصيد يبقى مستحقاً**.
      ({ paused } = await pauseRecurringOnVacancy(tx, apartment.id, effective));
    } else {
      /**
       * الإشغال: إنشاء الإلزامية.
       *
       * ⚠️ **لا استئناف تلقائياً للموقوف** (‏§7.3: «باختيار الأدمن»).
       * الساكن الجديد قد لا يريد ما أراده السابق، والاستئناف الصامت
       * يُنتج فاتورة لخدمة لم يطلبها أحد.
       */
      mandatory = await generateMandatorySubscriptions(tx, apartment.id, effective);
    }

    return { ...updated, mandatory, pausedSubscriptions: paused };
  },
});

// ═══════════════════════════════════════════════════════════════════════
//  قراءة تفصيلية — صفحة الشقة (‏§11.2)
// ═══════════════════════════════════════════════════════════════════════

const getApartmentSchema = z.object({
  apartmentId: z.string().min(1),
});

/**
 * كل ما تحتاجه صفحة الشقة في استعلام واحد.
 *
 * ── لماذا تُقرأ العقود **كلها** لا النشطة فقط ───────────────────────
 * المبدأ 3 و`A2`: الحساب المغلق ودفتره يبقيان مرئيَّين في تاريخ الشقة
 * **للأبد**. ترشيح `status = ACTIVE` هنا كان سيمحو من نظر الأدمن دَيناً
 * مجمَّداً على مستأجر سابق، وهو بالضبط ما يبحث عنه في تقرير المستحقات.
 *
 * ── ولماذا السكان **كلهم** لا النشطون فقط ───────────────────────────
 * «من كان يسكن هنا في آذار؟» سؤال أمني ومالي حقيقي. الصفوف المنتهية
 * تحمل `movedOutAt`، فتصلح سجلّاً زمنياً لا نفاية.
 *
 * ⚠️ استعلام واحد بـ`include` متداخل، لا استعلام لكل تبويب: التبويبات
 * تتبدّل على العميل بلا رحلة جديدة، ولا يتكرّر فحص الترخيص تسع مرات.
 */
export const getApartment = defineAction({
  name: "getApartment",
  capability: "APARTMENTS",
  kind: "read",
  schema: getApartmentSchema,
  handler: async ({ input, tx }) => {
    const apartment = await tx.apartment.findFirst({
      where: { id: input.apartmentId, deletedAt: null },
      select: {
        id: true,
        displayNumber: true,
        floorNumber: true,
        unitNumber: true,
        areaSqm: true,
        roomsCount: true,
        constructionStatus: true,
        ownershipStatus: true,
        occupancyStatus: true,
        occupancyChangedAt: true,
        priceIqd: true,
        notes: true,
        createdAt: true,
        building: { select: { id: true, code: true, name: true } },

        // السكان: النشطون والسابقون معاً، الأحدث أولاً
        residents: {
          orderBy: [{ isActive: "desc" }, { movedInAt: "desc" }],
          select: {
            id: true,
            relationType: true,
            isContractHolder: true,
            movedInAt: true,
            movedOutAt: true,
            isActive: true,
            user: { select: { id: true, fullName: true, phone: true, role: true } },
          },
        },

        // العقود: كلها بحالاتها، ومعها حساباتها ودفاترها
        contracts: {
          where: { deletedAt: null },
          orderBy: [{ createdAt: "desc" }],
          select: {
            id: true,
            contractNumber: true,
            type: true,
            status: true,
            startDate: true,
            endDate: true,
            totalAmountIqd: true,
            rentAmountIqd: true,
            rentCycle: true,
            paymentType: true,
            holder: { select: { id: true, fullName: true } },
            account: {
              select: {
                id: true,
                status: true,
                balanceIqd: true,
                openedAt: true,
                closedAt: true,
                entries: {
                  orderBy: { createdAt: "desc" },
                  select: {
                    id: true,
                    type: true,
                    source: true,
                    amountIqd: true,
                    descriptionAr: true,
                    createdAt: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!apartment) throw new NotFoundError("الشقة");
    return apartment;
  },
});
