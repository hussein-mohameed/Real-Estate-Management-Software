/**
 * تطبيق القيود الخام على قاعدة البيانات.
 *
 * تُشغَّل **بعد** كل `prisma migrate dev`، لأن Prisma لا يعبّر عن الفهارس
 * الفريدة الجزئية ولا عن CHECK ولا عن الـtriggers. الملف idempotent فإعادة
 * تشغيله بلا ضرر.
 *
 * يستخدم DIRECT_URL — القيود عمل ترحيل لا عمل تطبيق.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });

const url = process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"];
if (!url) {
  console.error("❌ DIRECT_URL غير مضبوط. انسخ .env.example إلى .env أولاً.");
  process.exit(1);
}

const sql = readFileSync(resolve(process.cwd(), "prisma/sql/001-constraints.sql"), "utf8");

async function main() {
  /*
   * ⚠️ **`search_path` صريحاً لا `?schema=` في الرابط.**
   * `?schema=` معامل خاصّ بـPrisma؛ `node-postgres` يتجاهله تماماً. فبلا
   * هذا السطر تُطبَّق القيود على `public` بينما الرابط يقول غير ذلك —
   * ويبدو الأمر ناجحاً.
   */
  const schema = process.env["DB_SCHEMA"] ?? "public";
  if (!/^[a-z][a-z0-9_]{0,40}$/.test(schema)) {
    console.error(`❌ اسم مخطّط غير صالح: «${schema}»`);
    process.exit(1);
  }

  const client = new Client({
    connectionString: url,
    options: `-c search_path=${schema}`,
  });
  try {
    await client.connect();
    await client.query(sql);

    /**
     * ── 🔴 العدّ من القاعدة لا نصّاً ثابتاً ──────────────────────────
     * كانت هذه السطر نصّاً مكتوباً: «11 فهرساً · 18 قيد CHECK · 4 triggers».
     * فطبعها السكربت وهو **لم يُطبّق قيد CHECK واحداً** على مخطّط جديد
     * (حرس الوجود كان غير مقيَّد بمخطّط — انظر رأس ملفّ SQL).
     *
     * رسالةُ نجاحٍ لا تقرأ الواقع ليست تقريراً بل تهنئة. والعدّ من
     * `pg_catalog` يجعل الكذب مستحيلاً: الرقم يهبط فيُرى.
     */
    const counted = await client.query<{ indexes: string; checks: string; triggers: string }>(`
      SELECT
        (SELECT count(*) FROM pg_indexes
          WHERE schemaname = current_schema() AND indexdef LIKE '%WHERE%')::text AS indexes,
        (SELECT count(*) FROM pg_constraint co
          JOIN pg_class cl ON cl.oid = co.conrelid
          JOIN pg_namespace ns ON ns.oid = cl.relnamespace
          WHERE ns.nspname = current_schema() AND co.contype = 'c')::text AS checks,
        (SELECT count(*) FROM pg_trigger tg
          JOIN pg_class cl ON cl.oid = tg.tgrelid
          JOIN pg_namespace ns ON ns.oid = cl.relnamespace
          WHERE ns.nspname = current_schema() AND NOT tg.tgisinternal)::text AS triggers
    `);
    const row = counted.rows[0];
    console.log(
      `✅ القيود الخام على «${schema}»: ` +
        `${row?.indexes ?? "?"} فهرساً جزئياً · ` +
        `${row?.checks ?? "?"} قيد CHECK · ` +
        `${row?.triggers ?? "?"} محفِّزاً.`,
    );
  } catch (error) {
    console.error("❌ فشل تطبيق القيود:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

void main();
