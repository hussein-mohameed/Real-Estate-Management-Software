import { describe, expect, it } from "vitest";
import { csvFileName, toCsv } from "@/lib/reports/csv";
import { fromBaghdadWallClock } from "@/lib/dates";

/**
 * ⚠️ ما يحرسه هذا الملفّ ليس شكل الفاصلة — بل ثلاثة أعطاب تُفسد الملفّ
 * عند المستخدم ولا تظهر في أي شاشة: الترميز · حقن الصيغ · تنسيق المال.
 */

describe("🔴 الترميز", () => {
  it("يبدأ بـBOM — وبدونه تظهر العربية رموزاً في Excel", () => {
    const out = toCsv(["الاسم"], [["أحمد"]]);
    expect(out.charCodeAt(0)).toBe(0xfeff);
  });

  it("والأسطر CRLF كما يوجب RFC 4180", () => {
    const out = toCsv(["أ", "ب"], [["1", "2"]]);
    expect(out).toContain("\r\n");
    expect(out.endsWith("\r\n")).toBe(true);
  });
});

describe("🔴 حقن الصيغ", () => {
  it("يُسبق ما يبدأ برمز صيغة بفاصلة عليا", () => {
    /* اسمٌ يبدأ بـ`=` يُنفَّذ عند فتح الملفّ — ثغرة لا تجميل */
    for (const risky of ["=SUM(A1)", "+1", "-1", "@cmd"]) {
      const out = toCsv(["x"], [[risky]]);
      expect(out, `مرّ «${risky}» بلا تحييد`).toContain(`"'${risky}"`);
    }
  });

  it("والنصّ العادي لا يُمسّ", () => {
    expect(toCsv(["x"], [["أحمد"]])).toContain('"أحمد"');
  });

  it("والاقتباس المزدوج يُضاعَف", () => {
    expect(toCsv(["x"], [['قال "نعم"']])).toContain('"قال ""نعم"""');
  });
});

describe("🔴 المال والأعداد", () => {
  it("BigInt يُكتب رقماً خاماً بلا اقتباس ولا فواصل", () => {
    const out = toCsv(["مبلغ"], [[1_250_000n]]);
    /* ⚠️ لو اقتُبس أو نُسّق لصار عموداً نصّياً لا يُجمَع في Excel */
    expect(out).toContain("1250000");
    expect(out).not.toContain('"1250000"');
    expect(out).not.toContain("1,250,000");
  });

  it("والفراغ خليّة فارغة لا كلمة", () => {
    expect(toCsv(["x", "y"], [[null, undefined]])).toContain("\r\n,\r\n");
  });

  it("والتاريخ بتوقيت بغداد قابلاً للفرز", () => {
    const d = fromBaghdadWallClock(2026, 3, 15, 14, 30, 0);
    expect(toCsv(["حين"], [[d]])).toContain("2026-03-15 14:30");
  });
});

describe("اسم الملفّ", () => {
  it("لاتينيّ بالمدّة — واليوم الأخير شامل رغم الحدّ المفتوح", () => {
    const from = fromBaghdadWallClock(2026, 3, 1);
    /* الحدّ الأعلى مفتوح: بداية 11 آذار تعني أن العاشر آخر يوم */
    const to = fromBaghdadWallClock(2026, 3, 11);
    expect(csvFileName("collections", from, to)).toBe(
      "collections_2026-03-01_2026-03-10.csv",
    );
  });

  it("وبلا مدّة يبقى الاسم وحده", () => {
    expect(csvFileName("outstanding")).toBe("outstanding.csv");
  });
});
