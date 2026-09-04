"use server";

import { revalidatePath } from "next/cache";
import {
  closeCashDrawer,
  openMyCashDrawer,
  recordCashPayment,
} from "@/lib/actions/cash";
import { requireRole } from "@/lib/auth/guard";
import type { ActionResult } from "@/lib/result";

/**
 * مغلّفات شاشة النقد.
 *
 * ⚠️ **تحلّ الجلسة بنفسها.** الإجراء الأساسي يستقبل `actor` وسيطاً ليبقى
 * قابلاً للاختبار بلا شبكة، لكن ما يستدعيه المتصفّح **لا يجوز أن يقبل
 * هوية من العميل** — وإلا فتح أي أحد صندوقاً باسم غيره. الهوية من الكوكي
 * ولا تعبر الحدّ.
 *
 * ⚠️ و`RECORD_CASH_PAYMENT` هي القدرة، لا `LEDGER_AND_ACCOUNTS`: من يقرأ
 * الدفتر ليس بالضرورة من يقبض. والمصفوفة تمنعه في `defineAction` على أي
 * حال — وهذا الحارس الثاني لا الأول.
 */

const PATH = "/admin/cash";

export async function openDrawerAction(): Promise<ActionResult<unknown>> {
  const me = await requireRole("OWNER", "ADMIN", "STAFF");
  const r = await openMyCashDrawer({}, { userId: me.id, role: me.role });
  if (r.ok) revalidatePath(PATH);
  return r;
}

export async function recordPaymentAction(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  const me = await requireRole("OWNER", "ADMIN", "STAFF");

  /**
   * ⚠️ المبلغ يُمرَّر **نصّاً** لا `Number`. `FormData` تعطي نصّاً، وتحويله
   * إلى عدد عائم يفقد الدقّة فوق 2^53 — و`z.coerce.bigint()` تقرأ النصّ
   * مباشرةً. رقمٌ ناقص دينارَين على دفعة نقدية عيبٌ يُكتشف عند الجرد.
   */
  const r = await recordCashPayment(
    {
      accountId: String(formData.get("accountId") ?? ""),
      amountIqd: String(formData.get("amountIqd") ?? ""),
      notes: String(formData.get("notes") ?? "") || undefined,
    },
    { userId: me.id, role: me.role },
  );

  if (r.ok) revalidatePath(PATH);
  return r;
}

export async function closeDrawerAction(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  const me = await requireRole("OWNER", "ADMIN", "STAFF");

  const r = await closeCashDrawer(
    {
      sessionId: String(formData.get("sessionId") ?? ""),
      declaredIqd: String(formData.get("declaredIqd") ?? ""),
      notes: String(formData.get("notes") ?? "") || undefined,
    },
    { userId: me.id, role: me.role },
  );

  if (r.ok) revalidatePath(PATH);
  return r;
}
