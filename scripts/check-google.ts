/**
 * فحص جاهزية الدخول بـGoogle — يقرأ إعدادات Supabase الحيّة.
 * لا يطبع أي قيمة سرّية.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });
import { optionalEnv, requireEnv } from "../lib/env";

interface Settings {
  external?: Record<string, boolean>;
  disable_signup?: boolean;
}

async function main(): Promise<void> {
  const url = requireEnv("SUPABASE_URL");
  const key = requireEnv("SUPABASE_PUBLIC_KEY");

  const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } });
  if (!res.ok) {
    console.error(`❌ تعذّر قراءة إعدادات Supabase: ${res.status}`);
    process.exit(1);
  }
  const settings = (await res.json()) as Settings;
  const google = settings.external?.["google"] === true;

  console.log("\n═══ جاهزية الدخول بـGoogle ═══\n");
  console.log(`  ${google ? "✅" : "❌"} موفّر Google في Supabase`);
  if (!google) {
    console.log("      ← Authentication → Sign In / Providers → Google → Enable + الصق Client ID/Secret");
  }

  const appUrl = requireEnv("APP_URL").replace(/\/$/u, "");
  console.log(`  ✅ APP_URL: ${appUrl}`);
  console.log(`      عنوان الرجوع المتوقَّع: ${appUrl}/api/auth/callback`);
  console.log(`      ← يجب أن يكون ضمن Supabase → Authentication → URL Configuration → Redirect URLs`);

  const ref = new URL(url).hostname.split(".")[0];
  console.log(`\n  عنوان الرجوع الذي يجب أن يكون في Google Cloud:`);
  console.log(`      https://${ref}.supabase.co/auth/v1/callback`);

  // هذان لا يستعملهما التطبيق — مكانهما لوحة Supabase.
  const hasId = Boolean(optionalEnv("GOOGLE_CLIENT_ID"));
  console.log(`\n  ℹ️  GOOGLE_CLIENT_ID في .env.local: ${hasId ? "موجود" : "غائب"} — ` +
    "التطبيق لا يقرأه؛ Supabase هو من يحمله.");

  if (settings.disable_signup === false) {
    console.log("\n  ⚠️  Supabase يسمح بإنشاء حسابات جديدة تلقائياً.");
    console.log("      حمايتنا في مسار الرجوع تكفي، لكن إيقافه يجعل المنع في طبقتين.");
  }

  console.log("");
  if (!google) process.exit(1);
  console.log("✅ جاهز — جرّب /login\n");
}

void main();
