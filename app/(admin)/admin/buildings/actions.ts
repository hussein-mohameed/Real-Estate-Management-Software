"use server";

import { revalidatePath } from "next/cache";
import { createBuilding, regenerateApartments } from "@/lib/actions/buildings";
import { requireRole } from "@/lib/auth/guard";
import type { ActionResult } from "@/lib/result";

/** الهوية تُقرأ من الكوكي — لا تعبر الحدّ من العميل أبداً. */
export async function createBuildingAction(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  const me = await requireRole("ADMIN", "OWNER");
  const num = (k: string): number => Number(formData.get(k) ?? 0);

  const result = await createBuilding(
    {
      code: String(formData.get("code") ?? ""),
      name: String(formData.get("name") ?? "") || undefined,
      floorsCount: num("floorsCount"),
      unitsPerFloor: num("unitsPerFloor"),
      numberingScheme: String(formData.get("numberingScheme") ?? "SEQUENTIAL"),
      displayNumberFormat: String(formData.get("displayNumberFormat") ?? ""),
      plannedApartmentsCount: formData.get("plannedApartmentsCount")
        ? num("plannedApartmentsCount")
        : undefined,
      generateApartments: true,
      floorOverrides: [],
    },
    { userId: me.id, role: me.role },
  );

  if (result.ok) revalidatePath("/admin/buildings");
  return result;
}

export async function regenerateAction(
  buildingId: string,
  fromFloor: number,
  toFloor: number,
): Promise<ActionResult<unknown>> {
  const me = await requireRole("ADMIN", "OWNER");
  const result = await regenerateApartments(
    { buildingId, fromFloor, toFloor },
    { userId: me.id, role: me.role },
  );
  if (result.ok) revalidatePath("/admin/buildings");
  return result;
}
