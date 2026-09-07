"use server";

import { revalidatePath } from "next/cache";
import {
  approveSubscription,
  cancelSubscription,
  createSubscription,
  dismissCancellationRequest,
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

/**
 * ردّ طلب الإلغاء — الإبقاء على الاشتراك.
 *
 * ⚠️ **ليس إلغاءً للاشتراك بل للطلب.** بدونه لا يملك الأدمن الذي يقرّر
 * الإبقاء إلا التجاهل، فيبقى العلم مرفوعاً ويتراكم حتى تصير شارة «إلغاء
 * مطلوب» ضجيجاً لا إشارة.
 */
export async function dismissCancellationAction(
  subscriptionId: string,
  reason: string,
): Promise<ActionResult<unknown>> {
  const me = await requireRole("ADMIN");
  const r = await dismissCancellationRequest(
    { subscriptionId, ...(reason.trim() ? { reason: reason.trim() } : {}) },
    { userId: me.id, role: me.role },
  );
  if (r.ok) revalidatePath(PATH);
  return r;
}

/**
 * إنشاء اشتراك — الإدارة مباشرةً.
 *
 * ⚠️ `subjectType: "APARTMENT"` ثابتٌ هنا: الاشتراك على **ساكن** يلزمه
 * `residentUserId` واختيارُ الساكن شاشةٌ أخرى. وقبولُه بلا واجهةٍ تختاره
 * كان سيمرّر `undefined` فيُردّ في الخادم برسالةٍ لا تشرح ما ينقص.
 */
export async function createSubscriptionAction(input: {
  serviceId: string;
  apartmentId: string;
  quantity: number;
  notes: string;
}): Promise<ActionResult<unknown>> {
  const me = await requireRole("ADMIN");
  const r = await createSubscription(
    {
      serviceId: input.serviceId,
      subjectType: "APARTMENT",
      apartmentId: input.apartmentId,
      quantity: input.quantity,
      ...(input.notes.trim() ? { notes: input.notes.trim() } : {}),
    },
    { userId: me.id, role: me.role },
  );
  if (r.ok) revalidatePath(PATH);
  return r;
}
