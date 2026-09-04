/**
 * توليد الأسرار المحلّية وكتابتها في `.env.local`.
 *
 * ── لماذا سكربت لا أمر يدوي ──────────────────────────────────────────
 * توليد مفتاحين ونسخهما ولصقهما يدوياً يفتح ثلاثة أبواب للخطأ: لصق ناقص،
 * أو لصق نفس المفتاح في الحقلين، أو مسافة زائدة تكسر التحليل. هنا يُولَّد
 * ويُكتب في موضعه مباشرةً.
 *
 * ⚠️ **لا يستبدل مفتاحاً موجوداً** إلا بـ`--force`. استبدال `AUTH_SECRET`
 * يُبطل **كل الجلسات القائمة** فيخرج كل المستخدمين فوراً — قد يكون هذا
 * مقصوداً (تسريب مفتاح) وقد يكون كارثة تشغيلية.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const FILE = resolve(process.cwd(), ".env.local");
const KEYS = ["AUTH_SECRET", "CRON_SECRET"] as const;
const force = process.argv.includes("--force");

if (!existsSync(FILE)) {
  console.error("❌ .env.local غير موجود. انسخ .env.example إليه أولاً.");
  process.exit(1);
}

let raw = readFileSync(FILE, "utf8");
const done: string[] = [];
const kept: string[] = [];

for (const key of KEYS) {
  const line = new RegExp(`^(\s*${key}\s*=\s*)(.*)$`, "m");
  const match = line.exec(raw);
  const current = match?.[2]?.trim().replace(/^["']|["']$/gu, "") ?? "";

  if (current && !force) {
    kept.push(key);
    continue;
  }

  const secret = randomBytes(48).toString("base64url");
  raw = match ? raw.replace(line, `$1${secret}`) : `${raw.trimEnd()}\n${key}=${secret}\n`;
  done.push(key);
}

writeFileSync(FILE, raw);

if (done.length > 0) console.log(`✅ وُلّد وكُتب: ${done.join(" · ")}`);
if (kept.length > 0) {
  console.log(`⏭  موجود سلفاً فلم يُمسّ: ${kept.join(" · ")}`);
  console.log("   للاستبدال القسري: npm run gen:secrets -- --force");
  console.log("   ⚠️ استبدال AUTH_SECRET يُخرج كل المستخدمين فوراً.");
}
