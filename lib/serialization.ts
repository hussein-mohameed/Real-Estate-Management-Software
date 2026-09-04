import superjson from "superjson";

/**
 * حدّ التسلسل بين الخادم والعميل.
 *
 * ── المشكلة ───────────────────────────────────────────────────────────
 * `JSON.stringify` **يرمي** على `BigInt`، وكل مبلغ في هذا النظام `BigInt`.
 * و`Date` يتحوّل إلى نصّ فيصل للعميل بنوع خاطئ.
 *
 * ── لماذا لا نُصحّح `BigInt.prototype.toJSON` عالمياً ─────────────────
 * §5.1/1 يقترح «‏superjson أو ترقيع `toJSON`». الترقيع العالمي **خطر**: يجعل
 * كل `JSON.stringify` في العملية كلها — بما فيها سجلّات التدقيق وحمولات
 * الـwebhook وأجسام طلبات Wayl — تُخرج المبالغ نصوصاً **بصمت**، فيصل مبلغ
 * كنصّ إلى طرف ثالث يتوقّع عدداً. نختار `superjson` صراحةً على الحدود
 * (ملاحظة فنية 2 في خطة التنفيذ).
 */

/** تسلسل قيمة عابرة لحدّ Server → Client. */
export function serialize<T>(value: T): string {
  return superjson.stringify(value);
}

/** فكّ تسلسل قيمة قادمة من الخادم. */
export function deserialize<T>(payload: string): T {
  return superjson.parse<T>(payload);
}

/**
 * `BigInt` → نصّ، **للحمولات الخارجية فقط** (‏Wayl · UltraMsg · التصدير).
 * ⚠️ لا تستعملها لعرض المال — العرض يمرّ بـ`<Money>` وحده.
 */
export function bigintToString(value: bigint): string {
  return value.toString(10);
}

/**
 * `BigInt` → `number`، **لواجهات الطرف الثالث التي تشترط عدداً** (‏Wayl يرسل
 * `total` و`lineItem[].amount` كأعداد صحيحة).
 *
 * يرمي فوق `Number.MAX_SAFE_INTEGER` بدل أن يفقد الدقّة بصمت. مبلغ يتجاوز
 * 9,007,199,254,740,991 ديناراً غير واقعي، لكن الفشل الصريح أفضل من فرق
 * صامت في دفعة.
 */
export function bigintToSafeNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError(
      `المبلغ ${value} يتجاوز المدى الآمن للتحويل إلى number. لا تفقد الدقّة بصمت.`,
    );
  }
  return Number(value);
}
