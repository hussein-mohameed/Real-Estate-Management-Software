"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { setMyAvailability, staffWorkspace } from "@/lib/services/staff-self";
import type { AvailabilityOutcome, StaffWorkspace } from "@/lib/services/staff-self";

export type {
  AvailabilityOutcome,
  MyColleague,
  MyDepartmentTask,
  MySkill,
  StaffWorkspace,
} from "@/lib/services/staff-self";

/**
 * أغلفة الجلسة حول مساحة الموظف.
 *
 * ⚠️ **لا منطق هنا عمداً.** النطاق والترتيب والتدقيق في
 * `lib/services/staff-self.ts` حيث تُختبَر — راجع تعليقه، وفيه شرح
 * «نصف الصلاحية المكتوب وغير المُنفَّذ» في §3.2.
 */

const EMPTY: StaffWorkspace = {
  profile: null,
  skills: [],
  departmentTasks: [],
  colleagues: [],
};

export async function myWorkspace(): Promise<StaffWorkspace> {
  const session = await getSession();
  if (!session) return EMPTY;
  return staffWorkspace(session.user.id);
}

/**
 * تبديل تواجدي.
 *
 * ⚠️ `userId` **من الجلسة لا من الوسيط**. لو قبلت هذه الدالّة مُعرِّفاً
 * لصارت «اضبط تواجد أي موظف» — وهي نقطة نهاية HTTP قابلة للاستدعاء
 * مباشرةً (‏§10.3: «لا تثق أبداً بأن المتصل عرض الصفحة»).
 */
export async function toggleMyAvailability(
  isAvailable: boolean,
): Promise<AvailabilityOutcome> {
  const session = await getSession();
  if (!session) {
    return { ok: false, isAvailable: false, message: "انتهت جلستك. أعد الدخول." };
  }

  const out = await setMyAvailability(session.user.id, isAvailable);

  // الشارة مُصيَّرة على الخادم — بلا إبطال تبقى القيمة القديمة معروضة
  if (out.ok) revalidatePath("/staff");
  return out;
}
