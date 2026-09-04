"use server";

import { z } from "zod";
import type { Prisma } from "@/lib/generated/prisma/client";
import { defineAction } from "./define-action";
import { BusinessRuleError, ConflictError, NotFoundError } from "@/lib/errors";
import { violates } from "@/lib/db-errors";
import { normalizePhone } from "@/lib/domain/phone";
import { RESIDENT_RELATION } from "@/lib/domain/enums";
import { now } from "@/lib/dates";
import { recomputePerPersonForApartment } from "@/lib/services/per-person-recompute";

/**
 * السكان وربطهم بالشقق — الخطوتان 1.3 و1.4.
 *
 * ── ما ليس هنا عمداً ─────────────────────────────────────────────────
 * **رفع صور الهوية وبطاقة السكن** مؤجَّل، ويحتاج شيئين لا أملكهما:
 *   1. `SUPABASE_SECRET_KEY` — للروابط الموقَّعة من الخادم (‏R4/R5).
 *   2. **قرارك في مدّة الاحتفاظ** — الخطوة `N6` تقول «تُحدَّد مدّة ويُبنى
 *      إجراء حذف مجدول»، والمدّة نفسها ليست ضمن `B1–B7` ولا يحدّدها أي
 *      مستند. راجع `F4` في docs/OPEN-DECISIONS.md.
 * بناء التخزين قبل معرفة مدّة الاحتفاظ يعني بناءه مرتين.
 */

const phoneField = z.string().transform((value, ctx) => {
  const result = normalizePhone(value);
  if (!result.ok) {
    ctx.addIssue({ code: "custom", message: result.messageAr });
    return z.NEVER;
  }
  return result.phone;
});

const createResidentSchema = z.object({
  fullName: z.string().trim().min(3, "الاسم الكامل مطلوب (٣ أحرف على الأقل)."),
  phone: phoneField,
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("صيغة البريد غير صحيحة.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  gender: z.enum(["MALE", "FEMALE"]).optional(),
  emergencyPhone: z
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
  notes: z.string().trim().max(500).optional(),
});

/**
 * إنشاء ساكن — مستخدم + ملف شخصي في **معاملة واحدة**.
 *
 * ⚠️ الساكن يُنشأ **بلا كلمة مرور**: يدخل بـOTP على واتساب، أو بـGoogle إن
 * أُعطي بريداً. لا تسجيل عام ولا دعوة — الأدمن يُنشئ كل حساب (‏§10.1).
 */
export const createResident = defineAction({
  name: "createResident",
  capability: "RESIDENT_PROFILES",
  kind: "write",
  transactional: true,
  auditAction: "resident.create",
  auditEntityType: "User",
  schema: createResidentSchema,
  handler: async ({ input, actor, tx }) => {
    const clash = await tx.user.findFirst({
      where: { OR: [{ phone: input.phone }, ...(input.email ? [{ email: input.email }] : [])] },
      select: { phone: true },
    });
    if (clash) {
      throw new ConflictError(
        clash.phone === input.phone
          ? "رقم الهاتف مسجَّل لمستخدم آخر."
          : "البريد الإلكتروني مسجَّل لمستخدم آخر.",
      );
    }

    const user = await tx.user.create({
      data: {
        fullName: input.fullName,
        phone: input.phone,
        email: input.email ?? null,
        gender: input.gender ?? null,
        role: "RESIDENT",
        isActive: true,
        createdByUserId: actor.userId,
        residentProfile: {
          create: {
            emergencyPhone: input.emergencyPhone ?? null,
            notes: input.notes ?? null,
            // R6: «هل تمتلك سيارة؟» و«هل عندك باج؟» **ليست حقولاً** —
            // تُشتقّ من Vehicle و Badge. تخزينها boolean يُنتج تناقضاً
            // حتمياً مع الجدولين عند أول تغيير.
          },
        },
      },
      select: { id: true, fullName: true, phone: true, email: true },
    });
    return user;
  },
});

const updateResidentSchema = z.object({
  userId: z.string().min(1),
  fullName: z.string().trim().min(3, "الاسم الكامل مطلوب.").optional(),
  phone: phoneField.optional(),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("صيغة البريد غير صحيحة.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  emergencyPhone: z.string().optional(),
  notes: z.string().trim().max(500).optional(),
});

/**
 * تعديل بيانات ساكن — **الإجراء المفقود `V4`**.
 *
 * §8.2/3 يعدّ «رفع المستندات» عملية مستقلة، و§3.2 يعطي الساكن «قراءة +
 * طلب تغيير» — وكلاهما يفترض وجود مسار تعديل. و§9.2 فيها `createResident`
 * وحده، الذي يقبل البيانات **عند الإنشاء فقط**. فهوية وصلت متأخرة أو رقم
 * هاتف تغيّر لا مكان لهما.
 */
export const updateResident = defineAction({
  name: "updateResident",
  capability: "RESIDENT_PROFILES",
  kind: "write",
  transactional: true,
  auditAction: "resident.update",
  auditEntityType: "User",
  schema: updateResidentSchema,
  handler: async ({ input, tx }) => {
    const target = await tx.user.findFirst({
      where: { id: input.userId },
      select: { id: true, role: true, phone: true },
    });
    if (!target) throw new NotFoundError("الساكن");
    if (target.role !== "RESIDENT") {
      throw new BusinessRuleError("هذا الإجراء للسكان فقط.");
    }

    let emergencyPhone: string | null | undefined;
    if (input.emergencyPhone !== undefined) {
      if (!input.emergencyPhone.trim()) emergencyPhone = null;
      else {
        const r = normalizePhone(input.emergencyPhone);
        if (!r.ok) throw new BusinessRuleError(`هاتف الطوارئ: ${r.messageAr}`);
        emergencyPhone = r.phone;
      }
    }

    try {
      const updated = await tx.user.update({
        where: { id: target.id },
        data: {
          fullName: input.fullName ?? undefined,
          phone: input.phone ?? undefined,
          email: input.email ?? undefined,
          residentProfile: {
            update: {
              emergencyPhone,
              notes: input.notes ?? undefined,
            },
          },
        },
        select: { id: true, fullName: true, phone: true, email: true },
      });
      return updated;
    } catch (error) {
      if (violates(error, "User_phone_key")) {
        throw new ConflictError("رقم الهاتف مسجَّل لمستخدم آخر.");
      }
      if (violates(error, "User_email_key")) {
        throw new ConflictError("البريد الإلكتروني مسجَّل لمستخدم آخر.");
      }
      throw error;
    }
  },
});

// ── الخطوة 1.4 — ربط الشقة بالسكان ───────────────────────────────────

const linkSchema = z.object({
  apartmentId: z.string().min(1),
  userId: z.string().min(1),
  relationType: z.enum(RESIDENT_RELATION),
  isContractHolder: z.boolean().default(false),
  movedInAt: z.coerce.date().optional(),
});

/**
 * ربط ساكن بشقة.
 *
 * ── ثلاثة قرارات محمولة في هذا الإجراء ──────────────────────────────
 * **`R11`** — المستخدم قد يُربط بأكثر من شقة (مالك يسكن واحدة ويؤجّر
 * أخرى). فلا فحص «مربوط سلفاً» على مستوى المستخدم، بل على الزوج.
 *
 * **`Q41`** — رُفع شرط «يجب أن يكون `RESIDENT`». حارس أو فنّي مقيم حالة
 * شائعة في المجمّعات، ودوره يبقى `STAFF` ولا يتغيّر.
 *
 * **`Q32`** — `CONTRACT_HOLDER` حُذف من `ResidentRelation`. القرابة
 * وحدها في الـenum، ودور صاحب العقد يحمله `isContractHolder` — لأن الفهرس
 * الفريد الجزئي مبنيّ عليه، ولأن حقلين لنفس الحقيقة يتناقضان حتماً.
 */
export const linkResidentToApartment = defineAction({
  name: "linkResidentToApartment",
  capability: "APARTMENT_RESIDENT_LINKS",
  kind: "write",
  transactional: true,
  auditAction: "apartment.resident.link",
  auditEntityType: "ApartmentResident",
  schema: linkSchema,
  handler: async ({ input, tx }) => {
    const [apartment, user] = await Promise.all([
      tx.apartment.findFirst({
        where: { id: input.apartmentId },
        select: { id: true, displayNumber: true },
      }),
      tx.user.findFirst({
        where: { id: input.userId },
        select: { id: true, fullName: true, isActive: true },
      }),
    ]);
    if (!apartment) throw new NotFoundError("الشقة");
    if (!user) throw new NotFoundError("المستخدم");
    if (!user.isActive) {
      throw new BusinessRuleError("لا يمكن ربط مستخدم معطَّل بشقة.");
    }

    const already = await tx.apartmentResident.findFirst({
      where: { apartmentId: apartment.id, userId: user.id, isActive: true },
      select: { id: true },
    });
    if (already) {
      throw new ConflictError(`«${user.fullName}» مرتبط بهذه الشقة أصلاً.`);
    }

    try {
      const link = await tx.apartmentResident.create({
        data: {
          apartmentId: apartment.id,
          userId: user.id,
          relationType: input.relationType,
          isContractHolder: input.isContractHolder,
          movedInAt: input.movedInAt ?? now(),
          // الاستثناء المتعمَّد الثاني للمبدأ 1: يُحسب عند الحفظ من
          // movedOutAt في **مكان واحد** فقط — هنا وفي unlinkResident.
          isActive: true,
        },
        select: { id: true, apartmentId: true, userId: true, isContractHolder: true },
      });

      /**
       * ⚠️ **شرط `Q5` اللازم — في نفس المعاملة.**
       * عدد الأشخاص مشتقّ، لكن `periodAmountIqd` مخزَّن ويقرأه مؤشّر
       * «الإيراد الشهري المتوقّع» (‏Q45). إعادةُ الحساب عند الفوترة
       * وحدها كانت ستترك المؤشّر بين دورتين يقرأ قيمةً قديمة: أسرة
       * كبرت والمالك يرى نصف الحقيقة لأسابيع.
       */
      const recomputed = await recomputePerPersonForApartment(tx, apartment.id);

      return { ...link, perPersonRecomputed: recomputed.updated, personsCount: recomputed.personsCount };
    } catch (error) {
      if (violates(error, "uniq_contract_holder_per_apartment")) {
        throw new ConflictError(
          "لهذه الشقة صاحب عقد نشط بالفعل. أنهِ ربطه أولاً أو أزل عنه صفة صاحب العقد.",
        );
      }
      throw error;
    }
  },
});

const unlinkSchema = z.object({
  apartmentResidentId: z.string().min(1),
  movedOutAt: z.coerce.date().optional(),
});

/**
 * إخراج ساكن.
 *
 * **`R13`**: إخراج **آخر** ساكن نشط يُطالب الأدمن بضبط `VACANT` — وهو
 * **تنبيه لا إجراء تلقائي**، لأن الإخلاء قرار إداري له أثر مالي مباشر:
 * يوقف كل الاشتراكات الدورية. النظام يُنبّه، والإنسان يقرّر.
 */
export const unlinkResident = defineAction({
  name: "unlinkResident",
  capability: "APARTMENT_RESIDENT_LINKS",
  kind: "write",
  transactional: true,
  auditAction: "apartment.resident.unlink",
  auditEntityType: "ApartmentResident",
  schema: unlinkSchema,
  handler: async ({ input, tx }) => {
    const link = await tx.apartmentResident.findFirst({
      where: { id: input.apartmentResidentId },
      select: { id: true, apartmentId: true, isActive: true },
    });
    if (!link) throw new NotFoundError("الربط");
    if (!link.isActive) throw new BusinessRuleError("هذا الربط منتهٍ أصلاً.");

    await tx.apartmentResident.update({
      where: { id: link.id },
      data: { movedOutAt: input.movedOutAt ?? now(), isActive: false },
    });

    const remaining = await tx.apartmentResident.count({
      where: { apartmentId: link.apartmentId, isActive: true },
    });

    // ‏Q5: الخروج يُنقص العدد كما يزيده الدخول — الاتجاهان سواء
    const recomputed = await recomputePerPersonForApartment(tx, link.apartmentId);

    const apartment = await tx.apartment.findFirst({
      where: { id: link.apartmentId },
      select: { occupancyStatus: true, displayNumber: true },
    });

    return {
      id: link.id,
      remainingResidents: remaining,
      // R13: المطالبة تُرفع للواجهة، والقرار للأدمن
      promptSetVacant: remaining === 0 && apartment?.occupancyStatus !== "VACANT",
      apartmentDisplayNumber: apartment?.displayNumber ?? null,
      perPersonRecomputed: recomputed.updated,
    };
  },
});

const listResidentsSchema = z.object({
  apartmentId: z.string().optional(),
  search: z.string().trim().max(60).optional(),
  includeInactive: z.boolean().default(false),
  /**
   * يشمل من ليس دوره `RESIDENT` وهو ساكن فعلاً.
   *
   * ⚠️ **تناقض حقيقي بلا هذا الحقل.** `linkResidentToApartment` رفع شرط
   * الدور صراحةً بحكم `Q41` (الحارس أو الفنّي المقيم يبقى `STAFF`)، بينما
   * هذه القائمة ترشّح `role = RESIDENT`. فالنتيجة أن موظفاً ساكناً يمكن
   * ربطه بالخلفية **ولا يظهر في أي منتقٍ** — لا في اختيار صاحب العقد ولا
   * في ربط ساكن بشقة. الحقل موجود ولا يُعثر عليه.
   *
   * الافتراضي `false` كي لا يتغيّر معنى «قائمة السكان» ولا نتائج قائمة.
   * المناتق تمرّره `true`.
   */
  includeNonResidentRoles: z.boolean().default(false),
  page: z.number().int().min(1).default(1),
  /**
   * ⚠️ سقف 200 مقصود. الشاشات تعرض 25، لكن **القوائم المنسدلة** (اختيار
   * الشقة في نموذج العقد مثلاً) تحتاج الكل لا الصفحة الأولى — وبلا هذا
   * الحقل كانت تُقصّ عند 25 **صامتةً**: الشقة موجودة والمستخدم لا يجدها
   * في القائمة، فيظنّها غير منشأة. والسقف يمنع أن يصير الترقيم زينة.
   */
  pageSize: z.number().int().min(1).max(200).default(25),
});

export const listResidents = defineAction({
  name: "listResidents",
  capability: "RESIDENT_PROFILES",
  kind: "read",
  schema: listResidentsSchema,
  handler: async ({ input, tx }) => {
    const PAGE_SIZE = input.pageSize;
    /**
     * ⚠️ الشروط تُركَّب في `AND` **لا كمفاتيح في كائن واحد**: شرط الدور
     * وشرط البحث كلاهما `OR`، وكائن JavaScript لا يحمل مفتاحاً مكرّراً —
     * فالثاني يمحو الأول صامتاً. النتيجة كانت ستكون بحثاً يتجاوز ترشيح
     * الدور بالكامل، فيُرجع الأدمن والمالك في «قائمة السكان».
     */
    const and: Prisma.UserWhereInput[] = [];

    // من دوره ساكن، أو من له ارتباط سكن نشط مهما كان دوره (‏Q41)
    and.push(
      input.includeNonResidentRoles
        ? { OR: [{ role: "RESIDENT" }, { apartmentLinks: { some: { isActive: true } } }] }
        : { role: "RESIDENT" },
    );
    if (!input.includeInactive) and.push({ isActive: true });
    if (input.search) {
      and.push({
        OR: [
          { fullName: { contains: input.search, mode: "insensitive" } },
          { phone: { contains: input.search } },
        ],
      });
    }
    if (input.apartmentId) {
      and.push({ apartmentLinks: { some: { apartmentId: input.apartmentId, isActive: true } } });
    }

    const where: Prisma.UserWhereInput = { AND: and };

    const [rows, total] = await Promise.all([
      tx.user.findMany({
        where,
        select: {
          id: true, fullName: true, phone: true, email: true, isActive: true,
          apartmentLinks: {
            where: { isActive: true },
            select: {
              id: true,
              isContractHolder: true,
              relationType: true,
              apartment: { select: { id: true, displayNumber: true } },
            },
          },
        },
        orderBy: { fullName: "asc" },
        skip: (input.page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      tx.user.count({ where }),
    ]);

    return { rows, total, page: input.page, pageSize: PAGE_SIZE };
  },
});
