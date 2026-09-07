import { describe, expect, it } from "vitest";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { ALL_NAVS } from "@/lib/nav";

/**
 * اتساق شريط التنقّل مع الصفحات الموجودة فعلاً.
 *
 * ⚠️ **العيب الذي يحرسه هذا الملف كان قائماً: 23 رابطاً يعطي 404.**
 * أسماء شاشات كُتبت في التخطيطات قبل أن تُبنى الشاشات. لا يفشل بناء ولا
 * نوع — الرابط نصّ صالح يشير إلى لا شيء. والأثر ليس تجميلياً: المستخدم
 * الذي يجد نصف الروابط معطّلة يكفّ عن تجربتها، فيفوته ما بُني فعلاً.
 *
 * ويحرس الاتجاه المعاكس أيضاً: صفحةً بُنيت ولا يشير إليها أي شريط، فلا
 * يجدها أحد إلا بكتابة العنوان بيده.
 */

const APP_DIR = resolve(import.meta.dirname, "../../app");

/**
 * كل المسارات التي لها `page.tsx`.
 *
 * ⚠️ مجموعات المسارات `(admin)` **لا تضيف مقطعاً للعنوان** — تُسقَط.
 * وهذا بالضبط ما يجعل الاشتقاق اليدوي للمسار من مسار الملف خاطئاً لو
 * كُتب بالحدس.
 */
function collectRoutes(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // مجموعة مسارات: لا تظهر في العنوان
      const segment = entry.startsWith("(") && entry.endsWith(")") ? "" : `/${entry}`;
      out.push(...collectRoutes(full, prefix + segment));
    } else if (entry === "page.tsx") {
      out.push(prefix === "" ? "/" : prefix);
    }
  }
  return out;
}

const routes = new Set(collectRoutes(APP_DIR));

/** مسارات لا يُتوقَّع أن يشير إليها شريط تنقّل. */
const NOT_IN_ANY_NAV = new Set([
  "/", // يعيد التوجيه حسب الدور
  "/login",
  "/pending",
  "/admin/apartments/[id]", // يُوصَل إليه من الجدول لا من الشريط
  "/admin/installments/[id]", // يُوصَل إليه من قائمة الأقساط — وفيه وحده يُسدَّد
  "/admin/staff/[id]", // يُوصَل إليه من جدول الموظفين
  "/admin/requests/[id]", // يُوصَل إليه من جدول الطلبات
  "/admin/requests/new", // زرّ «طلب جديد» في شاشة الطلبات
  "/admin/installments/new", // يُوصَل إليه من شاشة المتابعة
  "/admin/installments/migrate", // N3: يُستعمل مرّة عند إدخال النظام — رابطه في شاشة المتابعة لا في الشريط
  "/app/requests/new", // زرّ «طلب جديد» في شاشة طلبات الساكن وفي حالتها الفارغة
  "/app/subscriptions/new", // زرّ «طلب اشتراك» في شاشة اشتراكات الساكن
  "/app/vehicles/new", // زرّ «تسجيل مركبة» في شاشة سيارات الساكن وفي حالتها الفارغة
]);

describe("كل رابط في شريط التنقّل يشير إلى صفحة موجودة", () => {
  for (const [name, items] of Object.entries(ALL_NAVS)) {
    it(name, () => {
      const dead = items.filter((i) => !routes.has(i.href));
      expect(
        dead.map((d) => `${d.href} («${d.label}»)`),
        `روابط بلا صفحة في ${name}. أضف الرابط **مع** الصفحة لا قبلها؛ ` +
          `ما ينتظر قراراً أو خطوة يُسجَّل في docs/EXECUTION-ROADMAP.md.`,
      ).toEqual([]);
    });
  }
});

describe("كل صفحة مبنيّة يشير إليها شريط تنقّل", () => {
  it("لا صفحة يتيمة", () => {
    const linked = new Set(
      Object.values(ALL_NAVS).flatMap((items) => items.map((i) => i.href)),
    );
    const orphans = [...routes].filter(
      (r) => !linked.has(r) && !NOT_IN_ANY_NAV.has(r) && !r.startsWith("/api"),
    );
    expect(
      orphans,
      "صفحات لا يشير إليها أي شريط — لن يجدها أحد إلا بكتابة العنوان بيده. " +
        "أضفها إلى lib/nav.ts أو إلى NOT_IN_ANY_NAV مع سبب.",
    ).toEqual([]);
  });
});

describe("سلامة القوائم نفسها", () => {
  it("لا رابط مكرّر داخل قائمة واحدة", () => {
    for (const [name, items] of Object.entries(ALL_NAVS)) {
      const hrefs = items.map((i) => i.href);
      expect(new Set(hrefs).size, `تكرار في ${name}`).toBe(hrefs.length);
    }
  });

  it("كل تسمية عربية — لا رمز ولا إنكليزية في واجهة عربية", () => {
    for (const [name, items] of Object.entries(ALL_NAVS)) {
      for (const i of items) {
        expect(i.label, `${name}: «${i.label}»`).not.toMatch(/[A-Za-z]{3,}/);
        expect(i.label.trim().length, `${name}: تسمية فارغة`).toBeGreaterThan(0);
      }
    }
  });

  it("لم تعد أي قائمة مكتوبة داخل layout — المصدر واحد", () => {
    // ⚠️ المصدر الواحد لا يبقى واحداً بالنيّة: يكفي أن يضيف أحدهم
    // `nav={[…]}` مضمّنة في تخطيط جديد ليعود الانقسام صامتاً.
    const layouts = [
      "app/(admin)/layout.tsx",
      "app/(owner)/layout.tsx",
      "app/(staff)/layout.tsx",
      "app/(resident)/layout.tsx",
    ];
    for (const rel of layouts) {
      const src = readFileSync(resolve(import.meta.dirname, "../..", rel), "utf8");
      expect(src, `${rel} يحمل قائمة مضمّنة`).not.toMatch(/nav=\{\s*\[/);
      expect(src, `${rel} لا يستورد من lib/nav`).toMatch(/from "@\/lib\/nav"/);
    }
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  لا مجموعة تتكرّر متباعدةً.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── 🔴 العيب الذي وُجد هذا الفحص من أجله ────────────────────────────
 * `groupNav` في `app-sidebar.tsx` يجمع **بالتجاور** لا بالاسم: مجموعة
 * جديدة تبدأ حين يتغيّر اسم المجموعة. وذلك مقصود — الفرز بالاسم كان
 * سيُعيد ترتيب البنود ويكسر ترتيباً مكتوباً عمداً («مهام اليوم» أوّلاً).
 *
 * وثمنُه أن بنداً يُوضَع في **وسط** مجموعة أخرى يُنتج مجموعتين بنفس
 * الاسم — فيرمي React «مفتاحان متطابقان»، ويُصيَّر عنوان المجموعة مرّتين
 * في الشريط.
 *
 * وقع ذلك فعلاً: وُضع «الطلبات والشكاوى» (مجموعة المتابعة) بين
 * «الأقسام والمهامّ» و«المستخدمون» (مجموعة الناس)، فانقسمت «الناس» إلى
 * مجموعتين وظهرت «المتابعة» مرّتين.
 *
 * ⚠️ ولا الأنواع ولا البناء يكشفانه: الحقل نصّ صالح في كلتا الحالتين.
 * ولم يظهر إلا في وحدة تحكّم المتصفّح عند المستخدم.
 */
describe("لا مجموعة تتكرّر متباعدةً في أي شريط", () => {
  for (const [name, items] of Object.entries(ALL_NAVS)) {
    it(name, () => {
      /* نفس منطق `groupNav`: التجاور يبدأ مجموعة */
      const runs: Array<string | null> = [];
      for (const item of items) {
        const group = item.group ?? null;
        if (runs.at(-1) !== group) runs.push(group);
      }

      /*
       * ⚠️ **البنود بلا مجموعة مستثناة.** الشريط يعرض لها مجموعتين بلا
       * عنوان — «الرئيسية» في الأعلى و«ملفي» في الأسفل — ولا عنوان يتكرّر
       * لأن لا عنوان أصلاً. والمفتاح مأخوذ من الرابط لا من العنوان، فلا
       * يتصادم. أمّا العنوان المتكرّر فيبقى ممنوعاً كما كان.
       */
      const seen = new Set<string>();
      const repeated = runs.filter((g): g is string => {
        if (g === null) return false;
        if (seen.has(g)) return true;
        seen.add(g);
        return false;
      });

      expect(
        repeated,
        `مجموعة تظهر مرّتين متباعدتين في ${name} — الشريط يعرض عنوانها مرّتين ` +
          `وReact يرمي «مفتاحان متطابقان». اجمع بنودها متجاورة في lib/nav.ts.`,
      ).toEqual([]);
    });
  }
});

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  الأيقونات — مفتاحٌ مستقلّ يجب أن يُصيَّر صورةً مستقلّة.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── 🔴 العيب الذي وُجد هذا الفحص من أجله ────────────────────────────
 * كانت إحدى عشرة أيقونة تخدم خمساً وعشرين وجهة: `ListChecks` على
 * «الاشتراكات» و«الطلبات» و«الأقسام» و«طلباتي»، و`Wallet` على «كشف حسابي»
 * و«الأقساط» و«صندوق النقد» — و`Home` على **«سيارتي»**.
 *
 * والاتحاد النصّي `NavIconKey` يحرس أن المفتاح مكتوب صحيحاً، ولا يحرس أن
 * مفتاحين مختلفين يعطيان صورتين مختلفتين. فمرّ التكرار عبر الأنواع
 * والبناء والتدقيق، ولم يظهر إلا في الشاشة.
 *
 * ⚠️ وأثرُه ليس تجميلياً: أيقونةٌ تَعِد بتمييز ثم تُخلفه تُعلّم المستخدم
 * تجاهلها، فيعود إلى قراءة الشريط سطراً سطراً — وهو ما وُجدت لتمنعه.
 */
describe("الأيقونات", () => {
  const src = readFileSync(
    resolve(import.meta.dirname, "../..", "components/shell/app-sidebar.tsx"),
    "utf8",
  );

  /** يقرأ جسم `const ICONS: Record<NavIconKey, LucideIcon> = { … }`. */
  const body = /const ICONS: Record<NavIconKey, LucideIcon> = \{([\s\S]*?)\n\};/u.exec(src);

  it("خريطة الأيقونات مقروءة من المصدر", () => {
    expect(body, "تغيّر شكل تعريف ICONS — حدّث هذا الفحص معه").not.toBeNull();
  });

  it("🔴 لا أيقونة تخدم مفتاحين", () => {
    const pairs = [...(body?.[1] ?? "").matchAll(/^\s*(\w+):\s*(\w+),/gmu)];
    expect(pairs.length, "لم تُقرأ أي أزواج من ICONS").toBeGreaterThan(0);

    const byIcon = new Map<string, string[]>();
    for (const [, key, component] of pairs) {
      byIcon.set(component!, [...(byIcon.get(component!) ?? []), key!]);
    }

    const shared = [...byIcon.entries()].filter(([, keys]) => keys.length > 1);
    expect(
      shared.map(([component, keys]) => `${component} ← ${keys.join(" · ")}`),
      "أيقونة واحدة على مفتاحين: المفتاحان يبدوان مختلفين في lib/nav.ts ويُصيَّران متطابقين في الشريط.",
    ).toEqual([]);
  });

  it("كل مفتاح مستعمل في قائمة له صورة", () => {
    const mapped = new Set(
      [...(body?.[1] ?? "").matchAll(/^\s*(\w+):/gmu)].map((m) => m[1]!),
    );
    for (const [name, items] of Object.entries(ALL_NAVS)) {
      for (const item of items) {
        expect(mapped.has(item.icon), `${name}: «${item.icon}» بلا صورة`).toBe(true);
      }
    }
  });
});
