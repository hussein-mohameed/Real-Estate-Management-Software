import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

/**
 * بنية الاختبار (الخطوة N1).
 *
 * ⚠️ اختبارات **الوحدة** فقط تعمل هنا. اختبارات التكامل (التزامن، المعاملات،
 * الفهارس الفريدة الجزئية) تحتاج Postgres حقيقياً — لا وهميات — ولا Docker
 * ولا psql على جهاز التطوير الحالي. القرار معلّق: راجع docs/OPEN-DECISIONS.md
 * (النتيجة F3). حتى يُحسم، **نصف تعريفات الإنجاز غير قابلة للتحقّق**.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "scripts/**/*.test.ts", "tests/unit/**/*.test.ts"],
    exclude: ["node_modules/**", "lib/generated/**", "tests/integration/**"],
  },
  resolve: {
    alias: { "@": resolve(import.meta.dirname, ".") },
  },
});
