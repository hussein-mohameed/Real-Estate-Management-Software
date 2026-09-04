import { describe, expect, it } from "vitest";
import {
  countApartments,
  generateApartments,
  previewApartments,
  renderDisplayNumber,
  type BuildingSpec,
} from "./apartment-generator";

const base: BuildingSpec = {
  code: "A",
  floorsCount: 5,
  unitsPerFloor: 5,
  numberingScheme: "SEQUENTIAL",
  displayNumberFormat: "{building}-{floor}-{unit}",
};

const gen = (spec: Partial<BuildingSpec> = {}) => {
  const r = generateApartments({ ...base, ...spec });
  if (!r.ok) throw new Error(`فشل التوليد: ${r.messageAr}`);
  return r.apartments;
};

describe("§4.8 — مخططا الترقيم", () => {
  it("SEQUENTIAL: الترقيم متّصل عبر البناية", () => {
    const a = gen({ floorsCount: 2, unitsPerFloor: 4 });
    expect(a.filter((x) => x.floorNumber === 1).map((x) => x.unitNumber)).toEqual([1, 2, 3, 4]);
    expect(a.filter((x) => x.floorNumber === 2).map((x) => x.unitNumber)).toEqual([5, 6, 7, 8]);
  });

  it("PER_FLOOR: الترقيم يبدأ من جديد كل طابق", () => {
    const a = gen({ floorsCount: 2, unitsPerFloor: 5, numberingScheme: "PER_FLOOR" });
    expect(a.filter((x) => x.floorNumber === 1).map((x) => x.unitNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(a.filter((x) => x.floorNumber === 2).map((x) => x.unitNumber)).toEqual([1, 2, 3, 4, 5]);
  });

  it("🔴 **PER_FLOOR يُنتج unitNumber مكرَّراً** — فهو ليس مفتاحاً فريداً وحده", () => {
    const a = gen({ floorsCount: 3, unitsPerFloor: 4, numberingScheme: "PER_FLOOR" });
    const units = a.map((x) => x.unitNumber);
    expect(new Set(units).size).toBe(4); // 12 شقة بأربعة أرقام وحدات فقط

    // المفتاح الفريد هو الثلاثي، وdisplayNumber فريد داخل البناية
    const triples = a.map((x) => `${x.floorNumber}/${x.unitNumber}`);
    expect(new Set(triples).size).toBe(12);
    expect(new Set(a.map((x) => x.displayNumber)).size).toBe(12);
  });

  it("‏5 طوابق × 5 وحدات ← 25 شقة (تعريف إنجاز 1.1)", () => {
    expect(gen()).toHaveLength(25);
    expect(countApartments(base)).toBe(25);
  });
});

describe("قوالب رقم العرض — كل الرموز", () => {
  it("يملأ الرموز الأربعة", () => {
    expect(
      renderDisplayNumber("{building}-{floor}-{unit}-{seq}", {
        building: "B",
        floor: 2,
        unit: 3,
        seq: 8,
      }),
    ).toBe("B-2-3-8");
  });

  it("يكرّر الرمز الواحد أينما ورد", () => {
    expect(
      renderDisplayNumber("{floor}{floor}-{unit}", { building: "A", floor: 3, unit: 1 , seq: 1 }),
    ).toBe("33-1");
  });

  it("قوالب مختلفة تُنتج أرقاماً مختلفة للشقة نفسها", () => {
    const spec = { floorsCount: 2, unitsPerFloor: 2 } as const;
    expect(gen({ ...spec, displayNumberFormat: "{building}-{floor}-{unit}" })[3]!.displayNumber)
      .toBe("A-2-4");
    expect(gen({ ...spec, displayNumberFormat: "{building}{seq}" })[3]!.displayNumber).toBe("A4");
    expect(gen({ ...spec, displayNumberFormat: "شقة {seq}" })[3]!.displayNumber).toBe("شقة 4");
  });

  it("**قالب بلا رمز متغيّر مرفوض** — كان سيُنتج 25 شقة بنفس الرقم", () => {
    const r = generateApartments({ ...base, displayNumberFormat: "{building}" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("format-no-token");
  });

  it("**قالب يُنتج تكراراً مرفوض قبل الكتابة** لا بعد إدراج 24 صفاً", () => {
    // {unit} وحده في PER_FLOOR يتكرّر بين الطوابق
    const r = generateApartments({
      ...base,
      numberingScheme: "PER_FLOOR",
      displayNumberFormat: "{building}-{unit}",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("duplicate-display-number");
      expect(r.messageAr).toContain("A-1");
    }
  });

  it("نفس القالب في SEQUENTIAL **صالح** — لأن unitNumber لا يتكرّر", () => {
    const r = generateApartments({ ...base, displayNumberFormat: "{building}-{unit}" });
    expect(r.ok).toBe(true);
  });
});

describe("🔴 Q43 — الطوابق التي تختلف عن الافتراضي", () => {
  it("التجاوز يغيّر عدد وحدات طابق بعينه", () => {
    const a = gen({
      floorsCount: 3,
      unitsPerFloor: 4,
      floorOverrides: new Map([[2, 6]]),
    });
    expect(a.filter((x) => x.floorNumber === 1)).toHaveLength(4);
    expect(a.filter((x) => x.floorNumber === 2)).toHaveLength(6);
    expect(a.filter((x) => x.floorNumber === 3)).toHaveLength(4);
    expect(a).toHaveLength(14);
  });

  it("**`seq` يبقى صحيحاً بعد تجاوز** — الصيغة بالضرب كانت ستكسره", () => {
    const a = gen({
      floorsCount: 3,
      unitsPerFloor: 4,
      floorOverrides: new Map([[1, 6]]),
      numberingScheme: "PER_FLOOR",
    });
    // الطابق الأول 6 وحدات، فأول وحدة في الطابق الثاني تسلسلها 7
    const firstOfSecond = a.find((x) => x.floorNumber === 2 && x.unitNumber === 1);
    expect(firstOfSecond?.seq).toBe(7);
    // الصيغة الشائعة (floor-1)*unitsPerFloor+unit كانت ستعطي 5 — خطأ صامت
    expect(firstOfSecond?.seq).not.toBe(5);
  });

  it("‏SEQUENTIAL مع تجاوز: unitNumber يتبع التسلسل الحقيقي", () => {
    const a = gen({
      floorsCount: 2,
      unitsPerFloor: 3,
      floorOverrides: new Map([[1, 5]]),
    });
    expect(a.filter((x) => x.floorNumber === 1).map((x) => x.unitNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(a.filter((x) => x.floorNumber === 2).map((x) => x.unitNumber)).toEqual([6, 7, 8]);
  });

  it("تجاوز لطابق خارج النطاق مرفوض برسالة تسمّي الطابق", () => {
    const r = generateApartments({ ...base, floorOverrides: new Map([[9, 3]]) });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("override-floor-out-of-range");
      expect(r.messageAr).toContain("9");
    }
  });

  it("عدد وحدات غير صالح في التجاوز مرفوض", () => {
    for (const bad of [0, -2, 1.5]) {
      const r = generateApartments({ ...base, floorOverrides: new Map([[1, bad]]) });
      expect(r.ok, String(bad)).toBe(false);
    }
  });

  it("countApartments يحسب التجاوزات", () => {
    expect(
      countApartments({ ...base, floorsCount: 3, unitsPerFloor: 4, floorOverrides: new Map([[2, 6]]) }),
    ).toBe(14);
  });
});

describe("المدخلات غير الصالحة — برسائل عربية", () => {
  it("طوابق أو وحدات غير صالحة", () => {
    for (const spec of [
      { floorsCount: 0 },
      { floorsCount: -1 },
      { floorsCount: 2.5 },
      { unitsPerFloor: 0 },
      { unitsPerFloor: -3 },
    ]) {
      const r = generateApartments({ ...base, ...spec });
      expect(r.ok, JSON.stringify(spec)).toBe(false);
    }
  });

  it("قالب فارغ", () => {
    const r = generateApartments({ ...base, displayNumberFormat: "   " });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("format-empty");
  });

  it("لا رسالة خطأ بالإنجليزية", () => {
    for (const spec of [
      { floorsCount: 0 },
      { displayNumberFormat: "" },
      { displayNumberFormat: "ثابت" },
      { floorOverrides: new Map([[9, 3]]) },
    ]) {
      const r = generateApartments({ ...base, ...spec });
      if (!r.ok) {
        const withoutTokens = r.messageAr.replace(/\{[a-z]+\}/gu, "");
        expect(/[a-zA-Z]{4,}/u.test(withoutTokens), JSON.stringify(spec)).toBe(false);
      }
    }
  });
});

describe("المعاينة الحيّة — قبل الحفظ لا بعده", () => {
  it("تعطي عيّنة والعدد الكلي", () => {
    const p = previewApartments(base);
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.total).toBe(25);
      expect(p.apartments).toHaveLength(4); // 3 أوائل + الأخيرة
      expect(p.apartments[0]!.displayNumber).toBe("A-1-1");
      expect(p.apartments[3]!.displayNumber).toBe("A-5-25");
    }
  });

  it("تُظهر خطأ القالب **قبل** أي كتابة", () => {
    const p = previewApartments({ ...base, displayNumberFormat: "ثابت" });
    expect(p.ok).toBe(false);
  });

  it("بناية صغيرة تُعرض كاملة", () => {
    const p = previewApartments({ ...base, floorsCount: 1, unitsPerFloor: 2 });
    if (p.ok) expect(p.apartments).toHaveLength(2);
  });
});
