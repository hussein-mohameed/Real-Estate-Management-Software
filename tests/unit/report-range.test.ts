import { describe, expect, it } from "vitest";
import {
  parseDayParam,
  resolveRange,
  toDayParam,
} from "@/lib/domain/report-range";
import { fromBaghdadWallClock, toBaghdadParts } from "@/lib/dates";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  مدّة التقرير — الحدود بتوقيت بغداد.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ⚠️ **ما يحرسه هذا الملفّ هو الحدّ المفتوح.** خطأُ اليوم الأخير في
 * التقارير المالية لا يظهر في الشاشة: يعرض رقماً أصغر بقليل، ويُقرأ
 * صحيحاً حتى يقارنه أحدهم بإقفال الصندوق.
 */

/** ‏15 آذار 2026، الساعة 3 عصراً بغداد. */
const REF = fromBaghdadWallClock(2026, 3, 15, 15, 0, 0);

describe("قراءة التاريخ من العنوان", () => {
  it("يقبل YYYY-MM-DD ويبنيه ببداية اليوم في بغداد", () => {
    const d = parseDayParam("2026-03-15");
    expect(d).not.toBeNull();
    const p = toBaghdadParts(d!);
    expect([p.year, p.month, p.day, p.hour]).toEqual([2026, 3, 15, 0]);
  });

  it("🔴 يرفض تاريخاً لا وجود له", () => {
    /*
     * `Date.UTC(2026, 1, 31)` يُبنى بلا خطأ ويصير 3 آذار. وبلا فحص
     * الرجوع يعرض التقرير مدّةً لم يطلبها أحد ويبدو صحيحاً.
     */
    expect(parseDayParam("2026-02-31")).toBeNull();
    expect(parseDayParam("2026-13-01")).toBeNull();
    expect(parseDayParam("15-03-2026")).toBeNull();
    expect(parseDayParam("")).toBeNull();
    expect(parseDayParam(undefined)).toBeNull();
  });

  it("والذهاب والإياب متطابقان", () => {
    expect(toDayParam(parseDayParam("2026-03-15")!)).toBe("2026-03-15");
  });
});

describe("🔴 الحدّ الأعلى مفتوح — لا يسقط اليوم الأخير", () => {
  it("«اليوم» ينتهي ببداية الغد لا بنهاية اليوم", () => {
    const r = resolveRange({ preset: "today" }, REF);
    const from = toBaghdadParts(r.from);
    const to = toBaghdadParts(r.to);

    expect([from.day, from.hour]).toEqual([15, 0]);
    /* ⚠️ بداية اليوم التالي بالضبط — والمقارنة `< to` */
    expect([to.day, to.hour]).toEqual([16, 0]);
  });

  it("ودفعةٌ في الثانية الأخيرة من اليوم داخلة", () => {
    const r = resolveRange({ preset: "today" }, REF);
    const lastSecond = fromBaghdadWallClock(2026, 3, 15, 23, 59, 59);
    expect(lastSecond >= r.from && lastSecond < r.to).toBe(true);
  });

  it("وأوّل لحظة من الغد خارجة", () => {
    const r = resolveRange({ preset: "today" }, REF);
    expect(fromBaghdadWallClock(2026, 3, 16, 0, 0, 0) < r.to).toBe(false);
  });
});

describe("المدد الجاهزة", () => {
  it("«أمس» يوم كامل ينتهي ببداية اليوم", () => {
    const r = resolveRange({ preset: "yesterday" }, REF);
    expect(toBaghdadParts(r.from).day).toBe(14);
    expect(toBaghdadParts(r.to).day).toBe(15);
  });

  it("«آخر 7 أيام» تشمل اليوم — سبعة لا ثمانية", () => {
    const r = resolveRange({ preset: "week" }, REF);
    expect(toBaghdadParts(r.from).day).toBe(9);
    expect(toBaghdadParts(r.to).day).toBe(16);
  });

  it("«هذا الشهر» يبدأ من الأول", () => {
    const r = resolveRange({ preset: "month" }, REF);
    const p = toBaghdadParts(r.from);
    expect([p.month, p.day]).toEqual([3, 1]);
  });

  it("«الشهر الماضي» كامل — ينتهي ببداية هذا الشهر", () => {
    const r = resolveRange({ preset: "prevMonth" }, REF);
    expect(toBaghdadParts(r.from)).toMatchObject({ year: 2026, month: 2, day: 1 });
    expect(toBaghdadParts(r.to)).toMatchObject({ year: 2026, month: 3, day: 1 });
  });

  it("«هذه السنة» من أوّل كانون الثاني", () => {
    const r = resolveRange({ preset: "year" }, REF);
    expect(toBaghdadParts(r.from)).toMatchObject({ year: 2026, month: 1, day: 1 });
  });

  it("والافتراضي «هذا الشهر» لا «كل الوقت»", () => {
    /* تقريرٌ بلا مدّة يمسح الدفتر كلّه في كل فتح */
    expect(resolveRange({}, REF).preset).toBe("month");
    expect(resolveRange({ preset: "لا-وجود-له" }, REF).preset).toBe("month");
  });
});

describe("المدّة المخصّصة", () => {
  it("تسبق `preset` وتشمل اليوم الأخير كاملاً", () => {
    const r = resolveRange(
      { preset: "today", from: "2026-03-01", to: "2026-03-10" },
      REF,
    );
    expect(r.preset).toBe("custom");
    expect(toBaghdadParts(r.from).day).toBe(1);
    /* ⚠️ الحادي عشر — أي أن العاشر داخلٌ كاملاً */
    expect(toBaghdadParts(r.to).day).toBe(11);
  });

  it("⚠️ والمقلوبة تُصحَّح لا تُردّ", () => {
    const r = resolveRange({ from: "2026-03-10", to: "2026-03-01" }, REF);
    expect(toBaghdadParts(r.from).day).toBe(1);
    expect(toBaghdadParts(r.to).day).toBe(11);
  });

  it("وطرفٌ واحد لا يكفي — يعود إلى الجاهز", () => {
    expect(resolveRange({ from: "2026-03-01" }, REF).preset).toBe("month");
  });
});
