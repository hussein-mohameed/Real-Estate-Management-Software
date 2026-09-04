"use server";

import { revalidatePath } from "next/cache";
import { createUser, setUserActive } from "@/lib/actions/users";
import { requireRole } from "@/lib/auth/guard";
import type { ActionResult } from "@/lib/result";

/**
 * مغلّفات الشاشة.
 *
 * ⚠️ **تحلّ الجلسة بنفسها.** الإجراء الأساسي يستقبل `actor` كوسيط ليبقى
 * قابلاً للاختبار بلا شبكة، لكن ما يستدعيه المتصفّح **لا يجوز أن يقبل
 * هوية من العميل** — وإلا انتحل أي أحد دور المالك بتمرير الوسيط.
 * فالهوية تُقرأ من الكوكي هنا، ولا تعبر الحدّ أبداً.
 */

export async function createUserAction(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  const me = await requireRole("OWNER", "ADMIN");

  const result = await createUser(
    {
      fullName: String(formData.get("fullName") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      email: String(formData.get("email") ?? ""),
      role: String(formData.get("role") ?? ""),
    },
    { userId: me.id, role: me.role },
  );

  if (result.ok) revalidatePath("/admin/users");
  return result;
}

export async function toggleActiveAction(
  userId: string,
  isActive: boolean,
): Promise<ActionResult<unknown>> {
  const me = await requireRole("OWNER", "ADMIN");
  const result = await setUserActive({ userId, isActive }, { userId: me.id, role: me.role });
  if (result.ok) revalidatePath("/admin/users");
  return result;
}
