"use server";

import { z } from "zod";
import { defineAction } from "./define-action";
import { COMPLETED_STATUSES } from "@/lib/services/statistics";
import { BusinessRuleError, ConflictError, NotFoundError } from "@/lib/errors";
import { violates } from "@/lib/db-errors";
import { NUMBERING_SCHEME, CONSTRUCTION_STATUS } from "@/lib/domain/enums";
import {
  countApartments,
  generateApartments,
  type BuildingSpec,
} from "@/lib/domain/apartment-generator";

/**
 * البنايات ومولّد الشقق — الخطوة 1.1.
 */

const floorOverrideSchema = z.object({
  floorNumber: z.number().int().min(1),
  unitsCount: z.number().int().min(1),
});

const createBuildingSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "رمز البناية مطلوب.")
    .max(8, "رمز البناية طويل — 8 محارف كحدّ أقصى.")
    .regex(/^[A-Za-z0-9ء-ي]+$/u, "رمز البناية: أحرف وأرقام بلا مسافات أو رموز."),
  name: z.string().trim().max(120).optional(),
  floorsCount: z.number().int().min(1, "عدد الطوابق لا يقلّ عن 1.").max(200),
  unitsPerFloor: z.number().int().min(1, "عدد الوحدات لا يقلّ عن 1.").max(100),
  numberingScheme: z.enum(NUMBERING_SCHEME),
  displayNumberFormat: z.string().trim().min(1, "قالب رقم العرض مطلوب."),
  plannedApartmentsCount: z.number().int().min(0).optional(),
  constructionStatus: z.enum(CONSTRUCTION_STATUS).default("UNDER_CONSTRUCTION"),
  floorOverrides: z.array(floorOverrideSchema).default([]),
  /** يولّد الشقق فوراً — §9.2 يجعله خياراً صريحاً. */
  generateApartments: z.boolean().default(true),
  notes: z.string().trim().max(500).optional(),
});

function toSpec(input: z.infer<typeof createBuildingSchema>): BuildingSpec {
  return {
    code: input.code,
    floorsCount: input.floorsCount,
    unitsPerFloor: input.unitsPerFloor,
    numberingScheme: input.numberingScheme,
    displayNumberFormat: input.displayNumberFormat,
    floorOverrides: new Map(input.floorOverrides.map((o) => [o.floorNumber, o.unitsCount])),
  };
}

/**
 * إنشاء بناية — وتوليد شققها في **نفس المعاملة**.
 *
 * ⚠️ بناية بلا شققها ليست حالة وسطى مقبولة: الأدمن سيظنّ التوليد فشل
 * فيُعيد المحاولة، فينشأ رمز مكرَّر. إمّا الكل أو لا شيء.
 */
export const createBuilding = defineAction({
  name: "createBuilding",
  capability: "BUILDINGS",
  kind: "write",
  transactional: true,
  auditAction: "building.create",
  auditEntityType: "Building",
  schema: createBuildingSchema,
  handler: async ({ input, tx }) => {
    const spec = toSpec(input);

    // التوليد **قبل** أي كتابة: قالب خاطئ يُردّ برسالة مفهومة بدل أن
    // يفشل على قيد تفريد بعد إدراج عشرين صفاً.
    const generated = input.generateApartments ? generateApartments(spec) : null;
    if (generated && !generated.ok) {
      throw new BusinessRuleError(generated.messageAr, "§4.8");
    }

    try {
      const building = await tx.building.create({
        data: {
          code: input.code,
          name: input.name ?? null,
          floorsCount: input.floorsCount,
          unitsPerFloor: input.unitsPerFloor,
          numberingScheme: input.numberingScheme,
          displayNumberFormat: input.displayNumberFormat,
          plannedApartmentsCount: input.plannedApartmentsCount ?? null,
          constructionStatus: input.constructionStatus,
          notes: input.notes ?? null,
          floorOverrides: {
            create: input.floorOverrides.map((o) => ({
              floorNumber: o.floorNumber,
              unitsCount: o.unitsCount,
            })),
          },
        },
        select: { id: true, code: true },
      });

      if (generated?.ok) {
        await tx.apartment.createMany({
          data: generated.apartments.map((a) => ({
            buildingId: building.id,
            floorNumber: a.floorNumber,
            unitNumber: a.unitNumber,
            displayNumber: a.displayNumber,
            // §4.8: كل شقة تبدأ تحت الإنشاء · غير مباعة · فارغة
            constructionStatus: "UNDER_CONSTRUCTION" as const,
            ownershipStatus: "UNSOLD" as const,
            occupancyStatus: "VACANT" as const,
          })),
        });
      }

      return {
        id: building.id,
        code: building.code,
        apartmentsCreated: generated?.ok ? generated.apartments.length : 0,
      };
    } catch (error) {
      if (violates(error, "Building_code_key")) {
        throw new ConflictError(`رمز البناية «${input.code}» مستخدم لبناية أخرى.`);
      }
      throw error;
    }
  },
});

const regenerateSchema = z.object({
  buildingId: z.string().min(1),
  fromFloor: z.number().int().min(1),
  toFloor: z.number().int().min(1),
});

/**
 * إعادة توليد الشقق في مدى طوابق.
 *
 * ── الخطّ الأحمر ─────────────────────────────────────────────────────
 * §9.2 يضمن «لا تلمس شقة لها **عقد**». وقرار `Q31` وسّعها: **لا تلمس شقة
 * لها أي صفّ تابع** — عقد أو ساكن أو اشتراك أو سيارة أو طلب أو مرفق.
 * إعادة توليد تمسح شقة متعاقدة **تدمّر دفتراً مالياً**، وشقة لها سكان بلا
 * عقد ليست أهون: روابطها تنكسر أو تصير يتيمة.
 *
 * والحماية **في الاستعلام لا في الواجهة**: زرّ معطَّل لا يمنع استدعاءً
 * مباشراً للـaction.
 *
 * ── الحذف ناعم لا صلب ────────────────────────────────────────────────
 * والفهرسان الفريدان **جزئيان** `WHERE deletedAt IS NULL` (‏T1) — وإلا
 * فشلت إعادة التوليد على خطأ تفريد مع أن الشقة القديمة محذوفة.
 */
export const regenerateApartments = defineAction({
  name: "regenerateApartments",
  capability: "APARTMENTS",
  kind: "write",
  transactional: true,
  auditAction: "building.regenerate_apartments",
  auditEntityType: "Building",
  schema: regenerateSchema,
  handler: async ({ input, tx }) => {
    if (input.toFloor < input.fromFloor) {
      throw new BusinessRuleError("نطاق الطوابق غير صحيح: الطابق الأخير قبل الأول.");
    }

    const building = await tx.building.findFirst({
      where: { id: input.buildingId },
      select: {
        id: true, code: true, floorsCount: true, unitsPerFloor: true,
        numberingScheme: true, displayNumberFormat: true,
        floorOverrides: { select: { floorNumber: true, unitsCount: true } },
      },
    });
    if (!building) throw new NotFoundError("البناية");

    const spec: BuildingSpec = {
      code: building.code,
      floorsCount: building.floorsCount,
      unitsPerFloor: building.unitsPerFloor,
      numberingScheme: building.numberingScheme,
      displayNumberFormat: building.displayNumberFormat,
      floorOverrides: new Map(building.floorOverrides.map((o) => [o.floorNumber, o.unitsCount])),
    };

    const generated = generateApartments(spec);
    if (!generated.ok) throw new BusinessRuleError(generated.messageAr, "§4.8");

    // شقق المدى الحالية مع **كل** ما قد يمنع لمسها (‏Q31)
    const existing = await tx.apartment.findMany({
      where: {
        buildingId: building.id,
        floorNumber: { gte: input.fromFloor, lte: input.toFloor },
        deletedAt: null,
      },
      select: {
        id: true, floorNumber: true, unitNumber: true, displayNumber: true,
        _count: {
          select: {
            contracts: true, residents: true, subscriptions: true,
            vehicles: true, requests: true, attachments: true, accounts: true,
          },
        },
      },
    });

    const protectedOnes = existing.filter((a) =>
      Object.values(a._count).some((n) => n > 0),
    );
    const removable = existing.filter((a) => !Object.values(a._count).some((n) => n > 0));

    // حذف ناعم لما يجوز لمسه
    if (removable.length > 0) {
      await tx.apartment.updateMany({
        where: { id: { in: removable.map((a) => a.id) } },
        data: { deletedAt: new Date() },
      });
    }

    // إعادة إنشاء المدى، مع تخطّي ما يشغله صفّ محميّ
    const taken = new Set(protectedOnes.map((a) => `${a.floorNumber}/${a.unitNumber}`));
    const toCreate = generated.apartments.filter(
      (a) =>
        a.floorNumber >= input.fromFloor &&
        a.floorNumber <= input.toFloor &&
        !taken.has(`${a.floorNumber}/${a.unitNumber}`),
    );

    if (toCreate.length > 0) {
      await tx.apartment.createMany({
        data: toCreate.map((a) => ({
          buildingId: building.id,
          floorNumber: a.floorNumber,
          unitNumber: a.unitNumber,
          displayNumber: a.displayNumber,
          constructionStatus: "UNDER_CONSTRUCTION" as const,
          ownershipStatus: "UNSOLD" as const,
          occupancyStatus: "VACANT" as const,
        })),
      });
    }

    // §9.2: **تُبلّغ عن كل شقة تخطّتها** — التخطّي الصامت يجعل الأدمن يظنّ
    // أن كل شيء أُعيد توليده، ثم يكتشف الفرق بعد أسابيع.
    return {
      id: building.id,
      created: toCreate.length,
      softDeleted: removable.length,
      skipped: protectedOnes.map((a) => a.displayNumber),
    };
  },
});

const listBuildingsSchema = z.object({ page: z.number().int().min(1).default(1) });

export const listBuildings = defineAction({
  name: "listBuildings",
  capability: "BUILDINGS",
  kind: "read",
  schema: listBuildingsSchema,
  handler: async ({ input, tx }) => {
    const PAGE_SIZE = 25;
    const [rows, total] = await Promise.all([
      tx.building.findMany({
        select: {
          id: true, code: true, name: true, floorsCount: true, unitsPerFloor: true,
          numberingScheme: true, constructionStatus: true, plannedApartmentsCount: true,
          _count: { select: { apartments: true } },
        },
        orderBy: { code: "asc" },
        skip: (input.page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      tx.building.count(),
    ]);

    // §4.20 · المبدأ 1: عدد الشقق **محسوب** لا مخزَّن، ونسبة الإنجاز
    // تُحسب باستعلام مجمَّع لا بحلقة في JS.
    const completed = await tx.apartment.groupBy({
      by: ["buildingId"],
      where: {
        buildingId: { in: rows.map((r) => r.id) },
        constructionStatus: { in: [...COMPLETED_STATUSES] },
      },
      _count: { _all: true },
    });
    const completedBy = new Map(completed.map((c) => [c.buildingId, c._count._all]));

    return {
      rows: rows.map((r) => ({
        ...r,
        apartmentsCount: r._count.apartments,
        completedCount: completedBy.get(r.id) ?? 0,
      })),
      total,
      page: input.page,
      pageSize: PAGE_SIZE,
    };
  },
});

/** معاينة بلا كتابة — تستدعيها الواجهة عند كل تغيير في النموذج. */
export const previewBuilding = defineAction({
  name: "previewBuilding",
  capability: "BUILDINGS",
  kind: "read",
  schema: createBuildingSchema,
  handler: async ({ input }) => {
    const spec = toSpec(input);
    const result = generateApartments(spec);
    if (!result.ok) return { ok: false as const, messageAr: result.messageAr };
    const all = result.apartments;
    return {
      ok: true as const,
      total: countApartments(spec),
      sample: all.length <= 4 ? all : [...all.slice(0, 3), all[all.length - 1]!],
    };
  },
});
