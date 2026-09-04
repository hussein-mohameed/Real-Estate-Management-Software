"use server";

import { revalidatePath } from "next/cache";
import {
  createDepartment,
  createSkill,
  createStaff,
  createVendor,
  setStaffAvailability,
  setStaffCashPermission,
  setStaffSkills,
} from "@/lib/actions/staff";
import type { SkillLevel } from "@/lib/domain/enums";
import { setUserActive } from "@/lib/actions/users";
import { requireRole } from "@/lib/auth/guard";
import type { ActionResult } from "@/lib/result";

/** مغلّفات شاشة الموظفين — الهوية من الكوكي لا من العميل. */

function s(fd: FormData, key: string): string | undefined {
  const v = fd.get(key);
  const out = typeof v === "string" ? v.trim() : "";
  return out === "" ? undefined : out;
}

export async function createStaffAction(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  const me = await requireRole("ADMIN");
  const result = await createStaff(
    {
      fullName: s(formData, "fullName"),
      phone: s(formData, "phone"),
      email: s(formData, "email"),
      employmentType: s(formData, "employmentType"),
      vendorId: s(formData, "vendorId"),
      departmentId: s(formData, "departmentId"),
      jobTitle: s(formData, "jobTitle"),
    },
    { userId: me.id, role: me.role },
  );
  if (result.ok) revalidatePath("/admin/staff");
  return result;
}

export async function createDepartmentAction(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  const me = await requireRole("ADMIN");
  const result = await createDepartment(
    { name: s(formData, "name"), description: s(formData, "description") },
    { userId: me.id, role: me.role },
  );
  if (result.ok) revalidatePath("/admin/staff");
  return result;
}

export async function createSkillAction(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  const me = await requireRole("ADMIN");
  const result = await createSkill({ name: s(formData, "name") }, { userId: me.id, role: me.role });
  if (result.ok) revalidatePath("/admin/staff");
  return result;
}

export async function createVendorAction(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  const me = await requireRole("ADMIN");
  const result = await createVendor(
    {
      name: s(formData, "name"),
      contactPerson: s(formData, "contactPerson"),
      phone: s(formData, "phone"),
      specialty: s(formData, "specialty"),
    },
    { userId: me.id, role: me.role },
  );
  if (result.ok) revalidatePath("/admin/staff");
  return result;
}

export async function setAvailabilityAction(
  userId: string,
  isAvailable: boolean,
): Promise<ActionResult<unknown>> {
  const me = await requireRole("ADMIN");
  const result = await setStaffAvailability(
    { userId, isAvailable },
    { userId: me.id, role: me.role },
  );
  if (result.ok) revalidatePath("/admin/staff");
  return result;
}

/**
 * ── صلاحية قبض النقد — القرار `B4` ──────────────────────────────────
 *
 * ⚠️ **الإجراء الأخطر في هذه الشاشة.** مصفوفة §3.2 تعطي كل موظّف قدرةَ
 * تسجيل دفعة نقدية، والحماية الحقيقية هي هذا العلم: موظّف يسجّل دفعة
 * ويقبض النقد ولا يورّده = إسقاط دَين مقابل سرقة. الدفتر append-only
 * فالقيد لا يُحذف — لكن الدَين سقط والنقد بجيبه.
 *
 * والافتراضي `false` — لا أحد يقبض. والمنح **فعلٌ صريح مستقلّ**، لا حقل
 * في نموذج إنشاء الموظف يُملأ سهواً.
 *
 * ⚠️ والسبب إلزامي في المخطّط (‏min 3): يُكتب في التدقيق. «من منح ومتى»
 * بلا «لماذا» لا يفيد من يراجع بعد سنة.
 */
export async function setCashPermissionAction(
  userId: string,
  canReceiveCash: boolean,
  reason: string,
): Promise<ActionResult<unknown>> {
  const me = await requireRole("ADMIN");
  const result = await setStaffCashPermission(
    { userId, canReceiveCash, reason },
    { userId: me.id, role: me.role },
  );
  if (result.ok) revalidatePath("/admin/staff");
  return result;
}

/**
 * ── مهارات الموظّف ─────────────────────────────────────────────────
 *
 * ⚠️ **الإجراء يستبدل المجموعة كلّها، لا يضيف إليها.** فالمحرّر يرسل كل
 * مهارات الموظّف في كل حفظ — وإرسالُ المتغيّرة وحدها يمحو الباقي.
 * الاستبدال داخل معاملة، فلا نافذة يظهر فيها الموظّف بلا مهارات.
 */
export async function setSkillsAction(
  userId: string,
  skills: Array<{
    skillId: string;
    level: SkillLevel;
    needsTraining: boolean;
    hasTrained: boolean;
    trainingNote?: string;
  }>,
): Promise<ActionResult<unknown>> {
  const me = await requireRole("ADMIN");
  const result = await setStaffSkills({ userId, skills }, { userId: me.id, role: me.role });
  if (result.ok) revalidatePath("/admin/staff");
  return result;
}

/**
 * ── تعطيل موظّف ترك العمل ──────────────────────────────────────────
 *
 * ⚠️ **قدرته `USERS_AND_ROLES` لا إدارة الموظفين** — والفرق مقصود:
 * `isActive` هو **آلية منع الدخول الوحيدة** في النظام (‏R2 · §10.1)، لا
 * علمُ تنظيمٍ في ملفّ وظيفي. فمن يُدير الموظفين ليس بالضرورة من يملك
 * فتح الأبواب وإغلاقها.
 *
 * ⚠️ و**لا حذف**: الموظّف مرتبط بتدقيق وبجلسات صندوق وبقيود. حذفُه يقتل
 * مراجع لا تُستعاد، والتعطيل يمنع الدخول ويُبقي السجلّ.
 */
export async function setActiveAction(
  userId: string,
  isActive: boolean,
  reason: string,
): Promise<ActionResult<unknown>> {
  const me = await requireRole("ADMIN");
  const result = await setUserActive(
    { userId, isActive, ...(reason.trim() ? { reason: reason.trim() } : {}) },
    { userId: me.id, role: me.role },
  );
  if (result.ok) revalidatePath("/admin/staff");
  return result;
}
