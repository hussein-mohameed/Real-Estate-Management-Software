"use server";

import { revalidatePath } from "next/cache";
import {
  approveSubscription,
  cancelSubscription,
  rejectSubscription,
  updateSubscriptionQuantity,
} from "@/lib/actions/subscriptions";
import { requireRole } from "@/lib/auth/guard";
import type { ActionResult } from "@/lib/result";

/**
 * مغلّفات شاشة الاشتراكات.
 *
 * ⚠️ **تحلّ الجلسة بنفسها.** الإجراء الأساسي يستقبل `actor` وسيطاً ليبقى
 * قابلاً للاختبار بلا شبكة، لكن ما يستدعيه المتصفّح لا يجوز أن يقبل هوية
 * من العميل — وإلا وافق أي أحد على اشتراك باسم المالك.
 *
 * ⚠️ و**المالك ممنوع من هذه الأفعال** (‏D3/2): الموافقة على اشتراك كتابةٌ
 * عملياتية. تمنعه المصفوفة في `defineAction`، و`requireRole` هنا يُغلق
 * الباب قبل أن يُطرق — فلا يظهر في التدقيق محاولةُ منعٍ لكل نقرة.
 */

const PATH = "/admin/subscriptions";

export async function approveAction(subscriptionId: string): Promise<ActionResult<unknown>> {
  const me = await requireRole("ADMIN");
  const r = await approveSubscription({ subscriptionId }, { userId: me.id, role: me.role });
  if (r.ok) revalidatePath(PATH);
  return r;
}

export async function rejectAction(
  subscriptionId: string,
  reason: string,
): Promise<ActionResult<unknown>> {
  const me = await requireRole("ADMIN");
  const r = await rejectSubscription(
    { subscriptionId, reason },
    { userId: me.id, role: me.role },
  );
  if (r.ok) revalidatePath(PATH);
  return r;
}

export async function cancelAction(
  subscriptionId: string,
  reason: string,
): Promise<ActionResult<unknown>> {
  const me = await requireRole("ADMIN");
  const r = await cancelSubscription(
    { subscriptionId, reason: reason || undefined },
    { userId: me.id, role: me.role },
  );
  if (r.ok) revalidatePath(PATH);
  return r;
}

export async function setQuantityAction(
  subscriptionId: string,
  quantity: number,
): Promise<ActionResult<unknown>> {
  const me = await requireRole("ADMIN");
  const r = await updateSubscriptionQuantity(
    { subscriptionId, quantity },
    { userId: me.id, role: me.role },
  );
  if (r.ok) revalidatePath(PATH);
  return r;
}
