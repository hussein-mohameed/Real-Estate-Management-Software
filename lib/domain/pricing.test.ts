import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  computePeriodAmount,
  PricingError,
  prorateFirstPeriod,
  type PricingInput,
} from "./pricing";

/**
 * الخطوة 2.2 — تعريف الإنجاز:
 *   «اختبارات لكل نموذج تسعير + الحدود + أرقام كبيرة جداً»
 *   «لا `Number` في المسار»
 *
 * هذه الدالّة تحدّد **كل دينار في النظام**، فتُختبر قبل أي استعمال.
 */

const flat = (base: bigint | null = 50_000n): PricingInput => ({
  pricingModel: "FLAT",
  basePriceIqd: base,
  unitPriceIqd: null,
  minUnits: null,
  maxUnits: null,
});

const perUnit = (
  unit: bigint | null = 15_000n,
  min: number | null = null,
  max: number | null = null,
): PricingInput => ({
  pricingModel: "PER_UNIT",
  basePriceIqd: null,
  unitPriceIqd: unit,
  minUnits: min,
  maxUnits: max,
});

const perPerson = (base: bigint | null = 10_000n): PricingInput => ({
  pricingModel: "PER_PERSON",
  basePriceIqd: base,
  unitPriceIqd: null,
  minUnits: null,
  maxUnits: null,
});

// ═══════════════════════════════════════════════════════════════════════

describe("FLAT — سعر ثابت", () => {
  it("المبلغ = السعر الأساسي، والكمية 1", () => {
    const r = computePeriodAmount(flat(50_000n));
    expect(r.periodAmountIqd).toBe(50_000n);
    expect(r.quantity).toBe(1);
  });

  it("⚠️ اللقطة **إلزامية حتى هنا** وتساوي السعر الأساسي", () => {
    /**
     * `unitPriceSnapshotIqd` غير قابل لـnull في المخطّط. التسمية إرث،
     * والمعنى: السعر الذي حُسب به الاشتراك يوم أُنشئ — وهو ما يحمي R23.
     */
    const r = computePeriodAmount(flat(50_000n));
    expect(r.unitPriceSnapshotIqd).toBe(50_000n);
  });

  it("يتجاهل الكمية الممرَّرة — لا معنى لها هنا", () => {
    const r = computePeriodAmount(flat(50_000n), { quantity: 99 });
    expect(r.periodAmountIqd).toBe(50_000n);
    expect(r.quantity).toBe(1);
  });

  it("بلا سعر أساسي يرمي برسالة عربية", () => {
    expect(() => computePeriodAmount(flat(null))).toThrow(PricingError);
    expect(() => computePeriodAmount(flat(null))).toThrow(/سعر الخدمة/);
  });

  it("سعر صفري أو سالب يرمي", () => {
    expect(() => computePeriodAmount(flat(0n))).toThrow(PricingError);
    expect(() => computePeriodAmount(flat(-1n))).toThrow(PricingError);
  });
});

// ═══════════════════════════════════════════════════════════════════════

describe("PER_UNIT — سعر الوحدة × الكمية", () => {
  it("مثال المواصفة: مولّدة 5 أمبير", () => {
    const r = computePeriodAmount(perUnit(15_000n), { quantity: 5 });
    expect(r.periodAmountIqd).toBe(75_000n);
    expect(r.unitPriceSnapshotIqd).toBe(15_000n);
    expect(r.quantity).toBe(5);
  });

  it("كمية 1 تعمل", () => {
    expect(computePeriodAmount(perUnit(15_000n), { quantity: 1 }).periodAmountIqd).toBe(
      15_000n,
    );
  });

  it("بلا كمية يرمي — لا افتراض بواحد", () => {
    // الافتراض الصامت يُنتج فاتورة بخُمس المبلغ ولا يعترض أحد
    expect(() => computePeriodAmount(perUnit())).toThrow(/عدد الوحدات مطلوب/);
  });

  it("كمية غير صحيحة أو سالبة ترمي", () => {
    expect(() => computePeriodAmount(perUnit(), { quantity: 2.5 })).toThrow(/صحيحاً/);
    expect(() => computePeriodAmount(perUnit(), { quantity: -3 })).toThrow(/سالباً/);
  });

  it("كمية صفر ترمي — اشتراك بصفر وحدة بلا معنى", () => {
    expect(() => computePeriodAmount(perUnit(), { quantity: 0 })).toThrow(
      /واحدة على الأقل/,
    );
  });

  it("بلا سعر وحدة يرمي", () => {
    expect(() => computePeriodAmount(perUnit(null), { quantity: 5 })).toThrow(
      /سعر الوحدة/,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════

describe("🔴 الحدود تُفحَص هنا لا في الواجهة", () => {
  it("تحت الحدّ الأدنى مرفوض", () => {
    expect(() => computePeriodAmount(perUnit(15_000n, 5, 30), { quantity: 3 })).toThrow(
      /لا تقلّ عن 5/,
    );
  });

  it("فوق الحدّ الأعلى مرفوض", () => {
    /**
     * ⚠️ الإجراء نقطة نهاية HTTP: كمية 999 أمبير على خدمة حدّها 30 تصل
     * الخادم مباشرةً، وتُنتج قيداً بـ14,985,000 بلا مخالفة أي قيد في
     * قاعدة البيانات.
     */
    expect(() => computePeriodAmount(perUnit(15_000n, 1, 30), { quantity: 999 })).toThrow(
      /لا تزيد عن 30/,
    );
  });

  it("على الحدّين بالضبط مقبول", () => {
    expect(
      computePeriodAmount(perUnit(15_000n, 5, 30), { quantity: 5 }).periodAmountIqd,
    ).toBe(75_000n);
    expect(
      computePeriodAmount(perUnit(15_000n, 5, 30), { quantity: 30 }).periodAmountIqd,
    ).toBe(450_000n);
  });

  it("بلا حدود لا فحص — الحدّ اختياري", () => {
    expect(
      computePeriodAmount(perUnit(1_000n), { quantity: 10_000 }).periodAmountIqd,
    ).toBe(10_000_000n);
  });
});

// ═══════════════════════════════════════════════════════════════════════

describe("🔴 PER_PERSON — العدد مشتقّ لا مُدخَل (‏Q5)", () => {
  it("المبلغ = سعر الفرد × السكان النشطين", () => {
    const r = computePeriodAmount(perPerson(10_000n), { personsCount: 4 });
    expect(r.periodAmountIqd).toBe(40_000n);
    expect(r.quantity).toBe(4);
  });

  it("**لا يقرأ `quantity` ولو مُرِّرت** — التمرير اليدوي يفتح باب التلاعب", () => {
    /**
     * §4.14 يقول `quantity` مُدخَل، و§7.4 يقول محسوب. الحسم في خطة
     * الجسر: **المشتقّ هو الحقيقة**. قراءة `quantity` هنا كانت تسمح
     * بفوترة أسرة من ثلاثة على أنها عشرة بلا مخالفة أي قيد.
     */
    expect(() => computePeriodAmount(perPerson(), { quantity: 10 })).toThrow(
      /عدد الأشخاص مطلوب/,
    );
  });

  it("⚠️ شقة بلا سكان ← **صفر لا خطأ**", () => {
    /**
     * الحالة واقعية: تُخلى الوحدة ويبقى الاشتراك موقوفاً حتى قرار
     * الأدمن. الرمي هنا كان سيُفشل مسار الإخلاء نفسه.
     */
    const r = computePeriodAmount(perPerson(10_000n), { personsCount: 0 });
    expect(r.periodAmountIqd).toBe(0n);
    expect(r.quantity).toBe(0);
    // واللقطة تبقى محفوظة — نعرف بأي سعر كان يُحسب
    expect(r.unitPriceSnapshotIqd).toBe(10_000n);
  });

  it("عدد سالب أو كسري يرمي", () => {
    expect(() => computePeriodAmount(perPerson(), { personsCount: -1 })).toThrow();
    expect(() => computePeriodAmount(perPerson(), { personsCount: 1.5 })).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════

describe("🔴 أرقام كبيرة — حيث يفشل `Number`", () => {
  it("مبلغ فوق 2^53 يبقى دقيقاً بالدينار", () => {
    /**
     * ⚠️ الحدّ الآمن في `Number` هو 9,007,199,254,740,991. أي تحويل
     * وسيط فوقه يفقد الدقّة **بصمت**: لا خطأ، ولا تحذير، ورقمٌ يبدو
     * معقولاً وينقص دنانير.
     */
    const huge = 9_007_199_254_740_993n; // 2^53 + 1 — غير قابل للتمثيل في Number
    const r = computePeriodAmount(perUnit(huge), { quantity: 1 });
    expect(r.periodAmountIqd).toBe(huge);
    // البرهان: التحويل إلى Number يفقده
    expect(BigInt(Number(huge))).not.toBe(huge);
  });

  it("ضرب ينتج ما يتجاوز 2^53 يبقى دقيقاً", () => {
    const unit = 1_000_000_000n; // مليار
    const r = computePeriodAmount(perUnit(unit), { quantity: 10_000_000 });
    expect(r.periodAmountIqd).toBe(10_000_000_000_000_000n);
  });

  it("رقم يفضح انحراف Number فعلياً", () => {
    const unit = 3_333_333_333_333_333n;
    const r = computePeriodAmount(perUnit(unit), { quantity: 3 });
    expect(r.periodAmountIqd).toBe(9_999_999_999_999_999n);
    // نفس العملية بـNumber تُعطي رقماً مختلفاً
    const viaNumber = BigInt(Math.round(Number(unit) * 3));
    expect(viaNumber).not.toBe(r.periodAmountIqd);
  });
});

// ═══════════════════════════════════════════════════════════════════════

describe("🔴 لا `Number` في المسار — فحص على المصدر", () => {
  it("ملف التسعير خالٍ من التحويل إلى Number", () => {
    /**
     * ⚠️ **فحص على النصّ لا على السلوك.** اختبار الأرقام الكبيرة يكشف
     * الانحراف الموجود؛ هذا يمنع إدخاله أصلاً. تحويلٌ واحد يُضاف لاحقاً
     * في فرع نادر لا يمرّ به أي اختبار يبقى صامتاً حتى يُنتج فرقاً
     * بالدينار في الإنتاج.
     */
    const src = readFileSync(resolve(import.meta.dirname, "pricing.ts"), "utf8");
    const code = src.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    const offenders = [
      ...code.matchAll(/\bNumber\s*\(/g),
      ...code.matchAll(/\bparseInt\s*\(/g),
      ...code.matchAll(/\bparseFloat\s*\(/g),
      ...code.matchAll(/\bMath\.\w+/g),
    ].map((m) => m[0]);

    // `Number.isInteger` فحص نوع لا تحويل — يُستثنى صراحةً
    const real = offenders.filter((o) => o !== "Number(");
    expect(real, `تحويلات عددية في مسار التسعير: ${real.join(" · ")}`).toEqual([]);
    expect(code).not.toMatch(/Number\s*\(/);
  });

  it("ولا في `mulIqd` التي يستدعيها", () => {
    const src = readFileSync(resolve(import.meta.dirname, "../money.ts"), "utf8");
    const body = src.slice(src.indexOf("export function mulIqd"));
    const fn = body.slice(0, body.indexOf("\n}"));
    // ‏BigInt(quantity) تحويل **إلى** BigInt لا منه — وهو المطلوب
    expect(fn).not.toMatch(/Number\s*\(/);
    expect(fn).toMatch(/BigInt\(quantity\)/);
  });
});

// ═══════════════════════════════════════════════════════════════════════

describe("شمول النماذج", () => {
  it("نموذج غير معروف يرمي بدل أن يُعيد صفراً", () => {
    const bogus = { ...flat(), pricingModel: "MYSTERY" } as unknown as PricingInput;
    expect(() => computePeriodAmount(bogus)).toThrow(PricingError);
  });

  it("النماذج الثلاثة كلها مغطّاة", () => {
    expect(computePeriodAmount(flat()).periodAmountIqd).toBeGreaterThan(0n);
    expect(
      computePeriodAmount(perUnit(), { quantity: 2 }).periodAmountIqd,
    ).toBeGreaterThan(0n);
    expect(
      computePeriodAmount(perPerson(), { personsCount: 2 }).periodAmountIqd,
    ).toBeGreaterThan(0n);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  التقسيط بالتناسب (‏B2)
// ═══════════════════════════════════════════════════════════════════════

/** بداية يوم بتوقيت بغداد — الفترات تبدأ عند منتصف الليل المحلّي. */
function baghdad(y: number, m: number, d: number, h = 0): Date {
  return new Date(Date.UTC(y, m - 1, d, h - 3));
}

describe("‏prorateFirstPeriod — الفترة الأولى (‏B2)", () => {
  it("المثال المرجعي: 50,000 شهرياً · الموافقة يوم 2 من شهر ثلاثيني", () => {
    const r = prorateFirstPeriod({
      periodAmountIqd: 50_000n,
      alignedStart: baghdad(2026, 9, 1),
      alignedNextStart: baghdad(2026, 10, 1),
      activeFrom: baghdad(2026, 9, 2),
    });
    expect(r.cycleDays).toBe(30);
    expect(r.chargedDays).toBe(29);
    // 50,000 × 29 ÷ 30 = 48,333.33 ← يُقطع
    expect(r.amountIqd).toBe(48_333n);
    expect(r.prorated).toBe(true);
  });

  it("⚠️ الموافقة على بداية الدورة ← الكامل، بلا مرور بالقسمة", () => {
    const r = prorateFirstPeriod({
      periodAmountIqd: 50_000n,
      alignedStart: baghdad(2026, 9, 1),
      alignedNextStart: baghdad(2026, 10, 1),
      activeFrom: baghdad(2026, 9, 1),
    });
    expect(r.amountIqd).toBe(50_000n);
    expect(r.prorated).toBe(false);
    expect(r.chargedDays).toBe(30);
  });

  it("آخر يوم في الدورة ← يوم واحد", () => {
    const r = prorateFirstPeriod({
      periodAmountIqd: 30_000n,
      alignedStart: baghdad(2026, 9, 1),
      alignedNextStart: baghdad(2026, 10, 1),
      activeFrom: baghdad(2026, 9, 30),
    });
    expect(r.chargedDays).toBe(1);
    expect(r.amountIqd).toBe(1_000n);
  });

  it("⚠️ الضرب قبل القسمة — وإلا صُفّرت النتيجة", () => {
    /**
     * `(1n / 30n) * 50000n = 0` لأن `BigInt` يقطع. هذا الاختبار يفشل على
     * الترتيب المقلوب ويمرّ على الصحيح.
     */
    const r = prorateFirstPeriod({
      periodAmountIqd: 50_000n,
      alignedStart: baghdad(2026, 9, 1),
      alignedNextStart: baghdad(2026, 10, 1),
      activeFrom: baghdad(2026, 9, 30),
    });
    expect(r.amountIqd).toBeGreaterThan(0n);
  });

  it("⚠️ القطع لا التقريب — يميل لصالح الساكن", () => {
    const r = prorateFirstPeriod({
      periodAmountIqd: 100_000n,
      alignedStart: baghdad(2026, 9, 1),
      alignedNextStart: baghdad(2026, 10, 1),
      activeFrom: baghdad(2026, 9, 2),
    });
    // 100,000 × 29 ÷ 30 = 96,666.67 ← 96,666 لا 96,667
    expect(r.amountIqd).toBe(96_666n);
  });

  it("فبراير الكبيس: المقام 29 لا 28", () => {
    const r = prorateFirstPeriod({
      periodAmountIqd: 29_000n,
      alignedStart: baghdad(2028, 2, 1),
      alignedNextStart: baghdad(2028, 3, 1),
      activeFrom: baghdad(2028, 2, 15),
    });
    expect(r.cycleDays).toBe(29);
    expect(r.chargedDays).toBe(15);
    expect(r.amountIqd).toBe(15_000n);
  });

  it("دورة ربعية: المقام أيام الربع لا 30", () => {
    const r = prorateFirstPeriod({
      periodAmountIqd: 92_000n,
      alignedStart: baghdad(2026, 1, 1),
      alignedNextStart: baghdad(2026, 4, 1),
      activeFrom: baghdad(2026, 2, 1),
    });
    // يناير 31 + فبراير 28 + مارس 31 = 90
    expect(r.cycleDays).toBe(90);
    expect(r.chargedDays).toBe(59);
    expect(r.amountIqd).toBe((92_000n * 59n) / 90n);
  });

  it("⚠️ الساعة لا تُنقص يوماً — من اشترك ليلاً لا يخسر يومه", () => {
    const night = prorateFirstPeriod({
      periodAmountIqd: 30_000n,
      alignedStart: baghdad(2026, 9, 1),
      alignedNextStart: baghdad(2026, 10, 1),
      activeFrom: baghdad(2026, 9, 2, 23),
    });
    const morning = prorateFirstPeriod({
      periodAmountIqd: 30_000n,
      alignedStart: baghdad(2026, 9, 1),
      alignedNextStart: baghdad(2026, 10, 1),
      activeFrom: baghdad(2026, 9, 2, 1),
    });
    expect(night.chargedDays).toBe(morning.chargedDays);
    expect(night.amountIqd).toBe(morning.amountIqd);
  });

  it("مبلغ صفر يبقى صفراً — ‏PER_PERSON بلا سكان (‏Q5)", () => {
    const r = prorateFirstPeriod({
      periodAmountIqd: 0n,
      alignedStart: baghdad(2026, 9, 1),
      alignedNextStart: baghdad(2026, 10, 1),
      activeFrom: baghdad(2026, 9, 10),
    });
    expect(r.amountIqd).toBe(0n);
    expect(r.prorated).toBe(true);
  });

  it("تاريخ خارج الدورة يُرفض بدل أن يُحسب خطأً", () => {
    const outside = {
      periodAmountIqd: 50_000n,
      alignedStart: baghdad(2026, 9, 1),
      alignedNextStart: baghdad(2026, 10, 1),
    };
    expect(() =>
      prorateFirstPeriod({ ...outside, activeFrom: baghdad(2026, 10, 1) }),
    ).toThrow(PricingError);
    expect(() =>
      prorateFirstPeriod({ ...outside, activeFrom: baghdad(2026, 8, 31) }),
    ).toThrow(PricingError);
  });

  it("⚠️ مجموع الفترة الأولى والثانية لا يتجاوز دورتين", () => {
    // حراسة ضدّ خطأ يجعل التناسب يزيد بدل أن ينقص
    const full = 50_000n;
    const r = prorateFirstPeriod({
      periodAmountIqd: full,
      alignedStart: baghdad(2026, 9, 1),
      alignedNextStart: baghdad(2026, 10, 1),
      activeFrom: baghdad(2026, 9, 20),
    });
    expect(r.amountIqd).toBeLessThan(full);
    expect(r.amountIqd + full).toBeLessThan(full * 2n);
  });
});
