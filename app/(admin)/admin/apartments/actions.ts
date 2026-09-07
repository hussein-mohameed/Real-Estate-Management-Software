"use server";

import { revalidatePath } from "next/cache";
import {
  bulkSetApartmentConstructionStatus,
  createApartment,
} from "@/lib/actions/apartments";
import { requireRole } from "@/lib/auth/guard";
import { CONSTRUCTION_STATUS, type ConstructionStatus } from "@/lib/domain/enums";
import type { ActionResult } from "@/lib/result";

/**
 * مغلّفات شاشة الشقق.
 *
 * ⚠️ **تحلّ الجلسة بنفسها** — الإجراء الأساسي يستقبل `actor` وسيطاً ليبقى
 * قابلاً للاختبار بلا شبكة، وما يستدعيه المتصفّح لا يجوز أن يقبل هوية من
 * العميل. و`requireRole("ADMIN")` يمنع المالك (‏D3/2) قبل أن تُطرق المصفوفة.
 */

const PATH = "/admin/apartments";

/**
 * ⚠️ **الحقول الرقمية تصل نصوصاً من العميل.** تمريرُها كما هي إلى zod
 * يُنتج «متوقَّع رقم، وصل نصّ» — رسالةٌ صحيحة تقنياً ولا تقول للأدمن ما
 * يُصلحه. تُحوَّل هنا، وغيرُ الصالح يصير `undefined` فيقع على رسالة الحقل.
 */
function toInt(value: string): number | undefined {
  const trimmed = value.trim();
  if (!/^[0-9]+$/u.test(trimmed)) return undefined;
  return Number(trimmed);
}

function toStatus(value: string): ConstructionStatus {
  return (
    CONSTRUCTION_STATUS.find((s) => s === value) ?? "UNDER_CONSTRUCTION"
  );
}

export async function addApartmentAction(input: {
  buildingId: string;
  floorNumber: number;
  unitNumber: number;
  displayNumber: string;
  roomsCount: string;
  constructionStatus: string;
}): Promise<ActionResult<unknown>> {
  const me = await requireRole("ADMIN");
  const rooms = toInt(input.roomsCount);

  const r = await createApartment(
    {
      buildingId: input.buildingId,
      floorNumber: input.floorNumber,
      unitNumber: input.unitNumber,
      ...(input.displayNumber.trim() ? { displayNumber: input.displayNumber.trim() } : {}),
      ...(rooms === undefined ? {} : { roomsCount: rooms }),
      constructionStatus: toStatus(input.constructionStatus),
    },
    { userId: me.id, role: me.role },
  );
  if (r.ok) revalidatePath(PATH);
  return r;
}

export async function bulkConstructionAction(input: {
  buildingId: string;
  fromFloor: number;
  toFloor: number;
  status: string;
}): Promise<ActionResult<unknown>> {
  const me = await requireRole("ADMIN");
  const r = await bulkSetApartmentConstructionStatus(
    {
      buildingId: input.buildingId,
      fromFloor: input.fromFloor,
      toFloor: input.toFloor,
      status: toStatus(input.status),
    },
    { userId: me.id, role: me.role },
  );
  if (r.ok) revalidatePath(PATH);
  return r;
}
