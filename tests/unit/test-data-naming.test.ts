import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * حراسة اصطلاح تسمية بيانات الاختبار.
 *
 * ── 🔴 لماذا يوجد هذا الملف ─────────────────────────────────────────
 * `Building` لا يحمل بادئة `itest_` في معرّفه: `createBuilding` يولّد
 * `cuid()`. فالمُحدِّد الوحيد الباقي لتمييز بناية اختبار هو **رمزها**.
 *
 * وكانت رموز الاختبار كلماتٍ شائعة — `RES` و`APT` و`CTR` — وكتبتُ سكربت
 * تنظيف يحذف بها **بلا شرط بادئة**. أي أداةَ حذفٍ تُطابق «RES» على قاعدة
 * مجمَّعٍ حقيقي تمحو بنايته وشققه. لم يحدث ذلك، لكنه كان ينتظر.
 *
 * فوُحِّد الاصطلاح: رمز كل بناية اختبار يبدأ بـ`IT` — نفس ما يفعله
 * الفكسچر في `helpers.ts` (`IT${suffix}`). وهذا الحارس يُبقيه صحيحاً:
 * رمزٌ جديد بلا البادئة يجعل بنايته غير قابلة للتنظيف، فتعلق وتُفشل
 * التشغيل القادم برسالة «الرمز مستخدم» لا تشير إلى سببها.
 */

const DIR = resolve(import.meta.dirname, "../integration");

/** ينزع التعليقات — الشروح تذكر الرموز القديمة عمداً. */
function strip(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

/**
 * ── 🔴 والرمز الصريح لا يساوي رمز الفكسچر ──────────────────────────
 * `createFixture(client, suffix)` يُنشئ بنايةً برمز `IT${suffix}`. فملفٌّ
 * يستدعي `createFixture(client, "apt")` ثم `createBuilding({code: "ITapt"})`
 * يصطدم **ببنايته هو** — والرسالة «الرمز مستخدم لبناية أخرى» تُقرأ
 * كأنها بقايا من تشغيل سابق، فيُبحث في المكان الخطأ.
 *
 * وقع ذلك فعلاً حين وحّدتُ الرموز على بادئة `IT`: صارت ثلاثة ملفّات
 * تستعمل رمز فكسچرها حرفياً، وسقطت أربع حزم و64 اختباراً.
 */
describe("الرمز الصريح لا يصطدم برمز الفكسچر", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".test.ts"));

  for (const file of files) {
    it(`لا تصادم: ${file}`, () => {
      const body = strip(readFileSync(resolve(DIR, file), "utf8"));

      const suffixes = [...body.matchAll(/createFixture\(\s*client\s*,\s*"([a-z]+)"/g)].map(
        (m) => `IT${m[1] ?? ""}`,
      );
      const codes = [...body.matchAll(/code:\s*"([^"]+)"/g)].map((m) => m[1] ?? "");

      const clash = codes.filter((c) => suffixes.includes(c));
      expect(
        clash,
        `الرمز يساوي رمز بناية الفكسچر في ${file} — سيصطدم ببنايته هو`,
      ).toEqual([]);
    });
  }
});

describe("رموز بنايات الاختبار تبدأ بـIT", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".test.ts"));

  it("يجد ملفّات لِيفحصها", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const file of files) {
    it(`نظيف: ${file}`, () => {
      const body = strip(readFileSync(resolve(DIR, file), "utf8"));
      const bad: string[] = [];

      for (const m of body.matchAll(/code:\s*"([^"]+)"/g)) {
        const code = m[1];
        if (code && !code.startsWith("IT")) bad.push(code);
      }

      expect(
        bad,
        `رموز بلا بادئة IT في ${file} — بنايتها لن تُنظَّف وستُفشل التشغيل القادم`,
      ).toEqual([]);
    });
  }
});

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  أسماء الأقسام والمهارات والمورّدين تحوي «اختبار».
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── 🔴 لماذا ────────────────────────────────────────────────────────
 * `createDepartment` و`createSkill` و`createVendor` تولّد `cuid()`، فلا
 * يصل إليها `cleanupTestData` بالبادئة. والمُحدِّد الوحيد الباقي هو
 * **الاسم**، فيحذف المُنظِّف ما يحوي «اختبار».
 *
 * واسمٌ بلا هذه الكلمة يبقى بعد التشغيل، فيفشل التشغيل التالي بـ«القسم
 * موجود بالفعل» — رسالةٌ تبدو عيباً في الكود وهي بقايا. وقع ذلك فعلاً.
 *
 * ⚠️ والاسم يُقرأ من الكود لا من القاعدة: الفحص ساكن ويعمل بلا شبكة.
 */
describe("أسماء المرجعيّات في الاختبارات تحوي «اختبار»", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".test.ts"));

  for (const file of files) {
    it(`نظيف: ${file}`, () => {
      const body = strip(readFileSync(resolve(DIR, file), "utf8"));
      const bad: string[] = [];

      /*
       * ⚠️ التعبير يُبنى بـ`RegExp` من ثابت واحد لا بقالب لكل مُنشئ:
       * تكرارُ نصّه ثلاث مرّات يعني ثلاثة مواضع تتفرّق عند أوّل تعديل.
       */
      const NAMED_CREATE = /(createDepartment|createSkill|createVendor)\(\s*\{[^}]*?name:\s*"([^"]+)"/gs;

      for (const m of body.matchAll(NAMED_CREATE)) {
        const creator = m[1] ?? "";
        const name = m[2] ?? "";
        if (!name.includes("اختبار")) bad.push(`${creator}: «${name}»`);
      }

      expect(
        bad,
        `اسمٌ بلا «اختبار» في ${file} — لن يحذفه cleanupTestData، ` +
          `وسيفشل التشغيل التالي بـ«موجود بالفعل».`,
      ).toEqual([]);
    });
  }
});
