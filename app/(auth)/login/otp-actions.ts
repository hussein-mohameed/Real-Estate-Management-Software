"use server";

import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { requireEnv } from "@/lib/env";
import { normalizePhone } from "@/lib/domain/phone";
import { issueOtp, verifyOtp } from "@/lib/services/otp";
import { sendWhatsApp } from "@/lib/notifications/whatsapp";
import { render } from "@/lib/notifications/templates";
import { issueSession, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth/jwt";
import { now } from "@/lib/dates";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  دخول الساكن برمز على واتساب.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── 🔴 الجواب **واحد دائماً** على طلب الرمز ─────────────────────────
 * سواء كان الرقم مسجَّلاً أو لا، وسواء نجح الإرسال أو فشل عند المزوّد،
 * الجواب: «إن كان الرقم مسجَّلاً فقد أُرسل الرمز».
 *
 * وجوابٌ يفرّق يجعل النموذج **أداة تعداد**: يُدخل فضوليّ أرقاماً بالتسلسل
 * فيعرف من يسكن المجمَّع — ثم يعرف أن الرقم الفلاني ساكنٌ فيه. وذلك
 * تسريبُ بياناتٍ شخصية لا خطأ واجهة.
 *
 * ⚠️ **ويُستثنى من ذلك حدّ المعدّل وحده**: «انتظر ٤٠ ثانية» يجب أن تُقال،
 * وإلا ضغط المستخدم مرّةً بعد مرّة ولا يصله شيء ولا يفهم لماذا. وهو لا
 * يكشف تسجيل الرقم — الحدّ يُطبَّق على كل رقم يُطلَب له رمز.
 *
 * ── والرمز لا يعبر إلى العميل أبداً ────────────────────────────────
 * `issueOtp` يُرجعه ليُرسَل على واتساب، ويُستهلَك في هذه الدالّة. ولا يظهر
 * في جواب الإجراء ولا في تدقيق ولا في سجلّ.
 */

export type OtpRequestResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

/** جوابٌ واحد لكل الحالات — راجع أعلاه. */
const NEUTRAL = "إن كان الرقم مسجَّلاً فقد وصلك رمز على واتساب.";

async function clientIp(): Promise<string | null> {
  const h = await headers();
  /* ⚠️ أوّل عنوان في السلسلة هو العميل؛ ما بعده وسطاء */
  const forwarded = h.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
}

export async function requestOtpAction(rawPhone: string): Promise<OtpRequestResult> {
  const normalized = normalizePhone(rawPhone);
  if (!normalized.ok) {
    /* صيغة الرقم تُقال: خطأٌ في الإدخال لا كشفٌ عن تسجيل */
    return { ok: false, message: normalized.messageAr };
  }
  const phone = normalized.phone;

  const issued = await issueOtp(phone, await clientIp());
  if (!issued.ok) {
    return {
      ok: false,
      message:
        issued.reason === "cooldown"
          ? `انتظر ${issued.retryAfterSeconds} ثانية قبل طلب رمز جديد.`
          : `تجاوزتَ حدّ الطلبات. جرّب بعد ${Math.ceil(issued.retryAfterSeconds / 60)} دقيقة.`,
    };
  }

  /*
   * ⚠️ **يُبحَث عن المستخدم بعد إصدار الرمز لا قبله.**
   * لو خرجنا مبكراً للرقم غير المسجَّل لصار زمن الجواب مختلفاً بين
   * الحالتين — وهو نفس التعداد الذي يمنعه الجواب المحايد، من باب آخر.
   */
  const user = await prisma.user.findFirst({
    where: { phone, isActive: true },
    select: { id: true },
  });

  if (user) {
    const body = render("auth.otp", { code: issued.code });
    const sent = await sendWhatsApp(phone, body);

    /*
     * ⚠️ **يُسجَّل الإرسال ولا يُسجَّل الرمز.** `body` يحمل الرمز، فلا
     * يُكتب في `Notification.body` — وإلا صار الجدول نسخةً واضحة من كل
     * رمزٍ أُرسل، وهو ما وُجد التهشير لمنعه.
     */
    await prisma.notification.create({
      data: {
        userId: user.id,
        channel: "WHATSAPP",
        templateKey: "auth.otp",
        payload: {},
        body: "رمز دخول (المحتوى غير مسجَّل عمداً)",
        status: sent.ok ? "SENT" : "FAILED",
        ...(sent.ok
          ? { sentAt: now(), providerMessageId: sent.providerMessageId }
          : { error: sent.error }),
      },
    });
  }

  return { ok: true, message: NEUTRAL };
}

export type OtpVerifyResult =
  | { ok: true }
  | { ok: false; message: string };

export async function verifyOtpAction(
  rawPhone: string,
  code: string,
): Promise<OtpVerifyResult> {
  const normalized = normalizePhone(rawPhone);
  if (!normalized.ok) return { ok: false, message: normalized.messageAr };
  const phone = normalized.phone;

  const result = await verifyOtp(phone, code.trim());
  if (!result.ok) {
    const MESSAGES: Record<typeof result.reason, string> = {
      "no-code": "لا رمز فعّال لهذا الرقم. اطلب رمزاً جديداً.",
      expired: "انتهت صلاحية الرمز. اطلب رمزاً جديداً.",
      "too-many": "تجاوزتَ عدد المحاولات. اطلب رمزاً جديداً.",
      mismatch: "الرمز غير صحيح.",
    };
    return { ok: false, message: MESSAGES[result.reason] };
  }

  /*
   * ⚠️ **الرمز يُستهلَك قبل هذا السطر.** فلو لم يوجد مستخدم للرقم — وهو
   * ممكن: عُطِّل الحساب بين الطلب والتحقّق — فالرمز محروق ولا يُعاد
   * استعماله. وذلك صحيح: رمزٌ صحيح استُهلك مرّة واحدة مهما كانت النتيجة.
   */
  const user = await prisma.user.findFirst({
    where: { phone, isActive: true },
    select: { id: true },
  });
  if (!user) {
    return { ok: false, message: "لا حساب فعّال بهذا الرقم. راجع إدارة المجمَّع." };
  }

  const token = issueSession(user.id, requireEnv("AUTH_SECRET"));

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    /*
     * ⚠️ `secure` في الإنتاج وحده: على `http://localhost` يرفض المتصفّح
     * الكوكي الآمن، فيبدو الدخول ناجحاً ثم يعود إلى صفحة الدخول.
     */
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: now() },
  });

  return { ok: true };
}
