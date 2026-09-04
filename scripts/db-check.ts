/** فحص اتصال — قراءة فقط، لا يكتب شيئاً. */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });
import { Client } from "pg";

async function probe(label: string, url: string | undefined) {
  if (!url) { console.log(`${label}: ✗ غير مضبوط`); return; }
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 15000 });
  try {
    await client.connect();
    const v = await client.query("select version(), current_database() as db, current_user as usr");
    const t = await client.query(
      "select count(*)::int as n from information_schema.tables where table_schema='public'",
    );
    const row = v.rows[0] as { version: string; db: string; usr: string };
    console.log(`${label}: ✓ متصل`);
    console.log(`   الإصدار : ${row.version.split(" ").slice(0, 2).join(" ")}`);
    console.log(`   القاعدة : ${row.db}   المستخدم: ${row.usr}`);
    console.log(`   جداول public الموجودة: ${(t.rows[0] as { n: number }).n}`);
  } catch (e) {
    console.log(`${label}: ✗ فشل — ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  await probe("DATABASE_URL (مجمّع)", process.env["DATABASE_URL"]);
  console.log("");
  await probe("DIRECT_URL (ترحيلات)", process.env["DIRECT_URL"]);
}

void main();
