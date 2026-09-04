import { describe, expect, it } from "vitest";
import {
  assertPositiveIqd,
  formatIqd,
  formatIqdPlain,
  mulIqd,
  parseIqd,
  splitEvenlyIqd,
  sumIqd,
} from "./money";

describe("formatIqd — أرقام غربية دائماً (تصحيح T4)", () => {
  it("يعرض فواصل آلاف ولاحقة الدينار", () => {
    expect(formatIqd(125_000n)).toBe("125,000 د.ع");
  });

  it("لا يُخرج أي رقم هندي-عربي", () => {
    const rendered = formatIqd(1_234_567_890n);
    expect(rendered).toBe("1,234,567,890 د.ع");
    expect(/[٠-٩]/u.test(rendered)).toBe(false);
  });

  it("يتعامل مع الصفر والسالب (الرصيد الدائن سالب)", () => {
    expect(formatIqdPlain(0n)).toBe("0");
    expect(formatIqdPlain(-50_000n)).toBe("-50,000");
  });

  it("يحافظ على الدقّة فوق 2^53 — حيث ينهار float", () => {
    const huge = 9_007_199_254_740_993n; // MAX_SAFE_INTEGER + 2
    expect(formatIqdPlain(huge)).toBe("9,007,199,254,740,993");
  });
});

describe("parseIqd", () => {
  it("يقبل الفواصل والمسافات واللاحقة", () => {
    expect(parseIqd("125,000")).toBe(125_000n);
    expect(parseIqd(" 1 500 000 ")).toBe(1_500_000n);
    expect(parseIqd("75,000 د.ع")).toBe(75_000n);
  });

  it("يقبل الأرقام الهندية-العربية لأن لوحة المفاتيح العربية تنتجها", () => {
    expect(parseIqd("١٢٥٬٠٠٠")).toBe(125_000n);
    expect(parseIqd("٥٠٠٠")).toBe(5_000n);
  });

  it("يرفض الكسور — الدينار لا يقبل وحدة فرعية", () => {
    expect(parseIqd("1.5")).toBeNull();
    expect(parseIqd("125,000.75")).toBeNull();
  });

  it("يرفض ما ليس رقماً بدل أن يُنتج NaN صامتاً", () => {
    expect(parseIqd("abc")).toBeNull();
    expect(parseIqd("")).toBeNull();
    expect(parseIqd("1e3")).toBeNull();
    expect(parseIqd("-")).toBeNull();
  });
});

describe("mulIqd — لا Number في أي خطوة وسيطة (الخطوة 2.2)", () => {
  it("يضرب سعر الوحدة في الكمية: 5 أمبير × 15,000", () => {
    expect(mulIqd(15_000n, 5)).toBe(75_000n);
  });

  it("يحافظ على الدقّة فوق حدّ float", () => {
    expect(mulIqd(9_007_199_254_740_993n, 3)).toBe(27_021_597_764_222_979n);
  });

  it("يرفض الكمية الكسرية والسالبة بدل تقريبها بصمت", () => {
    expect(() => mulIqd(1_000n, 1.5)).toThrow(RangeError);
    expect(() => mulIqd(1_000n, -1)).toThrow(RangeError);
  });
});

describe("splitEvenlyIqd — R18: الباقي في القسط الأخير", () => {
  it("مثال المواصفة الحرفي: 10,000,000 على 3", () => {
    expect(splitEvenlyIqd(10_000_000n, 3)).toEqual([
      3_333_333n,
      3_333_333n,
      3_333_334n,
    ]);
  });

  it("المجموع يطابق المبلغ بالضبط في عشر تركيبات كسرية", () => {
    const cases: Array<[bigint, number]> = [
      [10_000_000n, 3],
      [50_000_000n, 7],
      [1n, 1],
      [1n, 3],
      [2n, 3],
      [999_999_999n, 11],
      [123_456_789n, 13],
      [7n, 5],
      [100_000_000n, 24],
      [875_000_000n, 36],
    ];

    for (const [total, count] of cases) {
      const parts = splitEvenlyIqd(total, count);
      expect(parts).toHaveLength(count);
      expect(sumIqd(parts)).toBe(total); // ← الثابت: لا دينار يضيع ولا يُخترع
    }
  });

  it("كل الأقساط متساوية عدا الأخير، والفرق أقل من عدد الأقساط", () => {
    const parts = splitEvenlyIqd(999_999_999n, 11);
    const base = parts[0]!;
    for (const part of parts.slice(0, -1)) expect(part).toBe(base);
    expect(parts[parts.length - 1]! - base).toBeLessThan(11n);
  });

  it("يرفض عدد أقساط غير صالح", () => {
    expect(() => splitEvenlyIqd(1_000n, 0)).toThrow(RangeError);
    expect(() => splitEvenlyIqd(1_000n, -3)).toThrow(RangeError);
    expect(() => splitEvenlyIqd(1_000n, 2.5)).toThrow(RangeError);
  });
});

describe("assertPositiveIqd — يعكس CHECK (amountIqd > 0)", () => {
  it("يمرّر الموجب", () => {
    expect(() => assertPositiveIqd(1n)).not.toThrow();
  });

  it("يرفض الصفر والسالب", () => {
    expect(() => assertPositiveIqd(0n)).toThrow(RangeError);
    expect(() => assertPositiveIqd(-1n)).toThrow(RangeError);
  });
});

describe("sumIqd", () => {
  it("يجمع بـ0n لا 0 — خلط النوعين خطأ شائع", () => {
    expect(sumIqd([])).toBe(0n);
    expect(sumIqd([1_000n, 2_000n, 3_000n])).toBe(6_000n);
  });
});
