import { z } from "zod";
import { defineAction } from "@/lib/actions/define-action";
import { BusinessRuleError, ConflictError, NotFoundError } from "@/lib/errors";
import { violates } from "@/lib/db-errors";
import { VEHICLE_STATUS } from "@/lib/domain/enums";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  المركبات — الخطوة 4.1 (بلا الباج).
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ما في هذا الملفّ وما ليس فيه ────────────────────────────────────
 * التسجيل والاعتماد والرفض والرفع. أمّا **إصدار الباج** فمحجوب بالقرار
 * `B3`: بعد `D1` للشقة حسابان ممكنان (مالك ومستأجر)، ورسمُ الباج يُقيَّد
 * على أحدهما ولم يُحسم أيّهما — و`R36` يوجب القيد في نفس معاملة الإصدار.
 *
 * ⚠️ ولا يُبنى «إصدارٌ بلا رسم» مؤقّتاً: باجٌ صدر بلا قيد يجعل الرسم
 * دَيناً منسيّاً لا يظهر في أي كشف، ثم لا يُعرَف كم باجاً صدر قبل الحسم.
 *
 * ── والحالات أربع لا اثنتان ────────────────────────────────────────
 *   `PENDING_APPROVAL` ← سجّلها الساكن، تنتظر
 *   `APPROVED`         ← تدخل البوّابة
 *   `REJECTED`         ← رُفضت، **وتبقى مانعةً لتسجيل اللوحة ثانيةً**
 *   `REMOVED`          ← رُفعت، وتُحرّر اللوحة لتسجيل جديد (‏S7)
 *
 * ⚠️ الفرق بين الأخيرتين هو `uniq_active_plate` نفسه: الرفض قرارٌ على
 * تسجيلٍ بعينه، والرفع إنهاءٌ لعلاقة السيارة بالمجمَّع.
 */

const listSchema = z
  .object({
    status: z.enum(VEHICLE_STATUS).optional(),
    apartmentId: z.string().optional(),
    /** بحث على اللوحة أو رقم الشقة — ما تعرفه البوّابة والإدارة. */
    search: z.string().trim().max(60).optional(),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(25),
  })
  .default({ page: 1, pageSize: 25 });

export const listVehicles = defineAction({
  name: "listVehicles",
  capability: "VEHICLES",
  kind: "read",
  schema: listSchema,
  handler: async ({ input, tx }) => {
    const where = {
      ...(input.status ? { status: input.status } : {}),
      ...(input.apartmentId ? { apartmentId: input.apartmentId } : {}),
      ...(input.search
        ? {
            OR: [
              { plateNumber: { contains: input.search, mode: "insensitive" as const } },
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
      tx.vehicle.findMany({
        where,
        select: {
          id: true,
          plateNumber: true,
          plateProvince: true,
          make: true,
          model: true,
          color: true,
          status: true,
          notes: true,
          createdAt: true,
          apartment: { select: { id: true, displayNumber: true } },
          owner: { select: { id: true, fullName: true } },
          /*
           * ⚠️ الباج **يُعدّ ولا يُقرأ**: الشاشة تحتاج «هل عليها باج؟»
           * كي لا تُرفَع مركبة تحته باج ساري. وتفاصيلُه شاشةٌ أخرى تُبنى
           * حين يُحسم `B3`.
           */
          _count: { select: { badges: true } },
        },
        /* المعلّق أوّلاً: هو ما ينتظر قراراً، والأحدث أوّلاً داخله */
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      tx.vehicle.count({ where }),
      /* العدّاد على **كل** المعلّق لا على الصفحة */
      tx.vehicle.count({ where: { status: "PENDING_APPROVAL" } }),
    ]);

    return { rows, total, page: input.page, pageSize: input.pageSize, pendingCount };
  },
});

/**
 * تسجيل الإدارة مركبةً — نيابةً عن ساكن اتّصل أو راجع.
 *
 * ⚠️ **معتمَدة فوراً** بخلاف تسجيل الساكن: الأدمن هو جهة الاعتماد، وجعلُه
 * يسجّل ثم يعتمد ما سجّله بنفسه خطوةٌ لا تُضيف مراجعةً — تُضيف نقرة.
 */
export const addVehicle = defineAction({
  name: "addVehicle",
  capability: "VEHICLES",
  kind: "write",
  schema: z.object({
    apartmentId: z.string().min(1),
    ownerUserId: z.string().min(1).optional(),
    plateNumber: z.string().trim().min(3).max(40),
    plateProvince: z.string().trim().max(40).optional(),
    make: z.string().trim().max(40).optional(),
    model: z.string().trim().max(40).optional(),
    color: z.string().trim().max(30).optional(),
    notes: z.string().trim().max(500).optional(),
  }),
  auditAction: "vehicle.add",
  auditEntityType: "Vehicle",
  handler: async ({ input, tx }) => {
    const apartment = await tx.apartment.findUnique({
      where: { id: input.apartmentId },
      select: { id: true },
    });
    if (!apartment) throw new NotFoundError("الشقة");

    try {
      return await tx.vehicle.create({
        data: {
          apartmentId: input.apartmentId,
          ownerUserId: input.ownerUserId ?? null,
          plateNumber: input.plateNumber,
          plateProvince: input.plateProvince ?? null,
          make: input.make ?? null,
          model: input.model ?? null,
          color: input.color ?? null,
          notes: input.notes ?? null,
          status: "APPROVED",
        },
        select: { id: true, plateNumber: true, status: true },
      });
    } catch (error) {
      /* ⚠️ للإدارة تُذكر الشقة: هي تملك النظر في الصفّ أصلاً (§3.2 F) */
      if (violates(error, "uniq_active_plate")) {
        const rival = await tx.vehicle.findFirst({
          where: { plateNumber: input.plateNumber, status: { not: "REMOVED" } },
          select: { status: true, apartment: { select: { displayNumber: true } } },
        });
        throw new ConflictError(
          `اللوحة «${input.plateNumber}» مسجَّلة على الشقة ` +
            `«${rival?.apartment.displayNumber ?? "—"}». ارفع تسجيلها القديم أولاً.`,
        );
      }
      throw error;
    }
  },
});

const decisionSchema = z.object({
  vehicleId: z.string().min(1),
  reason: z.string().trim().max(500).optional(),
});

export const approveVehicle = defineAction({
  name: "approveVehicle",
  capability: "VEHICLES",
  kind: "write",
  schema: decisionSchema,
  auditAction: "vehicle.approve",
  auditEntityType: "Vehicle",
  handler: async ({ input, tx }) => {
    const vehicle = await tx.vehicle.findUnique({
      where: { id: input.vehicleId },
      select: { id: true, status: true, plateNumber: true },
    });
    if (!vehicle) throw new NotFoundError("المركبة");

    /*
     * ⚠️ المعلّقة وحدها. واعتمادُ مرفوضةٍ يُبطل قراراً سابقاً بلا أثر
     * يقول من أبطله ولماذا — والتسجيل الجديد يمرّ بالرفع ثم التسجيل.
     */
    if (vehicle.status !== "PENDING_APPROVAL") {
      throw new BusinessRuleError(
        vehicle.status === "APPROVED"
          ? "المركبة معتمَدة سلفاً."
          : "تُعتمَد المركبة المعلّقة وحدها. سجّلها من جديد إن لزم.",
      );
    }

    return tx.vehicle.update({
      where: { id: vehicle.id },
      data: {
        status: "APPROVED",
        ...(input.reason ? { notes: input.reason } : {}),
      },
      select: { id: true, plateNumber: true, status: true },
    });
  },
});

export const rejectVehicle = defineAction({
  name: "rejectVehicle",
  capability: "VEHICLES",
  kind: "write",
  schema: decisionSchema.extend({
    /* ⚠️ إلزاميّ: رفضٌ بلا سبب لا يُخبر الساكن بما يُصلحه */
    reason: z.string().trim().min(3, "سبب الرفض مطلوب.").max(500),
  }),
  auditAction: "vehicle.reject",
  auditEntityType: "Vehicle",
  handler: async ({ input, tx }) => {
    const vehicle = await tx.vehicle.findUnique({
      where: { id: input.vehicleId },
      select: { id: true, status: true },
    });
    if (!vehicle) throw new NotFoundError("المركبة");
    if (vehicle.status !== "PENDING_APPROVAL") {
      throw new BusinessRuleError("تُرفَض المركبة المعلّقة وحدها.");
    }

    return tx.vehicle.update({
      where: { id: vehicle.id },
      data: { status: "REJECTED", notes: input.reason },
      select: { id: true, plateNumber: true, status: true },
    });
  },
});

/**
 * رفع المركبة — إنهاء علاقتها بالمجمَّع.
 *
 * ⚠️ **وهو ما يُحرّر اللوحة** لتسجيل جديد (‏S7). سيارةٌ بيعت لساكن آخر
 * تُرفَع من الأولى ثم تُسجَّل للثاني — والفريد الكامل كان سيمنع ذلك أبداً.
 */
export const removeVehicle = defineAction({
  name: "removeVehicle",
  capability: "VEHICLES",
  kind: "write",
  transactional: true,
  schema: decisionSchema,
  auditAction: "vehicle.remove",
  auditEntityType: "Vehicle",
  handler: async ({ input, tx }) => {
    const vehicle = await tx.vehicle.findUnique({
      where: { id: input.vehicleId },
      select: {
        id: true,
        status: true,
        badges: {
          where: { status: "ISSUED" },
          select: { id: true, code: true },
        },
      },
    });
    if (!vehicle) throw new NotFoundError("المركبة");
    if (vehicle.status === "REMOVED") {
      throw new BusinessRuleError("المركبة مرفوعة سلفاً.");
    }

    /**
     * ── 🔴 لا تُرفَع مركبة تحتها باجٌ ساري ─────────────────────────────
     * الرفع يُحرّر اللوحة للتسجيل باسم آخر، والباج الساري يفتح البوّابة.
     * فرفعُها بلا إلغائه يترك بطاقةً تعمل لسيارةٍ صارت لغير صاحبها.
     *
     * ⚠️ وإلغاء الباج هنا تلقائياً ممنوع: `B3` لم يُحسم، والباج قد يحمل
     * رسماً مقيَّداً — وإلغاؤه صامتاً يمسّ مالاً بلا قرار.
     */
    if (vehicle.badges.length > 0) {
      throw new BusinessRuleError(
        `على المركبة باجٌ ساري (${vehicle.badges[0]!.code ?? "بلا رمز"}). ألغِ الباج قبل رفعها.`,
      );
    }

    return tx.vehicle.update({
      where: { id: vehicle.id },
      data: { status: "REMOVED", ...(input.reason ? { notes: input.reason } : {}) },
      select: { id: true, plateNumber: true, status: true },
    });
  },
});
