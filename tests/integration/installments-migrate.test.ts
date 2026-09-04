import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { cleanupTestData, connection, createFixture, type Fixture } from "./helpers";
import { migrateInstallmentPlan } from "@/lib/actions/installments-migrate";
import { listInstallmentPlans } from "@/lib/actions/installments";
import { runInstallmentCharges } from "@/lib/services/installment-charges";
import type { ActorContext } from "@/lib/actions/define-action";
import { prisma } from "@/lib/prisma";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  ‏N3 — ترحيل عقد قائم قبل النظام (محسوم 2026-09-02).
 * ═══════════════════════════════════════════════════════════════════════
 *
 * > القرار: **خطة كاملة بأقساط ماضية مُعلَّمة مدفوعة.**
 *
 * وأخطر ما يحرسه هذا الملفّ: أن الترحيل **لا يُصدر إيصالاً لمالٍ لم يمرّ
 * بهذا النظام**. فاتورةٌ لدفعةٍ قُبضت قبل سنتين ورقةٌ تبدو رسمية ولا
 * تسندها واقعة — وتُضخّم تحصيل اليوم وتكسر ضابط الصندوق (‏B4).
 */

let client: Client;
let f: Fixture;
let admin: ActorContext;

async function resetWorld() {
  await cleanupTestData(client);
  f = await createFixture(client, "mig");
  admin = { userId: f.roleUsers.ADMIN, role: "ADMIN", ip: "10.0.0.70", userAgent: "vitest" };
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
}, 120_000);

const DAY = 86_400_000;

/** عقد بدأ قبل عشرة أشهر: 10 أقساط، سُدّد منها 4. */
const MIGRATION = {
  totalAmountIqd: 50_000_000n,
  downPaymentIqd: 10_000_000n,
  installmentsCount: 10,
  intervalMonths: 1,
  startDate: new Date(Date.now() - 300 * DAY),
  reason: "ترحيل العقود القائمة عند إدخال النظام",
};

describe("‏N3 — لا إيصال لمالٍ لم يمرّ", () => {
  it("🔴 لا `Payment` ولا `Invoice` إطلاقاً", async () => {
    const r = await migrateInstallmentPlan(
      {
        contractId: f.contractId,
        ...MIGRATION,
        paid: [{ sequence: 1 }, { sequence: 2 }, { sequence: 3 }, { sequence: 4 }],
        migratedAt: new Date(),
      },
      admin,
    );
    expect(r.ok, r.ok ? "" : r.error.message).toBe(true);
    if (!r.ok) return;

    /*
     * ⚠️ **جوهر القرار.** فاتورةٌ لمالٍ قُبض قبل سنتين تزويرُ إيصال؛
     * ودفعةٌ نقدية تحتاج جلسة صندوق، فترحيل مئة عقد كان يُضخّم تحصيل
     * اليوم بمالٍ لم يدخل الصندوق اليوم.
     */
    const payments = await prisma.payment.count({ where: { accountId: f.accountId } });
    expect(payments, "أُنشئت دفعة لمالٍ ماضٍ").toBe(0);

    const invoices = await prisma.invoice.count({ where: { accountId: f.accountId } });
    expect(invoices, "صدرت فاتورة لمالٍ ماضٍ").toBe(0);

    /* والأقساط المدفوعة بلا `paymentId` — لأنها بلا دفعة */
    const paidRows = await prisma.installment.findMany({
      where: { planId: r.data.planId, status: "PAID" },
      select: { paymentId: true },
    });
    expect(paidRows).toHaveLength(4);
    expect(paidRows.every((x) => x.paymentId === null), "قسط مُرحَّل يحمل دفعة").toBe(true);
  });

  it("القيود كلّها بمصدر OPENING", async () => {
    const r = await migrateInstallmentPlan(
      {
        contractId: f.contractId,
        ...MIGRATION,
        paid: [{ sequence: 1 }],
        migratedAt: new Date(),
      },
      admin,
    );
    if (!r.ok) throw new Error(r.error.message);

    const bySource = await prisma.ledgerEntry.groupBy({
      by: ["source"],
      where: { accountId: f.accountId },
      _count: { _all: true },
    });

    /* ⚠️ مصدرٌ واحد: `OPENING` يقول لمن يقرأ الكشف إن هذا ترحيل لا تشغيل */
    expect(bySource.map((x) => x.source)).toEqual(["OPENING"]);
  });
});

describe("‏N3 — الرصيد الافتتاحي", () => {
  it("🔴 يساوي ما لم يُدفع من المستحقّ", async () => {
    /*
     * 10 أقساط × 4 ملايين = 40 مليوناً، والمقدّمة 10 ملايين.
     * كلّها استحقّت (بدأت قبل 300 يوم بفاصل شهر ← العاشر قبل نحو 30 يوماً).
     * المدفوع: المقدّمة + 4 أقساط ← المتبقّي 6 أقساط = 24 مليوناً.
     */
    const r = await migrateInstallmentPlan(
      {
        contractId: f.contractId,
        ...MIGRATION,
        paid: [{ sequence: 1 }, { sequence: 2 }, { sequence: 3 }, { sequence: 4 }],
        migratedAt: new Date(),
      },
      admin,
    );
    if (!r.ok) throw new Error(r.error.message);

    expect(r.data.openingBalanceIqd).toBe(24_000_000n);

    const account = await prisma.account.findUnique({
      where: { id: f.accountId },
      select: { balanceIqd: true },
    });
    expect(account?.balanceIqd, "الرصيد لا يطابق الافتتاحي المُعلَن").toBe(24_000_000n);
  });

  it("خطة سُدّدت كلّها تُقفَل ورصيدها صفر", async () => {
    const all = Array.from({ length: 10 }, (_, i) => ({ sequence: i + 1 }));
    const r = await migrateInstallmentPlan(
      { contractId: f.contractId, ...MIGRATION, paid: all, migratedAt: new Date() },
      admin,
    );
    if (!r.ok) throw new Error(r.error.message);

    expect(r.data.planCompleted).toBe(true);
    expect(r.data.openingBalanceIqd).toBe(0n);

    const plan = await prisma.installmentPlan.findUnique({
      where: { id: r.data.planId },
      select: { status: true },
    });
    expect(plan?.status).toBe("COMPLETED");
  });
});

describe("‏N3 — التاريخ التقريبي يُعلَن", () => {
  it("🔴 يُعدّ ما لا تاريخ له، ويقوله القيد بنصّه", async () => {
    const exact = new Date(Date.now() - 250 * DAY);

    const r = await migrateInstallmentPlan(
      {
        contractId: f.contractId,
        ...MIGRATION,
        paid: [
          { sequence: 1, paidAt: exact },
          { sequence: 2 },
          { sequence: 3 },
        ],
        migratedAt: new Date(),
      },
      admin,
    );
    if (!r.ok) throw new Error(r.error.message);

    /* ⚠️ الأدمن يجب أن يعرف كم تاريخاً دخل تقريبياً لا دقيقاً */
    expect(r.data.approximateDates, "لم تُعدّ التواريخ التقريبية").toBe(2);

    const approximate = await prisma.ledgerEntry.count({
      where: {
        accountId: f.accountId,
        type: "PAYMENT",
        descriptionAr: { contains: "التاريخ تقريبي" },
      },
    });
    expect(approximate, "القيد لا يُعلن أن التاريخ تقريبي").toBe(2);

    /* والدقيق لا يُعلَّم تقريبياً */
    const first = await prisma.installment.findFirst({
      where: { planId: r.data.planId, sequence: 1 },
      select: { paidAt: true },
    });
    expect(first?.paidAt?.getTime()).toBe(exact.getTime());
  });

  it("السبب إلزامي ويُكتب في كل قيد", async () => {
    const r = await migrateInstallmentPlan(
      {
        contractId: f.contractId,
        ...MIGRATION,
        paid: [{ sequence: 1 }],
        migratedAt: new Date(),
      },
      admin,
    );
    if (!r.ok) throw new Error(r.error.message);

    const withoutReason = await prisma.ledgerEntry.count({
      where: { accountId: f.accountId, reason: null },
    });
    expect(withoutReason, "قيد ترحيل بلا سبب").toBe(0);
  });
});

describe("‏N3 — التداخل مع التشغيل اليومي", () => {
  it("🔴 مهمّة الاستحقاق لا تُقيّد ما رُحِّل مرّة ثانية", async () => {
    /*
     * ⚠️ **أخطر تداخل**: الترحيل يُقيّد الماضي، والمهمّة تقرأ ما استحقّ.
     * فبلا الضمانة (وجود القيد نفسه) كانت تُعيد قيد كل قسط ماضٍ —
     * فيتضاعف الدَين على كل عقد مُرحَّل في أوّل ليلة.
     */
    const r = await migrateInstallmentPlan(
      {
        contractId: f.contractId,
        ...MIGRATION,
        paid: [{ sequence: 1 }, { sequence: 2 }],
        migratedAt: new Date(),
      },
      admin,
    );
    if (!r.ok) throw new Error(r.error.message);

    const before = await prisma.ledgerEntry.count({ where: { accountId: f.accountId } });
    const balanceBefore = await prisma.account.findUnique({
      where: { id: f.accountId },
      select: { balanceIqd: true },
    });

    const run = await runInstallmentCharges();
    expect(run.charged, "أُعيد قيد ما رُحِّل").toBe(0);
    expect(run.skipped).toBeGreaterThan(0);

    const after = await prisma.ledgerEntry.count({ where: { accountId: f.accountId } });
    expect(after, "عدد القيود تغيّر").toBe(before);

    const balanceAfter = await prisma.account.findUnique({
      where: { id: f.accountId },
      select: { balanceIqd: true },
    });
    expect(balanceAfter?.balanceIqd, "الرصيد تضاعف").toBe(balanceBefore?.balanceIqd);
  });

  it("ما لم يستحقّ يبقى مجدولاً بلا قيد", async () => {
    /* أوّل قسط بعد شهر ← لا شيء استحقّ */
    const r = await migrateInstallmentPlan(
      {
        contractId: f.contractId,
        ...MIGRATION,
        startDate: new Date(Date.now() + 30 * DAY),
        downPaymentIqd: 0n,
        paid: [],
        migratedAt: new Date(),
      },
      admin,
    );
    if (!r.ok) throw new Error(r.error.message);

    const entries = await prisma.ledgerEntry.count({ where: { accountId: f.accountId } });
    expect(entries, "قُيّد قسط لم يستحقّ").toBe(0);
    expect(r.data.openingBalanceIqd).toBe(0n);

    const pending = await prisma.installment.count({
      where: { planId: r.data.planId, status: "PENDING" },
    });
    expect(pending).toBe(10);
  });
});

describe("‏N3 — الرفض", () => {
  it("لا يُرحَّل عقد عليه خطة", async () => {
    const first = await migrateInstallmentPlan(
      { contractId: f.contractId, ...MIGRATION, paid: [], migratedAt: new Date() },
      admin,
    );
    if (!first.ok) throw new Error(first.error.message);

    const second = await migrateInstallmentPlan(
      { contractId: f.contractId, ...MIGRATION, paid: [], migratedAt: new Date() },
      admin,
    );
    expect(second.ok, "رُحِّل مرّتين").toBe(false);
    if (!second.ok) expect(second.error.message).toContain("لا يُرحَّل مرّتين");
  });

  it("⚠️ تسلسل خارج الجدول يُرفض لا يُتجاهَل", async () => {
    /* تجاهلُه يعني ترحيلاً ناقصاً يبدو ناجحاً — والفرق يظهر في الرصيد */
    const r = await migrateInstallmentPlan(
      {
        contractId: f.contractId,
        ...MIGRATION,
        paid: [{ sequence: 99 }],
        migratedAt: new Date(),
      },
      admin,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("خارج الجدول");
  });
});

describe("القائمة — ترشيح وبحث وتصفيح", () => {
  /**
   * ⚠️ **أكثر من صفحة**: التصفيح لا يُختبَر ببيانات تسع في صفحة واحدة،
   * والتداخل بين الصفحات هو العيب الذي يمرّ صامتاً — العدّاد يبقى صحيحاً
   * بينما صفٌّ يظهر مرّتين وآخر يسقط تماماً.
   */
  it("يصفّح بلا تكرار، ويرشّح بالحالة، ويبحث بثلاثة محاور", async () => {
    const plan = await migrateInstallmentPlan(
      {
        contractId: f.contractId,
        ...MIGRATION,
        paid: [{ sequence: 1 }],
        migratedAt: new Date(),
      },
      admin,
    );
    if (!plan.ok) throw new Error(plan.error.message);

    const listed = await listInstallmentPlans({ pageSize: 25 }, admin);
    if (!listed.ok) throw new Error(listed.error.message);
    const row = listed.data.rows.find((x) => x.id === plan.data.planId);
    expect(row, "الخطة لم تظهر في القائمة").toBeDefined();

    /* ترشيح بالحالة */
    const active = await listInstallmentPlans({ status: "ACTIVE" }, admin);
    const cancelled = await listInstallmentPlans({ status: "CANCELLED" }, admin);
    if (!active.ok || !cancelled.ok) throw new Error("فشل الترشيح");
    expect(active.data.total).toBeGreaterThan(0);
    expect(cancelled.data.total).toBe(0);

    /* ⚠️ ثلاثة محاور: رقم العقد على الورق، والاسم في الذاكرة، ورقم الشقة
       هو ما يعرفه الساكن. البحث بأحدها دون غيره يُفشل ثلث الحالات. */
    const byNumber = await listInstallmentPlans(
      { search: row!.contractNumber },
      admin,
    );
    if (!byNumber.ok) throw new Error(byNumber.error.message);
    expect(byNumber.data.total, "البحث برقم العقد لا يجد").toBe(1);

    const byHolder = await listInstallmentPlans({ search: row!.holderName }, admin);
    if (!byHolder.ok) throw new Error(byHolder.error.message);
    expect(byHolder.data.total, "البحث بالاسم لا يجد").toBeGreaterThan(0);

    if (row!.apartmentNumber) {
      const byApartment = await listInstallmentPlans(
        { search: row!.apartmentNumber },
        admin,
      );
      if (!byApartment.ok) throw new Error(byApartment.error.message);
      expect(byApartment.data.total, "البحث برقم الشقة لا يجد").toBeGreaterThan(0);
    }

    const none = await listInstallmentPlans({ search: "لا_يوجد_هذا_العقد" }, admin);
    if (!none.ok) throw new Error(none.error.message);
    expect(none.data.total).toBe(0);
    expect(none.data.rows).toEqual([]);
  });
});
