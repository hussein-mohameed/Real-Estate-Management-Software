import { describe, expect, it } from "vitest";
import {
  APARTMENT_LOOKUP_FIELDS,
  SECURITY_GATE_FIELDS,
  assertNoFinancialLeak,
  decideApartmentAccess,
  requestGrantsApartmentAccess,
  type ApartmentAccessFacts,
} from "./access";
import {
  CAPABILITIES,
  OWNER_FORBIDDEN_OPERATIONS,
  PERMISSION_MATRIX,
  ROLE_HOME,
  ROLE_LABELS_AR,
  USER_ROLES,
  can,
  cell,
  isOwnScoped,
  isRequestBased,
  rolesThatCanRead,
  rolesThatCanWrite,
} from "./roles";

describe("اكتمال المصفوفة — لا خلية منسية", () => {
  it("‏23 قدرة بالضبط كما في §3.2", () => {
    expect(CAPABILITIES).toHaveLength(23);
    expect(new Set(CAPABILITIES).size).toBe(23); // لا تكرار
  });

  it("‏4 أدوار بالضبط", () => {
    expect(USER_ROLES).toHaveLength(4);
  });

  it("‏92 خلية كلها معرَّفة صراحةً (‏23 × 4)", () => {
    let defined = 0;
    for (const capability of CAPABILITIES) {
      for (const role of USER_ROLES) {
        const c = PERMISSION_MATRIX[capability][role];
        expect(c, `${capability}/${role}`).toBeDefined();
        expect(c.level, `${capability}/${role}`).toBeTruthy();
        expect(c.specValue, `${capability}/${role} بلا قيمة مواصفة`).toBeTruthy();
        defined += 1;
      }
    }
    expect(defined).toBe(92);
  });

  it("كل قدرة لها تسمية عربية، وكل دور كذلك", () => {
    for (const capability of CAPABILITIES) {
      expect(PERMISSION_MATRIX[capability]).toBeDefined();
    }
    for (const role of USER_ROLES) {
      expect(ROLE_LABELS_AR[role]).toBeTruthy();
      expect(ROLE_HOME[role]).toMatch(/^\//u);
    }
  });

  it("كل خلية اختلف مستواها عن نصّ المواصفة تحمل سبب التصحيح", () => {
    for (const capability of CAPABILITIES) {
      for (const role of USER_ROLES) {
        const c = cell(role, capability);
        if (c.specValue.startsWith("F") && c.level !== "FULL") {
          expect(c.correction, `${capability}/${role} خُفِّض بلا سبب موثَّق`).toBeTruthy();
        }
      }
    }
  });
});

describe("D3 — المالك قراءة فقط على العمليات", () => {
  it("لا يستطيع تنفيذ أي فعل عملياتي كتابي", () => {
    for (const capability of OWNER_FORBIDDEN_OPERATIONS) {
      expect(can("OWNER", capability, "create"), capability).toBe(false);
      expect(can("OWNER", capability, "update"), capability).toBe(false);
      expect(can("OWNER", capability, "delete"), capability).toBe(false);
    }
  });

  it("يقرأ ويُصدّر كل ما مُنع من كتابته — «قراءة كاملة + تصدير»", () => {
    for (const capability of OWNER_FORBIDDEN_OPERATIONS) {
      expect(can("OWNER", capability, "read"), capability).toBe(true);
      expect(can("OWNER", capability, "export"), capability).toBe(true);
    }
  });

  it("استثناءان كتابيان فقط: إعدادات المجمّع والمستخدمون", () => {
    const writable = CAPABILITIES.filter(
      (c) => can("OWNER", c, "create") || can("OWNER", c, "update"),
    );
    expect(new Set(writable)).toEqual(
      new Set(["COMPOUND_SETTINGS", "USERS_AND_ROLES", "FINANCIAL_REPORTS"]),
    );
  });

  it("إنشاء المستخدمين مسموح للمالك — بدونه لا مسار إقلاع للنظام", () => {
    expect(can("OWNER", "USERS_AND_ROLES", "create")).toBe(true);
  });
});

describe("§3.3 — الموظف لا يحذف أبداً، وكتابة الساكن بنظام الطلب", () => {
  it("لا قدرة واحدة يملك فيها الموظف الحذف", () => {
    for (const capability of CAPABILITIES) {
      expect(can("STAFF", capability, "delete"), capability).toBe(false);
    }
  });

  it("الساكن لا يحذف ولا يعدّل مباشرةً في أي قدرة", () => {
    for (const capability of CAPABILITIES) {
      expect(can("RESIDENT", capability, "delete"), capability).toBe(false);
      expect(can("RESIDENT", capability, "update"), capability).toBe(false);
    }
  });

  it("كل كتابة للساكن معلَّمة requestBased", () => {
    const residentWrites = CAPABILITIES.filter((c) => isRequestBased("RESIDENT", c));
    expect(residentWrites).toEqual(
      expect.arrayContaining([
        "RESIDENT_PROFILES",
        "SUBSCRIPTIONS",
        "VEHICLES",
        "CREATE_PAYMENT_LINK",
      ]),
    );
  });

  it("وصول الساكن على العقود والدفتر مقصور على صفوفه (OWN)", () => {
    for (const capability of ["CONTRACTS", "LEDGER_AND_ACCOUNTS", "INVOICES"] as const) {
      expect(isOwnScoped("RESIDENT", capability), capability).toBe(true);
      expect(isOwnScoped("ADMIN", capability), capability).toBe(false);
    }
  });

  it("كل وصول للساكن مقصور على صفوفه أو معدوم أو قراءة كتالوج", () => {
    for (const capability of CAPABILITIES) {
      const level = cell("RESIDENT", capability).level;
      expect(["NONE", "OWN", "READ"], capability).toContain(level);
    }
  });
});

describe("D3/1 — طبقتان بمعيارين مختلفين", () => {
  it("المالك ضمن أدوار القراءة على قدرات الأدمن (فيدخل layout الأدمن)", () => {
    expect(rolesThatCanRead("CONTRACTS")).toContain("OWNER");
    expect(rolesThatCanRead("LEDGER_AND_ACCOUNTS")).toContain("OWNER");
  });

  it("المالك خارج أدوار الكتابة على القدرات نفسها", () => {
    expect(rolesThatCanWrite("CONTRACTS")).not.toContain("OWNER");
    expect(rolesThatCanWrite("LEDGER_AND_ACCOUNTS")).not.toContain("OWNER");
    expect(rolesThatCanWrite("RECORD_CASH_PAYMENT")).toEqual(["ADMIN", "STAFF"]);
  });
});

describe("D4 — نطاق الموظف هو التكليف الفعلي", () => {
  const base: ApartmentAccessFacts = {
    role: "STAFF",
    hasActiveResidentLink: false,
    hasOpenAssignedRequest: false,
    hasActiveFollowUpInstallment: false,
  };

  it("الأدمن والمالك: نطاق المجمّع كله", () => {
    expect(decideApartmentAccess({ ...base, role: "ADMIN" }).allowed).toBe(true);
    expect(decideApartmentAccess({ ...base, role: "OWNER" }).allowed).toBe(true);
  });

  it("موظف بلا تكليف: ممنوع", () => {
    expect(decideApartmentAccess(base).allowed).toBe(false);
  });

  it("موظف بطلب مفتوح مُكلَّف به: مسموح", () => {
    expect(
      decideApartmentAccess({ ...base, hasOpenAssignedRequest: true }).allowed,
    ).toBe(true);
  });

  it("موظف بقسط متابعة نشط: مسموح", () => {
    expect(
      decideApartmentAccess({ ...base, hasActiveFollowUpInstallment: true }).allowed,
    ).toBe(true);
  });

  it("**يفقد الوصول لحظة إغلاق الطلب** — الحقيقة تصير false فيُمنع", () => {
    const withOpen = { ...base, hasOpenAssignedRequest: true };
    expect(decideApartmentAccess(withOpen).allowed).toBe(true);
    const afterClose = { ...withOpen, hasOpenAssignedRequest: false };
    expect(decideApartmentAccess(afterClose).allowed).toBe(false);
  });

  it("الساكن: رابط نشط فقط", () => {
    expect(
      decideApartmentAccess({ ...base, role: "RESIDENT", hasActiveResidentLink: true })
        .allowed,
    ).toBe(true);
    expect(decideApartmentAccess({ ...base, role: "RESIDENT" }).allowed).toBe(false);
  });

  it("Q41 — الموظف المقيم يصل لشقّته بنطاق الساكن لا بالدور", () => {
    const guardAtHome = { ...base, hasActiveResidentLink: true };
    const decision = decideApartmentAccess(guardAtHome);
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toContain("Q41");
  });
});

describe("Q35 — طلب المنطقة المشتركة لا يمنح وصولاً لأي شقة", () => {
  it("يُستثنى صراحةً", () => {
    expect(
      requestGrantsApartmentAccess({ scope: "COMMON_AREA", apartmentId: null }),
    ).toBe(false);
  });

  it("حتى لو أُلحق بشقة بالخطأ", () => {
    expect(
      requestGrantsApartmentAccess({ scope: "COMMON_AREA", apartmentId: "apt_1" }),
    ).toBe(false);
  });

  it("طلب الشقة العادي يمنح", () => {
    expect(
      requestGrantsApartmentAccess({ scope: "APARTMENT", apartmentId: "apt_1" }),
    ).toBe(true);
  });

  it("طلب شقة بلا معرّف لا يمنح", () => {
    expect(
      requestGrantsApartmentAccess({ scope: "APARTMENT", apartmentId: null }),
    ).toBe(false);
  });
});

describe("D4/2 — السطحان الضيّقان بلا أي إجماليات مالية", () => {
  it("«بحث عن شقة» نظيف", () => {
    expect(() => assertNoFinancialLeak(APARTMENT_LOOKUP_FIELDS, "بحث عن شقة")).not.toThrow();
  });

  it("«بوّابة الأمن» نظيف", () => {
    expect(() => assertNoFinancialLeak(SECURITY_GATE_FIELDS, "بوّابة الأمن")).not.toThrow();
  });

  it("الفحص يكشف التسرّب لو أُضيف حقل مالي لاحقاً", () => {
    expect(() =>
      assertNoFinancialLeak([...SECURITY_GATE_FIELDS, "account.balanceIqd"], "بوّابة الأمن"),
    ).toThrow(/تسرّب مالي/u);
  });
});
