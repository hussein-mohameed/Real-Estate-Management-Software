import { Client } from "pg";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  عزل بيانات الاختبار في مخطّط منفصل — إعدادٌ يُشغَّل مرّة.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── 🔴 المشكلة التي يحلّها ──────────────────────────────────────────
 * خادم التطوير وحزمة اختبارات التكامل كانا على **مخطّط واحد** (`public`)
 * في قاعدة واحدة. والنتيجة رآها المستخدم بعينه: واجهته تعرض بنايةً
 * وشقّتين و140,000 د.ع من **بيانات اختبار حيّة**، ثم تُفرغ أمامه حين
 * تنظّف الحزمة نفسها.
 *
 * ولم يُفقد شيء حقيقي — لأنه لم تكن هناك بيانات حقيقية بعد. وأوّل مرّة
 * تُدخَل بيانات مجمَّعٍ حقيقي، يمحوها تشغيلُ اختبار. والمحو حقيقي: الدفتر
 * `append-only` لكن التنظيف يعطّل محفِّزه بحكم أنه أداة اختبار.
 *
 * ── ولماذا مخطّط لا قاعدة ثانية ─────────────────────────────────────
 * مشروع Supabase ثانٍ غير متاح (حدّ الخطّة)، ولا Docker ولا Postgres
 * محلّي على الجهاز. والمخطّط المنفصل **مجاني وبلا تثبيت**: نفس القاعدة،
 * جدولان منفصلان تماماً، وحالة ترحيل مستقلّة.
 *
 * ── ⚠️ ولا يمرّ سرٌّ في أي أمر ولا في أي مخرَج ──────────────────────
 * الرابط يُشتقّ من `.env.local` **داخل هذا السكربت**، ويُكتب إلى `.env.test`
 * مباشرةً. لا يُطبَع، ولا يُمرَّر على سطر أوامر (سطور الأوامر تُسجَّل وتُرى)،
 * ولا يُلصَق في محادثة. المطبوع بصمةُ SHA-256 مقطوعة للتأكيد فقط.
 *
 *   npx tsx --env-file=.env.local scripts/setup-test-schema.ts
 *
 * ثم — الترحيلات والقيود على المخطّط الجديد:
 *   npx cross-env USE_TEST_SCHEMA=1 prisma migrate deploy
 *   npx cross-env USE_TEST_SCHEMA=1 DB_SCHEMA=integration_test tsx scripts/apply-constraints.ts
 */

const SCHEMA = process.env["TEST_SCHEMA_NAME"] ?? "integration_test";
const OUT = ".env.test";

/** بصمة مقطوعة — تُثبت أن الرابط الصحيح كُتب بلا كشفه. */
function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

/**
 * يضيف أو يستبدل معامل `schema` في رابط الاتصال.
 *
 * ⚠️ **`schema` معامل خاصّ بـPrisma لا بـPostgres.** `node-postgres`
 * يتجاهله تماماً. فـPrisma Migrate يحترمه، أما الاتصالات الخام في
 * الاختبارات فتحتاج `search_path` صريحاً — وذلك في `helpers.ts`.
 */
function withSchema(raw: string, schema: string): string {
  const url = new URL(raw);
  url.searchParams.set("schema", schema);
  return url.toString();
}

async function main(): Promise<void> {
  const appUrl = process.env["DATABASE_URL"];
  const directUrl = process.env["DIRECT_URL"] ?? appUrl;

  if (!appUrl || !directUrl) {
    console.error("❌ DATABASE_URL أو DIRECT_URL غير مضبوط. شغّل السكربت بـ--env-file=.env.local");
    process.exit(1);
  }

  /*
   * ⚠️ **الرفض إن كان `.env.local` نفسه يشير إلى مخطّط اختبار.**
   * تشغيلٌ ثانٍ بعد أن صار `.env.local` معدَّلاً بالخطأ كان سينتج
   * `integration_test` مشتقّاً من `integration_test` — ويبدو ناجحاً.
   */
  const current = new URL(appUrl).searchParams.get("schema");
  if (current && current !== "public") {
    console.error(
      `❌ .env.local يشير إلى المخطّط «${current}» لا إلى public. ` +
        "صحّحه أولاً — بيانات التطوير يجب أن تبقى في public.",
    );
    process.exit(1);
  }

  if (existsSync(OUT)) {
    const existing = readFileSync(OUT, "utf8");
    if (existing.includes(`schema=${SCHEMA}`)) {
      console.log(`ℹ️  ${OUT} موجود سلفاً ويشير إلى «${SCHEMA}». لا تغيير.`);
    } else {
      console.error(`❌ ${OUT} موجود ويشير إلى مخطّط آخر. احذفه أولاً إن أردت إعادة التوليد.`);
      process.exit(1);
    }
  }

  // ── إنشاء المخطّط ──────────────────────────────────────────────────
  const client = new Client({ connectionString: directUrl, connectionTimeoutMillis: 20_000 });
  await client.connect();
  try {
    /*
     * ⚠️ اسم المخطّط يُقحَم في النصّ لأن معرّفات SQL لا تُمرَّر كوسائط.
     * فيُتحقَّق منه بتعبير نمطي صارم أولاً — لا حرف خارج [a-z0-9_].
     */
    if (!/^[a-z][a-z0-9_]{2,40}$/.test(SCHEMA)) {
      console.error(`❌ اسم مخطّط غير صالح: «${SCHEMA}»`);
      process.exit(1);
    }
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`);
    console.log(`✅ المخطّط «${SCHEMA}» جاهز.`);
  } finally {
    await client.end();
  }

  // ── كتابة .env.test ───────────────────────────────────────────────
  if (!existsSync(OUT)) {
    const testApp = withSchema(appUrl, SCHEMA);
    const testDirect = withSchema(directUrl, SCHEMA);

    const body = [
      "# مُولَّد بـscripts/setup-test-schema.ts — لا تحرّره يدوياً.",
      "#",
      "# ⚠️ هذا الملفّ يوجّه **اختبارات التكامل وحدها** إلى مخطّط منفصل في",
      "# نفس القاعدة. بيانات التطوير تبقى في `public` ولا تلمسها الاختبارات.",
      "#",
      "# ولا يُلتزَم في git: `.env*` مُستثنى في .gitignore.",
      "",
      `DATABASE_URL=${testApp}`,
      `DIRECT_URL=${testDirect}`,
      "",
      "# ⚠️ يقرؤه `lib/prisma.ts` ليُمرّره إلى المحوّل، و`helpers.ts` ليضبط",
      "# `search_path` للاتصالات الخام. غيابه يعني `public` — وحارس",
      "# `tests/integration/setup-env.ts` يرفض التشغيل حينها.",
      `DB_SCHEMA=${SCHEMA}`,
      "",
    ].join("\n");

    writeFileSync(OUT, body, { encoding: "utf8" });
    console.log(`✅ كُتب ${OUT}`);
    console.log(`   بصمة رابط التطبيق: ${fingerprint(testApp)}…`);
    console.log(`   بصمة الرابط المباشر: ${fingerprint(testDirect)}…`);
  }

  console.log("\nالخطوتان التاليتان:");
  console.log("  npx cross-env USE_TEST_SCHEMA=1 prisma migrate deploy");
  console.log(`  npx cross-env USE_TEST_SCHEMA=1 DB_SCHEMA=${SCHEMA} tsx scripts/apply-constraints.ts`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
