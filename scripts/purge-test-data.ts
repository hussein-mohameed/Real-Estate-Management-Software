import { Client } from "pg";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  تنظيف بيانات الاختبار العالقة.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ⚠️ لماذا يوجد هذا السكربت ───────────────────────────────────────
 * `cleanupTestData` في `tests/integration/helpers.ts` يُطابق بالبادئة
 * `itest_`. وهي تكفي لما يُعطى معرّفاً صريحاً — لا لما يولّد `cuid()`
 * معرّفه: العقود والحسابات والدفعات والفواتير. تلك تُحذف عبر مُحدِّد غير
 * مباشر، وأي **فشل في تفكيك ملفّ اختبار** يترك سلسلةً منها.
 *
 * والنتيجة أسوأ من فشلٍ صريح: القاعدة تبقى ملوَّثة، فيفشل **ملفٌّ آخر**
 * في تهيئته بعد حين، برسالة مفتاح أجنبي لا تشير إلى سببها. حدث هذا
 * ثلاث مرّات في هذا المشروع.
 *
 * ── ⚠️ والبادئة `itest_` شرطٌ في كل استعلام ─────────────────────────
 * لا استعلام هنا يحذف بلا قيدها. سكربت تنظيف بلا هذا الشرط، يُشغَّل مرّةً
 * على قاعدة الإنتاج بالخطأ، يمحو المجمَّع كلّه.
 *
 * ── والدفتر append-only بمحفِّز ───────────────────────────────────────
 * فيُوقَف المحفِّز ويُعاد في `finally` — وإلا بقي النظام مكشوفاً بعد أول
 * فشل في المنتصف.
 *
 *   npx tsx --env-file=.env.local scripts/purge-test-data.ts
 */

const PREFIX = "itest_%";

/**
 * ⚠️ **بنايات الاختبار تُعرَف ببادئة رمزها `IT`.**
 * `createBuilding` يولّد `cuid()` للبناية، فلا تحمل بادئة `itest_` في
 * المعرّف ولا يصل إليها `cleanupTestData`. والمُحدِّد الباقي هو **الرمز**.
 *
 * ── 🔴 وكانت هنا قائمة رموز ثابتة، وكانت خطأً خطِراً ─────────────────
 * `["APT","CTR","OBL","RAC","RES","RPT"]` — رموزٌ يستعملها مجمَّع حقيقي
 * بسهولة تامّة، و`RES` أوّلها. وسكربتُ حذفٍ يُطابق **بلا شرط بادئة** هو
 * سكربتٌ ينتظر أن يُشغَّل على القاعدة الخطأ. وكتبتُ في هذا التعليق أن
 * القائمة «تُحدَّث يدوياً» ثم سلّمتُ على ذلك — وتحذيرٌ في تعليق ليس
 * ضابطاً على أداةٍ تحذف.
 *
 * فوُحِّدت رموز بنايات الاختبار على بادئة `IT` (نفس اصطلاح الفكسچر في
 * `helpers.ts`: `IT${suffix}`)، وصار الحذف مشروطاً بها. وبنايةٌ حقيقية
 * برمز يبدأ بـ`IT` تبقى احتمالاً — لكنه احتمالٌ **مشروط** لا قائمة
 * كلماتٍ شائعة، والاصطلاح مكتوب في مكان واحد.
 */
const TEST_BUILDING_CODE_PREFIX = "IT%";

/** حسابات الاختبار: بمعرّفها الصريح **أو** بصاحبها. */
const TEST_ACCOUNTS = `
  (SELECT id FROM "Account"
    WHERE "id" LIKE $1 OR "holderUserId" LIKE $1)`;

const STEPS: Array<[label: string, sql: string]> = [
  ["Invoice", `DELETE FROM "Invoice" WHERE "accountId" IN ${TEST_ACCOUNTS}`],
  ["Payment", `DELETE FROM "Payment" WHERE "accountId" IN ${TEST_ACCOUNTS}`],
  ["LedgerEntry", `DELETE FROM "LedgerEntry" WHERE "accountId" IN ${TEST_ACCOUNTS}`],
  [
    "Subscription",
    `DELETE FROM "Subscription"
       WHERE "residentUserId" LIKE $1 OR "accountId" IN ${TEST_ACCOUNTS}`,
  ],
  [
    "Account",
    `DELETE FROM "Account" WHERE "id" LIKE $1 OR "holderUserId" LIKE $1`,
  ],
  [
    "Contract",
    `DELETE FROM "Contract" WHERE "id" LIKE $1 OR "holderUserId" LIKE $1`,
  ],
];

/** ⚠️ بعد العقود والحسابات: الشقة أبٌ لهما. */
const BUILDING_STEPS: Array<[label: string, sql: string]> = [
  [
    "ApartmentResident",
    `DELETE FROM "ApartmentResident" WHERE "apartmentId" IN
       (SELECT id FROM "Apartment" WHERE "buildingId" IN
         (SELECT id FROM "Building" WHERE code LIKE $1))`,
  ],
  [
    "Apartment",
    `DELETE FROM "Apartment" WHERE "buildingId" IN
       (SELECT id FROM "Building" WHERE code LIKE $1)`,
  ],
  [
    "FloorUnitsOverride",
    `DELETE FROM "FloorUnitsOverride" WHERE "buildingId" IN
       (SELECT id FROM "Building" WHERE code LIKE $1)`,
  ],
  ["Building", `DELETE FROM "Building" WHERE code LIKE $1`],
];

async function main(): Promise<void> {
  const url = process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"];
  if (!url) {
    console.error("لا DIRECT_URL ولا DATABASE_URL في البيئة.");
    process.exit(1);
  }

  /* ⚠️ نفس سبب `apply-constraints`: pg يتجاهل `?schema=` في الرابط. */
  const schema = process.env["DB_SCHEMA"] ?? "public";
  if (!/^[a-z][a-z0-9_]{0,40}$/.test(schema)) {
    console.error(`❌ اسم مخطّط غير صالح: «${schema}»`);
    process.exit(1);
  }

  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: 20_000,
    options: `-c search_path=${schema}`,
  });
  await client.connect();

  try {
    await client.query(`ALTER TABLE "LedgerEntry" DISABLE TRIGGER USER`);
    await client.query(`ALTER TABLE "Invoice" DISABLE TRIGGER USER`);

    let total = 0;
    for (const [label, sql] of STEPS) {
      const result = await client.query(sql, [PREFIX]);
      const count = result.rowCount ?? 0;
      total += count;
      if (count > 0) console.log(`  ${label}: ${count}`);
    }

    for (const [label, sql] of BUILDING_STEPS) {
      const result = await client.query(sql, [TEST_BUILDING_CODE_PREFIX]);
      const count = result.rowCount ?? 0;
      total += count;
      if (count > 0) console.log(`  ${label}: ${count}`);
    }

    console.log(total === 0 ? "لا بقايا." : `حُذف ${total} صفّاً.`);
  } finally {
    await client.query(`ALTER TABLE "LedgerEntry" ENABLE TRIGGER USER`);
    await client.query(`ALTER TABLE "Invoice" ENABLE TRIGGER USER`);
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
