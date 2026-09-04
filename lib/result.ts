/**
 * الشكل الموحّد لنتيجة كل Server Action (‏§2.4 · المبدأ 7).
 *
 *   { ok: true,  data }
 *   { ok: false, error: { code, message, fieldErrors? } }
 *
 * بلا استثناء واحد. الشكل الموحّد هو ما يجعل معالجة الأخطاء في الواجهة
 * مكتوبة مرة واحدة بدل أن تُعاد في ستّين موضعاً.
 *
 * الرسائل **عربية دائماً**: §11.4 يمنع عرض رموز خام للمستخدم.
 */

/** رموز الأخطاء — مغلقة عمداً حتى لا يخترع كل action رمزاً جديداً. */
export const ERROR_CODES = {
  /** غير مصدَّق — لا جلسة صالحة. */
  UNAUTHENTICATED: "UNAUTHENTICATED",
  /** مصدَّق لكن غير مصرَّح له بهذا الفعل أو هذا الصفّ. */
  FORBIDDEN: "FORBIDDEN",
  /** فشل تحقّق المُدخلات — يصاحبه `fieldErrors` غالباً. */
  VALIDATION: "VALIDATION",
  /** الكيان المطلوب غير موجود (أو محذوف ناعماً). */
  NOT_FOUND: "NOT_FOUND",
  /** الفعل يخالف قاعدة عمل: حالة خاطئة، ثابت مخروق، شرط غير محقَّق. */
  BUSINESS_RULE: "BUSINESS_RULE",
  /** تعارض تزامن أو خرق قيد تفريد في قاعدة البيانات. */
  CONFLICT: "CONFLICT",
  /** تجاوز حدّ المعدّل. */
  RATE_LIMITED: "RATE_LIMITED",
  /** تبعية خارجية فشلت (‏UltraMsg · Wayl · Supabase Storage). */
  INTEGRATION: "INTEGRATION",
  /**
   * الفعل يعتمد على قرار عمل لم يُتَّخذ بعد (‏B1–B7 وما في حكمها).
   * ليس عطلاً: هو رفض متعمَّد للتخمين. راجع docs/OPEN-DECISIONS.md.
   */
  PENDING_DECISION: "PENDING_DECISION",
  /** خطأ غير متوقَّع — يُسجَّل ولا يُكشف تفصيله للمستخدم. */
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** أخطاء الحقول: اسم الحقل ← قائمة رسائل عربية. متوافق مع react-hook-form. */
export type FieldErrors = Record<string, string[]>;

export interface ActionError {
  code: ErrorCode;
  /** رسالة عربية جاهزة للعرض. لا رموز ولا إنجليزية. */
  message: string;
  fieldErrors?: FieldErrors;
}

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ActionError };

/** نجاح. */
export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

/** فشل. */
export function fail<T = never>(
  code: ErrorCode,
  message: string,
  fieldErrors?: FieldErrors,
): ActionResult<T> {
  return fieldErrors
    ? { ok: false, error: { code, message, fieldErrors } }
    : { ok: false, error: { code, message } };
}

/** حارس أنواع يضيّق النتيجة إلى فرع النجاح. */
export function isOk<T>(
  result: ActionResult<T>,
): result is { ok: true; data: T } {
  return result.ok;
}

/** رسائل افتراضية عربية لكل رمز — تُستعمل حين لا يقدّم المتصل رسالة أدقّ. */
export const DEFAULT_ERROR_MESSAGES: Record<ErrorCode, string> = {
  UNAUTHENTICATED: "الجلسة غير صالحة. سجّل الدخول من جديد.",
  FORBIDDEN: "لا تملك صلاحية تنفيذ هذا الإجراء.",
  VALIDATION: "بعض الحقول غير صحيحة. راجع البيانات المُدخَلة.",
  NOT_FOUND: "العنصر المطلوب غير موجود.",
  BUSINESS_RULE: "لا يمكن تنفيذ هذا الإجراء في الحالة الحالية.",
  CONFLICT: "تعذّر التنفيذ بسبب تعارض مع بيانات موجودة. أعد المحاولة.",
  RATE_LIMITED: "عدد المحاولات تجاوز الحدّ المسموح. انتظر قليلاً ثم أعد المحاولة.",
  INTEGRATION: "تعذّر إتمام العملية بسبب خدمة خارجية. أعد المحاولة لاحقاً.",
  PENDING_DECISION: "هذا الإجراء موقوف حتى يُتَّخذ قرار إداري مطلوب.",
  INTERNAL: "حدث خطأ غير متوقَّع. تم تسجيله وسيُراجَع.",
};
