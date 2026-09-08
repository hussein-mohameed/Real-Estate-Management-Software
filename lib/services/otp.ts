import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { now } from "@/lib/dates";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  رمز الدخول لمرّة واحدة.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── 🔴 الرمز **مُهشَّر في القاعدة** لا نصّاً ─────────────────────────
 * المخطّط يقول ذلك صراحةً (`codeHash`). ومن يقرأ الجدول — بنسخة احتياطية
 * أو باستعلامٍ عابر — يستطيع الدخول باسم كل من طلب رمزاً في آخر خمس
 * دقائق. والتهشير يجعل القراءة بلا فائدة.
 *
 * ⚠️ و`sha256` بلا ملح كافٍ **هنا وحده**: الرمز ستّة أرقام يعيش خمس
 * دقائق، والقوّة تأتي من قِصر العمر وحدّ المحاولات لا من كلفة التهشير.
 * وكلمة مرور دائمة كانت ستوجب `argon2` — ولا كلمات مرور في هذا النظام.
 *
 * ── وثلاثة حدود، وكلٌّ يمنع هجوماً مختلفاً ──────────────────────────
 *   • **حدّ الطلب** ← يمنع استنزاف رصيد الواتساب وإزعاج صاحب الرقم
 *   • **حدّ المحاولات** ← يمنع تخمين الستّة أرقام (مليون احتمال)
 *   • **الاستهلاك مرّة** ← يمنع إعادة استعمال رمزٍ التُقط من الشاشة
 *
 * ── ⚠️ ولا يقول هذا الملفّ «الرقم غير مسجَّل» ───────────────────────
 * جوابٌ يفرّق بين رقمٍ مسجَّل وآخر ليس كذلك يجعل النموذج **أداة تعداد**:
 * يُدخل فضوليّ أرقاماً فيعرف من يسكن المجمَّع. الجواب واحد دائماً، وقرار
 * الإرسال يُتَّخذ في الداخل بلا أن يظهر أثره.
 */

/** ستّة أرقام — ما يقرؤه الناس ويكتبونه بلا خطأ. */
const CODE_LENGTH = 6;

/** خمس دقائق — والقالب `auth.otp` يقول ذلك للمستخدم. */
export const OTP_TTL_MS = 5 * 60 * 1000;

/** ثلاث محاولات لكل رمز، ثم يُبطَل. */
export const MAX_ATTEMPTS = 3;

/** لا أكثر من ثلاثة رموز في الساعة لكل رقم. */
export const MAX_REQUESTS_PER_HOUR = 3;

/** ولا رمز جديد قبل ستّين ثانية — يمنع الضغط المتكرّر على الزرّ. */
export const RESEND_COOLDOWN_MS = 60 * 1000;

/**
 * ⚠️ `randomInt` من `node:crypto` لا `Math.random`.
 * الثاني قابل للتنبّؤ من مخرجاتٍ سابقة — ورمزُ دخولٍ يُتنبّأ به ليس رمزاً.
 */
export function generateCode(): string {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
}

/** ⚠️ الهاتف داخلٌ في التهشير: رمزٌ لرقم لا يصلح لرقم آخر. */
export function hashCode(phone: string, code: string): string {
  return createHash("sha256").update(`${phone}:${code}`).digest("hex");
}

/**
 * مقارنة **ثابتة الزمن**.
 *
 * ⚠️ `===` على النصوص يخرج عند أوّل حرف مختلف، فيتسرّب طول التطابق في
 * زمن الجواب. والفارق ميكروثوانٍ — لكنه قابل للقياس عبر آلاف الطلبات،
 * وهو ما يحوّل تخمين مليون احتمال إلى تخمين ستّة خانات واحدةً واحدة.
 */
function sameHash(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export type IssueOutcome =
  | { ok: true; code: string; expiresAt: Date }
  | { ok: false; reason: "cooldown" | "hourly-limit"; retryAfterSeconds: number };

/**
 * يُنشئ رمزاً جديداً ويُبطل ما سبقه لنفس الرقم.
 *
 * ⚠️ **إبطال السابق مقصود**: رمزان صالحان في وقتٍ واحد يعني أن رمزاً
 * قديماً وصل إلى هاتفٍ فُقد يبقى يعمل بعد أن طلب صاحبه رمزاً جديداً.
 */
export async function issueOtp(
  phone: string,
  requestIp: string | null,
): Promise<IssueOutcome> {
  const at = now();

  const recent = await prisma.otpCode.findMany({
    where: { phone, createdAt: { gte: new Date(at.getTime() - 60 * 60 * 1000) } },
    select: { createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  const last = recent[0];
  if (last) {
    const sinceLast = at.getTime() - last.createdAt.getTime();
    if (sinceLast < RESEND_COOLDOWN_MS) {
      return {
        ok: false,
        reason: "cooldown",
        retryAfterSeconds: Math.ceil((RESEND_COOLDOWN_MS - sinceLast) / 1000),
      };
    }
  }

  if (recent.length >= MAX_REQUESTS_PER_HOUR) {
    /*
     * ⚠️ المهلة تُحسب من **أقدم** طلبٍ في النافذة لا من الآن: النافذة
     * منزلقة، فالحدّ يُرفع حين يخرج ذلك الطلب منها.
     */
    const oldest = recent[recent.length - 1]!;
    const freeAt = oldest.createdAt.getTime() + 60 * 60 * 1000;
    return {
      ok: false,
      reason: "hourly-limit",
      retryAfterSeconds: Math.max(1, Math.ceil((freeAt - at.getTime()) / 1000)),
    };
  }

  const code = generateCode();
  const expiresAt = new Date(at.getTime() + OTP_TTL_MS);

  await prisma.$transaction([
    /* ما لم يُستهلَك من رموز هذا الرقم يُبطَل بانتهاء فوري */
    prisma.otpCode.updateMany({
      where: { phone, consumedAt: null, expiresAt: { gt: at } },
      data: { expiresAt: at },
    }),
    prisma.otpCode.create({
      data: {
        phone,
        codeHash: hashCode(phone, code),
        expiresAt,
        requestIp,
      },
    }),
  ]);

  return { ok: true, code, expiresAt };
}

export type VerifyOutcome =
  | { ok: true }
  | { ok: false; reason: "no-code" | "expired" | "too-many" | "mismatch" };

/**
 * يتحقّق من رمزٍ ويستهلكه.
 *
 * ⚠️ **الاستهلاك جزءٌ من التحقّق** لا خطوةٌ بعده: بينهما نافذة يمكن أن
 * يُستعمل فيها الرمز مرّتين على طلبين متوازيين. والتحديث المشروط
 * (`consumedAt: null`) يجعل الفوز لواحدٍ فقط — القاعدة تحكم لا الترتيب.
 */
export async function verifyOtp(phone: string, code: string): Promise<VerifyOutcome> {
  const at = now();

  const record = await prisma.otpCode.findFirst({
    where: { phone, consumedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, codeHash: true, expiresAt: true, attempts: true },
  });

  if (!record) return { ok: false, reason: "no-code" };
  if (record.expiresAt.getTime() <= at.getTime()) return { ok: false, reason: "expired" };
  if (record.attempts >= MAX_ATTEMPTS) return { ok: false, reason: "too-many" };

  if (!sameHash(record.codeHash, hashCode(phone, code))) {
    /*
     * ⚠️ العدّاد يزيد **قبل** أن يُعاد الجواب، وفي القاعدة لا في الذاكرة:
     * عدٌّ في الذاكرة يُصفَّر بإعادة تشغيل الخادم، ويُلتفّ عليه بطلبات
     * متوازية تصل إلى نسخٍ مختلفة.
     */
    await prisma.otpCode.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } },
    });
    return { ok: false, reason: "mismatch" };
  }

  const consumed = await prisma.otpCode.updateMany({
    where: { id: record.id, consumedAt: null },
    data: { consumedAt: at },
  });

  /* صفرٌ يعني أن طلباً متوازياً استهلكه قبلنا — والرمز لمرّة واحدة */
  if (consumed.count === 0) return { ok: false, reason: "no-code" };

  return { ok: true };
}
