import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { prisma } from "@/lib/prisma";
import { requireEnv, optionalEnv } from "@/lib/env";
import { SESSION_COOKIE, shouldRenew, issueSession, verifySession } from "./jwt";
import type { UserRole } from "./roles";

/**
 * حلّ الجلسة — **آليتان متوازيتان** (‏§10.2/6).
 *
 * ── التعقيد الجوهري الذي يجب مواجهته صراحةً ──────────────────────────
 * المواصفة تُنشئ مسارَي دخول بآليتَي جلسة مختلفتين:
 *   • كوكي Supabase   ← المالك والأدمن والموظفون (‏Google OAuth)
 *   • JWT خاص بنا     ← السكان (‏OTP على واتساب)
 * فأي كود ينسى إحداهما يُنتج **ثغرة أو انقطاعاً**: لو نسي الأولى خرج
 * الأدمن، ولو نسي الثانية لم يدخل أي ساكن — وهم أغلب المستخدمين.
 *
 * الحلّ: دالة واحدة تُجرّب الاثنتين وتُرجع **دائماً** نفس الشكل.
 *
 * ── ولماذا يُرجَع المستخدم من قاعدتنا لا من مزوّد الهوية ─────────────
 * مزوّد الهوية يعرف «من أنت»، ولا يعرف **دورك** ولا إن كنت معطَّلاً.
 * و`isActive` هو آلية منع الدخول الوحيدة (‏§10.1)، فلو قُرئ الدور من
 * التوكن لبقي موظف تُرك عمله داخلاً حتى انتهاء جلسته.
 * القراءة من قاعدتنا في كل طلب تجعل التعطيل **فورياً**.
 */

export interface SessionUser {
  id: string;
  fullName: string;
  role: UserRole;
  phone: string;
  email: string | null;
  /** صورة حساب Google — `null` لمن دخل بـOTP فلا صورة له. */
  avatarUrl: string | null;
  isActive: boolean;
}

/** من أين جاءت الجلسة — يُسجَّل في التدقيق ويفيد التشخيص. */
export type SessionSource = "supabase" | "otp-jwt";

export interface ResolvedSession {
  user: SessionUser;
  source: SessionSource;
}

async function loadUser(where: { id: string } | { supabaseUserId: string }): Promise<SessionUser | null> {
  const user = await prisma.user.findFirst({
    where,
    select: {
      id: true, fullName: true, role: true, phone: true, email: true,
      avatarUrl: true, isActive: true,
    },
  });
  // ⚠️ المستخدم المعطَّل **لا جلسة له** مهما كان توكنه صالحاً.
  if (!user || !user.isActive) return null;
  return user as SessionUser;
}

/** جلسة Supabase — لمن دخل بـGoogle. */
async function resolveSupabase(): Promise<SessionUser | null> {
  const url = optionalEnv("SUPABASE_URL");
  const key = optionalEnv("SUPABASE_PUBLIC_KEY");
  if (!url || !key) return null;

  const store = await cookies();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      // القراءة فقط هنا: تجديد الكوكي شأن `proxy.ts` لا شأن حلّ الجلسة.
      setAll: () => undefined,
    },
  });

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return loadUser({ supabaseUserId: data.user.id });
}

/** جلسة OTP — لمن دخل برقم هاتفه. */
async function resolveOtpJwt(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const result = verifySession(token, requireEnv("AUTH_SECRET"));
  if (!result.valid) return null;

  return loadUser({ id: result.claims.sub });
}

/**
 * الجلسة الحالية أو `null`.
 *
 * الترتيب مقصود: Supabase أولاً لأن كوكيه أدقّ (يحمل تحقّقاً من مزوّد
 * خارجي)، ثم الـJWT الخاص بنا.
 *
 * ── 🔴 ولماذا `cache()` ─────────────────────────────────────────────
 * هذه الدالّة **ليست رخيصة**: `resolveSupabase` يقطع رحلة شبكة إلى خدمة
 * مصادقة Supabase (`auth.getUser()`)، ثم `loadUser` يستعلم القاعدة.
 *
 * وتُستدعى **أربع مرّات لتصيير صفحة واحدة**: حارس التخطيط، ثم جرس
 * الإخطارات في القشرة، ثم حارس الصفحة، ثم قارئ بياناتها. أربع رحلات
 * شبكة وأربعة استعلامات تُرجع نفس الجواب في نفس اللحظة.
 *
 * `cache()` من React تُلغي التكرار **داخل دورة التصيير الواحدة** — لا
 * أكثر. فلا تصير الجلسة مخزَّنة بين الطلبات: كل طلب جديد يحلّها من
 * جديد، والخروج وتعطيل المستخدم يسريان فوراً كما كانا.
 *
 * ⚠️ ولا تُستبدل بـ`unstable_cache` ولا بذاكرة على مستوى الوحدة: تلك
 * تعبر حدود الطلبات، فيرث مستخدمٌ جلسة آخر.
 */
export const getSession = cache(async (): Promise<ResolvedSession | null> => {
  const fromSupabase = await resolveSupabase();
  if (fromSupabase) return { user: fromSupabase, source: "supabase" };

  const fromOtp = await resolveOtpJwt();
  if (fromOtp) return { user: fromOtp, source: "otp-jwt" };

  return null;
});

/** يضع كوكي جلسة OTP — HTTP-only · SameSite=Lax · 7 أيام (‏§10.2/6). */
export async function setOtpSessionCookie(userId: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, issueSession(userId, requireEnv("AUTH_SECRET")), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });
}

export async function clearOtpSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/**
 * تجديد الكوكي في آخر ثلث عمره — «متجدّد» في §10.2/6.
 * بدونه يخرج الساكن فجأة بعد سبعة أيام وهو يستعمل النظام يومياً.
 */
export async function renewIfNeeded(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return;
  const result = verifySession(token, requireEnv("AUTH_SECRET"));
  if (result.valid && shouldRenew(result.claims)) {
    await setOtpSessionCookie(result.claims.sub);
  }
}
