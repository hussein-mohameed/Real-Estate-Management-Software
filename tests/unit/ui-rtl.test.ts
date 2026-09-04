import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * حراسة مكوّنات shadcn/ui — الخطوة 0.13.
 *
 * ⚠️ **لماذا يوجد هذا الملف.**
 * مكوّنات shadcn تُنسَخ من مستودع أعلى المجرى، وهي **مكتوبة لواجهات LTR**:
 * `pl-8` و`right-4` و`text-left`. عُدِّلت يدوياً إلى خصائص منطقية عند
 * النسخ — لكن أي `shadcn add` أو `shadcn diff` لاحق يعيد نسخ الأصل
 * **ويُرجع الاتجاهات الفيزيائية صامتاً**، فتنقلب الواجهة دون أن يفشل
 * أي شيء: لا البناء، ولا الأنواع، ولا اختبار آخر.
 *
 * هذا بالضبط ما حدث مرّتين سابقاً (الهاتف والتاريخ، ثم قالب الترقيم):
 * أخطاء اتجاه لم يكشفها إلا نظر المستخدم إلى الشاشة. هذا الملف يجعل
 * الانقلاب فشلاً في CI بدل اكتشافٍ بالعين.
 */

const UI_DIR = resolve(import.meta.dirname, "../../components/ui");
const CSS = readFileSync(resolve(import.meta.dirname, "../../app/globals.css"), "utf8");

const files = readdirSync(UI_DIR).filter((f) => f.endsWith(".tsx"));

/** ‏globals.css بلا تعليقات — الفحوص البنيوية تقرأ القواعد لا الشروح. */
const STRIPPED = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * استثناءات: مواضع الاتجاه فيها **فيزيائي بحق** لا منطقي.
 * Radix يحسب `data-side` من موضع النافذة على الشاشة فعلياً، فحركة
 * الانزلاق ومحور التحويل يجب أن تبقيا فيزيائيتين. وتوسيط الحوار بـ
 * `left-[50%]` متماثل، فلا معنى لقلبه.
 */
const PHYSICAL_ON_PURPOSE = [
  /slide-in-from-(left|right)-\d/g,
  /data-\[side=(left|right)\]:-?translate-x-\d/g,
  /data-\[side=(left|right)\]:slide-in-from-(left|right)-\d/g,
  /left-\[50%\]/g,
  // متغيّرا `side` في Sheet: الاسم في واجهة المكوّن نفسه «يمين/يسار»،
  // والقيمة تحدّد أي حافة من الشاشة فعلاً. القلب هنا يكسر المعنى لا
  // يصلحه — نمرّر `side="right"` عمداً كي ينفتح الدرج من جهة البدء
  // في RTL. مسموح لهذين النمطين وحدهما، لا لكل `right-`.
  /inset-y-0 (right|left)-0 h-full/g,
  /*
   * ‏Sidebar: `side` فيزيائي كما في Sheet — يحدّد حافة الشاشة لا جهة
   * المنطق. نمرّر `side="right"` عمداً كي ينفتح الشريط من جهة البدء في
   * RTL. مسموح لأنماط `data-[side=…]` وحدها ولطرفَي التثبيت.
   */
  /group-data-\[side=(left|right)\]:-?(right|left)-(0|4|full|1\/2)/g,
  /\?\s*"left-0 group-data-\[collapsible=offcanvas\]:left-\[calc\(var\(--sidebar-width\)\*-1\)\]"/g,
  /:\s*"right-0 group-data-\[collapsible=offcanvas\]:right-\[calc\(var\(--sidebar-width\)\*-1\)\]"/g,
  /after:left-1\/2/g,
  /after:left-full/g,
  /translate-x-\[-50%\]/g,
];

/** أدوات فيزيائية ممنوعة في واجهة عربية — لكلٍّ بديل منطقي. */
const FORBIDDEN: Array<[RegExp, string]> = [
  [/\bp[lr]-(?!x)[\w.[\]]+/g, "استعمل ps-/pe- بدل pl-/pr-"],
  [/\bm[lr]-[\w.[\]]+/g, "استعمل ms-/me- بدل ml-/mr-"],
  [/\btext-(left|right)\b/g, "استعمل text-start/text-end"],
  [/(?<![-\w])(left|right)-[\w.[\]]+/g, "استعمل start-/end- بدل left-/right-"],
  [/\bborder-[lr]-/g, "استعمل border-s-/border-e-"],
  [/\brounded-[lr]-/g, "استعمل rounded-s-/rounded-e-"],
];

describe("مكوّنات shadcn/ui لا تحوي اتجاهات فيزيائية", () => {
  for (const file of files) {
    it(file, () => {
      let src = readFileSync(resolve(UI_DIR, file), "utf8");
      for (const allow of PHYSICAL_ON_PURPOSE) src = src.replace(allow, "");

      const hits: string[] = [];
      for (const [re, hint] of FORBIDDEN) {
        for (const m of src.matchAll(re)) hits.push(`«${m[0]}» — ${hint}`);
      }
      expect(hits, `اتجاه فيزيائي في ${file}:\n${hits.join("\n")}`).toEqual([]);
    });
  }
});

describe("كل رمز لوني تستعمله المكوّنات معرَّف في globals.css", () => {
  it("لا رمز يتيم", () => {
    const used = new Set<string>();
    for (const file of files) {
      const src = readFileSync(resolve(UI_DIR, file), "utf8");
      const re =
        /\b(?:bg|text|border|ring|fill|stroke|outline|divide|decoration|caret|placeholder|from|to|via|shadow|accent)-(background|foreground|card|card-foreground|popover|popover-foreground|primary|primary-foreground|secondary|secondary-foreground|muted|muted-foreground|accent|accent-foreground|destructive|destructive-foreground|border|input|ring)\b/g;
      for (const m of src.matchAll(re)) used.add(m[1]!);
    }

    expect(used.size).toBeGreaterThan(10); // حراسة: لو انهار الالتقاط لصار الاختبار أجوف

    const missing = [...used].filter((t) => !CSS.includes(`--color-${t}:`));
    expect(missing, `رموز تستعملها المكوّنات وغير معرَّفة في globals.css: ${missing.join(", ")}`).toEqual([]);
  });

  it("الجسر يُسنِد إلى رموزنا لا إلى لوحة موازية", () => {
    // لو عرّف أحدهم --color-primary بلون خام بدل var(--color-…) لانشقّت اللوحة
    const bridge = CSS.slice(CSS.indexOf("@theme inline"));
    const raw = [...bridge.matchAll(/--color-[\w-]+:\s*(oklch|#|rgb)/g)];
    expect(raw.map((m) => m[0]), "الجسر يجب أن يُسنِد لا أن يعرّف ألواناً خاماً").toEqual([]);
  });
});

describe("طبقة الأساس التي تفترضها مكوّنات shadcn موجودة", () => {
  /**
   * ⚠️ في Tailwind v4 لم يعد `border` المجرّد يأخذ رمادياً افتراضياً، بل
   * يرث `currentColor`. ومكوّنات shadcn تكتب `border` بلا لون معتمدةً
   * على قاعدة `*` في طبقة الأساس. بغيابها تُرسم كل الحدود بلون الحبر.
   *
   * ‏`shadcn init` يضيفها؛ وقد كُتب `components.json` يدوياً هنا كي لا
   * يُمحى `@theme`، فسقطت. لم يكشفها بناء ولا نوع ولا اختبار — بل قياسُ
   * اللون المحسوب في المتصفّح. هذا الاختبار يمنع سقوطها ثانيةً.
   */
  it("قاعدة لون الحدّ الافتراضي معرَّفة", () => {
    const base = CSS.match(/@layer\s+base\s*\{[\s\S]*?\n\}/);
    expect(base, "لا توجد @layer base في globals.css").not.toBeNull();
    expect(base![0]).toMatch(/border-color:\s*var\(--color-border\)/);
  });

  it("مكوّنات shadcn تعتمد فعلاً على هذا الافتراضي", () => {
    // لو صارت كلها تكتب `border-border` صراحةً لانتفت الحاجة — والعكس
    // هو الواقع: هذا الاختبار يوثّق الاعتماد بدل افتراضه.
    // `border` محاطاً بمسافة أو اقتباس = صنف بلا لون يعتمد على الافتراضي؛
    // أما `border-b` و`border-input` فلهما جهة أو لون صريح.
    const bare = files.filter((f) =>
      /["'\s]border(?=[\s"'])/.test(readFileSync(resolve(UI_DIR, f), "utf8")),
    );
    expect(bare.length, "لا مكوّن يستعمل `border` مجرّداً — أعد فحص الحاجة للطبقة").toBeGreaterThan(0);
  });
});

describe("الوضع الليلي مبنيّ بالشكل الذي يفهمه Tailwind v4", () => {
  /**
   * ⚠️ **عاش هذا العيب في المشروع بلا أن يفشل شيء.**
   * كانت لوحة الليل مكتوبة `@media { @theme { … } }`. و`@theme` في
   * Tailwind v4 **يُرفع خارج `@media`** عند التجميع، فتُكتب قيم الليل فوق
   * قيم النهار في `:root` بلا شرط — والنتيجة تطبيق **داكن دائماً** لا
   * يرى مستخدمُ الوضع الفاتح شيئاً غيره.
   *
   * لم يفشل بناء ولا نوع ولا اختبار: الملف صالح والقيم صحيحة، والخطأ في
   * موضعها **بعد** التجميع. كُشف بقراءة CSS المولَّد في المتصفّح.
   */
  it("لا @theme داخل أي @media", () => {
    // ⚠️ التعليقات تُزال أولاً: التعليق الذي يشرح هذا العيب يذكر `@media`
    // و`@theme` نصّاً، فكان الفحص يرصد شرحَ العيب بدل العيب.
    const CSS = STRIPPED;
    const offenders: string[] = [];
    const re = /@media[^{]*\{/g;
    for (const m of CSS.matchAll(re)) {
      let depth = 0;
      let i = m.index! + m[0].length - 1;
      const start = i;
      do {
        if (CSS[i] === "{") depth += 1;
        else if (CSS[i] === "}") depth -= 1;
        i += 1;
      } while (depth > 0 && i < CSS.length);
      const body = CSS.slice(start, i);
      if (body.includes("@theme")) offenders.push(m[0].trim());
    }
    expect(
      offenders,
      `@theme داخل @media يُرفع خارجها في Tailwind v4 — استعمل :root بدلاً منه. المواضع: ${offenders.join(" · ")}`,
    ).toEqual([]);
  });

  it("لوحة الليل تتجاوز عبر :root داخل prefers-color-scheme", () => {
    const dark = STRIPPED.match(
      /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{[\s\S]*?\}\s*\}/,
    );
    expect(dark, "لا توجد كتلة :root داخل @media للوضع الليلي").not.toBeNull();
    expect(dark![0]).toMatch(/--color-surface\s*:/);
    expect(dark![0]).toMatch(/--color-ink\s*:/);
  });

  it("كل رمز في لوحة الليل معرَّف في لوحة النهار أيضاً", () => {
    // رمز يظهر في الليل وحده = لون بلا مقابل نهاري ← ينهار الوضع الفاتح
    const darkVars = varsOf(autoDarkBlock());
    expect(darkVars.length).toBeGreaterThan(0);

    const baseTheme = STRIPPED.slice(STRIPPED.indexOf("@theme"), STRIPPED.indexOf("@media"));
    const missing = darkVars.filter((v) => !baseTheme.includes(`${v}:`));
    expect(missing, `رموز في لوحة الليل بلا مقابل نهاري: ${missing.join(", ")}`).toEqual([]);
  });

  /**
   * ⚠️ **الكتلتان الداكنتان مكرَّرتان بالضرورة، والانحراف بينهما صامت.**
   * ‏CSS لا يسمح بقائمة مُحدِّدات تعبر حدّ `@media`، فقيم الليل مكتوبة
   * مرّتين: مرّة لتفضيل النظام ومرّة للاختيار الصريح. ومن يضيف رمزاً في
   * إحداهما وينسى الأخرى يُنتج عيباً لا يظهر إلا لمن **بدّل السمة يدوياً**
   * على نظام فاتح — أي لمن لن يجرّبه أحد.
   *
   * هذا الاختبار يجعل الانحراف فشلاً في CI.
   */
  it("كتلتا الليل — التلقائية والصريحة — تُعلنان نفس الرموز", () => {
    const auto = varsOf(autoDarkBlock());
    const explicit = varsOf(explicitDarkBlock());

    expect(auto.length, "كتلة الليل التلقائية فارغة — أُعيد فحص الالتقاط").toBeGreaterThan(5);
    expect(explicit.length, "لا كتلة :root[data-theme=dark] — لن يعمل التبديل اليدوي").toBeGreaterThan(5);

    const onlyAuto = auto.filter((v) => !explicit.includes(v));
    const onlyExplicit = explicit.filter((v) => !auto.includes(v));
    expect(
      { onlyAuto, onlyExplicit },
      "انحرفت كتلتا الليل: رمز معرَّف في إحداهما فقط. أضِفه في الاثنتين.",
    ).toEqual({ onlyAuto: [], onlyExplicit: [] });
  });
});

/**
 * نظام السمة — الجزء الذي **لا يعمل إلا بمكوّنَين معاً**.
 *
 * ⚠️ الوضع الداكن هنا مبنيّ على شيئين مستقلّين:
 *   • `data-theme` تقرأه لوحة الألوان في `globals.css`.
 *   • الصنف `dark` يقرأه `@custom-variant dark (&:is(.dark *))` — أي كل
 *     أداة `dark:` في المشروع.
 *
 * ⚠️ **والثاني كان مفقوداً بالكامل.** المشروع فيه عشرات أدوات `dark:`
 * ولا شيء كان يضيف الصنف قط، فكانت كلها **ميتة**: لا تفشل في بناء ولا
 * نوع ولا اختبار — تُكتب ولا تُطبَّق أبداً. هذا هو ما يحرسه ما يلي.
 */
/**
 * الشريط الجانبي المستورد — تفاصيل يعيدها `shadcn add` صامتاً.
 *
 * ⚠️ كلاهما عيب حقيقي كان قائماً في الكود المستورد:
 *   • أيقونة `PanelLeftIcon` على شريط **يمينيّ**: الأيقونة ترسم لوحاً على
 *     الجهة اليسرى، فيقول زرّ الطيّ عكسَ ما يفعل.
 *   • «Toggle Sidebar» بالإنكليزية في `sr-only` و`aria-label` و`title` —
 *     يقرأها قارئ الشاشة العربي حرفياً.
 *
 * لا يفشل بناء ولا نوع بسببهما، ولا يراهما بصرياً إلا من يدقّق. وأي
 * `shadcn add sidebar` لاحق يعيد الأصل — فهذا الاختبار هو ما يمنع الرجوع.
 */
describe("الشريط الجانبي المستورد مُعرَّب ومصحَّح الاتجاه", () => {
  const SRC = readFileSync(resolve(UI_DIR, "sidebar.tsx"), "utf8");

  it("أيقونة اللوح يمينية لا يسارية", () => {
    expect(SRC, "PanelLeftIcon على شريط يمينيّ — الأيقونة تعاكس الفعل").not.toContain(
      "PanelLeftIcon",
    );
    expect(SRC).toContain("PanelRightIcon");
  });

  it("لا نصّ إنكليزي في أسماء يقرأها قارئ الشاشة", () => {
    const offenders = [
      ...SRC.matchAll(/(?:aria-label|title)="([^"]*[A-Za-z]{3,}[^"]*)"/g),
      ...SRC.matchAll(/className="sr-only">([^<]*[A-Za-z]{3,}[^<]*)</g),
    ].map((m) => m[1]!);
    expect(offenders, `أسماء إنكليزية: ${offenders.join(" · ")}`).toEqual([]);
  });
});

/**
 * ⚠️ **`translateX` فيزيائيّ ولا يرصده فحص الأصناف أعلاه.**
 * كان `Progress` المستورد يحرّك مؤشّره بـ`translateX(-${100-value}%)`،
 * فيمتلئ الشريط في RTL من الحافّة اليسرى — عكس جهة البدء. قِيس في
 * المتصفّح: بقيمة 25 لمست التعبئةُ اليسار ولم تلمس اليمين.
 *
 * ولم يفشل شيء: المكوّن لم يكن مستعملاً، و`translateX` ليس صنف اتجاه.
 * الشرائط تُملأ بـ`width` الذي لا اتجاه له.
 */
describe("أشرطة التقدّم تُملأ من جهة البدء", () => {
  /** توسيط الحوار بـ`translate-x-[-50%]` متماثل، فلا معنى لقلبه. */
  const SYMMETRIC = /translate-x-\[-50%\]/g;

  for (const file of files) {
    it(file, () => {
      /*
       * ⚠️ التعليقات تُزال أولاً. التعليق الذي يشرح هذا العيب داخل
       * `progress.tsx` يذكر `translateX(` نصّاً، فكان الفحص يرصد **شرح
       * العيب** بدل العيب — وهو نفس ما وقع في فحص الوضع الليلي.
       */
      const src = readFileSync(resolve(UI_DIR, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "")
        .replace(SYMMETRIC, "");
      const hits = [...src.matchAll(/translateX\(/g)].map((m) => m[0]);
      expect(
        hits,
        `translateX في ${file} — فيزيائي في RTL. املأ الشريط بـ\`width\` بدلاً منه.`,
      ).toEqual([]);
    });
  }
});

describe("نظام السمة موصول من طرفيه", () => {
  const SCRIPT = readFileSync(
    resolve(import.meta.dirname, "../../components/theme/theme-script.tsx"),
    "utf8",
  );

  it("المتغيّر dark معرَّف على الصنف .dark", () => {
    expect(CSS).toMatch(/@custom-variant\s+dark\s*\(&:is\(\.dark\s*\*\)\)/);
  });

  it("النصّ الحاجب يكتب السمة **والصنف** معاً", () => {
    // إسقاط أيٍّ منهما يكسر نصف النظام بصمت
    expect(SCRIPT, "لا يكتب data-theme").toMatch(/dataset\.theme/);
    expect(SCRIPT, "لا يضيف الصنف dark — كل أدوات dark: تصير ميتة").toMatch(
      /classList\.toggle\("dark"/,
    );
  });

  it("النصّ محقون في التخطيط الجذري قبل الجسد", () => {
    const layout = readFileSync(
      resolve(import.meta.dirname, "../../app/layout.tsx"),
      "utf8",
    );
    expect(layout, "ThemeScript غير محقون — تُرسَم الصفحة فاتحة ثم تنقلب").toMatch(
      /<ThemeScript\s*\/>/,
    );
    // بلا هذا يحذّر React من عدم تطابق الترطيب لأن النصّ عدّل <html>
    expect(layout, "ينقص suppressHydrationWarning على <html>").toMatch(
      /suppressHydrationWarning/,
    );
  });

  it("مبدّل السمة لا يخزّن «حسب النظام» كقيمة", () => {
    // «حسب النظام» غيابُ قيمة لا قيمة: تخزينها يجعل تفضيل النظام لا يُتَّبع
    const toggle = readFileSync(
      resolve(import.meta.dirname, "../../components/theme/theme-toggle.tsx"),
      "utf8",
    );
    expect(toggle).toMatch(/removeItem\(THEME_KEY\)/);
    expect(toggle, "لا يجوز تخزين \"system\" كقيمة").not.toMatch(/setItem\([^)]*"system"/);
  });
});

/**
 * جسم القاعدة التي يبدأ مُحدِّدها بـ`selector`.
 *
 * ⚠️ **بمطابقة أقواس لا بتعبير نمطي.** التعبير النمطي `\{([\s\S]*?)\}`
 * يتوقّف عند **أول** قوس إغلاق، وهو قوس القاعدة الداخلية لا الخارجية —
 * فيُرجع جسماً مقطوعاً ويجعل الاختبار أجوف بلا أن يفشل.
 */
function ruleBody(selector: string): string {
  const at = STRIPPED.indexOf(selector);
  if (at === -1) return "";
  const open = STRIPPED.indexOf("{", at);
  if (open === -1) return "";
  let depth = 0;
  let i = open;
  do {
    if (STRIPPED[i] === "{") depth += 1;
    else if (STRIPPED[i] === "}") depth -= 1;
    i += 1;
  } while (depth > 0 && i < STRIPPED.length);
  return STRIPPED.slice(open + 1, i - 1);
}

/** كتلة الليل التلقائية — داخل `@media`. */
function autoDarkBlock(): string {
  return ruleBody(':root:not([data-theme="light"])');
}

/** كتلة الليل الصريحة — اختيار المستخدم. */
function explicitDarkBlock(): string {
  return ruleBody(':root[data-theme="dark"]');
}

function varsOf(block: string): string[] {
  return [...block.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]!).sort();
}
