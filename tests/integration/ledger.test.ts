import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import {
  assertLedgerProtected,
  cleanupTestData,
  connection,
  createFixture,
  type Fixture,
} from "./helpers";
import { computeBalance, detectBalanceDrift, postEntry } from "@/lib/ledger/post-entry";
import { prisma } from "@/lib/prisma";
import { BusinessRuleError, ConflictError } from "@/lib/errors";

/**
 * اختبار الدفتر على قاعدة حقيقية — تعريف إنجاز الخطوة 2.5.
 *
 * ⚠️ **بيانات ملتزَمة لا معاملة تُلغى.** اختبار التزامن الذي يجري داخل
 * معاملة واحدة لا يختبر تزامناً إطلاقاً: لا شيء يتنافس على القفل، فيمرّ
 * الاختبار على نظام معطوب. هنا معاملات متوازية حقيقية.
 */

let client: Client;
let f: Fixture;

beforeAll(async () => {
  client = connection();
  await client.connect();
  await cleanupTestData(client); // بقايا جولة سابقة فاشلة
  f = await createFixture(client, "ledger");
}, 90_000);

afterAll(async () => {
  await cleanupTestData(client);
  expect(await assertLedgerProtected(client), "حماية الدفتر لم تعد بعد التنظيف!").toBe(true);
  await client.end().catch(() => {});
  await prisma.$disconnect().catch(() => {});
}, 90_000);

describe("‏postEntry — المسار الوحيد", () => {
  it("يكتب قيداً ويُعيد الرصيد صحيحاً **فوراً** لا بعد مهمة لاحقة", async () => {
    const r = await postEntry({
      accountId: f.accountId,
      type: "CHARGE",
      source: "MANUAL",
      amountIqd: 75_000n,
      descriptionAr: "اشتراك المولدة - 5 أمبير - شهر 8/2026",
      reason: "قيد اختبار",
    });
    expect(r.balanceIqd).toBe(75_000n);
    expect(await computeBalance(f.accountId)).toBe(75_000n);
  });

  it("الدفعة تُنقص الرصيد — بلا أي فرع للإشارة (‏D2)", async () => {
    const r = await postEntry({
      accountId: f.accountId,
      type: "PAYMENT",
      source: "MANUAL",
      amountIqd: 25_000n,
      descriptionAr: "دفعة على الحساب",
      reason: "قيد اختبار",
    });
    expect(r.balanceIqd).toBe(50_000n);
  });

  it("يرفض ADJUSTMENT قبل أن يصل لقاعدة البيانات (‏D2/4)", async () => {
    await expect(
      postEntry({
        accountId: f.accountId,
        // @ts-expect-error — النوع نفسه يمنعها؛ نتحقّق من الحارس وقت التشغيل
        type: "ADJUSTMENT",
        source: "MANUAL",
        amountIqd: 1_000n,
        descriptionAr: "تسوية",
        reason: "س",
      }),
    ).rejects.toThrow(BusinessRuleError);
  });

  it("يرفض MANUAL بلا سبب", async () => {
    await expect(
      postEntry({
        accountId: f.accountId,
        type: "CHARGE",
        source: "MANUAL",
        amountIqd: 1_000n,
        descriptionAr: "تسوية بلا سبب",
      }),
    ).rejects.toThrow(/سبباً مكتوباً/u);
  });

  it("يرفض مبلغاً غير موجب", async () => {
    for (const amount of [0n, -5_000n]) {
      await expect(
        postEntry({
          accountId: f.accountId,
          type: "CHARGE",
          source: "MANUAL",
          amountIqd: amount,
          descriptionAr: "مبلغ غير صالح",
          reason: "س",
        }),
      ).rejects.toThrow(RangeError);
    }
  });

  it("يرفض وصفاً فارغاً — الساكن يقرأ هذا النصّ", async () => {
    await expect(
      postEntry({
        accountId: f.accountId,
        type: "CHARGE",
        source: "MANUAL",
        amountIqd: 1_000n,
        descriptionAr: "   ",
        reason: "س",
      }),
    ).rejects.toThrow(BusinessRuleError);
  });

  it("يرفض القيد على حساب مغلق (‏R16) — بفحص **داخل** المعاملة", async () => {
    await client.query(`update "Account" set status='CLOSED' where id=$1`, [f.accountId]);
    await expect(
      postEntry({
        accountId: f.accountId,
        type: "CHARGE",
        source: "MANUAL",
        amountIqd: 1_000n,
        descriptionAr: "قيد على حساب مغلق",
        reason: "س",
      }),
    ).rejects.toThrow(/حساب مغلق/u);
    await client.query(`update "Account" set status='OPEN' where id=$1`, [f.accountId]);
  });
});

describe("🔴 التزامن — أخطر اختبار في النظام", () => {
  it("**50 قيداً متوازياً ← الرصيد = Σ CHARGE − Σ PAYMENT بالضبط**", async () => {
    const before = await computeBalance(f.accountId);

    // 30 مديناً بـ1,000 و20 دائناً بـ400 ← صافي 30,000 − 8,000 = 22,000
    const jobs = [
      ...Array.from({ length: 30 }, (_, i) =>
        postEntry({
          accountId: f.accountId,
          type: "CHARGE" as const,
          source: "MANUAL" as const,
          amountIqd: 1_000n,
          descriptionAr: `قيد تزامن مدين ${i}`,
          reason: "اختبار تزامن",
        }),
      ),
      ...Array.from({ length: 20 }, (_, i) =>
        postEntry({
          accountId: f.accountId,
          type: "PAYMENT" as const,
          source: "MANUAL" as const,
          amountIqd: 400n,
          descriptionAr: `قيد تزامن دائن ${i}`,
          reason: "اختبار تزامن",
        }),
      ),
    ];

    const results = await Promise.all(jobs);
    expect(results).toHaveLength(50);

    const expected = before + 30_000n - 8_000n;

    // الرصيد المحسوب من الدفتر
    expect(await computeBalance(f.accountId)).toBe(expected);

    // والكاش المخزَّن — لا يكفي أن يكون الحساب صحيحاً إن كان الكاش منحرفاً
    const [row] = await client.query<{ balanceIqd: string }>(
      `select "balanceIqd" from "Account" where id=$1`,
      [f.accountId],
    ).then((r) => r.rows);
    expect(BigInt(row!.balanceIqd)).toBe(expected);
  }, 120_000);

  it("لا انحراف بين الكاش والدفتر بعد كل ذلك (‏R31)", async () => {
    const drift = await detectBalanceDrift();
    expect(drift.filter((d) => d.accountId === f.accountId)).toEqual([]);
  });

  it("كاشف الانحراف **يكتشف** فساداً مفتعلاً ولا يصلحه", async () => {
    await client.query(`update "Account" set "balanceIqd" = 999999 where id=$1`, [f.accountId]);

    const drift = await detectBalanceDrift();
    const mine = drift.find((d) => d.accountId === f.accountId);
    expect(mine, "الانحراف لم يُكتشف!").toBeDefined();
    expect(mine!.cachedIqd).toBe(999_999n);
    expect(mine!.computedIqd).not.toBe(999_999n);

    // ⚠️ لم يُصحَّح تلقائياً — التصحيح الصامت يخفي الخلل الذي سبّبه
    const [row] = await client.query<{ balanceIqd: string }>(
      `select "balanceIqd" from "Account" where id=$1`,
      [f.accountId],
    ).then((r) => r.rows);
    expect(BigInt(row!.balanceIqd)).toBe(999_999n);

    // يُصحَّح بقيد جديد يمرّ من postEntry
    const fixed = await postEntry({
      accountId: f.accountId,
      type: "CHARGE",
      source: "MANUAL",
      amountIqd: 1n,
      descriptionAr: "قيد تصحيح",
      reason: "إعادة مزامنة بعد فساد مفتعل",
    });
    expect(fixed.balanceIqd).toBe(await computeBalance(f.accountId));
  });
});

describe("‏Q3/V1 — الحماية من تكرار الفوترة عبر postEntry", () => {
  it("قيد إيجار لفترة ثم تكراره ← **ConflictError برسالة عربية مفهومة**", async () => {
    const periodStart = new Date("2026-09-01T00:00:00.000Z");
    await postEntry({
      accountId: f.accountId,
      type: "CHARGE",
      source: "RENT",
      amountIqd: 500_000n,
      descriptionAr: "إيجار شهر 9/2026",
      periodStart,
    });

    await expect(
      postEntry({
        accountId: f.accountId,
        type: "CHARGE",
        source: "RENT",
        amountIqd: 500_000n,
        descriptionAr: "إيجار شهر 9/2026",
        periodStart,
      }),
    ).rejects.toThrow(ConflictError);
  });

  it("**تشغيل الفوترة مرتين متوازيتين ← قيد واحد فقط**", async () => {
    const periodStart = new Date("2026-10-01T00:00:00.000Z");
    const attempt = () =>
      postEntry({
        accountId: f.accountId,
        type: "CHARGE" as const,
        source: "RENT" as const,
        amountIqd: 500_000n,
        descriptionAr: "إيجار شهر 10/2026",
        periodStart,
      });

    const results = await Promise.allSettled([attempt(), attempt(), attempt()]);
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok, "أكثر من قيد إيجار مرّ لنفس الفترة!").toHaveLength(1);

    const { rows } = await client.query<{ n: string }>(
      `select count(*) n from "LedgerEntry"
       where "accountId"=$1 and source='RENT' and "periodStart"=$2`,
      [f.accountId, periodStart.toISOString()],
    );
    expect(Number(rows[0]!.n)).toBe(1);
  }, 60_000);

  it("يرفض قيد اشتراك بلا periodStart — وإلا بطلت الحماية (‏Q39)", async () => {
    await expect(
      postEntry({
        accountId: f.accountId,
        type: "CHARGE",
        source: "SUBSCRIPTION",
        amountIqd: 75_000n,
        descriptionAr: "اشتراك بلا فترة",
        subscriptionId: "sub_x",
      }),
    ).rejects.toThrow(/periodStart/u);
  });
});
