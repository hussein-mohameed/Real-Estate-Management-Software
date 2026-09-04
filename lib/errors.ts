/**
 * أخطاء المجال.
 *
 * تُرمى من عمق منطق المجال، ويلتقطها مغلّف الـaction (`defineAction`) فيحوّلها
 * إلى الشكل الموحّد. الفائدة: منطق المجال لا يعرف شيئاً عن HTTP ولا عن شكل
 * الاستجابة، ومع ذلك تصل رسالته العربية الدقيقة إلى المستخدم.
 */

import { ERROR_CODES, type ErrorCode, type FieldErrors } from "./result";

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly fieldErrors?: FieldErrors;

  constructor(code: ErrorCode, message: string, fieldErrors?: FieldErrors) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    if (fieldErrors) this.fieldErrors = fieldErrors;
  }
}

/** لا جلسة صالحة. */
export class UnauthenticatedError extends DomainError {
  constructor(message = "الجلسة غير صالحة. سجّل الدخول من جديد.") {
    super(ERROR_CODES.UNAUTHENTICATED, message);
  }
}

/**
 * مصدَّق وغير مصرَّح.
 * ⚠️ يجب أن يصل هذا للمستخدم كـ403 صريح — **لا قائمة فارغة**. القائمة الفارغة
 * توحي بعدم الوجود ولا تميّز الخطأ من المنع (الخطوة 5.3).
 */
export class ForbiddenError extends DomainError {
  constructor(message = "لا تملك صلاحية تنفيذ هذا الإجراء.") {
    super(ERROR_CODES.FORBIDDEN, message);
  }
}

export class NotFoundError extends DomainError {
  constructor(entityAr: string) {
    super(ERROR_CODES.NOT_FOUND, `${entityAr} غير موجود.`);
  }
}

/** قاعدة عمل مخروقة — الرسالة تشرح **السبب بالضبط** لا خطأً عاماً. */
export class BusinessRuleError extends DomainError {
  /** مرجع القاعدة في المواصفة، مثل `R10`. يُسجَّل ولا يُعرض للمستخدم. */
  readonly rule?: string;

  constructor(message: string, rule?: string) {
    super(ERROR_CODES.BUSINESS_RULE, message);
    if (rule) this.rule = rule;
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, fieldErrors?: FieldErrors) {
    super(ERROR_CODES.VALIDATION, message, fieldErrors);
  }
}

export class ConflictError extends DomainError {
  constructor(message = "تعذّر التنفيذ بسبب تعارض مع بيانات موجودة.") {
    super(ERROR_CODES.CONFLICT, message);
  }
}

export class RateLimitedError extends DomainError {
  constructor(message = "عدد المحاولات تجاوز الحدّ المسموح.") {
    super(ERROR_CODES.RATE_LIMITED, message);
  }
}

export class IntegrationError extends DomainError {
  readonly provider: string;

  constructor(provider: string, message: string) {
    super(ERROR_CODES.INTEGRATION, message);
    this.provider = provider;
  }
}

/**
 * ⛔ قرار عمل غير مُتَّخذ.
 *
 * هذه ليست فئة خطأ عادية — هي **تطبيق قاعدة «لا تخترع جواباً» في الكود نفسه**.
 * حيثما يعتمد مسار على قرار محجوب (‏B1–B7 أو ما في حكمها)، يرمي هذا الخطأ
 * بدل أن يختار افتراضاً معقول المظهر.
 *
 * فائدته أن الفراغ يصبح **مرئياً ومختبَراً** بدل أن يختفي في تخمين صامت:
 * الاختبار يؤكّد أن المسار يرمي `PendingDecisionError` بمعرّف القرار الصحيح،
 * وشاشة الأدمن تعرض رسالة تشرح ما المطلوب من صاحب المنتج.
 *
 * كل موضع يرمي هذا الخطأ مسجَّل في `docs/OPEN-DECISIONS.md`.
 */
export class PendingDecisionError extends DomainError {
  /** معرّف القرار: `B1`…`B7` أو `Q16` أو `effectiveDate`. */
  readonly decisionId: string;

  constructor(decisionId: string, whatIsBlocked: string) {
    super(
      ERROR_CODES.PENDING_DECISION,
      `${whatIsBlocked} — موقوف حتى يُتَّخذ القرار «${decisionId}». راجع مسؤول النظام.`,
    );
    this.decisionId = decisionId;
  }
}

/** هل الخطأ من أخطاء المجال المعروفة؟ */
export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
