import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * حراسة الانزلاق الأفقي.
 *
 * ── 🔴 العيب الذي وُجد هذا الملف من أجله ────────────────────────────
 * `TableCard` تحمل `overflow-x-auto` — وكانت **لا تعمل**. البطاقة عنصر في
 * `flex flex-col`، وافتراض عنصر الـflex هو `min-width: auto`: يرفض
 * الانكماش دون عرض محتواه. فجدولٌ بـ`min-w-[68rem]` وسّع البطاقة، فوسّعت
 * الصفحة، فانزلق **جسم الصفحة كلّه أفقياً** والقائمة الجانبية معه.
 *
 * ولم يكشفه شيء: لا الأنواع، ولا البناء، ولا اختبار. ولا يظهر أصلاً إلا
 * حين تكون الشاشة أضيق من الجدول — فيمرّ على شاشة المطوّر العريضة ويظهر
 * عند المستخدم. رآه المستخدم في `/admin/services` قبل أن يراه أي فحص.
 *
 * ── وما يُفحص هنا ───────────────────────────────────────────────────
 * أن كل حاوية `overflow-x-auto` في مكوّنات الواجهة تحمل `min-w-0` معها.
 * القاعدة عامّة: `overflow-x` بلا `min-w-0` داخل flex **لا تفعل شيئاً**.
 */

const FILES = ["components/ui/page.tsx", "components/ui/table.tsx"];
const ROOT = resolve(import.meta.dirname, "../..");

/** ينزع التعليقات — الشرح أعلاه يذكر الصنفين معاً عمداً. */
function strip(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

describe("حاويات overflow-x تحمل min-w-0", () => {
  for (const file of FILES) {
    it(`نظيف: ${file}`, () => {
      const src = strip(readFileSync(resolve(ROOT, file), "utf8"));
      const offenders: string[] = [];

      /* كل سلسلة أصناف تحمل `overflow-x-` يجب أن تحمل `min-w-0` كذلك. */
      for (const m of src.matchAll(/"([^"]*overflow-x-[^"]*)"/g)) {
        const classes = m[1] ?? "";
        if (!classes.includes("min-w-0")) offenders.push(classes.trim());
      }

      expect(
        offenders,
        `overflow-x بلا min-w-0 في ${file} — لن ينزلق الجدول، ستنزلق الصفحة`,
      ).toEqual([]);
    });
  }
});
