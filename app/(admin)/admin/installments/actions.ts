"use server";

import { revalidatePath } from "next/cache";
import {
  createInstallmentPlan,
  markInstallmentPaid,
  recordFollowUp,
} from "@/lib/actions/installments";
import { requireRole } from "@/lib/auth/guard";
import type { ActionResult } from "@/lib/result";

/**
 * مغلّفات شاشة متابعة الأقساط.
 *
 * ⚠️ **تحلّ الجلسة بنفسها.** الإجراء الأساسي يقبل `actor` وسيطاً ليبقى
 * قابلاً للاختبار بلا شبكة؛ وما يستدعيه المتصفّح لا يجوز أن يقبل هوية من
 * العميل — وإلا سدّد أي أحد قسطاً باسم الأدمن.
 *
 * ── ⚠️ والأدوار **ليست واحدة هنا** ──────────────────────────────────
 * مصفوفة §3.2 تعطي الموظّف `W (follow-up + mark paid)`: يتابع ويُعلِّم
 * الدفع، ولا يُنشئ خططاً. فالإنشاء `ADMIN` وحده، والتعليم والمتابعة
 * `ADMIN` أو `STAFF`. وتوحيدُها على `ADMIN` كان يُعطّل نصف عمل الموظّف.
 */

const PATH = "/admin/installments";

export async function createPlanAction(input: {
  contractId: string;
  totalAmountIqd: string;
  downPaymentIqd: string;
  installmentsCount: number;
  intervalMonths: number;
  startDate: string;
}): Promise<ActionResult<unknown>> {
  const me = await requireRole("ADMIN");
  const result = await createInstallmentPlan(
    {
      contractId: input.contractId,
      /* ⚠️ المال يعبر **نصّاً**: `BigInt` لا يعبر حدّ الخادم/العميل في RSC */
      totalAmountIqd: input.totalAmountIqd,
      downPaymentIqd: input.downPaymentIqd,
      installmentsCount: input.installmentsCount,
      intervalMonths: input.intervalMonths,
      startDate: input.startDate,
    },
    { userId: me.id, role: me.role },
  );
  if (result.ok) revalidatePath(PATH);
  return result;
}

export async function markPaidAction(
  installmentId: string,
  notes: string,
): Promise<ActionResult<unknown>> {
  const me = await requireRole("ADMIN", "STAFF");
  const result = await markInstallmentPaid(
    { installmentId, ...(notes.trim() ? { notes: notes.trim() } : {}) },
    { userId: me.id, role: me.role },
  );
  if (result.ok) revalidatePath(PATH);
  return result;
}

export async function followUpAction(
  installmentId: string,
  note: string,
): Promise<ActionResult<unknown>> {
  const me = await requireRole("ADMIN", "STAFF");
  const result = await recordFollowUp(
    { installmentId, note },
    { userId: me.id, role: me.role },
  );
  if (result.ok) revalidatePath(PATH);
  return result;
}
