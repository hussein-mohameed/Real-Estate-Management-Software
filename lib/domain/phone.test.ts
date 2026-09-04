import { describe, expect, it } from "vitest";
import {
  formatPhoneForDisplay,
  isNormalized,
  normalizePhone,
  normalizePhoneOrThrow,
  whatsappLink,
} from "./phone";

const ok = (input: string): string => {
  const r = normalizePhone(input);
  if (!r.ok) throw new Error(`رُفض بلا داعٍ: ${input} — ${r.messageAr}`);
  return r.phone;
};

describe("R3 — كل الصيغ التي يكتبها الناس تُنتج قيمة واحدة", () => {
  it("الصيغ الشائعة كلها تتطابق", () => {
    const expected = "+9647701234567";
    for (const variant of [
      "07701234567",
      "0770 123 4567",
      "0770-123-4567",
      "+9647701234567",
      "+964 770 123 4567",
      "009647701234567",
      "9647701234567",
      "7701234567",
      "(0770) 123-4567",
    ]) {
      expect(ok(variant), variant).toBe(expected);
    }
  });

  it("الأرقام الهندية-العربية تُقبل — لوحة المفاتيح العربية تنتجها", () => {
    expect(ok("٠٧٧٠١٢٣٤٥٦٧")).toBe("+9647701234567");
  });

  it("كل بادئات المشغّلين العراقيين", () => {
    for (const p of ["70", "75", "77", "78", "79"]) {
      expect(ok(`0${p}01234567`)).toBe(`+964${p}01234567`);
    }
  });
});

describe("الرفض — برسالة عربية تشرح السبب", () => {
  it("رقم غير عراقي", () => {
    const r = normalizePhone("+12025550123");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("not-iraqi");
      expect(r.messageAr).toContain("عراقياً");
    }
  });

  it("طول خاطئ", () => {
    for (const bad of ["077012345", "0770123456789"]) {
      const r = normalizePhone(bad);
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.reason).toBe("bad-length");
    }
  });

  it("**بادئة مشغّل غير موجودة** — 076 و071 ليستا عراقيتين", () => {
    for (const bad of ["07601234567", "07101234567"]) {
      const r = normalizePhone(bad);
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.reason).toBe("bad-prefix");
    }
  });

  it("الفارغ", () => {
    for (const bad of ["", "   "]) {
      const r = normalizePhone(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("empty");
    }
  });

  it("لا رسالة خطأ بالإنجليزية", () => {
    for (const bad of ["", "+12025550123", "077", "07601234567"]) {
      const r = normalizePhone(bad);
      if (!r.ok) expect(/[a-zA-Z]{4,}/u.test(r.messageAr), bad).toBe(false);
    }
  });
});

describe("الثبات — التطبيع لا يغيّر المُطبَّع", () => {
  it("تطبيع المُطبَّع يعطي نفسه", () => {
    const once = ok("07701234567");
    expect(ok(once)).toBe(once);
    expect(isNormalized(once)).toBe(true);
  });

  it("isNormalized يرفض غير المخزَّن بالصيغة", () => {
    expect(isNormalized("07701234567")).toBe(false);
    expect(isNormalized("+9647701234567")).toBe(true);
  });
});

describe("مساعدات العرض", () => {
  it("العرض للبشر — والمخزَّن يبقى E.164", () => {
    expect(formatPhoneForDisplay("+9647701234567")).toBe("0770 123 4567");
  });

  it("رابط واتساب بلا + (‏§8.3)", () => {
    expect(whatsappLink("+9647701234567")).toBe("https://wa.me/9647701234567");
  });

  it("normalizePhoneOrThrow يرمي برسالة عربية", () => {
    expect(() => normalizePhoneOrThrow("abc")).toThrow(/عراقياً/u);
    expect(normalizePhoneOrThrow("07701234567")).toBe("+9647701234567");
  });
});
