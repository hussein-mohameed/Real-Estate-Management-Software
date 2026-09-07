"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit";
import {
  requestProfileChangeFor,
  type ProfileChangeInput,
} from "@/lib/services/resident-profile-requests";

/**
 * مغلّف جلسة طلب تعديل البيانات.
 *
 * ⚠️ نفس فصل `resident-requests.ts`: الخدمة تأخذ معرّفاً وتُختبَر بلا شبكة،
 * والمغلّف يحلّ الجلسة. وتمريرُ المعرّف من العميل كان سيجعلها «اطلب تغيير
 * بيانات أي أحد» — وأخطر ما فيها الهاتف، فهو هويّة الدخول.
 */

export type ProfileRequestResult =
  | { ok: true; id: string }
  | { ok: false; message: string };

export async function requestMyProfileChange(
  input: ProfileChangeInput,
): Promise<ProfileRequestResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: "الجلسة منتهية. سجّل الدخول ثانيةً." };

  try {
    const created = await requestProfileChangeFor(session.user.id, input);

    await writeAudit({
      action: "resident_request.create",
      entityType: "ResidentRequest",
      entityId: created.id,
      actorUserId: session.user.id,
      /*
       * ⚠️ **لا تُكتب القيم في التدقيق.** الهاتف بيانٌ شخصيّ (‏§12.1)،
       * والحمولة محفوظة في الصفّ نفسه لمن يملك قراءته. وتكرارُها في سجلٍّ
       * يُصدَّر ويُقرأ على نطاق أوسع توسيعٌ لدائرة من يراها بلا سبب.
       */
      after: { kind: "PROFILE_CHANGE" },
    });

    revalidatePath("/app/profile");
    return { ok: true, id: created.id };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "تعذّر إرسال الطلب.",
    };
  }
}
