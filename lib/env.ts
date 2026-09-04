/**
 * قراءة متغيّرات البيئة — بمصدر واحد ورسائل عربية صريحة.
 *
 * ── لماذا وحدة مستقلة ────────────────────────────────────────────────
 * `process.env.X!` المنثور في الكود يُنتج `undefined` يتسلّل إلى عمق منطق
 * مالي فينفجر برسالة غامضة بعد ثلاث خطوات. هنا يُقرأ المتغيّر مرة واحدة
 * ويفشل **فوراً** برسالة تقول أي مفتاح ينقص وأين يُوضع.
 *
 * ── أسماء مفاتيح Supabase تغيّرت ─────────────────────────────────────
 * §12.2 يسمّيها `NEXT_PUBLIC_SUPABASE_ANON_KEY` و`SUPABASE_SERVICE_ROLE_KEY`
 * (نظام مفاتيح JWT القديم). المشاريع الحديثة تستخدم النظام الجديد:
 *   `sb_publishable_…` بدل anon   ·   `sb_secret_…` بدل service_role
 * ورفض الواجهة للمفتاح العام يقول ذلك حرفياً:
 *   «Only secret API keys can be used for this endpoint»
 * لذلك نقبل **الاسمين** بدل إجبار المشروع على تسمية مهجورة.
 */

type EnvSource = Record<string, string | undefined>;

function readAlias(
  source: EnvSource,
  names: readonly string[],
): { value?: string; foundAs?: string } {
  for (const name of names) {
    const raw = source[name];
    if (raw !== undefined && raw.trim() !== "") {
      return { value: raw.trim(), foundAs: name };
    }
  }
  return {};
}

/** مفاتيح البيئة مع بدائل التسمية المقبولة. */
export const ENV_KEYS = {
  DATABASE_URL: ["DATABASE_URL"],
  DIRECT_URL: ["DIRECT_URL", "DATABASE_URL"],
  SUPABASE_URL: ["NEXT_PUBLIC_SUPABASE_URL"],
  /** anon (قديم) ↔ publishable (جديد) — يُرسل للمتصفّح. */
  SUPABASE_PUBLIC_KEY: [
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  ],
  /** service_role (قديم) ↔ secret (جديد) — ⚠️ خادم فقط، لا يُمرَّر لأي Client Component. */
  SUPABASE_SECRET_KEY: [
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SECRET_KEY",
  ],
  AUTH_SECRET: ["AUTH_SECRET"],
  GOOGLE_CLIENT_ID: ["GOOGLE_CLIENT_ID"],
  GOOGLE_CLIENT_SECRET: ["GOOGLE_CLIENT_SECRET"],
  ULTRAMSG_INSTANCE_ID: ["ULTRAMSG_INSTANCE_ID"],
  ULTRAMSG_TOKEN: ["ULTRAMSG_TOKEN"],
  WAYL_SECRET_TOKEN: ["WAYL_SECRET_TOKEN"],
  WAYL_ENV: ["WAYL_ENV"],
  WAYL_WEBHOOK_SECRET: ["WAYL_WEBHOOK_SECRET"],
  APP_URL: ["APP_URL"],
  CRON_SECRET: ["CRON_SECRET"],
  SENTRY_DSN: ["SENTRY_DSN"],
} as const;

export type EnvKey = keyof typeof ENV_KEYS;

/** أين يُوضع كل مفتاح إن نقص — تظهر في رسالة الخطأ. */
const WHERE_TO_GET: Record<EnvKey, string> = {
  DATABASE_URL: "Supabase → Project Settings → Database → Connection string → Transaction pooler (منفذ 6543)",
  DIRECT_URL: "Supabase → Project Settings → Database → Connection string → Session pooler (منفذ 5432)",
  SUPABASE_URL: "Supabase → Project Settings → API → Project URL",
  SUPABASE_PUBLIC_KEY: "Supabase → Project Settings → API Keys → publishable (أو anon في المشاريع القديمة)",
  SUPABASE_SECRET_KEY: "Supabase → Project Settings → API Keys → secret (أو service_role) — ⚠️ خادم فقط",
  AUTH_SECRET: 'ولّده محلياً: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"',
  GOOGLE_CLIENT_ID: "Google Cloud Console → APIs & Services → Credentials → OAuth client",
  GOOGLE_CLIENT_SECRET: "Google Cloud Console → نفس بيانات الاعتماد",
  ULTRAMSG_INSTANCE_ID: "لوحة UltraMsg → Instance ID",
  ULTRAMSG_TOKEN: "لوحة UltraMsg → Token",
  WAYL_SECRET_TOKEN: "من Wayl — محجوب بالقرار B6",
  WAYL_ENV: '"test" أو "live"',
  WAYL_WEBHOOK_SECRET: "سرّ تختاره أنت وتُرسله لـWayl عند إنشاء الرابط",
  APP_URL: "عنوان التطبيق، مثل http://localhost:3000",
  CRON_SECRET: 'ولّده محلياً كـAUTH_SECRET',
  SENTRY_DSN: "Sentry → Project Settings → Client Keys (اختياري حتى P6)",
};

/** يقرأ متغيّراً إلزامياً أو يرمي برسالة تقول ما ينقص وأين يُوجد. */
export function requireEnv(key: EnvKey, source: EnvSource = process.env): string {
  const { value } = readAlias(source, ENV_KEYS[key]);
  if (!value) {
    const names = ENV_KEYS[key].join(" أو ");
    throw new Error(
      `المتغيّر ${names} غير مضبوط.\n` +
        `  أين تجده: ${WHERE_TO_GET[key]}\n` +
        `  ضعه في .env.local (‏مستثنى من git). القالب في .env.example.`,
    );
  }
  return value;
}

/** يقرأ متغيّراً اختيارياً. */
export function optionalEnv(key: EnvKey, source: EnvSource = process.env): string | undefined {
  return readAlias(source, ENV_KEYS[key]).value;
}

export interface EnvStatus {
  key: EnvKey;
  set: boolean;
  foundAs?: string;
  where: string;
}

/** تقرير حالة كل المفاتيح — يستدعيه `npm run env:check`. لا يكشف أي قيمة. */
export function inspectEnv(source: EnvSource = process.env): EnvStatus[] {
  return (Object.keys(ENV_KEYS) as EnvKey[]).map((key) => {
    const { value, foundAs } = readAlias(source, ENV_KEYS[key]);
    const status: EnvStatus = { key, set: value !== undefined, where: WHERE_TO_GET[key] };
    if (foundAs) status.foundAs = foundAs;
    return status;
  });
}

/**
 * المفاتيح التي بدونها **لا يعمل شيء**، مقابل ما يحجب ميزة بعينها.
 * التمييز مهم: مشروع بلا UltraMsg يعمل ولا يدخله ساكن؛ مشروع بلا
 * DATABASE_URL لا يقلع أصلاً.
 */
export const CRITICAL_KEYS: readonly EnvKey[] = Object.freeze([
  "DATABASE_URL",
  "DIRECT_URL",
  "SUPABASE_URL",
  "SUPABASE_PUBLIC_KEY",
  "AUTH_SECRET",
]);
