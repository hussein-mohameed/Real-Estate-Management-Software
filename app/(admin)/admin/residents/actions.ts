"use server";

import { revalidatePath } from "next/cache";
import {
  createResident,
  linkResidentToApartment,
  unlinkResident,
  updateResident,
} from "@/lib/actions/residents";
import { requireRole } from "@/lib/auth/guard";
import type { ActionResult } from "@/lib/result";

/**
 * مغلّفات شاشة السكان.
 *
 * ⚠️ **تحلّ الجلسة بنفسها** — الهوية تُقرأ من الكوكي ولا تعبر من العميل.
 */

function s(fd: FormData, key: string): string | undefined {
  const v = fd.get(key);
  const out = typeof v === "string" ? v.trim() : "";
  return out === "" ? undefined : out;
}

export async function createResidentAction(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  const me = await requireRole("ADMIN");
  const result = await createResident(
    {
      fullName: s(formData, "fullName"),
      phone: s(formData, "phone"),
      email: s(formData, "email"),
      gender: s(formData, "gender"),
      emergencyPhone: s(formData, "emergencyPhone"),
      notes: s(formData, "notes"),
    },
    { userId: me.id, role: me.role },
  );
  if (result.ok) revalidatePath("/admin/residents");
  return result;
}

export async function updateResidentAction(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  const me = await requireRole("ADMIN");
  const result = await updateResident(
    {
      userId: s(formData, "userId"),
      fullName: s(formData, "fullName"),
      phone: s(formData, "phone"),
      email: s(formData, "email"),
      emergencyPhone: s(formData, "emergencyPhone"),
      notes: s(formData, "notes"),
    },
    { userId: me.id, role: me.role },
  );
  if (result.ok) revalidatePath("/admin/residents");
  return result;
}

export async function linkResidentAction(input: {
  apartmentId: string;
  userId: string;
  relationType: string;
  isContractHolder: boolean;
}): Promise<ActionResult<unknown>> {
  const me = await requireRole("ADMIN");
  const result = await linkResidentToApartment(input, { userId: me.id, role: me.role });
  if (result.ok) {
    revalidatePath("/admin/residents");
    revalidatePath("/admin/apartments");
  }
  return result;
}

export async function unlinkResidentAction(
  apartmentResidentId: string,
): Promise<ActionResult<{ promptSetVacant: boolean }>> {
  const me = await requireRole("ADMIN");
  const result = await unlinkResident({ apartmentResidentId }, { userId: me.id, role: me.role });
  if (result.ok) {
    revalidatePath("/admin/residents");
    revalidatePath("/admin/apartments");
  }
  return result as ActionResult<{ promptSetVacant: boolean }>;
}
