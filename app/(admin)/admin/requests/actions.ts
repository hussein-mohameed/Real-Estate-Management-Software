"use server";

import { revalidatePath } from "next/cache";
import {
  addRequestComment,
  assignServiceRequest,
  createServiceRequest,
  setRequestStatus,
} from "@/lib/actions/requests";
import { requireRole } from "@/lib/auth/guard";
import type { Priority, RequestScope, RequestStatus, RequestType } from "@/lib/domain/enums";
import type { ActionResult } from "@/lib/result";

/**
 * مغلّفات شاشة الطلبات.
 *
 * ── ⚠️ الأدوار ليست واحدة هنا ───────────────────────────────────────
 * مصفوفة §3.2: أدمن كاملة · موظّف `W (assigned)` — يُحرّك ما أُسنِد إليه
 * ويُعلّق · مالك قراءةً. فالإنشاء والإسناد `ADMIN`، والحالة والتعليق
 * `ADMIN` أو `STAFF` — والنطاق «المُسنَد» يُفرَض في الإجراء نفسه بنيوياً.
 */

const PATH = "/admin/requests";

export async function createRequestAction(input: {
  type: RequestType;
  scope: RequestScope;
  apartmentId: string;
  title: string;
  description: string;
  departmentTaskId: string;
  priority: Priority;
}): Promise<ActionResult<unknown>> {
  const me = await requireRole("ADMIN");
  const r = await createServiceRequest(
    {
      type: input.type,
      scope: input.scope,
      /* ⚠️ الفراغ يُحذف لا يُرسَل نصّاً فارغاً — عمود مفتاح أجنبي */
      ...(input.apartmentId ? { apartmentId: input.apartmentId } : {}),
      title: input.title,
      description: input.description,
      ...(input.departmentTaskId ? { departmentTaskId: input.departmentTaskId } : {}),
      priority: input.priority,
    },
    { userId: me.id, role: me.role },
  );
  if (r.ok) revalidatePath(PATH);
  return r;
}

export async function assignAction(
  requestId: string,
  staffUserId: string,
): Promise<ActionResult<unknown>> {
  const me = await requireRole("ADMIN");
  const r = await assignServiceRequest(
    { requestId, staffUserId },
    { userId: me.id, role: me.role },
  );
  if (r.ok) {
    revalidatePath(PATH);
    revalidatePath(`${PATH}/${requestId}`);
  }
  return r;
}

export async function setStatusAction(
  requestId: string,
  status: RequestStatus,
  resolutionNote: string,
): Promise<ActionResult<unknown>> {
  const me = await requireRole("ADMIN", "STAFF");
  const r = await setRequestStatus(
    {
      requestId,
      status,
      ...(resolutionNote.trim() ? { resolutionNote: resolutionNote.trim() } : {}),
    },
    { userId: me.id, role: me.role },
  );
  if (r.ok) {
    revalidatePath(PATH);
    revalidatePath(`${PATH}/${requestId}`);
  }
  return r;
}

export async function commentAction(
  requestId: string,
  body: string,
  isInternal: boolean,
): Promise<ActionResult<unknown>> {
  const me = await requireRole("ADMIN", "STAFF");
  const r = await addRequestComment(
    { requestId, body, isInternal },
    { userId: me.id, role: me.role },
  );
  if (r.ok) revalidatePath(`${PATH}/${requestId}`);
  return r;
}
