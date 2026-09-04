import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * حراسة تناسق البذرة مع حذفها.
 *
 * ── 🔴 العيب الذي وُجد هذا الملف من أجله ────────────────────────────
 * كتلة `--reset` في `prisma/seed.ts` كانت تحذف الأقسام والمهارات
 * والمورّدين بـ`deleteMany({})` **بلا شرط** — أي كل ما في تلك الجداول،
 * بذرَتْه البذرة أو أنشأته الإدارة بيدها. والخدمات بنمط `startsWith("خدمة ")`
 * وهي بادئة أسماء خدمات حقيقية كثيرة.
 *
 * صار الحذف بالاسم الصريح. وهذا الحارس يمنع الانحراف التالي: اسمٌ يُضاف
 * إلى ما تبذره البذرة ولا يُضاف إلى ما تحذفه **يبقى في القاعدة بلا أثر**،
 * فتفشل إعادة البذر برسالة «الاسم مستخدم» ولا يعرف أحد لماذا.
 */

const SEED = readFileSync(
  resolve(import.meta.dirname, "../../prisma/seed.ts"),
  "utf8",
);

describe("البذرة لا تحذف بلا شرط", () => {
  it("🔴 لا `deleteMany({})` في الملفّ", () => {
    /* التعليقات تذكره عمداً لتشرح العيب — فتُنزَع أولاً. */
    const code = SEED.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
    const bare = [...code.matchAll(/deleteMany\(\s*\{\s*\}\s*\)/g)];
    expect(bare.map((m) => m[0]), "حذفٌ بلا شرط يمحو ما أنشأته الإدارة").toEqual([]);
  });

  it("⚠️ لا حذف خدمات بـ`startsWith`", () => {
    const code = SEED.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
    expect(
      /service\.deleteMany[\s\S]{0,120}startsWith/.test(code),
      "«خدمة» بادئة أسماء حقيقية — الحذف بالاسم الصريح",
    ).toBe(false);
  });
});

describe("ما تبذره البذرة هو ما تحذفه", () => {
  /** يقرأ عناصر مصفوفة ثابتة معلنة باسمها. */
  function items(constName: string): string[] {
    const at = SEED.indexOf(`const ${constName}`);
    if (at === -1) return [];
    const end = SEED.indexOf("] as const", at);
    const body = SEED.slice(at, end === -1 ? at + 2000 : end);
    return [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? "");
  }

  it("أسماء الخدمات المُنشأة كلّها في قائمة الحذف", () => {
    const declared = items("SERVICE_NAMES");
    expect(declared.length, "SERVICE_NAMES فارغة أو لم تُقرأ").toBeGreaterThan(3);

    /* كل `name:` داخل مصفوفة الخدمات يجب أن يكون في القائمة */
    const at = SEED.indexOf("const services = [");
    const block = SEED.slice(at, SEED.indexOf("] as const", at));
    const created = [...block.matchAll(/name: "([^"]+)"/g)].map((m) => m[1] ?? "");

    expect(created.length, "لم تُقرأ خدمات البذرة").toBeGreaterThan(3);
    const missing = created.filter((n) => !declared.includes(n));
    expect(missing, "خدمة تُبذر ولا تُحذف — ستبقى وتُفشل إعادة البذر").toEqual([]);
  });

  it("اسم المورّد ثابتٌ واحد لا نصّان", () => {
    /* ⚠️ نصّان متطابقان اليوم يفترقان غداً. */
    expect(SEED).toContain("const VENDOR_NAME =");
    expect(SEED).toContain("{ name: VENDOR_NAME,");
  });
});
