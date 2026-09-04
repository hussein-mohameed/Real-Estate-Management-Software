import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  مزامنة مخطّط الاختبار مع المخطّط الحالي — يُشغَّل بعد كل هجرة.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ⚠️ لماذا أمرٌ واحد لا أمران ─────────────────────────────────────
 * الهجرة وحدها **لا تكفي**: القيود الخام (الفهارس الفريدة الجزئية وقيود
 * CHECK والمحفِّزات) لا يعرفها Prisma ولا تسري بالترحيل. فمخطّطٌ مُرحَّل
 * بلا قيود يقبل ما ترفضه القاعدة الحقيقية — واختباراتٌ تُثبت أن القيد
 * يمنع الخرق **تمرّ وهي لا تفحص شيئاً**.
 *
 * وهذا أسوأ من الفشل: حزمةٌ خضراء تشهد على حمايةٍ غير موجودة. فالأمران
 * أمرٌ واحد كي لا يُنسى الثاني.
 *
 * ── ولماذا لا `cross-env` ───────────────────────────────────────────
 * ليست في تبعيّات المشروع، فـ`npx` يجلبها من الشبكة في كل تشغيل. وضبط
 * متغيّر بيئة لا يستحقّ تبعيّة ولا رحلة شبكة: `process.env` هنا يكفي،
 * والعمليات الفرعية ترثه.
 *
 *   npm run db:test:sync
 */

if (!existsSync(".env.test")) {
  console.error(
    [
      "❌ لا وجود لـ.env.test — مخطّط الاختبار غير مُعدّ بعد.",
      "",
      "الإعداد يُشغَّل مرّة واحدة:",
      "  npm run db:test:setup",
    ].join("\n"),
  );
  process.exit(1);
}

/*
 * ⚠️ `USE_TEST_SCHEMA` يقرؤه `prisma.config.ts` فيقدّم `.env.test` على
 * `.env.local`. و`DB_SCHEMA` يقرؤه `apply-constraints.ts` ليضبط
 * `search_path` — لأن `?schema=` في الرابط يتجاهله `node-postgres`.
 */
process.env["USE_TEST_SCHEMA"] = "1";
process.env["DB_SCHEMA"] ??= "integration_test";

const steps: Array<[label: string, command: string, args: string[]]> = [
  ["الترحيلات", "npx", ["prisma", "migrate", "deploy"]],
  ["القيود الخام", "npx", ["tsx", "--env-file=.env.test", "scripts/apply-constraints.ts"]],
];

for (const [label, command, args] of steps) {
  console.log(`\n── ${label} ──`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env,
    // ⚠️ `shell: true` على ويندوز: `npx` ملفّ `.cmd` لا ملفّ تنفيذي.
    shell: true,
  });

  if (result.status !== 0) {
    console.error(`\n❌ فشل: ${label}`);
    process.exit(result.status ?? 1);
  }
}

console.log(`\n✅ مخطّط «${process.env["DB_SCHEMA"]}» مزامَن — ترحيلاتٍ وقيوداً.`);
