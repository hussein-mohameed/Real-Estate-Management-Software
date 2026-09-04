"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { clearOtpSessionCookie } from "@/lib/auth/session";
import { optionalEnv } from "@/lib/env";

/**
 * الخروج.
 *
 * ── ⚠️ **آليتان، فلا بدّ من إبطال الاثنتين** ────────────────────────
 * §10.2/6 يُنشئ مسارَي دخول: كوكي Supabase للإدارة والموظفين، وJWT خاصّ
 * بنا للسكان. وإبطال إحداهما فقط يُنتج عيباً صامتاً:
 *   • نسيان الأولى ← يبقى الأدمن داخلاً بعد ضغطه «خروج».
 *   • نسيان الثانية ← يبقى الساكن داخلاً سبعة أيام.
 * فالخروج يمسح الاثنتين دائماً بلا فحص لأيّهما كانت.
 *
 * ── ولماذا `optionalEnv` لا `requireEnv` ───────────────────────────
 * ⚠️ `requireEnv` **يرمي** حين ينقص المتغيّر، ورميُه هنا يعني أن **الخروج
 * نفسه يفشل** في بيئة بلا Supabase — فيبقى المستخدم محتجزاً داخل النظام
 * بلا مخرج. والخروج آخر ما يجوز أن يتعطّل.
 */
export async function signOutAction(): Promise<void> {
  if (optionalEnv("SUPABASE_URL") && optionalEnv("SUPABASE_PUBLIC_KEY")) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }

  await clearOtpSessionCookie();

  /**
   * ⚠️ `redirect` يرمي داخلياً — فلا شيء بعده، ولا يوضع في `try`.
   * وضعه داخل `try/catch` كان سيلتقط التحويل ويحوّله إلى خطأ صامت.
   */
  redirect("/login");
}
