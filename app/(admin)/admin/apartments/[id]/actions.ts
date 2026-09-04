"use server";

import { revalidatePath } from "next/cache";
import {
  setApartmentConstructionStatus,
  setApartmentOccupancy,
} from "@/lib/actions/apartments";
import { requireRole } from "@/lib/auth/guard";
import type { ActionResult } from "@/lib/result";

/**
 * مغلّفات صفحة الشقة.
 *
 * ⚠️ **تحلّ الجلسة بنفسها** — الهوية من الكوكي لا من العميل.
 *
 * ⚠️ المالك ليس هنا: `APARTMENT_OCCUPANCY` من الأفعال العملياتية الممنوعة
 * عليه صراحةً (‏D3/2). يرى الحالة ولا يغيّرها.
 */

export async function setOccupancyAction(
  apartmentId: string,
  occupancyStatus: string,
): Promise<ActionResult<unknown>> {
  const me = await requireRole("ADMIN");
  const result = await setApartmentOccupancy(
    { apartmentId, occupancyStatus },
    { userId: me.id, role: me.role },
  );
  if (result.ok) {
    revalidatePath(`/admin/apartments/${apartmentId}`);
    revalidatePath("/admin/apartments");
    revalidatePath("/admin"); // «مسكونة بلا عقد نشط» في لوحة المهام
  }
  return result;
}

export async function setConstructionAction(
  apartmentId: string,
  constructionStatus: string,
): Promise<ActionResult<unknown>> {
  const me = await requireRole("ADMIN");
  const result = await setApartmentConstructionStatus(
    { apartmentId, status: constructionStatus },
    { userId: me.id, role: me.role },
  );
  if (result.ok) {
    revalidatePath(`/admin/apartments/${apartmentId}`);
    revalidatePath("/admin/apartments");
    revalidatePath("/admin");
  }
  return result;
}
