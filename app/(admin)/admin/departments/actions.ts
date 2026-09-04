"use server";

import { revalidatePath } from "next/cache";
import {
  setDepartmentActive,
  setDepartmentTaskActive,
  updateDepartmentTask,
} from "@/lib/actions/departments";
import { createDepartment, createDepartmentTask } from "@/lib/actions/staff";
import { requireRole } from "@/lib/auth/guard";
import type { ActionResult } from "@/lib/result";

/**
 * مغلّفات شاشة الأقسام.
 *
 * ⚠️ **الأدمن وحده يكتب.** المالك يقرأ (‏D3/2)، والموظّف لا شأن له
 * بتعريف الأقسام — هو يُنفّذ ما تُعرّفه الإدارة.
 */

const PATH = "/admin/departments";

export async function createDepartmentAction(
  name: string,
  description: string,
): Promise<ActionResult<unknown>> {
  const me = await requireRole("ADMIN");
  const r = await createDepartment(
    { name, ...(description.trim() ? { description: description.trim() } : {}) },
    { userId: me.id, role: me.role },
  );
  if (r.ok) revalidatePath(PATH);
  return r;
}

export async function createTaskAction(
  departmentId: string,
  name: string,
  description: string,
): Promise<ActionResult<unknown>> {
  const me = await requireRole("ADMIN");
  const r = await createDepartmentTask(
    {
      departmentId,
      name,
      ...(description.trim() ? { description: description.trim() } : {}),
    },
    { userId: me.id, role: me.role },
  );
  if (r.ok) revalidatePath(PATH);
  return r;
}

export async function updateTaskAction(
  taskId: string,
  name: string,
  description: string,
): Promise<ActionResult<unknown>> {
  const me = await requireRole("ADMIN");
  const r = await updateDepartmentTask(
    { taskId, name, ...(description.trim() ? { description: description.trim() } : {}) },
    { userId: me.id, role: me.role },
  );
  if (r.ok) revalidatePath(PATH);
  return r;
}

export async function setTaskActiveAction(
  taskId: string,
  isActive: boolean,
): Promise<ActionResult<unknown>> {
  const me = await requireRole("ADMIN");
  const r = await setDepartmentTaskActive(
    { taskId, isActive },
    { userId: me.id, role: me.role },
  );
  if (r.ok) revalidatePath(PATH);
  return r;
}

export async function setDepartmentActiveAction(
  departmentId: string,
  isActive: boolean,
): Promise<ActionResult<unknown>> {
  const me = await requireRole("ADMIN");
  const r = await setDepartmentActive(
    { departmentId, isActive },
    { userId: me.id, role: me.role },
  );
  if (r.ok) revalidatePath(PATH);
  return r;
}
