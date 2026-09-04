import { NextResponse, type NextRequest } from "next/server";

/**
 * ⚠️ **الاسم `proxy.ts` لا `middleware.ts`.**
 *
 * ‏Next.js 16 هجّر `middleware.ts` وأعاد تسميته إلى `proxy.js|ts`، واسم
 * الدالة المصدَّرة `proxy` لا `middleware`. المواصفة §10.3 تبني على الاسم
 * القديم — وهو تصحيح `S9` مُطبَّقاً. المصدر مع المسار في
 * `docs/00-STACK-VERIFIED.md` §2.1.
 *
 * ── ولماذا هذا الملف **ليس** حدّاً أمنياً ────────────────────────────
 * توثيق Next 16 نفسه يحذّر: «‏Proxy يُستدعى منفصلاً عن كود العرض، وفي
 * الحالات المُحسَّنة **يُنشر على CDN** — لا ينبغي أن تعتمد على وحدات
 * مشتركة أو متغيّرات عامة»، ويوصي بـ«تجنّب الاعتماد عليه ما لم يوجد
 * خيار آخر».
 *
 * لذلك هنا **فحص وجود كوكي فقط** — بلا Prisma وبلا قراءة دور. الغرض
 * تحويلٌ رخيص يوفّر على المستخدم تحميل صفحة لا يستطيع رؤيتها.
 * الحدّ الأمني الفعلي حيث تضعه المواصفة نفسها: `layout.tsx` لكل مجموعة،
 * **وكل Server Action يعيد الفحص بنفسه**.
 */

const PUBLIC_PATHS = ["/login", "/pending", "/api/auth", "/api/otp", "/api/webhooks", "/api/cron"];

/** كوكي جلسة OTP الخاص بنا. */
const OTP_COOKIE = "compound_session";

function hasAnySessionCookie(request: NextRequest): boolean {
  if (request.cookies.get(OTP_COOKIE)) return true;
  // كوكي Supabase اسمه مشتقّ من مرجع المشروع: `sb-<ref>-auth-token`.
  // نفحص النمط لا الاسم الكامل حتى لا يرتبط الملف بمشروع بعينه.
  return request.cookies.getAll().some((c) => /^sb-.*-auth-token/u.test(c.name));
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  if (!hasAnySessionCookie(request)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // نحفظ الوجهة ليعود إليها بعد الدخول بدل أن يبدأ من الصفر
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * كل شيء عدا الملفات الساكنة وصور Next — فحص الكوكي على كل طلب أصل
     * يبطئ الموقع بلا فائدة.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2)$).*)",
  ],
};
