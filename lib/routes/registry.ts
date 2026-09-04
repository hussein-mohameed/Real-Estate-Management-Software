/**
 * سجلّ مسارات الـAPI (‏§9.3) — تسعة في المواصفة + واحد كشفه التدقيق.
 *
 * كل مسار يعلن آلية مصادقته صراحةً. المسار بلا آلية معلَنة عيب أمني
 * لا نقص توثيق.
 */

export type RouteAuth =
  | "public"
  | "public-rate-limited"
  | "shared-secret"
  | "cron-secret"
  | "session-ownership";

export interface RouteSpec {
  path: string;
  method: "GET" | "POST";
  auth: RouteAuth;
  ar: string;
  source: "spec" | "audit";
  blockedBy?: string;
  note?: string;
}

export const ROUTES: readonly RouteSpec[] = Object.freeze([
  { path: "/api/auth/callback", method: "GET", auth: "public", ar: "ردّ Google OAuth", source: "spec",
    note: "يطابق supabaseUserId ← User. مستخدم غير موجود ← /pending **بجلسة Supabase مُلغاة فعلياً**." },
  { path: "/api/otp/request", method: "POST", auth: "public-rate-limited", ar: "طلب رمز OTP", source: "spec",
    note: "§10.2/1: **نفس الردّ الناجح** سواء وُجد الرقم أم لا، ولا يُرسل شيئاً إن لم يوجد — وإلا صار تعداد أرقام السكان ممكناً." },
  { path: "/api/otp/verify", method: "POST", auth: "public-rate-limited", ar: "التحقّق من الرمز", source: "spec",
    note: "مقارنة timing-safe. 5 محاولات لكل رمز." },
  { path: "/api/webhooks/wayl", method: "POST", auth: "shared-secret", ar: "نتيجة الدفع من Wayl", source: "spec",
    blockedBy: "B6", note: "🔴 المواصفة تقول «تحقّق من السرّ المشترك» ولا تقول **أين** يأتي: ترويسة؟ حقل؟ HMAC؟ لا تخمين في آلية تحقّق لمسار يقبض مالاً." },
  { path: "/api/cron/billing", method: "POST", auth: "cron-secret", ar: "الفوترة الدورية", source: "spec",
    note: "بُنيت 2026-08-28 بعد حسم B2. تشغيلان متتاليان ← نفس عدد القيود بالضبط (فهرسان فريدان جزئيان). " +
      "توقيت 02:00 بغداد = 23:00 UTC اليوم السابق. **لا ترسل إخطاراً** — الإرسال محجوب بـB7 ومذكور في skipped." },
  { path: "/api/cron/installments", method: "POST", auth: "cron-secret", ar: "قلب المتأخّر والتنبيهات", source: "spec",
    note: "Q16: **هي** من يُنشئ قيد استحقاق القسط — الفراغ الذي لا مكوّن مُسنَد إليه في المواصفة. بُنيت 2026-09-02 بعد حسم B1؛ الضمانة ضدّ التكرار هي وجود القيد نفسه لا علمٌ على الصفّ." },
  { path: "/api/cron/notifications", method: "POST", auth: "cron-secret", ar: "إرسال الإخطارات المصفوفة", source: "spec",
    blockedBy: "B7", note: "§12.3 يطلبها **كل دقيقة** — يتعارض مع خطط الاستضافة المجانية." },
  { path: "/api/invoices/[id]/pdf", method: "GET", auth: "session-ownership", ar: "تنزيل فاتورة PDF", source: "spec",
    blockedBy: "B7", note: "تُبنى من Invoice.lines **اللقطة** لا من استعلام حيّ — وإلا تغيّرت الفاتورة القديمة بتغيّر الأسعار." },
  { path: "/api/files/signed-url", method: "POST", auth: "session-ownership", ar: "رابط موقَّع لملف خاص", source: "spec",
    note: "T5: يستقبل **مرجع كيان** لا مساراً خاماً — منع IDOR. وكل توليد يُكتب في التدقيق (R5)." },
  { path: "/api/cron/maintenance", method: "POST", auth: "cron-secret", ar: "صيانة يومية: انتهاء الباجات وروابط الدفع", source: "audit",
    note: "Q40 — لا مسار في §9.3 لانتهاء روابط الدفع (§12.4 يطلبه) ولا لانتهاء الباجات. **باج منتهٍ يبقى ISSUED فتُدخل سيارته بلا تفتيش** — ثقب في ضبط الوصول الفيزيائي." },
]);

export function auditRoutes() {
  return {
    total: ROUTES.length,
    fromSpec: ROUTES.filter((r) => r.source === "spec").length,
    blocked: ROUTES.filter((r) => r.blockedBy).map((r) => `${r.path} (${r.blockedBy})`),
  };
}
