import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * حراسة نصّ الواجهة — لا ترميز Markdown داخل JSX.
 *
 * ── ⚠️ لماذا يوجد هذا الملف ─────────────────────────────────────────
 * كتبتُ توكيد Markdown داخل نصّ JSX **أربع مرّات** في هذا المشروع (صفحة
 * المالك، نماذج الصندوق، أفعال الاشتراكات). JSX لا يُصرّف Markdown، فيقرأ
 * المستخدم النجمات حرفياً.
 *
 * ولا شيء يكشفه: الأنواع تمرّ، والبناء ينجح، وESLint لا يقرأ نصّ الواجهة.
 * كنتُ أكتشفه بالعين أو بفحصٍ يدوي أُجريه ثم أنساه — وهذا ليس ضابطاً.
 *
 * ── ⚠️ والتعليقات تُنزَع أولاً ───────────────────────────────────────
 * تعليقات هذا المشروع تستعمل التوكيد بكثافة، وهي شروح لا تُعرض. فحصٌ لا
 * ينزعها يُنتج مئات النتائج الكاذبة فيُهمَل الفحص كلّه — وهذه هي الطريقة
 * التي تموت بها الضوابط.
 */

const ROOT = resolve(import.meta.dirname, "../..");
const SKIP = new Set(["node_modules", ".next", ".git", "dist"]);

function tsxFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) tsxFiles(path, acc);
    else if (entry.endsWith(".tsx")) acc.push(path);
  }
  return acc;
}

/** ينزع تعليقات الكتلة والسطر، فلا يبقى إلا ما قد يُعرض. */
function strip(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

/**
 * ⚠️ **يُطابَق داخل نصّ JSX وحده** — بين `>` و`<` وبلا أقواس معقوفة.
 * النجمتان تظهران شرعياً في الكود، فمطابقةٌ على الملف كلّه بلا سياق تكذب.
 */
const JSX_TEXT = />([^<>{}]*)</g;
const MARKDOWN: Array<{ name: string; re: RegExp }> = [
  { name: "توكيد بنجمتين", re: /\*\*[^*\n]+\*\*/ },
  { name: "توكيد بشرطتين سفليتين", re: /__[^_\n]+__/ },
  { name: "عنوان بشبّاك", re: /^\s*#{1,6}\s+\S/ },
];

describe("نصّ الواجهة لا يحمل ترميز Markdown", () => {
  const files = tsxFiles(ROOT);

  it("يجد ملفّات لِيفحصها", () => {
    /* ⚠️ بلا هذا يمرّ الفحص كلّه حين يفشل المشي في الشجرة، فيبدو نظيفاً. */
    expect(files.length).toBeGreaterThan(20);
  });

  for (const file of files) {
    const rel = relative(ROOT, file).split("\\").join("/");

    it(`نظيف: ${rel}`, () => {
      const found: string[] = [];

      for (const match of strip(readFileSync(file, "utf8")).matchAll(JSX_TEXT)) {
        const text = match[1];
        if (!text || text.trim() === "") continue;
        for (const rule of MARKDOWN) {
          if (rule.re.test(text)) found.push(`${rule.name}: «${text.trim().slice(0, 60)}»`);
        }
      }

      expect(found, `ترميز Markdown يُعرض حرفياً في ${rel}`).toEqual([]);
    });
  }
});
