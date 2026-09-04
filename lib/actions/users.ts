"use server";

import { z } from "zod";
import { defineAction } from "./define-action";
import { BusinessRuleError, ConflictError, NotFoundError } from "@/lib/errors";
import { normalizePhone } from "@/lib/domain/phone";
import { violates } from "@/lib/db-errors";
import { CAN_CREATE_ROLES, USER_ROLES, type UserRole } from "@/lib/auth/roles";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  إجراءات المستخدمين — سدّ الفراغين `V2` و`V3`.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── لماذا هذان الإجراءان غير موجودين في §9.2 أصلاً ────────────────────
 * المواصفة تفترضهما في أربعة مواضع ولا تعرّفهما:
 *   §3.1  «حساب الأدمن يُنشئه المالك» · «حساب الموظف يُنشئه الأدمن»
 *   §7.1/2 «المالك يدخل بـGoogle ويُنشئ الأدمن»
 *   §3.2  «المستخدمون والأدوار» = F للمالك · F للأدمن عدا OWNER
 *   R2    «لا حذف صلب؛ اضبط isActive = false»
 * وقائمة §9.2 فيها `createResident` و`createStaff` فقط.
 *
 * أثر الفراغ الأول: **لا مسار إقلاع للنظام** — تعريف إنجاز P0 غير قابل
 * للتحقّق. وأثر الثاني: **لا سبيل لمنع دخول موظف تُرك عمله**، لأن
 * `isActive` هو آلية المنع الوحيدة (‏§10.1).
 */

// ── قواعد من ينشئ من ────────────────────────────────────────────────

/**
 * `§3.2`: الأدمن يملك `F` على المستخدمين **«عدا OWNER»**.
 *
 * الجدول صريح لا مستنتَج، ويُختبر. ولولا هذا القيد لاستطاع أي أدمن أن
 * يُنشئ مالكاً ثانياً أو يُعطّل المالك — أي أن يعزل من يُفترض أن يراقبه،
 * وهو نقض للهدف `O4` نفسه.
 */
/** مصدر واحد يقرأه الخادم والواجهة معاً — راجع lib/auth/roles.ts */
const CAN_CREATE = CAN_CREATE_ROLES;

/** من يجوز له تعطيل/تفعيل مَن. نفس المنطق: الأدمن لا يمسّ مالكاً. */
const CAN_TOGGLE: Record<UserRole, readonly UserRole[]> = CAN_CREATE;

const phoneField = z.string().transform((value, ctx) => {
  const result = normalizePhone(value);
  if (!result.ok) {
    ctx.addIssue({ code: "custom", message: result.messageAr });
    return z.NEVER;
  }
  return result.phone;
});

const createUserSchema = z.object({
  fullName: z.string().trim().min(3, "الاسم الكامل مطلوب (٣ أحرف على الأقل)."),
  phone: phoneField,
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("صيغة البريد غير صحيحة.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  role: z.enum(USER_ROLES),
  gender: z.enum(["MALE", "FEMALE"]).optional(),
  notes: z.string().trim().max(500, "الملاحظة طويلة.").optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

/**
 * إنشاء مستخدم بأي دور — **مسار الإقلاع** ومسار الإدارة معاً.
 *
 * ⚠️ البريد **إلزامي عملياً لمن يدخل بـGoogle** (المالك والأدمن والموظف)،
 * لأن المطابقة في مسار الرجوع تقع عليه. الساكن يدخل بالهاتف فلا يلزمه.
 */
export const createUser = defineAction({
  name: "createUser",
  capability: "USERS_AND_ROLES",
  kind: "write",
  transactional: true,
  auditAction: "user.create",
  auditEntityType: "User",
  schema: createUserSchema,
  handler: async ({ input, actor, tx }) => {
    const allowed = CAN_CREATE[actor.role];
    if (!allowed.includes(input.role)) {
      throw new BusinessRuleError(
        actor.role === "ADMIN" && input.role === "OWNER"
          ? "الأدمن لا يستطيع إنشاء حساب مالك."
          : "دورك لا يسمح بإنشاء مستخدم بهذا الدور.",
        "§3.2",
      );
    }

    if (input.role !== "RESIDENT" && !input.email) {
      throw new BusinessRuleError(
        "البريد الإلكتروني مطلوب لهذا الدور — الدخول يتمّ بحساب Google والمطابقة تقع على البريد.",
        "§10.1",
      );
    }

    // فحص تطبيقي **إضافي** لا بديل: القيد الفريد في القاعدة هو الحارس
    // الحقيقي ضد التزامن. هذا الفحص يعطي رسالة عربية مفهومة بدل خطأ خام.
    const clash = await tx.user.findFirst({
      where: { OR: [{ phone: input.phone }, ...(input.email ? [{ email: input.email }] : [])] },
      select: { id: true, phone: true, email: true },
    });
    if (clash) {
      throw new ConflictError(
        clash.phone === input.phone
          ? "رقم الهاتف مسجَّل لمستخدم آخر."
          : "البريد الإلكتروني مسجَّل لمستخدم آخر.",
      );
    }

    try {
      const user = await tx.user.create({
        data: {
          fullName: input.fullName,
          phone: input.phone,
          email: input.email ?? null,
          role: input.role,
          gender: input.gender ?? null,
          notes: input.notes ?? null,
          isActive: true,
          createdByUserId: actor.userId,
        },
        select: { id: true, fullName: true, phone: true, email: true, role: true },
      });
      return user;
    } catch (error) {
      // R1: فهرس فريد جزئي على المالك النشط — رسالة مفهومة لا خطأ خام.
      // ⚠️ لا String(error): اسم القيد مدفون في meta لا في الرسالة.
      if (violates(error, "uniq_active_owner")) {
        throw new ConflictError("يوجد مالك نشط بالفعل. لا يمكن وجود أكثر من مالك نشط واحد.");
      }
      throw error;
    }
  },
});

const setUserActiveSchema = z.object({
  userId: z.string().min(1, "معرّف المستخدم مطلوب."),
  isActive: z.boolean(),
  reason: z.string().trim().max(500).optional(),
});

/**
 * التفعيل والتعطيل — **آلية منع الدخول الوحيدة** (‏R2 · §10.1).
 *
 * لا حذف صلب أبداً: التاريخ المالي والتشغيلي يشير إلى هذا المستخدم في
 * العقود والقيود والتدقيق، وحذفه يقطع سلسلة المسؤولية.
 */
export const setUserActive = defineAction({
  name: "setUserActive",
  capability: "USERS_AND_ROLES",
  kind: "write",
  transactional: true,
  auditAction: "user.set_active",
  auditEntityType: "User",
  schema: setUserActiveSchema,
  handler: async ({ input, actor, tx }) => {
    const target = await tx.user.findFirst({
      where: { id: input.userId },
      select: { id: true, role: true, isActive: true, fullName: true },
    });
    if (!target) throw new NotFoundError("المستخدم");

    if (!CAN_TOGGLE[actor.role].includes(target.role as UserRole)) {
      throw new BusinessRuleError("دورك لا يسمح بتعديل حالة هذا المستخدم.", "§3.2");
    }

    // لا أحد يُعطّل نفسه — وإلا خرج من النظام ولا سبيل لعودته إلا بتدخّل
    // مباشر في قاعدة البيانات.
    if (target.id === actor.userId && !input.isActive) {
      throw new BusinessRuleError("لا يمكنك تعطيل حسابك أنت.");
    }

    const updated = await tx.user.update({
      where: { id: target.id },
      data: { isActive: input.isActive, notes: input.reason ?? undefined },
      select: { id: true, fullName: true, role: true, isActive: true },
    });
    return updated;
  },
});

const listUsersSchema = z.object({
  role: z.enum(USER_ROLES).optional(),
  includeInactive: z.boolean().default(false),
  page: z.number().int().min(1).default(1),
});

/** قائمة المستخدمين — مُصفَّحة من الخادم (‏§12.6: حجم الصفحة 25). */
export const listUsers = defineAction({
  name: "listUsers",
  capability: "USERS_AND_ROLES",
  kind: "read",
  schema: listUsersSchema,
  handler: async ({ input, tx }) => {
    const PAGE_SIZE = 25;
    const where = {
      ...(input.role ? { role: input.role } : {}),
      ...(input.includeInactive ? {} : { isActive: true }),
    };
    const [rows, total] = await Promise.all([
      tx.user.findMany({
        where,
        select: {
          id: true, fullName: true, phone: true, email: true,
          role: true, isActive: true, lastLoginAt: true, createdAt: true,
        },
        orderBy: [{ role: "asc" }, { fullName: "asc" }],
        skip: (input.page - 1) * PAGE_SIZE,
        take: PAGE_SIZE, // §12.6: لا findMany بلا take أبداً
      }),
      tx.user.count({ where }),
    ]);
    return { rows, total, page: input.page, pageSize: PAGE_SIZE };
  },
});
