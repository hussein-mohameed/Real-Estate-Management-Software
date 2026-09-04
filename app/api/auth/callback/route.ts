import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { ROLE_HOME, type UserRole } from "@/lib/auth/roles";

/**
 * ردّ Google OAuth (‏§9.3 · الخطوة 0.8).
 *
 * ── القاعدة الحاكمة: لا تسجيل عام ────────────────────────────────────
 * §10.1: «الدخول ينجح **فقط** إن وُجد `User` بذلك البريد و`isActive = true`».
 * وGoogle OAuth يُنشئ مستخدم Supabase **قبل** أن نتحقّق من أي شيء — فمن
 * ليس عندنا يصل إلى هنا ومعه جلسة Supabase صالحة.
 *
 * ⚠️ لذلك **نُسجّل خروجه فعلياً** لا نكتفي بتحويله إلى `/pending`. لو تُرك
 * بجلسة Supabase حيّة لبقي في حالة معلّقة: `proxy.ts` يرى كوكيه فيظنّه
 * داخلاً، وكل صفحة تحوّله من جديد — حلقة لا تنتهي.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next");

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    return NextResponse.redirect(`${origin}/login?error=exchange_failed`);
  }

  const authUser = data.user;
  // ⚠️ التطبيع إلزامي: بريد Google قد يعود بأحرف كبيرة، ومقارنة حرفية
  // تمنع مستخدماً موجوداً من الدخول بلا سبب ظاهر.
  const email = authUser.email?.trim().toLowerCase() ?? null;

  // المطابقة بـ`supabaseUserId` أولاً — بعد أول دخول يصير هو المفتاح،
  // لأن البريد قد يتغيّر في حساب Google بينما المعرّف ثابت.
  let user = await prisma.user.findFirst({
    where: { supabaseUserId: authUser.id },
    select: { id: true, role: true, isActive: true, supabaseUserId: true },
  });

  if (!user && email) {
    user = await prisma.user.findFirst({
      where: { email },
      select: { id: true, role: true, isActive: true, supabaseUserId: true },
    });
  }

  if (!user || !user.isActive) {
    // إبطال جلسة Supabase فعلياً قبل التحويل
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/pending`);
  }

  /**
   * صورة الحساب من Google.
   *
   * ⚠️ **تُحدَّث في كل دخول لا عند الإنشاء وحده.** روابط صور Google
   * تتغيّر حين يغيّر المستخدم صورته، والرابط القديم يُرجع 404 — فتظهر
   * صورة مكسورة إلى الأبد. والتحديث الدوري يجعل المصدر هو Google لا لقطة
   * قديمة عندنا.
   *
   * ⚠️ و`avatar_url` **أو** `picture`: Google يعيد الثانية في بعض
   * التدفّقات، وSupabase يمرّر ما وصله كما هو. قراءة واحد منهما فقط
   * تُنتج مستخدمين بلا صورة بلا سبب ظاهر.
   *
   * والنوع مُتحقَّق منه صراحةً: `user_metadata` هو `Json` — أي `any`
   * فعلياً — ووضع قيمة غير نصّية في عمود `String?` يرمي عند الحفظ.
   */
  const meta = authUser.user_metadata as Record<string, unknown> | null;
  const rawAvatar = meta?.["avatar_url"] ?? meta?.["picture"];
  const avatarUrl =
    typeof rawAvatar === "string" && rawAvatar.startsWith("https://") ? rawAvatar : null;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      // تثبيت المعرّف عند أول دخول ناجح
      ...(user.supabaseUserId ? {} : { supabaseUserId: authUser.id }),
      // ⚠️ لا نكتب `null` فوق صورة قائمة: تدفّقٌ لم يُرجع الصورة كان
      // سيمحوها بلا أن يطلب أحد ذلك.
      ...(avatarUrl ? { avatarUrl } : {}),
      lastLoginAt: new Date(),
    },
  });

  const destination = next && next.startsWith("/") ? next : ROLE_HOME[user.role as UserRole];
  return NextResponse.redirect(`${origin}${destination}`);
}
