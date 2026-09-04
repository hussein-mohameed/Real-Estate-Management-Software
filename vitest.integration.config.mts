import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

/**
 * اختبارات التكامل (‏N1) — تحتاج **Postgres حقيقياً**.
 * مفصولة عن اختبارات الوحدة حتى تبقى الأخيرة سريعة وبلا شبكة.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    /*
     * ⚠️ يحمّل البيئة **ويرفض** التشغيل على مخطّط التطوير.
     * انظر رأس `tests/integration/setup-env.ts` — لماذا هنا لا في `helpers`.
     */
    setupFiles: ["tests/integration/setup-env.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false, // معاملة واحدة على اتصال واحد
  },
  resolve: { alias: { "@": resolve(import.meta.dirname, ".") } },
});
