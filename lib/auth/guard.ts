import "server-only";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ForbiddenError, UnauthenticatedError } from "@/lib/errors";
import { decideApartmentAccess, type ApartmentAccessFacts } from "./access";
import { getSession, type SessionUser } from "./session";
import { ROLE_HOME, type UserRole } from "./roles";

/**
 * طبقة الحماية (‏§2.3 · §10.3) — **العمود الفقري الأمني للنظام كله**.
 *
 * ── التحصين الطبقي بثلاث طبقات، معياران مختلفان ─────────────────────
 *   1. `proxy.ts`     ← تحويل رخيص بفحص وجود الكوكي. **ليس حدّاً أمنياً**:
 *                        توثيق Next 16 يقول إن Proxy قد يُنشر على CDN ولا
 *                        ينبغي أن يعتمد على وحدات مشتركة (‏00-STACK-VERIFIED §2.2).
 *   2. `layout.tsx`   ← `requireRole` بأدوار **القراءة** — فيدخل المالك.
 *   3. كل Server Action ← يعيد الفحص بأدوار **الكتابة**.
 *
 * المواصفة تشدّد: «لا تثق أبداً بأن المتصل قد عرض الصفحة» — لأن الـaction
 * نقطة نهاية HTTP قابلة للاستدعاء مباشرةً بلا مرور بأي صفحة.
 */

/** يرمي إن لم توجد جلسة. للاستعمال داخل الإجراءات. */
export async function requireUser(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) throw new UnauthenticatedError();
  return session.user;
}

/** يرمي إن لم يكن الدور ضمن المسموح. */
export async function requireRole(...roles: UserRole[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) {
    throw new ForbiddenError("لا تملك صلاحية الوصول إلى هذا القسم.");
  }
  return user;
}

/**
 * نسخة الـ`layout`: تُحوّل بدل أن ترمي.
 * صفحة تعرض خطأً 500 لمستخدم دخل مساراً لا يخصّه تجربة رديئة؛ التحويل
 * إلى لوحته هو السلوك الصحيح.
 */
export async function requireRoleOrRedirect(...roles: UserRole[]): Promise<SessionUser> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!roles.includes(session.user.role)) redirect(ROLE_HOME[session.user.role]);
  return session.user;
}

/**
 * نطاق الساكن — نُقل إلى `./scope` كي لا يجرّ **الجلسة** كلُّ من يحتاج
 * **نطاقاً**. يُعاد تصديره هنا فلا ينكسر مستدعٍ قائم.
 */
import { residentAccountIds } from "./scope";
export { residentApartmentIds, residentAccountIds } from "./scope";

/** يجلب الحقائق التي تحتاجها سياسة `D4`. */
async function gatherFacts(user: SessionUser, apartmentId: string): Promise<ApartmentAccessFacts> {
  if (user.role === "OWNER" || user.role === "ADMIN") {
    return {
      role: user.role,
      hasActiveResidentLink: false,
      hasOpenAssignedRequest: false,
      hasActiveFollowUpInstallment: false,
    };
  }

  const [link, request, installment] = await Promise.all([
    prisma.apartmentResident.findFirst({
      where: { userId: user.id, apartmentId, isActive: true },
      select: { id: true },
    }),
    user.role === "STAFF"
      ? prisma.serviceRequest.findFirst({
          where: {
            apartmentId,
            assignedStaffId: user.id,
            status: { notIn: ["DONE", "CANCELLED"] },
          },
          select: { id: true },
        })
      : null,
    user.role === "STAFF"
      ? prisma.installment.findFirst({
          where: {
            followUpStaffId: user.id,
            status: { in: ["PENDING", "OVERDUE"] },
            // ⚠️ المسار ثلاثي القفزات (‏D4/1) — يعتمد على الفهرس
            // Installment(followUpStaffId, status) وإلا صار **فحص الترخيص
            // نفسه** بطيئاً، وهو يُنفَّذ في كل استدعاء.
            plan: { contract: { apartmentId } },
          },
          select: { id: true },
        })
      : null,
  ]);

  return {
    role: user.role,
    hasActiveResidentLink: link !== null,
    hasOpenAssignedRequest: request !== null,
    hasActiveFollowUpInstallment: installment !== null,
  };
}

/**
 * ⚠️ **أخطر دالة في النظام.** تُنفَّذ في كل استدعاء تقريباً، وخطأ فيها يفتح
 * بيانات ساكن لساكن آخر.
 *
 * ترمي `ForbiddenError` صريحاً — **لا تُرجع قائمة فارغة**. الفراغ يوحي
 * بعدم الوجود ولا يميّز الخطأ من المنع، فيظنّ المستخدم أن بياناته ضاعت.
 */
export async function requireApartmentAccess(apartmentId: string): Promise<SessionUser> {
  const user = await requireUser();
  const decision = decideApartmentAccess(await gatherFacts(user, apartmentId));
  if (!decision.allowed) {
    throw new ForbiddenError("لا تملك صلاحية الوصول إلى بيانات هذه الشقة.");
  }
  return user;
}

/** يرمي إن لم يكن الحساب ضمن نطاق الساكن — يمنع تمرير `accountId` غيره. */
export async function requireAccountAccess(accountId: string): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role === "OWNER" || user.role === "ADMIN") return user;

  const allowed = await residentAccountIds(user.id);
  if (!allowed.includes(accountId)) {
    throw new ForbiddenError("لا تملك صلاحية الوصول إلى هذا الحساب.");
  }
  return user;
}
