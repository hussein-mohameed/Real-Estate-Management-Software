import { z } from "zod";
import { defineAction } from "./define-action";
import { BusinessRuleError, ConflictError, NotFoundError } from "@/lib/errors";
import { violates } from "@/lib/db-errors";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  الأقسام ومهامّها — الإدارة الكاملة.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── 🔴 الثغرة التي وُجدت من أجلها ───────────────────────────────────
 * `createDepartmentTask` كان موجوداً بلا قراءةٍ ولا تعديل ولا إيقاف. أي
 * أن المهمّة تُنشأ ولا تُصحَّح: خطأٌ في اسمها يبقى أبداً، ومهمّة انتهت
 * الحاجة إليها تظل تُعرَض على من يُنشئ طلباً.
 *
 * ── ⚠️ ولا حذف — إيقاف ─────────────────────────────────────────────
 * `DepartmentTask` مرتبطة بـ`ServiceRequest`: كل طلب يشير إلى مهمّته.
 * وحذفُها يقتل مراجع طلباتٍ مضت ولا تُستعاد — أو يفشل بمفتاح أجنبي.
 * والإيقاف يمنع الاستعمال الجديد ويُبقي التاريخ مقروءاً، وهو نفس المبدأ
 * الذي حكم الخدمات (‏R24) والموظفين.
 *
 * ── ولماذا وحدة منفصلة عن `staff.ts` ────────────────────────────────
 * الأقسام والمهامّ شأنٌ تنظيمي قائم بذاته، و`staff.ts` تجاوز ثمانمئة سطر.
 * والقدرة واحدة (`DEPARTMENTS_SKILLS_STAFF`) فلا ينفصل الترخيص.
 */

export const listDepartmentTasks = defineAction({
  name: "listDepartmentTasks",
  capability: "DEPARTMENTS_SKILLS_STAFF",
  kind: "read",
  schema: z
    .object({
      departmentId: z.string().optional(),
      includeInactive: z.boolean().default(false),
      search: z.string().trim().min(1).max(80).optional(),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(200).default(25),
    })
    .default({ includeInactive: false, page: 1, pageSize: 25 }),
  handler: async ({ input, tx }) => {
    const where = {
      ...(input.departmentId ? { departmentId: input.departmentId } : {}),
      ...(input.includeInactive ? {} : { isActive: true }),
      ...(input.search
        ? {
            OR: [
              { name: { contains: input.search, mode: "insensitive" as const } },
              { description: { contains: input.search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      tx.departmentTask.findMany({
        where,
        /*
         * ⚠️ ترتيب حاسم: `name` وحده يتساوى بين قسمين، فيتداخل التصفيح.
         * والقسم أوّلاً لأن القارئ يقرأ مهامّ قسمٍ لا مهامّ النظام.
         */
        orderBy: [{ department: { name: "asc" } }, { name: "asc" }, { id: "asc" }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        select: {
          id: true,
          name: true,
          description: true,
          isActive: true,
          departmentId: true,
          department: { select: { id: true, name: true } },
          /*
           * ⚠️ عدد الطلبات **محسوب دائماً**: هو ما يقرّر أن المهمّة تُوقَف
           * ولا تُحذف. وإخفاؤه يجعل الأدمن يطلب حذفاً لا يُنفَّذ.
           */
          _count: { select: { requests: true } },
        },
      }),
      tx.departmentTask.count({ where }),
    ]);

    return {
      rows: rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        isActive: r.isActive,
        departmentId: r.departmentId,
        departmentName: r.department.name,
        requestsCount: r._count.requests,
      })),
      total,
      page: input.page,
      pageSize: input.pageSize,
    };
  },
});

export const updateDepartmentTask = defineAction({
  name: "updateDepartmentTask",
  capability: "DEPARTMENTS_SKILLS_STAFF",
  kind: "write",
  transactional: true,
  auditAction: "department.task.update",
  auditEntityType: "DepartmentTask",
  schema: z.object({
    taskId: z.string().min(1),
    name: z.string().trim().min(2, "اسم المهمّة مطلوب."),
    description: z.string().trim().max(500).optional(),
  }),
  handler: async ({ input, tx }) => {
    const task = await tx.departmentTask.findUnique({
      where: { id: input.taskId },
      select: { id: true, departmentId: true, department: { select: { name: true } } },
    });
    if (!task) throw new NotFoundError("المهمّة");

    try {
      return await tx.departmentTask.update({
        where: { id: input.taskId },
        data: { name: input.name, description: input.description ?? null },
        select: { id: true, name: true, description: true },
      });
    } catch (error) {
      /* ⚠️ رسالة عربية تسبق خطأ القاعدة الخام — والاسم فريد داخل القسم */
      if (violates(error, "DepartmentTask_departmentId_name_key")) {
        throw new ConflictError(
          `المهمة «${input.name}» موجودة في قسم «${task.department.name}».`,
        );
      }
      throw error;
    }
  },
});

/**
 * إيقاف مهمّة أو إعادتها.
 *
 * ⚠️ **لا حذف.** كل `ServiceRequest` يشير إلى مهمّته، وحذفُها يقتل مراجع
 * طلبات مضت. والإيقاف يمنع الاستعمال الجديد ويُبقي التاريخ مقروءاً.
 */
export const setDepartmentTaskActive = defineAction({
  name: "setDepartmentTaskActive",
  capability: "DEPARTMENTS_SKILLS_STAFF",
  kind: "write",
  transactional: true,
  auditAction: "department.task.set_active",
  auditEntityType: "DepartmentTask",
  schema: z.object({
    taskId: z.string().min(1),
    isActive: z.boolean(),
    reason: z.string().trim().max(300).optional(),
  }),
  handler: async ({ input, tx }) => {
    const task = await tx.departmentTask.findUnique({
      where: { id: input.taskId },
      select: { id: true, name: true, isActive: true },
    });
    if (!task) throw new NotFoundError("المهمّة");

    /* ⚠️ لا كتابة ولا تدقيق بلا تغيير — صفوف متطابقة تُغرق السجلّ */
    if (task.isActive === input.isActive) {
      return { id: task.id, isActive: task.isActive, changed: false };
    }

    const updated = await tx.departmentTask.update({
      where: { id: input.taskId },
      data: { isActive: input.isActive },
      select: { id: true, name: true, isActive: true },
    });

    return { ...updated, changed: true };
  },
});

/**
 * إيقاف قسم أو إعادته.
 *
 * ⚠️ **قسمٌ فيه موظفون لا يُوقَف.** إيقافُه يُخفيه من القوائم ويترك
 * موظفيه مُسنَدين إلى قسمٍ لا يظهر — فلا يُعرَف أين يعملون ولا كيف
 * يُنقَلون. يُفرَّغ أولاً، والرسالة تقول العدد بالرقم.
 */
export const setDepartmentActive = defineAction({
  name: "setDepartmentActive",
  capability: "DEPARTMENTS_SKILLS_STAFF",
  kind: "write",
  transactional: true,
  auditAction: "department.set_active",
  auditEntityType: "Department",
  schema: z.object({
    departmentId: z.string().min(1),
    isActive: z.boolean(),
  }),
  handler: async ({ input, tx }) => {
    const dept = await tx.department.findUnique({
      where: { id: input.departmentId },
      select: {
        id: true,
        name: true,
        isActive: true,
        _count: { select: { staff: true } },
      },
    });
    if (!dept) throw new NotFoundError("القسم");

    if (dept.isActive === input.isActive) {
      return { id: dept.id, isActive: dept.isActive, changed: false };
    }

    if (!input.isActive && dept._count.staff > 0) {
      throw new BusinessRuleError(
        `قسم «${dept.name}» فيه ${dept._count.staff} موظفاً. انقلهم أولاً — ` +
          "الإيقاف يُخفي القسم ويترك موظفيه بلا موضع ظاهر.",
      );
    }

    const updated = await tx.department.update({
      where: { id: input.departmentId },
      data: { isActive: input.isActive },
      select: { id: true, name: true, isActive: true },
    });

    return { ...updated, changed: true };
  },
});
