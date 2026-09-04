/**
 * تطبيع أرقام الهواتف العراقية إلى E.164 (‏R3).
 *
 * ── لماذا التطبيع **قبل** أي بحث أو إدخال ────────────────────────────
 * `User.phone` فريد، وهو **مفتاح دخول السكان** عبر OTP. ولو خُزّن رقم واحد
 * بصيغتين — `07701234567` و`+9647701234567` — لحدث أمران معاً:
 *   • قيد التفريد لا يمنع التكرار، فيصير للشخص حسابان.
 *   • ومن سجّل بصيغة لا يدخل بالأخرى، فيبدو النظام معطوباً بلا سبب ظاهر.
 *
 * لذلك: صيغة واحدة مخزَّنة، والتطبيع يقع عند **كل** مدخل — الإنشاء
 * والتعديل والبحث وطلب رمز الدخول.
 */

/** الصيغة المخزَّنة: `+964` ثم عشرة أرقام تبدأ بـ7. */
const E164_IRAQ = /^\+9647\d{9}$/u;

/** بادئات المشغّلين العراقيين الصالحة (‏070 · 075 · 077 · 078 · 079). */
const VALID_PREFIXES = ["70", "75", "77", "78", "79"] as const;

export type PhoneError =
  | "empty"
  | "not-iraqi"
  | "bad-length"
  | "bad-prefix";

export type PhoneResult =
  | { ok: true; phone: string }
  | { ok: false; reason: PhoneError; messageAr: string };

const MESSAGES: Record<PhoneError, string> = {
  empty: "رقم الهاتف مطلوب.",
  "not-iraqi": "الرقم يجب أن يكون عراقياً (يبدأ بـ07 أو +964).",
  "bad-length": "طول الرقم غير صحيح. الصيغة: 07 يتبعها تسعة أرقام.",
  "bad-prefix": "بادئة المشغّل غير معروفة. المسموح: 070 · 075 · 077 · 078 · 079",
};

/**
 * يقبل ما يكتبه الناس فعلاً ويُخرج صيغة واحدة:
 *   `07701234567` · `+964 770 123 4567` · `009647701234567` · `٠٧٧٠١٢٣٤٥٦٧`
 *   ← كلها تصير `+9647701234567`
 */
export function normalizePhone(input: string): PhoneResult {
  if (typeof input !== "string" || input.trim() === "") {
    return { ok: false, reason: "empty", messageAr: MESSAGES.empty };
  }

  // تطبيع الأرقام الهندية-العربية والفارسية، وإزالة كل ما ليس رقماً أو +
  let value = input
    .replace(/[٠-٩]/gu, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/gu, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\s()\-.]/gu, "");

  // 00964… ← +964…
  if (value.startsWith("00")) value = `+${value.slice(2)}`;
  // 964… ← +964…
  if (/^964\d/u.test(value)) value = `+${value}`;
  // 07… ← +9647…
  if (/^0\d/u.test(value)) value = `+964${value.slice(1)}`;
  // 7XXXXXXXXX (بلا صفر ولا مفتاح) ← +964…
  if (/^7\d{9}$/u.test(value)) value = `+964${value}`;

  if (!value.startsWith("+964")) {
    return { ok: false, reason: "not-iraqi", messageAr: MESSAGES["not-iraqi"] };
  }

  const national = value.slice(4); // ما بعد +964
  if (national.length !== 10) {
    return { ok: false, reason: "bad-length", messageAr: MESSAGES["bad-length"] };
  }

  const prefix = national.slice(0, 2);
  if (!VALID_PREFIXES.includes(prefix as (typeof VALID_PREFIXES)[number])) {
    return { ok: false, reason: "bad-prefix", messageAr: MESSAGES["bad-prefix"] };
  }

  if (!E164_IRAQ.test(value)) {
    return { ok: false, reason: "bad-length", messageAr: MESSAGES["bad-length"] };
  }

  return { ok: true, phone: value };
}

/** يرمي بدل أن يُرجع — للمسارات التي لا تعرض خطأ حقل. */
export function normalizePhoneOrThrow(input: string): string {
  const result = normalizePhone(input);
  if (!result.ok) throw new RangeError(result.messageAr);
  return result.phone;
}

/** هل الرقم مخزَّن بالصيغة الصحيحة؟ يُستعمل في التدقيق على البيانات. */
export function isNormalized(phone: string): boolean {
  return E164_IRAQ.test(phone);
}

/** «‏0770 123 4567» — للعرض فقط. المخزَّن يبقى E.164 دائماً. */
export function formatPhoneForDisplay(phone: string): string {
  if (!isNormalized(phone)) return phone;
  const n = phone.slice(4);
  return `0${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
}

/** رابط واتساب مباشر — تحتاجه شاشة متابعات الموظف (‏§8.3). */
export function whatsappLink(phone: string): string {
  return `https://wa.me/${phone.replace(/^\+/u, "")}`;
}
