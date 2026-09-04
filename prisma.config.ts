import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

/**
 * ⚠️ `import "dotenv/config"` يحمّل `.env` **وحده**، بينما Next.js يحمّل
 * `.env.local` تلقائياً. فبلا هذا السطر يرى التطبيق المفاتيح ولا يراها
 * الـCLI — و`prisma migrate` يفشل بخطأ اتصال مُربك بينما كل شيء يبدو مضبوطاً.
 * الترتيب يتبع اصطلاح Next.js: `.env.local` يعلو على `.env`.
 */
/*
 * ⚠️ و`USE_TEST_SCHEMA=1` يوجّه الترحيلات إلى مخطّط الاختبار.
 * البديل كان تمرير `DIRECT_URL` على سطر الأوامر — وسطور الأوامر تُسجَّل
 * وتُرى، فيتسرّب سرّ القاعدة في كل مرّة. الملفّ لا يتسرّب.
 */
loadEnv({
  path: process.env["USE_TEST_SCHEMA"]
    ? [".env.test", ".env.local", ".env"]
    : [".env.local", ".env"],
  quiet: true,
});

/**
 * تهيئة Prisma 7 — تُقرأ من **الـCLI وحدها** (migrate · validate · studio · generate).
 * التطبيق لا يقرأ هذا الملف إطلاقاً؛ هو يتصل عبر driver adapter في lib/prisma.ts.
 *
 * ── فصل الاتصالين (متطلّب الخطوة 0.3) ──────────────────────────────
 * المواصفة تطلب اتصالين: مجمّع (pgbouncer) للتطبيق، ومباشر للترحيلات.
 * في Prisma 6 كان ذلك بحقل `directUrl` داخل datasource.
 *
 * ⚠️ في Prisma 7.9.1 لا وجود لـ`directUrl`. النوع المثبَّت في
 * node_modules/@prisma/config/dist/index.d.ts سطر 26 هو حرفياً:
 *     export declare type Datasource = { url?: string; shadowDatabaseUrl?: string; };
 * (توثيق Prisma المرفق مع الحزمة يوثّق `directUrl` — والحزمة المثبَّتة لا تدعمه.
 *  راجع docs/00-STACK-VERIFIED.md §3.2.)
 *
 * الفصل يتحقّق بطريقة أنظف بحكم أن هذا الملف للـCLI وحده:
 *   هنا           → DIRECT_URL  (الترحيلات تحتاج اتصالاً مباشراً)
 *   lib/prisma.ts → DATABASE_URL (التطبيق يعمل على المجمّع)
 *
 * `process.env` مباشرةً بدل `env()` لأن `env()` يرمي عند غياب المتغيّر،
 * فيمنع `prisma validate` من العمل بلا قاعدة بيانات — وهو فحص نريده متاحاً
 * دائماً في CI وقبل توفّر أي اتصال.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"],
  },
});
