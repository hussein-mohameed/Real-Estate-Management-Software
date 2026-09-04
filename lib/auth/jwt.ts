import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

/**
 * توقيع جلسة الدخول بـOTP (‏§10.2/6).
 *
 * ── لماذا بلا مكتبة ──────────────────────────────────────────────────
 * §2.1 يحدّد الحزمة، و`jose`/`jsonwebtoken` ليستا فيها. و`HS256` عبر
 * `crypto` المدمج ثلاثون سطراً واضحة بلا سطح هجوم إضافي ولا اعتماد يتقادم.
 * القاعدة «لا تضف اعتماداً غير مذكور» ليست شكلية: كل اعتماد يدخل يجب أن
 * يُحدَّث ويُراجَع أمنياً إلى الأبد.
 *
 * ── ما هذا التوقيع وما ليس ───────────────────────────────────────────
 * هو **إثبات أن الخادم أصدر هذه الحمولة**، لا تشفير. لا تضع فيه شيئاً
 * سرّياً: الحمولة مقروءة لأي أحد بـbase64. نضع `sub` (معرّف المستخدم)
 * و`exp` فقط، والباقي يُقرأ من قاعدة البيانات في كل طلب.
 */

const ALG = { alg: "HS256", typ: "JWT" } as const;

export interface SessionClaims {
  /** معرّف `User.id` في قاعدتنا — **لا** معرّف مزوّد الهوية. */
  sub: string;
  /** لحظة الإصدار (ثوانٍ). */
  iat: number;
  /** لحظة الانتهاء (ثوانٍ). 7 أيام حسب §10.2/6. */
  exp: number;
  /** معرّف عشوائي للجلسة — يسمح بإبطال جلسة بعينها لاحقاً. */
  jti: string;
}

export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

/** الكوكي: HTTP-only · SameSite=Lax · 7 أيام · متجدّد (‏§10.2/6). */
export const SESSION_COOKIE = "compound_session";

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function issueSession(userId: string, secret: string, nowSeconds?: number): string {
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET قصير أو غير مضبوط — 32 محرفاً على الأقل.");
  }
  const iat = nowSeconds ?? Math.floor(Date.now() / 1000);
  const claims: SessionClaims = {
    sub: userId,
    iat,
    exp: iat + SESSION_TTL_SECONDS,
    jti: randomBytes(12).toString("base64url"),
  };
  const head = b64url(JSON.stringify(ALG));
  const body = b64url(JSON.stringify(claims));
  return `${head}.${body}.${sign(`${head}.${body}`, secret)}`;
}

export type VerifyFailure =
  | "malformed"
  | "bad-algorithm"
  | "bad-signature"
  | "expired";

export type VerifyResult =
  | { valid: true; claims: SessionClaims }
  | { valid: false; reason: VerifyFailure };

/**
 * التحقّق.
 *
 * ⚠️ **المقارنة timing-safe** (‏§12.1). المقارنة العادية `===` تتوقّف عند أول
 * محرف مختلف، فزمنها يسرّب كم محرفاً صحّ — ويسمح باستنتاج التوقيع محرفاً
 * محرفاً عبر آلاف المحاولات.
 *
 * ⚠️ **الخوارزمية تُفحص صراحةً.** قبول ما تعلنه الترويسة يفتح هجوم
 * `alg: "none"` الكلاسيكي: يزوّر المهاجم الحمولة ويحذف التوقيع فيمرّ.
 */
export function verifySession(
  token: string,
  secret: string,
  nowSeconds?: number,
): VerifyResult {
  const parts = token.split(".");
  if (parts.length !== 3) return { valid: false, reason: "malformed" };

  const [head, body, signature] = parts as [string, string, string];

  let header: unknown;
  try {
    header = JSON.parse(Buffer.from(head, "base64url").toString("utf8"));
  } catch {
    return { valid: false, reason: "malformed" };
  }
  if ((header as { alg?: string })?.alg !== ALG.alg) {
    return { valid: false, reason: "bad-algorithm" };
  }

  const expected = sign(`${head}.${body}`, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { valid: false, reason: "bad-signature" };
  }

  let claims: SessionClaims;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionClaims;
  } catch {
    return { valid: false, reason: "malformed" };
  }
  if (typeof claims.sub !== "string" || typeof claims.exp !== "number") {
    return { valid: false, reason: "malformed" };
  }

  const at = nowSeconds ?? Math.floor(Date.now() / 1000);
  if (claims.exp <= at) return { valid: false, reason: "expired" };

  return { valid: true, claims };
}

/** هل حان وقت التجديد؟ نجدّد في آخر ثلث العمر فلا يخرج المستخدم فجأة. */
export function shouldRenew(claims: SessionClaims, nowSeconds?: number): boolean {
  const at = nowSeconds ?? Math.floor(Date.now() / 1000);
  return claims.exp - at < SESSION_TTL_SECONDS / 3;
}

/** مقارنة timing-safe لأي سرّين — تُستعمل لـ`CRON_SECRET` وسرّ الـwebhook. */
export function secretsMatch(provided: string | null | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    // نُجري مقارنة وهمية بطول ثابت حتى لا يسرّب الاختلاف في الطول زمناً
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}
