import { describe, expect, it } from "vitest";
import { buildSchedule } from "@/lib/services/installments";

/**
 * جدول الأقساط — القرار `B1` (‏2026-09-02): **المقدّمة مقبوضة، والأقساط
 * على الباقي**.
 *
 * ⚠️ دالّة نقيّة، فتُختبَر بلا قاعدة بيانات. والحساب هنا هو الذي يقرّر
 * ملايين على كل عقد — يستحقّ اختباراً لا يلمس الشبكة.
 */

const base = {
  contractId: "c1",
  installmentsCount: 40,
  intervalMonths: 1,
  startDate: new Date("2026-10-01T00:00:00Z"),
};

describe("buildSchedule — المبلغ المُقسَّم هو المتبقّي", () => {
  it("🔴 يقسّم على (الكامل − المقدّمة) لا على الكامل", () => {
    /*
     * هذا **جوهر B1**. القسمة على الكامل تُنتج مجموعاً أكبر من قيمة العقد
     * بمقدار المقدّمة — خطأً لا يكشفه شيء إلا جمع الأعمدة بيد بعد سنة.
     */
    const rows = buildSchedule({
      ...base,
      totalAmountIqd: 50_000_000n,
      downPaymentIqd: 10_000_000n,
    });

    const sum = rows.reduce((n, r) => n + r.amountIqd, 0n);
    expect(sum, "المجموع ليس المتبقّي").toBe(40_000_000n);
    expect(sum + 10_000_000n, "المجموع مع المقدّمة ≠ قيمة العقد").toBe(50_000_000n);
    expect(rows).toHaveLength(40);
    expect(rows[0]?.amountIqd).toBe(1_000_000n);
  });

  it("‏R18: الباقي في القسط الأخير — المجموع يطابق بالضبط", () => {
    /* 7,000,003 على 3 لا تقبل القسمة — والفلوس لا تُقرَّب */
    const rows = buildSchedule({
      ...base,
      installmentsCount: 3,
      totalAmountIqd: 7_000_003n,
      downPaymentIqd: 0n,
    });

    expect(rows.map((r) => r.amountIqd)).toEqual([
      2_333_334n,
      2_333_334n,
      2_333_335n,
    ]);
    expect(rows.reduce((n, r) => n + r.amountIqd, 0n)).toBe(7_000_003n);
  });

  it("بلا مقدّمة يقسّم على الكامل", () => {
    const rows = buildSchedule({ ...base, totalAmountIqd: 40_000_000n, downPaymentIqd: 0n });
    expect(rows.reduce((n, r) => n + r.amountIqd, 0n)).toBe(40_000_000n);
  });

  it("⚠️ المقدّمة تساوي القيمة تُرفض — لا خطة بلا متبقّي", () => {
    /* خطةٌ بأصفار تظهر في القائمة فيظنّ الأدمن أنها تعمل */
    expect(() =>
      buildSchedule({ ...base, totalAmountIqd: 50_000_000n, downPaymentIqd: 50_000_000n }),
    ).toThrow(/لا متبقّي/);
  });

  it("⚠️ المقدّمة أكبر من القيمة تُرفض", () => {
    expect(() =>
      buildSchedule({ ...base, totalAmountIqd: 10_000_000n, downPaymentIqd: 20_000_000n }),
    ).toThrow(/أكبر من قيمة العقد/);
  });

  it("المقدّمة السالبة تُرفض", () => {
    expect(() =>
      buildSchedule({ ...base, totalAmountIqd: 10_000_000n, downPaymentIqd: -1n }),
    ).toThrow(/لا تكون سالبة/);
  });
});

describe("buildSchedule — التواريخ", () => {
  it("‏startDate هو أوّل قسط، والفترة تتراكم", () => {
    const rows = buildSchedule({
      ...base,
      installmentsCount: 3,
      intervalMonths: 3,
      totalAmountIqd: 3_000_000n,
      downPaymentIqd: 0n,
    });

    /* ⚠️ ربعيّ: 3 أشهر بين قسط وآخر لا شهراً */
    const months = rows.map((r) => r.dueDate.getUTCMonth());
    expect(new Set(months).size, "التواريخ متطابقة — الفترة لم تتراكم").toBe(3);
    expect(rows[0]?.sequence).toBe(1);
    expect(rows[2]?.sequence).toBe(3);
    expect(rows[1]!.dueDate.getTime()).toBeGreaterThan(rows[0]!.dueDate.getTime());
    expect(rows[2]!.dueDate.getTime()).toBeGreaterThan(rows[1]!.dueDate.getTime());
  });

  it("قسط واحد يُقبَل", () => {
    const rows = buildSchedule({
      ...base,
      installmentsCount: 1,
      totalAmountIqd: 5_000_000n,
      downPaymentIqd: 1_000_000n,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amountIqd).toBe(4_000_000n);
  });
});
