/**
 * يحقن DATABASE_PASSWORD في DATABASE_URL و DIRECT_URL بترميز صحيح.
 *
 * لماذا سكربت: كلمة مرور Supabase قد تحتوي محارف (‏@ : / ? # %) تكسر تحليل
 * الـURL إن لُصقت خاماً — فتفشل المصادقة برسالة مضلّلة. `encodeURIComponent`
 * يعالجها. ولصقها في موضعين يدوياً يعني احتمال اختلافهما.
 *
 * لا يطبع أي قيمة سرّية.
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local"], quiet: true });
import { Client } from "pg";

const FILE = ".env.local";

function main(): void {
  if (!existsSync(FILE)) {
    console.error(`❌ ${FILE} غير موجود.`);
    process.exit(1);
  }

  const pw = process.env["DATABASE_PASSWORD"]?.trim();
  if (!pw) {
    console.error(
      "❌ DATABASE_PASSWORD فارغ.\n" +
        "   احصل عليها من: Supabase → Project Settings → Database → Reset database password\n" +
        "   ثم ضعها في .env.local:  DATABASE_PASSWORD=...",
    );
    process.exit(1);
  }

  if (pw.startsWith("[") || /YOUR|PASSWORD|xxx|change/i.test(pw)) {
    console.error(`❌ القيمة تبدو نائبة لا كلمة مرور حقيقية (طولها ${pw.length}).`);
    process.exit(1);
  }

  copyFileSync(FILE, `${FILE}.bak`);
  const enc = encodeURIComponent(pw);
  let raw = readFileSync(FILE, "utf8");
  let changed = 0;

  raw = raw.replace(
    /^(\s*(?:DATABASE_URL|DIRECT_URL)\s*=\s*"?)([^\r\n"]*)("?)\s*$/gm,
    (match, head: string, value: string, tail: string) => {
      try {
        const u = new URL(value);
        if (!u.protocol.startsWith("postgres")) return match;
        u.password = enc;
        changed += 1;
        return `${head}${u.toString()}${tail}`;
      } catch {
        return match;
      }
    },
  );

  writeFileSync(FILE, raw);
  console.log(`✅ حُقنت كلمة المرور في ${changed} رابط. (نسخة احتياطية: ${FILE}.bak)`);
  void verify(raw);
}

async function verify(raw: string): Promise<void> {
  const get = (k: string): string | undefined =>
    new RegExp(`^\s*${k}\s*=\s*"?([^\r\n"]*)"?`, "m").exec(raw)?.[1]?.trim();

  for (const key of ["DATABASE_URL", "DIRECT_URL"]) {
    const url = get(key);
    if (!url) continue;
    const client = new Client({ connectionString: url, connectionTimeoutMillis: 15000 });
    try {
      await client.connect();
      await client.query("select 1");
      console.log(`   ✓ ${key} — الاتصال ناجح`);
    } catch (e) {
      console.log(`   ✗ ${key} — ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      await client.end().catch(() => {});
    }
  }
}

main();
