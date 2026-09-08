import { requireEnv } from "@/lib/env";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  إرسال واتساب — UltraMsg.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── 🔴 التوكن **لا يُكتب في الكود ولا يُمرَّر في سطر أمر** ──────────
 * `requireEnv("ULTRAMSG_TOKEN")` يقرؤه من `.env.local` وحدها. وسطور
 * الأوامر تُسجَّل في تاريخ الطرفية وفي سجلّات CI، وثابتٌ في الكود يُرفَع
 * إلى المستودع — وكلاهما يجعل من يملك القراءة يملك إرسال رسائل باسم
 * المجمَّع.
 *
 * ── ⚠️ وهذا الملفّ **خادم فقط** ─────────────────────────────────────
 * لا يُستورَد من أي مكوّن عميل. والتوكن ليس في `NEXT_PUBLIC_*` عمداً:
 * ما يبدأ بها يُحقَن في حزمة المتصفّح ويقرؤه أي زائر.
 *
 * ── والجسم `x-www-form-urlencoded` لا JSON ──────────────────────────
 * ⚠️ UltraMsg يقبل الأول وحده على `/messages/chat`. وإرسال JSON يُرجع
 * `200` مع جسمٍ فيه خطأ — لا `4xx`. فالنجاح يُقرأ من **الجسم** لا من
 * رمز الحالة، وهذا ما يفعله `parseResult` أدناه.
 *
 * ── ولا يرمي — يُرجع نتيجة ────────────────────────────────────────
 * فشل الإرسال حدثٌ متوقَّع (شبكة · رصيد · رقم غير مسجَّل على واتساب)،
 * لا خللٌ برمجي. ورميُه كان سيُسقط تسجيل الدخول كلّه بدل أن يقول
 * «تعذّر إرسال الرمز، جرّب ثانيةً».
 */

const ENDPOINT = "https://api.ultramsg.com";

/** مهلة قصيرة: المستخدم واقفٌ ينتظر الرمز، ولا يحتمل ثلاثين ثانية. */
const TIMEOUT_MS = 12_000;

export type WhatsAppResult =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; error: string };

/**
 * جواب UltraMsg — `sent` نصّاً أو منطقياً بحسب الحالة، و`error` نصّاً أو
 * كائناً. ولا مخطّط معلَن من المزوّد، فيُقرأ دفاعياً.
 */
function parseResult(raw: unknown): WhatsAppResult {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "جواب غير مفهوم من مزوّد الواتساب." };
  }

  const body = raw as Record<string, unknown>;

  /*
   * ⚠️ `sent` يعود `"true"` نصّاً في بعض الحالات و`true` منطقياً في
   * أخرى. ومقارنةٌ بأحدهما وحده تجعل نصف الإرسالات الناجحة تُقرأ فشلاً.
   */
  const sent = body["sent"];
  const isSent = sent === true || sent === "true";

  if (isSent) {
    const id = body["id"];
    return {
      ok: true,
      providerMessageId: typeof id === "string" || typeof id === "number" ? String(id) : null,
    };
  }

  const err = body["error"];
  if (typeof err === "string") return { ok: false, error: err };
  if (err !== undefined) return { ok: false, error: JSON.stringify(err) };
  return { ok: false, error: "لم يؤكّد المزوّد الإرسال." };
}

/**
 * يرسل رسالة نصّية إلى رقم بصيغة E.164.
 *
 * ⚠️ **`to` يجب أن يكون مطبَّعاً قبل الوصول هنا** (`normalizePhone`).
 * التطبيع في مكانٍ واحد — وإرسالُ رقمٍ غير مطبَّع يفشل عند المزوّد
 * برسالةٍ لا تشرح، أو أسوأ: يصل إلى رقمٍ آخر.
 */
export async function sendWhatsApp(
  to: string,
  body: string,
): Promise<WhatsAppResult> {
  let instance: string;
  let token: string;
  try {
    instance = requireEnv("ULTRAMSG_INSTANCE_ID");
    token = requireEnv("ULTRAMSG_TOKEN");
  } catch (error) {
    /* ⚠️ الرسالة تقول ما ينقص ولا تحمل القيمة — راجع `requireEnv` */
    return {
      ok: false,
      error: error instanceof Error ? error.message : "إعداد الواتساب ناقص.",
    };
  }

  /*
   * ⚠️ **مهلة صريحة.** `fetch` بلا مهلة ينتظر إلى ما لا نهاية إن تعلّق
   * المزوّد، فيبقى طلب تسجيل الدخول معلّقاً والمستخدم أمام زرٍّ يدور.
   */
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${ENDPOINT}/${instance}/messages/chat`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token, to, body }).toString(),
      signal: controller.signal,
      /* لا تخزين: كل إرسال حدثٌ مستقلّ */
      cache: "no-store",
    });

    /*
     * ⚠️ الحالة تُفحَص **ثم** الجسم: المزوّد يُرجع `200` مع خطأ في الجسم،
     * لكن `5xx` تأتي بجسمٍ غير JSON أحياناً — وقراءتُه تسقط.
     */
    if (!response.ok) {
      return { ok: false, error: `المزوّد ردّ ${response.status}.` };
    }

    return parseResult(await response.json());
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, error: "انتهت مهلة الاتصال بمزوّد الواتساب." };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "تعذّر الاتصال بمزوّد الواتساب.",
    };
  } finally {
    clearTimeout(timer);
  }
}
