import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { cleanupTestData, connection, createFixture, testId, type Fixture } from "./helpers";
import { openMyCashDrawer, recordCashPayment } from "@/lib/actions/cash";
import { setStaffCashPermission } from "@/lib/actions/staff";
import { issueInvoiceForPayment } from "@/lib/services/invoicing";
import type { ActorContext } from "@/lib/actions/define-action";
import { prisma } from "@/lib/prisma";
import { toBaghdadParts } from "@/lib/dates";

/**
 * الخطوة 3.1 — الدفعة والفاتورة والترقيم. تعريف الإنجاز حرفياً:
 *   «**20 دفعة متوازية ← 20 رقماً فريداً بلا تكرار**» (‏`Counter` بقفل،
 *    والفراغات مقبولة)
 *   «دفعة `PENDING` بلا فاتورة (‏R33)»
 *   «تعديل فاتورة مرفوض (‏R35)»
 */

let client: Client;
let f: Fixture;
let admin: ActorContext;
let cashier: ActorContext;

const CASHIER = testId("u_inv_staff");

async function resetWorld() {
  await cleanupTestData(client);
  f = await createFixture(client, "inv");
  admin = { userId: f.roleUsers.ADMIN, role: "ADMIN", ip: "10.0.0.40", userAgent: "vitest" };

  await client.query(
    `insert into "User" (id,"fullName",phone,role,"isActive","updatedAt")
     values ($1,'أمين صندوق الفواتير','+9647085000001','STAFF',true,now())`,
    [CASHIER],
  );
  await client.query(
    `insert into "StaffProfile" ("userId","employmentType","isAvailable","updatedAt")
     values ($1,'INTERNAL',true,now())`,
    [CASHIER],
  );
  cashier = { userId: CASHIER, role: "STAFF", ip: "10.0.0.41", userAgent: "vitest" };

  const granted = await setStaffCashPermission(
    { userId: CASHIER, canReceiveCash: true, reason: "أمين صندوق" },
    admin,
  );
  if (!granted.ok) throw new Error(granted.error.message);

  const opened = await openMyCashDrawer({}, cashier);
  if (!opened.ok) throw new Error(opened.error.message);
}

beforeAll(async () => {
  client = connection();
  await client.connect();
  await resetWorld();
}, 180_000);

beforeEach(async () => {
  await resetWorld();
}, 120_000);

afterAll(async () => {
  await cleanupTestData(client);
  await client.end();
  await prisma.$disconnect();
});

describe("الفاتورة مع الدفعة", () => {
  it("الدفعة النقدية تُصدر فاتورة في نفس المعاملة", async () => {
    const r = await recordCashPayment(
      { accountId: f.accountId, amountIqd: 120_000n },
      cashier,
    );
    expect(r.ok, r.ok ? "" : r.error.message).toBe(true);
    if (!r.ok) return;

    expect(r.data.invoiceNumber).toBeTruthy();

    const invoice = await prisma.invoice.findUniqueOrThrow({
      where: { id: r.data.invoiceId },
      select: { number: true, totalIqd: true, accountId: true, paymentId: true, lines: true },
    });
    expect(invoice.totalIqd).toBe(120_000n);
    expect(invoice.accountId).toBe(f.accountId);
    expect(invoice.paymentId).toBe(r.data.paymentId);
  });

  it("⚠️ الترقيم يحمل السنة **بتوقيت بغداد** بتنسيق `R34`", async () => {
    const r = await recordCashPayment(
      { accountId: f.accountId, amountIqd: 10_000n },
      cashier,
    );
    if (!r.ok) throw new Error(r.error.message);

    /**
     * ⚠️ **بلا تعبير نمطي مبنيّ بقالب نصّي.** كتبتُه أولاً
     * `new RegExp(\`^INV-${"$"}{year}-\\\\d{6}$\`)` فصار `\\d` حرفَين — شرطةً
     * مائلة وحرف d — لا صنفَ أرقام، ففشل على رقم صحيح. الفحص المباشر لا
     * هروب فيه ولا يُخطئ.
     */
    const year = toBaghdadParts(new Date()).year;
    const prefix = `INV-${year}-`;
    expect(r.data.invoiceNumber.startsWith(prefix)).toBe(true);

    const serial = r.data.invoiceNumber.slice(prefix.length);
    expect(serial, "التسلسل ليس ستّ خانات — R34").toHaveLength(6);
    expect(/^[0-9]+$/.test(serial), "التسلسل ليس أرقاماً").toBe(true);
  });

  it("⚠️ البنود **لقطة** فيها الرصيد قبل وبعد (‏Q15)", async () => {
    await client.query(`update "Account" set "balanceIqd" = 0 where id = $1`, [f.accountId]);

    const r = await recordCashPayment(
      { accountId: f.accountId, amountIqd: 75_000n },
      cashier,
    );
    if (!r.ok) throw new Error(r.error.message);

    const invoice = await prisma.invoice.findUniqueOrThrow({
      where: { id: r.data.invoiceId },
      select: { lines: true },
    });
    const lines = invoice.lines as Array<Record<string, string>>;
    expect(lines).toHaveLength(1);
    expect(lines[0]!["descriptionAr"]).toBe("دفعة على الحساب");
    /**
     * ⚠️ المبالغ **نصوص** لا أرقام: `BigInt` لا يُسلسَل، والعائم يفقد
     * الدقّة فوق 2^53 — ورقمٌ ناقص على ورقة حصينة لا يُصلَح بعد الإصدار.
     */
    expect(lines[0]!["amountIqd"]).toBe("75000");
    expect(lines[0]!["balanceBeforeIqd"]).toBe("0");
    // القيد `PAYMENT` يُطرَح (‏D2)
    expect(lines[0]!["balanceAfterIqd"]).toBe("-75000");
  });

  it("فاتورة واحدة لكل دفعة — لا تُصدَر مرّتين", async () => {
    const r = await recordCashPayment(
      { accountId: f.accountId, amountIqd: 20_000n },
      cashier,
    );
    if (!r.ok) throw new Error(r.error.message);

    await expect(
      prisma.$transaction((tx) =>
        issueInvoiceForPayment(tx, r.data.paymentId, {
          balanceBeforeIqd: 0n,
          balanceAfterIqd: -20_000n,
        }),
      ),
    ).rejects.toThrow(/صادرة سلفاً/);

    expect(await prisma.invoice.count({ where: { paymentId: r.data.paymentId } })).toBe(1);
  });
});

describe("‏R33 — دفعة PENDING بلا فاتورة", () => {
  it("⚠️ لا تُصدَر فاتورة لدفعة غير مدفوعة", async () => {
    /**
     * الفاتورة **إقرار استلام**. إصدارها قبل الاستلام يعطي الساكن ورقةً
     * يُثبت بها دفعاً لم يقع، ويُغرق الترقيم بأرقام لدفعات فشلت.
     */
    const pendingId = testId("pay_inv_pending");
    await client.query(
      `insert into "Payment" (id,"accountId","amountIqd",method,status,purpose,
                              "referenceId","updatedAt")
       values ($1,$2,50000,'WAYL_LINK','PENDING','MANUAL',$3,now())`,
      [pendingId, f.accountId, `PEND-${pendingId}`],
    );

    await expect(
      prisma.$transaction((tx) =>
        issueInvoiceForPayment(tx, pendingId, {
          balanceBeforeIqd: 0n,
          balanceAfterIqd: -50_000n,
        }),
      ),
    ).rejects.toThrow(/غير مدفوعة/);

    expect(await prisma.invoice.count({ where: { paymentId: pendingId } })).toBe(0);
  });

  it("⚠️ والرقم لا يُستهلك على دفعة مرفوضة", async () => {
    /**
     * الرفض يقع **قبل** حجز الرقم. ولو وقع بعده لتركت كل محاولة فاشلة
     * فجوةً في تسلسل الفواتير — و`R34` يقبل الفجوات لكن فجوةً بلا سبب
     * تبقى سؤالاً عند التدقيق.
     */
    const year = toBaghdadParts(new Date()).year;
    const before = await prisma.counter.findFirst({
      where: { kind: "INV", year },
      select: { lastValue: true },
    });

    const failedId = testId("pay_inv_failed");
    await client.query(
      `insert into "Payment" (id,"accountId","amountIqd",method,status,purpose,
                              "referenceId","updatedAt")
       values ($1,$2,50000,'WAYL_LINK','FAILED','MANUAL',$3,now())`,
      [failedId, f.accountId, `FAIL-${failedId}`],
    );

    await expect(
      prisma.$transaction((tx) =>
        issueInvoiceForPayment(tx, failedId, {
          balanceBeforeIqd: 0n,
          balanceAfterIqd: 0n,
        }),
      ),
    ).rejects.toThrow();

    const after = await prisma.counter.findFirst({
      where: { kind: "INV", year },
      select: { lastValue: true },
    });
    expect(after?.lastValue ?? 0, "استُهلك رقم على دفعة مرفوضة").toBe(
      before?.lastValue ?? 0,
    );
  });
});

describe("‏R35 — الفاتورة حصينة بعد الإصدار", () => {
  it("⚠️ تعديل الفاتورة مرفوض **من القاعدة** لا باصطلاح", async () => {
    const r = await recordCashPayment(
      { accountId: f.accountId, amountIqd: 30_000n },
      cashier,
    );
    if (!r.ok) throw new Error(r.error.message);

    await expect(
      client.query(`update "Invoice" set "totalIqd" = 1 where id = $1`, [r.data.invoiceId]),
    ).rejects.toThrow();

    const still = await prisma.invoice.findUniqueOrThrow({
      where: { id: r.data.invoiceId },
      select: { totalIqd: true },
    });
    expect(still.totalIqd).toBe(30_000n);
  });

  it("حذف الفاتورة مرفوض", async () => {
    const r = await recordCashPayment(
      { accountId: f.accountId, amountIqd: 30_000n },
      cashier,
    );
    if (!r.ok) throw new Error(r.error.message);

    await expect(
      client.query(`delete from "Invoice" where id = $1`, [r.data.invoiceId]),
    ).rejects.toThrow();
  });

  it("⚠️ و`pdfUrl` **مستثنى** — يُملأ عند التوليد", async () => {
    /**
     * الاستثناء الوحيد في `reject_invoice_mutation`. بلا استثنائه كان
     * توليد الـPDF مستحيلاً على فاتورة صدرت — أي على كل فاتورة.
     */
    const r = await recordCashPayment(
      { accountId: f.accountId, amountIqd: 30_000n },
      cashier,
    );
    if (!r.ok) throw new Error(r.error.message);

    await client.query(`update "Invoice" set "pdfUrl" = $2 where id = $1`, [
      r.data.invoiceId,
      "https://example.invalid/inv.pdf",
    ]);

    const row = await prisma.invoice.findUniqueOrThrow({
      where: { id: r.data.invoiceId },
      select: { pdfUrl: true },
    });
    expect(row.pdfUrl).toBe("https://example.invalid/inv.pdf");
  });
});

describe("🔴 الترقيم عند التزامن", () => {
  it("**20 دفعة متوازية ← 20 رقماً فريداً بلا تكرار واحد**", async () => {
    /**
     * ⚠️ **أخطر عيب محاسبي ممكن.** `MAX(number) + 1` يتكرّر عند التزامن:
     * معاملتان تقرآن نفس الأقصى فتُنتجان نفس الرقم. ورقما فاتورة متطابقان
     * كارثة لا عيب تجميلي.
     *
     * الحماية `INSERT … ON CONFLICT DO UPDATE` على صفّ `(kind, year)`،
     * فتُسلسَل المعاملات على قفل الصفّ.
     */
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        recordCashPayment({ accountId: f.accountId, amountIqd: 1_000n }, cashier),
      ),
    );

    const ok = results.filter((r) => r.ok);
    expect(ok, `فشل بعضها: ${JSON.stringify(results.find((r) => !r.ok))}`).toHaveLength(20);

    const numbers = ok.map((r) => (r.ok ? r.data.invoiceNumber : ""));
    expect(new Set(numbers).size, "تكرّر رقم فاتورة").toBe(20);

    // وفي القاعدة أيضاً: عشرون فاتورة لا أقلّ
    const stored = await prisma.invoice.findMany({
      where: { accountId: f.accountId },
      select: { number: true },
    });
    expect(stored).toHaveLength(20);
    expect(new Set(stored.map((s) => s.number)).size).toBe(20);
  });

  it("الرصيد بعد العشرين يساوي مجموعها بالضبط", async () => {
    await client.query(`update "Account" set "balanceIqd" = 0 where id = $1`, [f.accountId]);

    await Promise.all(
      Array.from({ length: 20 }, () =>
        recordCashPayment({ accountId: f.accountId, amountIqd: 1_000n }, cashier),
      ),
    );

    const account = await prisma.account.findUniqueOrThrow({
      where: { id: f.accountId },
      select: { balanceIqd: true },
    });
    // عشرون دفعة × 1,000 مطروحة من صفر
    expect(account.balanceIqd).toBe(-20_000n);
  });
});
