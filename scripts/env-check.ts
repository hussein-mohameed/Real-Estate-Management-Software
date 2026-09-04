/** فحص بيئة — يعرض الحالة والمصدر، **ولا يطبع أي قيمة**. */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });
import { CRITICAL_KEYS, inspectEnv } from "../lib/env";

const rows = inspectEnv();
const missingCritical = rows.filter((r) => CRITICAL_KEYS.includes(r.key) && !r.set);

console.log("\n═══ فحص متغيّرات البيئة ═══\n");
for (const r of rows) {
  const critical = CRITICAL_KEYS.includes(r.key);
  const mark = r.set ? "✅" : critical ? "❌" : "⏳";
  const alias = r.foundAs && r.foundAs !== r.key ? `  (باسم ${r.foundAs})` : "";
  console.log(`  ${mark} ${r.key}${alias}`);
  if (!r.set && critical) console.log(`      ← ${r.where}`);
}

const set = rows.filter((r) => r.set).length;
console.log(`\n${set}/${rows.length} مضبوط · ${missingCritical.length} حرج ناقص\n`);
if (missingCritical.length > 0) process.exit(1);
