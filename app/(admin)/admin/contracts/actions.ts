"use server";

import { revalidatePath } from "next/cache";
import {
  activateContract,
  createContract,
  endContract,
} from "@/lib/actions/contracts";
import { requireRole } from "@/lib/auth/guard";
import type { ActionResult } from "@/lib/result";

/**
 * مغلّفات شاشة العقود.
 *
 * ⚠️ **تحلّ الجلسة بنفسها.** الإجراء الأساسي يستقبل `actor` كوسيط ليبقى
 * قابلاً للاختبار بلا شبكة، لكن ما يستدعيه المتصفّح **لا يجوز أن يقبل
 * هوية من العميل** — وإلا انتحل أي أحد دور المالك بتمرير الوسيط.
 *
 * ⚠️ المالك **ليس** في قائمة الأدوار هنا: `CONTRACTS` من الأفعال
 * العملياتية الممنوعة عليه صراحةً (‏D3/2 · `OWNER_FORBIDDEN_OPERATIONS`).
 * يرى الشاشة ولا يكتب فيها.
 */

function s(fd: FormData, key: string): string | undefined {
  const v = fd.get(key);
  const out = typeof v === "string" ? v.trim() : "";
  return out === "" ? undefined : out;
}

export async function createContractAction(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  const me = await requireRole("ADMIN");

  const result = await createContract(
    {
      apartmentId: s(formData, "apartmentId"),
      holderUserId: s(formData, "holderUserId"),
      type: s(formData, "type"),
      startDate: s(formData, "startDate"),
      endDate: s(formData, "endDate"),
      totalAmountIqd: s(formData, "totalAmountIqd"),
      paymentType: s(formData, "paymentType"),
      rentAmountIqd: s(formData, "rentAmountIqd"),
      rentCycle: s(formData, "rentCycle"),
      notes: s(formData, "notes"),
    },
    { userId: me.id, role: me.role },
  );

  if (result.ok) revalidatePath("/admin/contracts");
  return result;
}

export async function activateContractAction(
  contractId: string,
): Promise<ActionResult<unknown>> {
  const me = await requireRole("ADMIN");
  const result = await activateContract({ contractId }, { userId: me.id, role: me.role });
  if (result.ok) {
    revalidatePath("/admin/contracts");
    revalidatePath("/admin/apartments");
  }
  return result;
}

export async function endContractAction(
  contractId: string,
  outcome: "EXPIRED" | "TERMINATED",
  reason: string,
  confirmNonZeroBalance: boolean,
): Promise<ActionResult<unknown>> {
  const me = await requireRole("ADMIN");
  const result = await endContract(
    { contractId, outcome, reason: reason || undefined, confirmNonZeroBalance },
    { userId: me.id, role: me.role },
  );
  if (result.ok) {
    revalidatePath("/admin/contracts");
    revalidatePath("/admin/apartments");
  }
  return result;
}
