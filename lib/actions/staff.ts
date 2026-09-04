"use server";

import { z } from "zod";
import { defineAction } from "./define-action";
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
} from "@/lib/errors";
import { violates } from "@/lib/db-errors";
import { normalizePhone } from "@/lib/domain/phone";
import { EMPLOYMENT_TYPE, SKILL_LEVEL } from "@/lib/domain/enums";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  الموظفون والأقسام والمهارات والبائعون — الخطوة 1.8.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * **بيانات مرجعية تنظيمية.** والقرار الأهمّ هنا هو ما **لم** يُبنَ:
 *
 * ── المهارات ملصقات فقط [محسوم] ────────────────────────────────────
 * لا كتالوج كورسات، ولا تسجيل، ولا شهادات، ولا مسار تدريب.
 * `level` و`needsTraining` و`hasTrained` حقول **معلوماتية** تُقرأ
 * كتلميح عند اقتراح مُكلَّف — **والتكليف يدوي دائماً**.
 * مقاومة إغراء بناء وحدة تدريب هنا مقصودة ومُعلَنة.
 *
 * ── `DepartmentTask` قائمة مرجعية لا محرّك مهام ────────────────────
 * تُصنَّف بها الطلبات، ولا تحمل حالة ولا مُكلَّفاً ولا موعداً. ما يحمل
 * الحالة هو `ServiceRequest`.
 *
 * ── `isAvailable` علم حضور بسيط [محسوم] ───────────────────────────
 * لا ورديات، ولا حضور وانصراف، ولا جدولة. علمٌ يرفعه الموظف أو الأدمن
 * ليُقترح أو لا يُقترح.
 *
 * ── «الأشخاص» في القسم **محسوب** ──────────────────────────────────
 * §4.6: عدد `StaffProfile` لا عمود مخزَّن. العمود كان سيتقادم عند أول
 * نقل بين قسمين يجري خارج المسار المتوقَّع، ولا يكشفه شيء لأنه يبدو
 * رقماً معقولاً دائماً.
 */

const phoneField = z.string().transform((value, ctx) => {
  const result = normalizePhone(value);
  if (!result.ok) {
    ctx.addIssue({ code: "custom", message: result.messageAr });
    return z.NEVER;
  }
  return result.phone;
});

// ═══════════════════════════════════════════════════════════════════════
//  البائعون
// ═══════════════════════════════════════════════════════════════════════

const vendorSchema = z.object({
  name: z.string().trim().min(2, "اسم الشركة مطلوب."),
  contactPerson: z.string().trim().max(120).optional(),
  phone: z
    .string()
    .transform((v, ctx) => {
      if (!v.trim()) return undefined;
      const r = normalizePhone(v);
      if (!r.ok) {
        ctx.addIssue({ code: "custom", message: r.messageAr });
        return z.NEVER;
      }
      return r.phone;
    })
    .optional(),
  specialty: z.string().trim().max(120).optional(),
});

export const createVendor = defineAction({
  name: "createVendor",
  capability: "DEPARTMENTS_SKILLS_STAFF",
  kind: "write",
  transactional: true,
  auditAction: "vendor.create",
  auditEntityType: "Vendor",
  schema: vendorSchema,
  handler: async ({ input, tx }) =>
    tx.vendor.create({
      data: {
        name: input.name,
        contactPerson: input.contactPerson ?? null,
        phone: input.phone ?? null,
        specialty: input.specialty ?? null,
      },
      select: { id: true, name: true, specialty: true, isActive: true },
    }),
});

export const listVendors = defineAction({
  name: "listVendors",
  capability: "DEPARTMENTS_SKILLS_STAFF",
  kind: "read",
  schema: z.object({ includeInactive: z.boolean().default(false) }).default({ includeInactive: false }),
  handler: async ({ input, tx }) =>
    tx.vendor.findMany({
      where: input.includeInactive ? {} : { isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        contactPerson: true,
        phone: true,
        specialty: true,
        isActive: true,
        // §4.6: العدد محسوب لا مخزَّن
        _count: { select: { staff: true } },
      },
    }),
});

// ═══════════════════════════════════════════════════════════════════════
//  الأقسام ومهامّها
// ═══════════════════════════════════════════════════════════════════════

const departmentSchema = z.object({
  name: z.string().trim().min(2, "اسم القسم مطلوب."),
  description: z.string().trim().max(500).optional(),
  managerUserId: z.string().optional(),
});

export const createDepartment = defineAction({
  name: "createDepartment",
  capability: "DEPARTMENTS_SKILLS_STAFF",
  kind: "write",
  transactional: true,
  auditAction: "department.create",
  auditEntityType: "Department",
  schema: departmentSchema,
  handler: async ({ input, tx }) => {
    if (input.managerUserId) {
      const manager = await tx.user.findFirst({
        where: { id: input.managerUserId },
        select: { id: true, isActive: true, fullName: true },
      });
      if (!manager) throw new NotFoundError("مدير القسم");
      if (!manager.isActive) {
        throw new BusinessRuleError(`«${manager.fullName}» حساب معطَّل، ولا يصحّ أن يدير قسماً.`);
      }
    }

    try {
      return await tx.department.create({
        data: {
          name: input.name,
          description: input.description ?? null,
          managerUserId: input.managerUserId ?? null,
        },
        select: { id: true, name: true, isActive: true },
      });
    } catch (error) {
      if (violates(error, "Department_name_key")) {
        throw new ConflictError(`القسم «${input.name}» موجود بالفعل.`);
      }
      throw error;
    }
  },
});

export const listDepartments = defineAction({
  name: "listDepartments",
  capability: "DEPARTMENTS_SKILLS_STAFF",
  kind: "read",
  schema: z.object({ includeInactive: z.boolean().default(false) }).default({ includeInactive: false }),
  handler: async ({ input, tx }) =>
    tx.department.findMany({
      where: input.includeInactive ? {} : { isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        description: true,
        isActive: true,
        manager: { select: { id: true, fullName: true } },
        /**
         * §4.6: «الأشخاص» **محسوب**. `_count` يُترجَم إلى تجميع في
         * المحرّك — لا صفوف تعبر الشبكة لتُعَدّ، ولا عمود يتقادم.
         */
        _count: { select: { staff: true, tasks: true } },
      },
    }),
});

const taskSchema = z.object({
  departmentId: z.string().min(1, "القسم مطلوب."),
  name: z.string().trim().min(2, "اسم المهمة مطلوب."),
  description: z.string().trim().max(500).optional(),
});

/**
 * مهمة قسم — **بند في قائمة مرجعية**.
 *
 * ⚠️ ليست مهمةً تُسنَد أو تُنجَز: لا حالة، ولا مُكلَّف، ولا موعد. وجودها
 * الوحيد أن تُصنَّف بها الطلبات («تسريب ماء» تحت قسم الصيانة). ما يحمل
 * الحالة والمُكلَّف هو `ServiceRequest`.
 */
export const createDepartmentTask = defineAction({
  name: "createDepartmentTask",
  capability: "DEPARTMENTS_SKILLS_STAFF",
  kind: "write",
  transactional: true,
  auditAction: "department.task.create",
  auditEntityType: "DepartmentTask",
  schema: taskSchema,
  handler: async ({ input, tx }) => {
    const dept = await tx.department.findFirst({
      where: { id: input.departmentId },
      select: { id: true, name: true },
    });
    if (!dept) throw new NotFoundError("القسم");

    try {
      return await tx.departmentTask.create({
        data: {
          departmentId: input.departmentId,
          name: input.name,
          description: input.description ?? null,
        },
        select: { id: true, name: true, departmentId: true },
      });
    } catch (error) {
      if (violates(error, "DepartmentTask_departmentId_name_key")) {
        throw new ConflictError(`المهمة «${input.name}» موجودة في قسم «${dept.name}».`);
      }
      throw error;
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════
//  المهارات — ملصقات
// ═══════════════════════════════════════════════════════════════════════

export const createSkill = defineAction({
  name: "createSkill",
  capability: "DEPARTMENTS_SKILLS_STAFF",
  kind: "write",
  transactional: true,
  auditAction: "skill.create",
  auditEntityType: "Skill",
  schema: z.object({ name: z.string().trim().min(2, "اسم المهارة مطلوب.") }),
  handler: async ({ input, tx }) => {
    try {
      return await tx.skill.create({
        data: { name: input.name },
        select: { id: true, name: true, isActive: true },
      });
    } catch (error) {
      if (violates(error, "Skill_name_key")) {
        throw new ConflictError(`المهارة «${input.name}» موجودة بالفعل.`);
      }
      throw error;
    }
  },
});

export const listSkills = defineAction({
  name: "listSkills",
  capability: "DEPARTMENTS_SKILLS_STAFF",
  kind: "read",
  schema: z.object({ includeInactive: z.boolean().default(false) }).default({ includeInactive: false }),
  handler: async ({ input, tx }) =>
    tx.skill.findMany({
      where: input.includeInactive ? {} : { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, isActive: true, _count: { select: { staffSkills: true } } },
    }),
});

// ═══════════════════════════════════════════════════════════════════════
//  الموظفون
// ═══════════════════════════════════════════════════════════════════════

const createStaffSchema = z
  .object({
    /** لربط ملف موظف بمستخدم قائم (‏مثلاً أُنشئ عبر `createUser`). */
    userId: z.string().optional(),
    fullName: z.string().trim().min(3, "الاسم الكامل مطلوب (٣ أحرف على الأقل).").optional(),
    phone: phoneField.optional(),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email("صيغة البريد غير صحيحة.")
      .optional()
      .or(z.literal("").transform(() => undefined)),
    employmentType: z.enum(EMPLOYMENT_TYPE),
    vendorId: z.string().optional(),
    departmentId: z.string().optional(),
    jobTitle: z.string().trim().max(120).optional(),
    hiredAt: z.coerce.date().optional(),
  })
  .superRefine((v, ctx) => {
    /**
     * ⚠️ **شرط مشروط لا يُعبَّر عنه في Prisma.**
     * `vendorId` اختياري في المخطّط لأنه لا يلزم إلا حين يكون التوظيف
     * عبر شركة. القيد الحقيقي في قاعدة البيانات
     * (`staff_vendor_requires_vendor`)، وهذا الفحص يسبقه ليعطي رسالة
     * عربية على الحقل الصحيح بدل رسالة محرّك على النموذج كلّه.
     */
    if (v.employmentType === "VENDOR" && !v.vendorId) {
      ctx.addIssue({
        code: "custom",
        path: ["vendorId"],
        message: "الشركة مطلوبة عندما يكون التوظيف عبر بائع.",
      });
    }
    /** والعكس: شركة على موظف داخلي بيانٌ لا معنى له ويضلّل التقارير. */
    if (v.employmentType !== "VENDOR" && v.vendorId) {
      ctx.addIssue({
        code: "custom",
        path: ["vendorId"],
        message: "الشركة تُذكر لموظفي البائعين فقط.",
      });
    }
    if (!v.userId && (!v.fullName || !v.phone)) {
      ctx.addIssue({
        code: "custom",
        path: ["fullName"],
        message: "الاسم ورقم الهاتف مطلوبان لإنشاء موظف جديد.",
      });
    }
    /**
     * ⚠️ **البريد إلزامي للموظف الجديد** — نفس قاعدة `createUser`.
     * §7.1: الموظفون يدخلون بـGoogle، **والمطابقة تقع على البريد**.
     * موظف بلا بريد مستخدمٌ **لا يستطيع الدخول إطلاقاً**: يظهر في كل
     * قائمة، ويُكلَّف بطلبات، ولا يرى شيئاً منها.
     *
     * كُشف بفشل اختبار: `createUser` يفرض القاعدة و`createStaff` لا،
     * فكان المسار الثاني ينتج حسابات ميتة بلا أن يشتكي شيء.
     */
    if (!v.userId && !v.email) {
      ctx.addIssue({
        code: "custom",
        path: ["email"],
        message: "البريد الإلكتروني مطلوب للموظف — الدخول بحساب Google والمطابقة على البريد.",
      });
    }
  });

/**
 * إنشاء موظف — مستخدم + ملف وظيفي في **معاملة واحدة**.
 *
 * ── لماذا يقبل `userId` قائماً ─────────────────────────────────────
 * `createUser` يُنشئ مستخدماً بدور `STAFF` **بلا ملف وظيفي**، فيبقى بلا
 * قسم ولا علم تواجد ولا مهارات — موجوداً وغير قابل للتكليف. هذا المسار
 * يسدّ الفجوة بدل أن يفرض إنشاء مستخدم ثانٍ.
 *
 * ⚠️ **`canReceiveCash` غير مقبول هنا عمداً** — راجع
 * `setStaffCashPermission` أدناه.
 */
export const createStaff = defineAction({
  name: "createStaff",
  capability: "DEPARTMENTS_SKILLS_STAFF",
  kind: "write",
  transactional: true,
  auditAction: "staff.create",
  auditEntityType: "StaffProfile",
  schema: createStaffSchema,
  handler: async ({ input, tx }) => {
    if (input.vendorId) {
      const vendor = await tx.vendor.findFirst({
        where: { id: input.vendorId },
        select: { id: true, isActive: true, name: true },
      });
      if (!vendor) throw new NotFoundError("الشركة");
      if (!vendor.isActive) {
        throw new BusinessRuleError(`الشركة «${vendor.name}» غير نشطة.`);
      }
    }
    if (input.departmentId) {
      const dept = await tx.department.findFirst({
        where: { id: input.departmentId },
        select: { id: true },
      });
      if (!dept) throw new NotFoundError("القسم");
    }

    let userId = input.userId;

    if (userId) {
      const user = await tx.user.findFirst({
        where: { id: userId },
        select: { id: true, fullName: true, staffProfile: { select: { userId: true } } },
      });
      if (!user) throw new NotFoundError("المستخدم");
      if (user.staffProfile) {
        throw new ConflictError(`«${user.fullName}» له ملف وظيفي بالفعل.`);
      }
    } else {
      const clash = await tx.user.findFirst({
        where: {
          OR: [{ phone: input.phone! }, ...(input.email ? [{ email: input.email }] : [])],
        },
        select: { phone: true },
      });
      if (clash) {
        throw new ConflictError(
          clash.phone === input.phone
            ? "رقم الهاتف مسجَّل لمستخدم آخر."
            : "البريد الإلكتروني مسجَّل لمستخدم آخر.",
        );
      }

      const created = await tx.user.create({
        data: {
          fullName: input.fullName!,
          phone: input.phone!,
          email: input.email ?? null,
          role: "STAFF",
        },
        select: { id: true },
      });
      userId = created.id;
    }

    try {
      return await tx.staffProfile.create({
        data: {
          userId,
          employmentType: input.employmentType,
          vendorId: input.vendorId ?? null,
          departmentId: input.departmentId ?? null,
          jobTitle: input.jobTitle ?? null,
          hiredAt: input.hiredAt ?? null,
          // ⚠️ لا يُمرَّر `canReceiveCash` — يبقى على افتراضيه `false`
        },
        select: {
          userId: true,
          employmentType: true,
          departmentId: true,
          vendorId: true,
          isAvailable: true,
          canReceiveCash: true,
        },
      });
    } catch (error) {
      if (violates(error, "staff_vendor_requires_vendor")) {
        throw new BusinessRuleError("الشركة مطلوبة عندما يكون التوظيف عبر بائع.");
      }
      throw error;
    }
  },
});

/**
 * علم التواجد — **حضور بسيط لا وردية**.
 *
 * لا جدول ورديات ولا سجلّ حضور وانصراف [محسوم]. العلم يُقرأ **كتلميح**
 * في منتقي المُكلَّف، ولا يمنع التكليف: موظف غير متواجد قد يكون هو
 * الوحيد المؤهَّل، والقرار للأدمن.
 */
export const setStaffAvailability = defineAction({
  name: "setStaffAvailability",
  capability: "DEPARTMENTS_SKILLS_STAFF",
  kind: "write",
  transactional: true,
  auditAction: "staff.availability.set",
  auditEntityType: "StaffProfile",
  schema: z.object({ userId: z.string().min(1), isAvailable: z.boolean() }),
  handler: async ({ input, tx }) => {
    const profile = await tx.staffProfile.findUnique({
      where: { userId: input.userId },
      select: { userId: true },
    });
    if (!profile) throw new NotFoundError("الملف الوظيفي");

    return tx.staffProfile.update({
      where: { userId: input.userId },
      data: { isAvailable: input.isAvailable },
      select: { userId: true, isAvailable: true },
    });
  },
});

const skillsSchema = z.object({
  userId: z.string().min(1),
  skills: z
    .array(
      z.object({
        skillId: z.string().min(1),
        level: z.enum(SKILL_LEVEL),
        needsTraining: z.boolean().default(false),
        hasTrained: z.boolean().default(false),
        trainingNote: z.string().trim().max(300).optional(),
      }),
    )
    .max(50),
});

/**
 * ضبط مهارات موظف — **استبدال كامل للمجموعة**.
 *
 * ── لماذا استبدال لا إضافة ─────────────────────────────────────────
 * الشاشة تعرض المجموعة كاملة ويحرّرها المستخدم دفعةً واحدة. الإضافة
 * وحدها كانت تترك المهارة المحذوفة قائمة بلا طريق لإزالتها، والحذف
 * المنفصل يضاعف الإجراءات بلا داعٍ.
 *
 * ⚠️ **ملصقات لا تدريب.** `needsTraining` و`hasTrained` حقلان
 * معلوماتيان: لا يُنشئان دورة، ولا يُذكّران، ولا يمنعان تكليفاً. من
 * أرادها وحدةَ تدريب فليبنِها صراحةً لا بالتسلّل من هنا.
 */
export const setStaffSkills = defineAction({
  name: "setStaffSkills",
  capability: "DEPARTMENTS_SKILLS_STAFF",
  kind: "write",
  transactional: true,
  auditAction: "staff.skills.set",
  auditEntityType: "StaffProfile",
  schema: skillsSchema,
  handler: async ({ input, tx }) => {
    const profile = await tx.staffProfile.findUnique({
      where: { userId: input.userId },
      select: { userId: true },
    });
    if (!profile) throw new NotFoundError("الملف الوظيفي");

    const ids = input.skills.map((s) => s.skillId);
    if (new Set(ids).size !== ids.length) {
      throw new BusinessRuleError("المهارة الواحدة لا تتكرّر بمستويين.");
    }

    if (ids.length > 0) {
      const found = await tx.skill.count({ where: { id: { in: ids } } });
      if (found !== ids.length) throw new NotFoundError("إحدى المهارات");
    }

    // الاستبدال داخل المعاملة: لا نافذة يظهر فيها الموظف بلا مهارات
    await tx.staffSkill.deleteMany({ where: { staffProfileId: input.userId } });
    if (input.skills.length > 0) {
      await tx.staffSkill.createMany({
        data: input.skills.map((s) => ({
          staffProfileId: input.userId,
          skillId: s.skillId,
          level: s.level,
          needsTraining: s.needsTraining,
          hasTrained: s.hasTrained,
          trainingNote: s.trainingNote ?? null,
        })),
      });
    }

    return { userId: input.userId, count: input.skills.length };
  },
});

/**
 * ⚠️ **محجوب بالقرار `B4`.**
 *
 * منح موظفٍ صلاحية قبض النقد بلا **إقفال صندوق يومي** هو بالضبط الثقب
 * الذي يصفه `B4`: موظف يسجّل دفعة ويقبض النقد ولا يورّده — **إسقاط
 * دَين مقابل سرقة**، ولا صندوق ولا إقفال في المواصفة يكشفه.
 *
 * العمود موجود بافتراضي `false` — أي **لا أحد يقبض نقداً**. وهذا هو
 * الوضع الآمن، ولن يتغيّر بالتسلّل: المنح فعلٌ صريح مستقلّ، لا حقلٌ في
 * نموذج إنشاء الموظف يُملأ سهواً.
 */
export const setStaffCashPermission = defineAction({
  name: "setStaffCashPermission",
  capability: "DEPARTMENTS_SKILLS_STAFF",
  kind: "write",
  transactional: true,
  auditAction: "staff.cash_permission.set",
  auditEntityType: "StaffProfile",
  schema: z.object({
    userId: z.string().min(1),
    canReceiveCash: z.boolean(),
    /** سبب المنح أو السحب — إلزامي، ويُكتب في التدقيق. */
    reason: z.string().trim().min(3).max(300),
  }),
  handler: async ({ input, tx }) => {
    const profile = await tx.staffProfile.findUnique({
      where: { userId: input.userId },
      select: { canReceiveCash: true, isAvailable: true },
    });
    if (!profile) throw new NotFoundError("الملفّ الوظيفي");

    if (profile.canReceiveCash === input.canReceiveCash) {
      // ⚠️ لا كتابة ولا تدقيق بلا تغيير — صفوف متطابقة تُغرق السجلّ
      return {
        id: input.userId,
        userId: input.userId,
        canReceiveCash: profile.canReceiveCash,
        changed: false,
      };
    }

    /**
     * ⚠️ **السحب لا يُقفل صندوقاً مفتوحاً.** موظف سُحبت صلاحيته ونقدٌ بيده
     * يجب أن **يُقفل صندوقه ويُقرّ بما ورّده** — سحبُ الصلاحية وتركُ
     * الجلسة مفتوحة يُخفي النقد ولا يستعيده. فالسحب يُرفض حتى يُقفَل.
     */
    if (!input.canReceiveCash) {
      const open = await tx.cashDrawerSession.findFirst({
        where: { staffUserId: input.userId, closedAt: null },
        select: { id: true },
      });
      if (open) {
        throw new BusinessRuleError(
          "لا تُسحب الصلاحية وصندوقه مفتوح. يُقفَل الصندوق ويُقرّ بالمُورَّد أولاً.",
          "B4",
        );
      }
    }

    await tx.staffProfile.update({
      where: { userId: input.userId },
      data: { canReceiveCash: input.canReceiveCash },
    });

    return {
      id: input.userId,
      userId: input.userId,
      canReceiveCash: input.canReceiveCash,
      changed: true,
      reason: input.reason,
    };
  },
});

export const listStaff = defineAction({
  name: "listStaff",
  capability: "DEPARTMENTS_SKILLS_STAFF",
  kind: "read",
  schema: z
    .object({
      departmentId: z.string().optional(),
      onlyAvailable: z.boolean().default(false),
      /** تلميح اقتراح المُكلَّف — يرشّح بمهارة، ولا يفرض شيئاً. */
      skillId: z.string().optional(),
      /**
       * بحث بالاسم أو المسمّى الوظيفي أو الهاتف.
       *
       * ⚠️ **كان الحقل موجوداً في الشاشة والإجراء لا يعرفه** — أي مربّع
       * بحثٍ يُكتب فيه فلا يتغيّر شيء. وهذا أسوأ من غياب البحث: الغياب
       * يُفهَم، والصمت يُقرأ «لا نتائج».
       */
      search: z.string().trim().min(1).max(80).optional(),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(200).default(25),
    })
    .default({ onlyAvailable: false, page: 1, pageSize: 25 }),
  handler: async ({ input, tx }) => {
    /**
     * ── ⚠️ الهاتف يُطابَق برقمه لا بصيغته ─────────────────────────────
     * المخزَّن `E.164` (‏`+9647701234567`)، ومن يبحث يكتب `0770` أو
     * `077 012` أو `+964`. فبحثٌ نصّي حرفيّ لا يجد شيئاً أبداً، والمستخدم
     * يستنتج أن الموظف غير موجود.
     *
     * فتُنزَع كل غير الأرقام، ويُسقَط الصفر البادئ (‏`0770` ← `770`)،
     * ويُطابَق بـ`contains` على الذيل. و`+964` وحده يبقى صالحاً لأنه
     * يظهر في المخزَّن.
     */
    const digits = input.search?.replace(/\D/g, "").replace(/^0+/, "") ?? "";

    const where = {
      ...(input.departmentId ? { departmentId: input.departmentId } : {}),
      /*
       * ── 🔴 «متواجد» **و**«حسابه فعّال» ──────────────────────────────
       * كان الشرط `isAvailable` وحده. وموظّفٌ ترك العمل — حسابه معطَّل —
       * يبقى علمُ تواجده كما تركه، فيظهر في **قائمة من يُكلَّف**. ثم يُسنَد
       * إليه عمل ولا يصله شيء، ولا أحد يعرف لماذا تأخّر.
       *
       * و`isActive` هو منع الدخول نفسه (‏§10.1): من لا يدخل لا يُكلَّف.
       */
      ...(input.onlyAvailable ? { isAvailable: true, user: { isActive: true } } : {}),
      ...(input.skillId ? { skills: { some: { skillId: input.skillId } } } : {}),
      ...(input.search
        ? {
            OR: [
              /* ⚠️ `insensitive` لا يفيد العربية، ويفيد المسمّى اللاتيني إن وُجد */
              { user: { fullName: { contains: input.search, mode: "insensitive" as const } } },
              { jobTitle: { contains: input.search, mode: "insensitive" as const } },
              ...(digits.length >= 3
                ? [{ user: { phone: { contains: digits } } }]
                : []),
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      tx.staffProfile.findMany({
        where,
        orderBy: { user: { fullName: "asc" } },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        select: {
          userId: true,
          employmentType: true,
          jobTitle: true,
          isAvailable: true,
          canReceiveCash: true,
          hiredAt: true,
          user: { select: { id: true, fullName: true, phone: true, isActive: true } },
          department: { select: { id: true, name: true } },
          vendor: { select: { id: true, name: true } },
          skills: {
            select: {
              id: true,
              level: true,
              needsTraining: true,
              hasTrained: true,
              /*
               * ⚠️ **لا يُعرض في الجدول، ويجب أن يُقرأ.**
               * `setStaffSkills` **يستبدل** المجموعة كلّها، ومحرّر المهارات
               * يرسل ما قرأه. فحقلٌ لا يُقرأ هنا يُمحى في كل حفظ — صامتاً،
               * ولا شيء يُنبّه.
               */
              trainingNote: true,
              skill: { select: { id: true, name: true } },
            },
          },
        },
      }),
      tx.staffProfile.count({ where }),
    ]);

    return { rows, total, page: input.page, pageSize: input.pageSize };
  },
});

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  تعديل الملفّ الوظيفي بعد إنشائه.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── 🔴 الثغرة التي وُجد من أجلها ────────────────────────────────────
 * لم يكن في النظام سبيلٌ إلى تعديل موظّف بعد إنشائه: لا قسمه ولا نوع
 * توظيفه ولا مسمّاه. وموظّفٌ يُنقَل من الصيانة إلى الأمن كان يُنشَأ من
 * جديد — فيبقى الأوّل في القوائم، ويتفرّق تدقيقه على ملفّين، وتُحسب
 * أقدميّته من تاريخ خاطئ.
 *
 * ── ⚠️ والاسم والهاتف ليسا هنا ──────────────────────────────────────
 * هما في `User` لا في `StaffProfile`، ويحكمهما `USERS_AND_ROLES` —
 * قدرةٌ أخرى لأن الهاتف **مفتاح دخول** لا بيان تنظيمي. خلطُهما هنا كان
 * يعطي من يُدير الأقسام قدرةَ تغيير هوية الدخول.
 *
 * ── ⚠️ وتغيير نوع التوظيف يُنظّف الشركة ─────────────────────────────
 * موظّفٌ يُنقَل من `VENDOR` إلى `INTERNAL` يبقى `vendorId` عليه لو لم
 * يُمسَح صراحةً — بياناً يناقض حالته، ويضلّل كل تقرير يجمع حسب الشركة.
 * والقيد `staff_vendor_requires_vendor` يمنع العكس لا هذا.
 */
const updateStaffSchema = z
  .object({
    userId: z.string().min(1),
    employmentType: z.enum(EMPLOYMENT_TYPE),
    vendorId: z.string().optional(),
    /** ⚠️ `null` صريح = فكّ الإسناد. و`undefined` = لا تغيير. */
    departmentId: z.string().nullable().optional(),
    jobTitle: z.string().trim().max(120).optional(),
    hiredAt: z.coerce.date().optional(),
  })
  .superRefine((v, ctx) => {
    /* نفس شرط الإنشاء حرفياً — قاعدةٌ واحدة لا تتفرّق بين مسارين */
    if (v.employmentType === "VENDOR" && !v.vendorId) {
      ctx.addIssue({
        code: "custom",
        path: ["vendorId"],
        message: "الشركة مطلوبة عندما يكون التوظيف عبر بائع.",
      });
    }
    if (v.employmentType !== "VENDOR" && v.vendorId) {
      ctx.addIssue({
        code: "custom",
        path: ["vendorId"],
        message: "الشركة تُذكر لموظفي البائعين فقط.",
      });
    }
  });

export const updateStaff = defineAction({
  name: "updateStaff",
  capability: "DEPARTMENTS_SKILLS_STAFF",
  kind: "write",
  transactional: true,
  auditAction: "staff.update",
  auditEntityType: "StaffProfile",
  schema: updateStaffSchema,
  handler: async ({ input, tx }) => {
    const profile = await tx.staffProfile.findUnique({
      where: { userId: input.userId },
      select: { userId: true },
    });
    if (!profile) throw new NotFoundError("الملف الوظيفي");

    if (input.departmentId) {
      const dept = await tx.department.findFirst({
        where: { id: input.departmentId },
        select: { id: true },
      });
      if (!dept) throw new NotFoundError("القسم");
    }

    if (input.vendorId) {
      const vendor = await tx.vendor.findFirst({
        where: { id: input.vendorId },
        select: { id: true },
      });
      if (!vendor) throw new NotFoundError("الشركة");
    }

    const updated = await tx.staffProfile.update({
      where: { userId: input.userId },
      data: {
        employmentType: input.employmentType,
        /* ⚠️ يُمسَح صراحةً حين لا يكون التوظيف عبر شركة */
        vendorId: input.employmentType === "VENDOR" ? (input.vendorId ?? null) : null,
        ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
        ...(input.jobTitle !== undefined ? { jobTitle: input.jobTitle } : {}),
        ...(input.hiredAt !== undefined ? { hiredAt: input.hiredAt } : {}),
      },
      select: {
        userId: true,
        employmentType: true,
        departmentId: true,
        vendorId: true,
        jobTitle: true,
      },
    });

    return { id: updated.userId, ...updated };
  },
});

/**
 * ملفّ موظّف واحد — لصفحته.
 *
 * ⚠️ **لا يُخفي المعطَّل.** من ترك العمل يبقى ملفّه مقروءاً: تدقيقه
 * وجلسات صندوقه وقيوده تشير إليه، وصفحةٌ تقول «غير موجود» تقطع الخيط
 * على من يراجع بعد سنة.
 */
export const getStaff = defineAction({
  name: "getStaff",
  capability: "DEPARTMENTS_SKILLS_STAFF",
  kind: "read",
  schema: z.object({ userId: z.string().min(1) }),
  handler: async ({ input, tx }) => {
    const profile = await tx.staffProfile.findUnique({
      where: { userId: input.userId },
      select: {
        userId: true,
        employmentType: true,
        jobTitle: true,
        isAvailable: true,
        canReceiveCash: true,
        hiredAt: true,
        departmentId: true,
        vendorId: true,
        user: {
          select: {
            id: true,
            fullName: true,
            phone: true,
            email: true,
            isActive: true,
            createdAt: true,
          },
        },
        department: { select: { id: true, name: true } },
        vendor: { select: { id: true, name: true } },
        skills: {
          select: {
            id: true,
            level: true,
            needsTraining: true,
            hasTrained: true,
            trainingNote: true,
            skill: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!profile) return null;

    /*
     * ⚠️ آخر جلسات الصندوق: هي **سجلّ المسؤولية المالية** لهذا الموظّف.
     * وصفحةٌ تعرض مهاراته وتُخفي فروق صناديقه تُجيب عن السؤال السهل وحده.
     */
    const drawers = await tx.cashDrawerSession.findMany({
      where: { staffUserId: input.userId },
      orderBy: { openedAt: "desc" },
      take: 10,
      select: {
        id: true,
        openedAt: true,
        closedAt: true,
        declaredIqd: true,
      },
    });

    return { ...profile, drawers };
  },
});
