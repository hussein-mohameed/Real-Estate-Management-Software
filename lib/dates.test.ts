import { describe, expect, it } from "vitest";
import {
  addMonthsBaghdad,
  billingDateForMonth,
  daysInMonth,
  formatBaghdadDate,
  formatBaghdadDateTime,
  formatBaghdadMonth,
  fromBaghdadWallClock,
  isSameBaghdadDay,
  periodEndFor,
  startOfDayBaghdad,
  startOfMonthBaghdad,
  toBaghdadParts,
} from "./dates";

describe("تحويل ساعة الحائط ↔ UTC", () => {
  it("منتصف ليل بغداد = 21:00 UTC اليوم السابق", () => {
    const instant = fromBaghdadWallClock(2026, 9, 1);
    expect(instant.toISOString()).toBe("2026-08-31T21:00:00.000Z");
  });

  it("الرحلة ذهاباً وإياباً لا تفقد شيئاً", () => {
    const instant = fromBaghdadWallClock(2026, 3, 15, 14, 37, 9);
    expect(toBaghdadParts(instant)).toEqual({
      year: 2026,
      month: 3,
      day: 15,
      hour: 14,
      minute: 37,
      second: 9,
    });
  });
});

describe("startOfMonthBaghdad — الاختبار الذي يمنع القيد في الشهر الخطأ", () => {
  it("لحظة UTC في 31/8 مساءً هي أصلاً 1/9 في بغداد", () => {
    // 21:30 UTC يوم 31/8 = 00:30 يوم 1/9 بتوقيت بغداد
    const instant = new Date("2026-08-31T21:30:00.000Z");
    expect(formatBaghdadDate(instant)).toBe("01/09/2026");
    // فبداية الشهر هي سبتمبر لا أغسطس — لو حُسبت بمنطقة الخادم لأخطأت شهراً
    expect(startOfMonthBaghdad(instant).toISOString()).toBe("2026-08-31T21:00:00.000Z");
    expect(formatBaghdadMonth(instant)).toBe("9/2026");
  });

  it("لحظة UTC في 31/8 قبل الحدّ تبقى في أغسطس", () => {
    const instant = new Date("2026-08-31T20:59:59.000Z"); // 23:59:59 بغداد
    expect(formatBaghdadDate(instant)).toBe("31/08/2026");
    expect(startOfMonthBaghdad(instant).toISOString()).toBe("2026-07-31T21:00:00.000Z");
  });

  it("النتيجة لا تتأثّر بمنطقة الخادم — الحساب عبر Intl بمنطقة صريحة", () => {
    const instant = new Date("2026-08-31T21:30:00.000Z");
    const expected = "2026-08-31T21:00:00.000Z";
    const original = process.env.TZ;
    for (const tz of ["UTC", "America/New_York", "Asia/Tokyo", "Pacific/Kiritimati"]) {
      process.env.TZ = tz;
      expect(startOfMonthBaghdad(instant).toISOString()).toBe(expected);
    }
    process.env.TZ = original;
  });
});

describe("billingDateForMonth — تثبيت يوم 31 (القرار الحرج في الخطوة 0.7)", () => {
  it("31 في شهر من 30 يوماً يُثبَّت على 30 ولا يتدحرج إلى الشهر التالي", () => {
    const d = billingDateForMonth(2026, 4, 31); // نيسان 30 يوماً
    expect(formatBaghdadDate(d)).toBe("30/04/2026");
  });

  it("31 في فبراير عادي ← 28", () => {
    expect(formatBaghdadDate(billingDateForMonth(2026, 2, 31))).toBe("28/02/2026");
  });

  it("31 في فبراير كبيسة ← 29", () => {
    expect(formatBaghdadDate(billingDateForMonth(2028, 2, 31))).toBe("29/02/2028");
  });

  it("30 في فبراير ← 28/29 أيضاً", () => {
    expect(formatBaghdadDate(billingDateForMonth(2026, 2, 30))).toBe("28/02/2026");
    expect(formatBaghdadDate(billingDateForMonth(2028, 2, 30))).toBe("29/02/2028");
  });

  it("اليوم الصالح يبقى كما هو", () => {
    expect(formatBaghdadDate(billingDateForMonth(2026, 8, 1))).toBe("01/08/2026");
    expect(formatBaghdadDate(billingDateForMonth(2026, 8, 15))).toBe("15/08/2026");
    expect(formatBaghdadDate(billingDateForMonth(2026, 8, 31))).toBe("31/08/2026");
  });

  it("يرفض يوم فوترة خارج المدى بدل تصحيحه بصمت", () => {
    expect(() => billingDateForMonth(2026, 1, 0)).toThrow(RangeError);
    expect(() => billingDateForMonth(2026, 1, 32)).toThrow(RangeError);
    expect(() => billingDateForMonth(2026, 1, 1.5)).toThrow(RangeError);
  });
});

describe("daysInMonth — السنة الكبيسة", () => {
  it("يحسب فبراير صحيحاً بقاعدة الكبيسة الكاملة", () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2000, 2)).toBe(29); // قابلة للقسمة على 400
    expect(daysInMonth(1900, 2)).toBe(28); // قابلة على 100 لا على 400
  });

  it("بقيّة الأشهر", () => {
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });
});

describe("addMonthsBaghdad", () => {
  it("31 يناير + شهر = آخر فبراير لا 3 مارس", () => {
    const jan31 = fromBaghdadWallClock(2026, 1, 31);
    expect(formatBaghdadDate(addMonthsBaghdad(jan31, 1))).toBe("28/02/2026");
  });

  it("يعبر حدّ السنة", () => {
    const dec15 = fromBaghdadWallClock(2026, 12, 15);
    expect(formatBaghdadDate(addMonthsBaghdad(dec15, 1))).toBe("15/01/2027");
    expect(formatBaghdadDate(addMonthsBaghdad(dec15, 12))).toBe("15/12/2027");
  });

  it("يقبل الرجوع للخلف", () => {
    const mar15 = fromBaghdadWallClock(2026, 3, 15);
    expect(formatBaghdadDate(addMonthsBaghdad(mar15, -3))).toBe("15/12/2025");
  });
});

describe("periodEndFor — بلا تداخل ولا فجوة بين الفترات", () => {
  it("الشهرية", () => {
    const start = fromBaghdadWallClock(2026, 8, 1);
    const end = periodEndFor(start, "MONTHLY");
    expect(formatBaghdadDate(end)).toBe("31/08/2026");
    // نهاية الفترة تسبق بداية التالية بمللي ثانية واحدة بالضبط
    expect(addMonthsBaghdad(start, 1).getTime() - end.getTime()).toBe(1);
  });

  it("الربعية والسنوية", () => {
    const start = fromBaghdadWallClock(2026, 1, 1);
    expect(formatBaghdadDate(periodEndFor(start, "QUARTERLY"))).toBe("31/03/2026");
    expect(formatBaghdadDate(periodEndFor(start, "YEARLY"))).toBe("31/12/2026");
  });
});

describe("مساعدات العرض", () => {
  it("التاريخ dd/MM/yyyy بأرقام غربية", () => {
    const d = fromBaghdadWallClock(2026, 8, 5);
    expect(formatBaghdadDate(d)).toBe("05/08/2026");
    expect(/[٠-٩]/u.test(formatBaghdadDate(d))).toBe(false);
  });

  it("التاريخ والوقت", () => {
    const d = fromBaghdadWallClock(2026, 8, 5, 9, 7);
    expect(formatBaghdadDateTime(d)).toBe("05/08/2026 09:07");
  });

  it("منتصف الليل يُعرض 00:00 لا 24:00", () => {
    const d = fromBaghdadWallClock(2026, 8, 5, 0, 0);
    expect(formatBaghdadDateTime(d)).toBe("05/08/2026 00:00");
    expect(toBaghdadParts(d).hour).toBe(0);
  });

  it("startOfDayBaghdad", () => {
    const d = new Date("2026-08-05T18:45:00.000Z"); // 21:45 بغداد
    expect(startOfDayBaghdad(d).toISOString()).toBe("2026-08-04T21:00:00.000Z");
  });

  it("isSameBaghdadDay يقارن بيوم بغداد لا بيوم UTC", () => {
    const a = new Date("2026-08-05T21:30:00.000Z"); // 6/8 بغداد
    const b = new Date("2026-08-06T05:00:00.000Z"); // 6/8 بغداد
    expect(isSameBaghdadDay(a, b)).toBe(true);
    const c = new Date("2026-08-05T20:00:00.000Z"); // 5/8 بغداد
    expect(isSameBaghdadDay(a, c)).toBe(false);
  });
});
