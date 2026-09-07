"use server";

import { revalidatePath } from "next/cache";
import {
  addVehicle,
  approveVehicle,
  rejectVehicle,
  removeVehicle,
} from "@/lib/actions/vehicles";
import { requireRole } from "@/lib/auth/guard";
import type { ActionResult } from "@/lib/result";

/**
 * مغلّفات شاشة المركبات.
 *
 * ⚠️ **تحلّ الجلسة بنفسها** — نفس سبب `subscriptions/actions.ts`: الإجراء
 * الأساسي يستقبل `actor` وسيطاً ليبقى قابلاً للاختبار بلا شبكة، وما
 * يستدعيه المتصفّح لا يجوز أن يقبل هوية من العميل.
 *
 * ⚠️ و**المالك ممنوع** (‏D3/2): اعتماد مركبة كتابةٌ عملياتية. تمنعه
 * المصفوفة، و`requireRole` يُغلق الباب قبل أن يُطرق.
 */

const PATH = "/admin/vehicles";

export async function approveVehicleAction(
  vehicleId: string,
): Promise<ActionResult<unknown>> {
  const me = await requireRole("ADMIN");
  const r = await approveVehicle({ vehicleId }, { userId: me.id, role: me.role });
  if (r.ok) revalidatePath(PATH);
  return r;
}

export async function rejectVehicleAction(
  vehicleId: string,
  reason: string,
): Promise<ActionResult<unknown>> {
  const me = await requireRole("ADMIN");
  const r = await rejectVehicle({ vehicleId, reason }, { userId: me.id, role: me.role });
  if (r.ok) revalidatePath(PATH);
  return r;
}

export async function removeVehicleAction(
  vehicleId: string,
  reason: string,
): Promise<ActionResult<unknown>> {
  const me = await requireRole("ADMIN");
  const r = await removeVehicle(
    { vehicleId, ...(reason.trim() ? { reason: reason.trim() } : {}) },
    { userId: me.id, role: me.role },
  );
  if (r.ok) revalidatePath(PATH);
  return r;
}

/** إضافة مركبة — معتمَدة فوراً، فالأدمن هو جهة الاعتماد. */
export async function addVehicleAction(input: {
  apartmentId: string;
  plateNumber: string;
  plateProvince: string;
  make: string;
  color: string;
}): Promise<ActionResult<unknown>> {
  const me = await requireRole("ADMIN");
  const r = await addVehicle(
    {
      apartmentId: input.apartmentId,
      plateNumber: input.plateNumber,
      ...(input.plateProvince.trim() ? { plateProvince: input.plateProvince.trim() } : {}),
      ...(input.make.trim() ? { make: input.make.trim() } : {}),
      ...(input.color.trim() ? { color: input.color.trim() } : {}),
    },
    { userId: me.id, role: me.role },
  );
  if (r.ok) revalidatePath(PATH);
  return r;
}
