"use server";

import { revalidatePath } from "next/cache";
import { updateStaff } from "@/lib/actions/staff";
import { requireRole } from "@/lib/auth/guard";
import type { EmploymentType } from "@/lib/domain/enums";
import type { ActionResult } from "@/lib/result";

/**
 * مغلّف صفحة الموظّف الواحد.
 *
 * ⚠️ **الأدمن وحده.** المالك يقرأ ولا يكتب (‏D3/2)، والموظّف يكتب على
 * ملفّه هو — تواجدَه لا قسمَه ولا نوع توظيفه.
 *
 * ⚠️ و**الفراغ يُترجَم `null` لا نصّاً فارغاً**: «بلا قسم» فكُّ إسناد
 * حقيقي، ونصٌّ فارغ في عمود مفتاح أجنبي يُرفض من القاعدة برسالة خام.
 */
export async function updateStaffAction(input: {
  userId: string;
  employmentType: EmploymentType;
  vendorId: string;
  departmentId: string;
  jobTitle: string;
}): Promise<ActionResult<unknown>> {
  const me = await requireRole("ADMIN");

  const result = await updateStaff(
    {
      userId: input.userId,
      employmentType: input.employmentType,
      ...(input.vendorId ? { vendorId: input.vendorId } : {}),
      departmentId: input.departmentId === "" ? null : input.departmentId,
      jobTitle: input.jobTitle.trim(),
    },
    { userId: me.id, role: me.role },
  );

  if (result.ok) {
    revalidatePath(`/admin/staff/${input.userId}`);
    revalidatePath("/admin/staff");
  }
  return result;
}
