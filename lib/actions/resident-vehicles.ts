"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit";
import {
  registerVehicleFor,
  type ResidentVehicleInput,
} from "@/lib/services/resident-vehicles";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  مغلّف جلسة تسجيل المركبة.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ⚠️ نفس فصل `resident-requests.ts`: الخدمة تأخذ معرّفاً وتُختبَر بلا شبكة،
 * والمغلّف يحلّ الجلسة ولا منطق فيه. وتمريرُ المعرّف من العميل كان سيجعلها
 * «سجّل مركبةً باسم أي أحد».
 *
 * ⚠️ والتدقيق يُكتب هنا — حيث تُحلّ الجلسة، فيحمل الفاعل الحقيقي.
 */

export type ResidentVehicleResult =
  | { ok: true; id: string; plateNumber: string }
  | { ok: false; message: string };

export async function registerMyVehicle(
  input: ResidentVehicleInput,
): Promise<ResidentVehicleResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: "الجلسة منتهية. سجّل الدخول ثانيةً." };

  try {
    const created = await registerVehicleFor(session.user.id, input);

    await writeAudit({
      action: "vehicle.register",
      entityType: "Vehicle",
      entityId: created.id,
      actorUserId: session.user.id,
      after: { plateNumber: created.plateNumber, status: created.status },
    });

    revalidatePath("/app/vehicles");
    return { ok: true, id: created.id, plateNumber: created.plateNumber };
  } catch (error) {
    /* ⚠️ الرسالة العربية تصل كما هي — §11.4 يمنع عرض رموز خام */
    return {
      ok: false,
      message: error instanceof Error ? error.message : "تعذّر تسجيل المركبة.",
    };
  }
}
