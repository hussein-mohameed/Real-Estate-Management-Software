import { describe, expect, it } from "vitest";
import {
  resolvePayerAccount,
  type ContractAccount,
  type PayerContext,
} from "./payer";
import type { OwnershipStatus, PayerType } from "@/lib/domain/enums";

/**
 * الخطوة 2.3 — تعريف الإنجاز حرفياً:
 *   «جدول اختبارات: كل تركيبة (مباعة/غير مباعة × مؤجّرة/غير مؤجّرة ×
 *    `OWNER`/`OCCUPANT`) تُنتج الحساب المتوقّع أو الخطأ المتوقّع —
 *    **ثماني حالات صريحة**.»
 *
 * الجدول أدناه هو الاختبار نفسه: كل صفّ حالة، ولا حالة بلا صفّ.
 */

const SALE: ContractAccount = {
  contractId: "c_sale",
  contractNumber: "CTR-2026-0001",
  type: "SALE",
  accountId: "acc_sale",
  accountStatus: "OPEN",
  holderUserId: "u_owner",
};

const RENTAL: ContractAccount = {
  contractId: "c_rent",
  contractNumber: "CTR-2026-0002",
  type: "RENTAL",
  accountId: "acc_rental",
  accountStatus: "OPEN",
  holderUserId: "u_tenant",
};

const ctx = (
  contracts: ContractAccount[],
  ownershipStatus: OwnershipStatus = "SOLD",
): PayerContext => ({
  apartmentDisplayNumber: "A-3-12",
  ownershipStatus,
  activeContracts: contracts,
});

// ═══════════════════════════════════════════════════════════════════════
//  الحالات الثماني
// ═══════════════════════════════════════════════════════════════════════

interface Row {
  n: number;
  sold: boolean;
  rented: boolean;
  payer: PayerType;
  expect: "acc_sale" | "acc_rental" | "error";
  why: string;
}

const TABLE: Row[] = [
  {
    n: 1,
    sold: true,
    rented: true,
    payer: "OWNER",
    expect: "acc_sale",
    why: "مباعة ومؤجّرة — الخدمة على المالك ← حساب التمليك. **الحالة التي وُجد payerType من أجلها**",
  },
  {
    n: 2,
    sold: true,
    rented: true,
    payer: "OCCUPANT",
    expect: "acc_rental",
    why: "مباعة ومؤجّرة — الساكن الفعلي هو المستأجر ← حساب الإيجار",
  },
  {
    n: 3,
    sold: true,
    rented: false,
    payer: "OWNER",
    expect: "acc_sale",
    why: "مباعة غير مؤجّرة — المالك ساكن ومالك ← حساب التمليك",
  },
  {
    n: 4,
    sold: true,
    rented: false,
    payer: "OCCUPANT",
    expect: "acc_sale",
    why: "مباعة غير مؤجّرة — الساكن الفعلي هو المالك ← حساب التمليك",
  },
  {
    n: 5,
    sold: false,
    rented: true,
    payer: "OWNER",
    expect: "error",
    why: "غير مباعة ومؤجّرة — لا عقد تمليك، والخدمة على المالك ← يُرفض ويُشرَح (‏Q36 يغطّي RENTED_BY_COMPANY وحدها)",
  },
  {
    n: 6,
    sold: false,
    rented: true,
    payer: "OCCUPANT",
    expect: "acc_rental",
    why: "غير مباعة ومؤجّرة — الساكن هو المستأجر ← حساب الإيجار",
  },
  {
    n: 7,
    sold: false,
    rented: false,
    payer: "OWNER",
    expect: "error",
    why: "لا عقد نشط إطلاقاً ← لا حساب",
  },
  {
    n: 8,
    sold: false,
    rented: false,
    payer: "OCCUPANT",
    expect: "error",
    why: "لا عقد نشط إطلاقاً ← لا حساب",
  },
];

describe("🔴 R28 — الحالات الثماني", () => {
  it.each(TABLE)(
    "$n) مباعة=$sold · مؤجّرة=$rented · $payer ← $expect",
    ({ sold, rented, payer, expect: want }) => {
      const contracts = [
        ...(sold ? [SALE] : []),
        ...(rented ? [RENTAL] : []),
      ];
      const ownership: OwnershipStatus = sold ? "SOLD" : "UNSOLD";
      const r = resolvePayerAccount(payer, ctx(contracts, ownership));

      if (want === "error") {
        expect(r.ok).toBe(false);
        if (r.ok) return;
        // §11.4: الرسالة عربية وتسمّي الشقة والسبب — لا خطأ عام
        expect(r.messageAr).toContain("A-3-12");
        expect(r.messageAr).not.toMatch(/[A-Za-z]{4,}/);
      } else {
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.accountId).toBe(want);
      }
    },
  );

  it("الجدول يغطّي التركيبات الثماني بلا نقص ولا تكرار", () => {
    expect(TABLE).toHaveLength(8);
    const keys = TABLE.map((r) => `${r.sold}|${r.rented}|${r.payer}`);
    expect(new Set(keys).size).toBe(8);
  });
});

// ═══════════════════════════════════════════════════════════════════════

describe("🔴 Q36 — وحدة يملكها المجمّع ويؤجّرها", () => {
  it("خدمة على المالك تُقيَّد على **حساب الإيجار**", () => {
    /**
     * ⚠️ لا عقد تمليك ولا يمكن أن يوجد: **المجمّع نفسه ليس له `Account`**.
     * حسمت خطة الجسر أن `payerType = OWNER` عليها يُقيَّد على حساب
     * الإيجار.
     */
    const r = resolvePayerAccount("OWNER", ctx([RENTAL], "RENTED_BY_COMPANY"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.accountId).toBe("acc_rental");
    expect(r.reasonAr).toContain("Q36");
  });

  it("⚠️ **والقيد محصور بهذه الحالة وحدها**", () => {
    /**
     * على وحدة **مباعة** ومؤجّرة يبقى المالك هو المُقيَّد عليه. توسيع
     * القاعدة كان سيُحمّل المستأجر ما ليس عليه — دَينٌ يُطالَب به من
     * ليس عليه، وهو أسوأ ما يُنتجه خطأ في هذه الدالّة.
     */
    const r = resolvePayerAccount("OWNER", ctx([SALE, RENTAL], "SOLD"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.accountId).toBe("acc_sale");
  });

  it("وبلا عقد إيجار حتى على RENTED_BY_COMPANY ← يُرفض", () => {
    const r = resolvePayerAccount("OWNER", ctx([], "RENTED_BY_COMPANY"));
    expect(r.ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════

describe("الحساب المغلق", () => {
  it("يُرفَض هنا — والرسالة تسمّي العقد", () => {
    /**
     * ⚠️ الرفض المتأخّر في `postEntry` يُنتج رسالة عامة بعد أن يكون
     * المستخدم أتمّ النموذج كلّه. الرفض هنا يسمّي العقد والسبب.
     */
    const closed: ContractAccount = { ...SALE, accountStatus: "CLOSED" };
    const r = resolvePayerAccount("OWNER", ctx([closed]));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.messageAr).toContain("CTR-2026-0001");
    expect(r.messageAr).toContain("مغلق");
  });

  it("والساكن لا يقع على حساب مغلق ولو كان الوحيد", () => {
    const closed: ContractAccount = { ...RENTAL, accountStatus: "CLOSED" };
    const r = resolvePayerAccount("OCCUPANT", ctx([closed], "UNSOLD"));
    expect(r.ok).toBe(false);
  });

  it("لكن إغلاق الإيجار لا يمنع الوقوع على التمليك للمالك", () => {
    const closedRental: ContractAccount = { ...RENTAL, accountStatus: "CLOSED" };
    const r = resolvePayerAccount("OWNER", ctx([SALE, closedRental]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.accountId).toBe("acc_sale");
  });
});

// ═══════════════════════════════════════════════════════════════════════

describe("الرسائل تشرح لا تعتذر (‏R28 · §11.4)", () => {
  it("«على المالك ولا تمليك» تقترح الفعل", () => {
    const r = resolvePayerAccount("OWNER", ctx([RENTAL], "UNSOLD"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.messageAr).toContain("عقد تمليك نشط");
    // تقول للأدمن ما يفعل، لا «تعذّر التنفيذ»
    expect(r.messageAr).toMatch(/فعّل|غيّر/);
  });

  it("«لا عقد إطلاقاً» تسمّي الحالتين", () => {
    const r = resolvePayerAccount("OCCUPANT", ctx([], "UNSOLD"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.messageAr).toContain("لا إيجار ولا تمليك");
  });

  it("النجاح يحمل سبباً يُقرأ ويُسجَّل", () => {
    const r = resolvePayerAccount("OCCUPANT", ctx([SALE, RENTAL]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.reasonAr).toContain("المستأجر");
    expect(r.via.contractNumber).toBe("CTR-2026-0002");
  });
});
