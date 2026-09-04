"use server";

import { revalidatePath } from "next/cache";
import { migrateInstallmentPlan } from "@/lib/actions/installments-migrate";
import { requireRole } from "@/lib/auth/guard";
import { formatIqd } from "@/lib/money";
import type { ActionResult } from "@/lib/result";

/**
 * مغلّف شاشة الترحيل — `N3`.
 *
 * ⚠️ **الأدمن وحده.** الترحيل يكتب عشرات القيود في دفترٍ لا يُحذف منه
 * شيء (‏R29)، ويجري مرّة واحدة لكل عقد. والموظّف يتابع ويُعلّم الدفع —
 * لا يُعيد كتابة تاريخ العقد.
 *
 * ⚠️ و**المال يعبر نصّاً**: `BigInt` لا يعبر حدّ الخادم/العميل في RSC،
 * وتحويله إلى عدد عائم يفقد الدقّة فوق 2^53 — على قيمة عقدٍ بالملايين.
 */
export async function migrateAction(input: {
  contractId: string;
  totalAmountIqd: string;
  downPaymentIqd: string;
  installmentsCount: number;
  intervalMonths: number;
  startDate: string;
  migratedAt: string;
  reason: string;
  paid: Array<{ sequence: number; paidAt?: string }>;
}): Promise<
  ActionResult<{
    planId: string;
    installments: number;
    paidCount: number;
    approximateDates: number;
    openingBalanceLabel: string;
    planCompleted: boolean;
  }>
> {
  const me = await requireRole("ADMIN");

  const result = await migrateInstallmentPlan(input, { userId: me.id, role: me.role });
  if (!result.ok) return result;

  revalidatePath("/admin/installments");

  return {
    ok: true,
    data: {
      planId: result.data.planId,
      installments: result.data.installments,
      paidCount: result.data.paidCount,
      approximateDates: result.data.approximateDates,
      /* ⚠️ يُنسَّق هنا: قاعدة تنسيق واحدة للمال، في الخادم */
      openingBalanceLabel: formatIqd(result.data.openingBalanceIqd),
      planCompleted: result.data.planCompleted,
    },
  };
}
