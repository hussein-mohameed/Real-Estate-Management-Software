"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { requireEnv } from "@/lib/env";

/**
 * بدء الدخول بـGoogle.
 *
 * ⚠️ `redirectTo` **يجب أن يطابق** ما هو مُسجَّل في:
 *   Supabase → Authentication → URL Configuration → Redirect URLs
 * وأي اختلاف — ولو في الشرطة الأخيرة — يُنتج خطأ `redirect_to not allowed`
 * وهو خطأ يبدو غامضاً لأنه لا يذكر ما توقّعه الخادم.
 */
export async function signInWithGoogle(next?: string): Promise<never> {
  const supabase = await createSupabaseServerClient();
  const appUrl = requireEnv("APP_URL").replace(/\/$/u, "");
  const callback = new URL("/api/auth/callback", appUrl);
  if (next?.startsWith("/")) callback.searchParams.set("next", next);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: callback.toString(),
      queryParams: {
        // نطلب موافقة صريحة على البريد — هو مفتاح المطابقة مع سجلّ المستخدمين
        access_type: "offline",
        prompt: "select_account",
      },
    },
  });

  if (error || !data.url) {
    redirect("/login?error=oauth_start_failed");
  }
  redirect(data.url);
}
