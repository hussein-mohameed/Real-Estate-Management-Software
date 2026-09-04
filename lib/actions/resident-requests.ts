"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit";
import {
  addCommentFor,
  createRequestFor,
  type ResidentRequestInput,
} from "@/lib/services/resident-requests";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  مغلّفات جلسة طلبات الساكن.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ⚠️ لا `defineAction` هنا ────────────────────────────────────────
 * القدرة `SERVICE_REQUESTS` تمنح الساكن `OWN`، و`LEVEL_ACTIONS.OWN` يمنح
 * **القراءة وحدها**. فتمريرُ قدرةٍ تمنع الفعل ثم الالتفاف عليها أسوأ من
 * عدم استعمالها: يُوهم القارئ أن الترخيص فُحص.
 *
 * والنطاق بنيويّ: `userId` من الجلسة، والمنطق في
 * `lib/services/resident-requests.ts` حيث يُختبَر بلا شبكة. وهو نفس النمط
 * الذي حكم `staff-self` و`requestSubscription` — ثالث موضع، أي قاعدة.
 *
 * ── والتدقيق يُكتب هنا ──────────────────────────────────────────────
 * ⚠️ حيث تُحلّ الجلسة، فيحمل الفاعل الحقيقي. وكتابتُه في الخدمة كانت
 * ستجعله يعتمد على مُعرِّفٍ يُمرَّر — وهو ما يُفترَض ألّا يُوثَق به.
 */

export type ResidentRequestResult =
  | { ok: true; id: string; number: string }
  | { ok: false; message: string };

export async function createMyRequest(
  input: ResidentRequestInput,
): Promise<ResidentRequestResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: "الجلسة منتهية. سجّل الدخول ثانيةً." };

  try {
    const created = await createRequestFor(session.user.id, input);

    await writeAudit({
      action: "request.create",
      entityType: "ServiceRequest",
      entityId: created.id,
      actorUserId: session.user.id,
      after: { scope: input.scope, type: input.type, number: created.number },
    });

    revalidatePath("/app/requests");
    return { ok: true, id: created.id, number: created.number };
  } catch (error) {
    /* ⚠️ الرسالة العربية تصل كما هي — §11.4 يمنع عرض رموز خام */
    return {
      ok: false,
      message: error instanceof Error ? error.message : "تعذّر إنشاء الطلب.",
    };
  }
}

export async function commentOnMyRequest(
  requestId: string,
  body: string,
): Promise<{ ok: boolean; message?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, message: "الجلسة منتهية. سجّل الدخول ثانيةً." };

  try {
    const comment = await addCommentFor(session.user.id, requestId, body);

    await writeAudit({
      action: "request.comment",
      entityType: "RequestComment",
      entityId: comment.id,
      actorUserId: session.user.id,
    });

    revalidatePath(`/app/requests/${requestId}`);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "تعذّر إضافة التعليق.",
    };
  }
}
