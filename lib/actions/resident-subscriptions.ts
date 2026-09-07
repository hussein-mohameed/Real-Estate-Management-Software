"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import {
  requestSubscription,
  requestSubscriptionCancellation,
  withdrawSubscriptionCancellation,
} from "@/lib/actions/subscriptions";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  مغلّف جلسة طلب الاشتراك.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ⚠️ لماذا مغلّف أصلاً ───────────────────────────────────────────
 * `requestSubscription` يأخذ `requesterUserId` **وسيطاً**، لأنه يعيش في
 * وحدةٍ تُستدعى من الاختبارات ومن البذر بلا جلسة. وتمريرُه من العميل كان
 * سيجعله «اطلب باسم أي أحد» — فالمعرّف يُحلّ هنا، من الكوكي، حيث لا يملك
 * المتصل التأثير عليه.
 *
 * وهو نفس فصلِ `resident-requests.ts`: الخدمة تأخذ معرّفاً وتُختبَر بلا
 * شبكة، والمغلّف يحلّ الجلسة ولا منطق فيه.
 *
 * ── ولا تدقيق هنا ──────────────────────────────────────────────────
 * ⚠️ بخلاف `createMyRequest`: `requestSubscription` يكتب `subscription.
 * request` بنفسه. وكتابتُه ثانيةً هنا تُنتج سطرين لفعلٍ واحد — وسجلُّ
 * تدقيقٍ يعدّ الفعل مرّتين أسوأ من سجلٍّ ناقص، لأنه يبدو دقيقاً.
 */

export type RequestSubscriptionResult =
  | { ok: true; id: string }
  | { ok: false; message: string };

export async function requestMySubscription(input: {
  serviceId: string;
  apartmentId: string;
  quantity?: number | undefined;
  notes?: string | undefined;
}): Promise<RequestSubscriptionResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: "الجلسة منتهية. سجّل الدخول ثانيةً." };

  try {
    /*
     * ⚠️ `subjectType: "APARTMENT"` ثابتٌ هنا لا مُدخَل.
     * الاشتراك على **ساكن** يخصّ خدمات الأفراد، ويلزمه `residentUserId` —
     * وقبولُه من العميل يفتح «اطلب على جارك». ومن أراد خدمةً شخصية يطلبها
     * من الإدارة حتى تُبنى شاشتها.
     */
    const created = await requestSubscription(
      {
        serviceId: input.serviceId,
        subjectType: "APARTMENT",
        apartmentId: input.apartmentId,
        ...(input.quantity === undefined ? {} : { quantity: input.quantity }),
        ...(input.notes ? { notes: input.notes } : {}),
      },
      session.user.id,
    );

    revalidatePath("/app/subscriptions");
    return { ok: true, id: created.id };
  } catch (error) {
    /* ⚠️ الرسالة العربية تصل كما هي — §11.4 يمنع عرض رموز خام */
    return {
      ok: false,
      message: error instanceof Error ? error.message : "تعذّر إرسال الطلب.",
    };
  }
}

/**
 * طلب إلغاء اشتراك — §3.2 «unsubscribe».
 *
 * ⚠️ لا تدقيق هنا: `requestSubscriptionCancellation` يكتب
 * `subscription.cancellation_request` بنفسه — راجع التعليق أعلى الملفّ.
 */
export async function requestMyCancellation(input: {
  subscriptionId: string;
  reason?: string | undefined;
}): Promise<RequestSubscriptionResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: "الجلسة منتهية. سجّل الدخول ثانيةً." };

  try {
    const done = await requestSubscriptionCancellation(
      {
        subscriptionId: input.subscriptionId,
        ...(input.reason ? { reason: input.reason } : {}),
      },
      session.user.id,
    );

    revalidatePath("/app/subscriptions");
    return { ok: true, id: done.id };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "تعذّر إرسال طلب الإلغاء.",
    };
  }
}

/**
 * سحب طلب الإلغاء.
 *
 * ⚠️ لا تدقيق هنا: `withdrawSubscriptionCancellation` يكتب
 * `subscription.cancellation_withdraw` بنفسه — راجع التعليق أعلى الملفّ.
 */
export async function withdrawMyCancellation(
  subscriptionId: string,
): Promise<RequestSubscriptionResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: "الجلسة منتهية. سجّل الدخول ثانيةً." };

  try {
    const done = await withdrawSubscriptionCancellation({ subscriptionId }, session.user.id);
    revalidatePath("/app/subscriptions");
    return { ok: true, id: done.id };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "تعذّر سحب الطلب.",
    };
  }
}
