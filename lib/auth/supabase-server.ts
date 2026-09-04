import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { requireEnv } from "@/lib/env";

/**
 * عميل Supabase على الخادم **مع صلاحية كتابة الكوكيز**.
 *
 * يختلف عن العميل في `session.ts` الذي يقرأ فقط: هنا نحتاج الكتابة لأن
 * تبادل رمز OAuth يُنشئ جلسة ويجب حفظها.
 *
 * ⚠️ يستعمل **المفتاح العام** لا السرّي: تدفّق OAuth لا يحتاج امتيازاً،
 * والمفتاح السرّي يتجاوز كل صلاحية فلا يُستعمل إلا حيث يلزم فعلاً.
 */
export async function createSupabaseServerClient() {
  const store = await cookies();
  return createServerClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_PUBLIC_KEY"), {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        for (const { name, value, options } of list) {
          store.set(name, value, options);
        }
      },
    },
  });
}
