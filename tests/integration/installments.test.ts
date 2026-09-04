import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { cleanupTestData, connection, createFixture, testId, type Fixture } from "./helpers";
import { openMyCashDrawer } from "@/lib/actions/cash";
import { setStaffCashPermission } from "@/lib/actions/staff";
import {
  createInstallmentPlan,
  getInstallmentPlan,
  listInstallmentPlans,
  markInstallmentPaid,
  recordFollowUp,
} from "@/lib/actions/installments";
import { runInstallmentCharges } from "@/lib/services/installment-charges";
import type { ActorContext } from "@/lib/actions/define-action";
import { prisma } from "@/lib/prisma";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  الخطوة 3.5 — الأقساط · القرار `B1` (‏2026-09-02).
 * ═══════════════════════════════════════════════════════════════════════
 *
 * تعريف الإنجاز حرفياً: «‏Σ الأقساط = المبلغ المرجعي بالضبط» · «قلب
 * `OVERDUE` مرّة واحدة فقط» · «قيد الاستحقاق ينشئه `cron/installments`
 * ولا يتكرّر عند إعادة التشغيل» · «تعليم الدفع ذرّي» · «لا غرامات».
 *
 * والقرار `B1` يضيف: **المقدّمة مقبوضة** — دفعةٌ بوصل وفاتورة عند التوقيع.
 */

let client: Client;
let f: Fixture;
let admin: ActorContext;

const CASHIER = testId("u_inst_cash");

/**
 * ── 🔴 الأقساط تمرّ من صندوق النقد ──────────────────────────────────
 * قيد `payment_cash_needs_drawer` (‏B4) يمنع دفعة نقدية بلا جلسة. وهو
 * أوقف أوّل تنفيذ لهذه الخطوة **وكان محقّاً**: من يُعلّم قسطاً مدفوعاً
 * يقبض نقداً، وتسجيلُه بلا صندوق يفتح في الضابط ثغرةً بحجم الأقساط كلّها.
 *
 * فالفكسچر هنا يفتح صندوقاً — كما يفعل المحصِّل في الواقع.
 */
async function resetWorld() {
  await cleanupTestData(client);
  f = await createFixture(client, "inst");
  admin = { userId: f.roleUsers.ADMIN, role: "ADMIN", ip: "10.0.0.60", userAgent: "vitest" };

  await client.query(
    `insert into "User" (id,"fullName",phone,role,"isActive","updatedAt")
     values ($1,'محصّل الأقساط','+9647086000001','STAFF',true,now())`,
    [CASHIER],
  );
  await client.query(
    `insert into "StaffProfile" ("userId","employmentType","isAvailable","updatedAt")
     values ($1,'INTERNAL',true,now())`,
    [CASHIER],
  );
  /*
   * ⚠️ **الأدمن الذي يقبض النقد موظّفٌ له ملفّ وظيفي.**
   * `setStaffCashPermission` يوجبه، و`B4` يوجب صندوقاً — ومن لا ملفّ له
   * لا صندوق له ولا يقبض. وهذا ليس تحايلاً على الاختبار بل وصفٌ للواقع:
   * من يستلم مالاً في المركز يخضع لضابط الإقفال اليومي أياً كان دوره.
   */
  await client.query(
    `insert into "StaffProfile" ("userId","employmentType","isAvailable","updatedAt")
     values ($1,'INTERNAL',true,now())
     on conflict ("userId") do nothing`,
    [f.roleUsers.ADMIN],
  );

  const granted = await setStaffCashPermission(
    { userId: f.roleUsers.ADMIN, canReceiveCash: true, reason: "بذر اختبار الأقساط" },
    admin,
  );
  if (!granted.ok) throw new Error(granted.error.message);

  const opened = await openMyCashDrawer({}, admin);
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
}, 120_000);

const PLAN = {
  totalAmountIqd: 50_000_000n,
  downPaymentIqd: 10_000_000n,
  installmentsCount: 40,
  intervalMonths: 1,
};

/** أوّل قسط في الماضي كي يستحقّ فوراً عند تشغيل المهمّة. */
const pastStart = (): Date => new Date(Date.now() - 40 * 86_400_000);

describe("‏B1 — الدفعة المقدّمة مقبوضة", () => {
  it("🔴 تُنشئ دفعة وفاتورة، والرصيد يعود إلى ما كان", async () => {
    const before = await prisma.account.findUnique({
      where: { id: f.accountId },
      select: { balanceIqd: true },
    });

    const r = await createInstallmentPlan(
      { contractId: f.contractId, ...PLAN, startDate: new Date() },
      admin,
    );
    expect(r.ok, r.ok ? "" : r.error.message).toBe(true);
    if (!r.ok) return;

    /*
     * ⚠️ **قلب القرار**: المقدّمة تُقيَّد استحقاقاً ثم تُسدَّد فوراً — فالرصيد
     * لا يتغيّر. والبديل «مستحقّة» كان يترك 10 ملايين ديناً على من دفعها.
     */
    const after = await prisma.account.findUnique({
      where: { id: f.accountId },
      select: { balanceIqd: true },
    });
    expect(after?.balanceIqd, "المقدّمة تركت ديناً").toBe(before?.balanceIqd);

    expect(r.data.downPayment, "لا دفعة للمقدّمة").not.toBeNull();

    const payment = await prisma.payment.findUnique({
      where: { id: r.data.downPayment!.paymentId },
      select: { amountIqd: true, status: true },
    });
    expect(payment?.amountIqd).toBe(10_000_000n);
    expect(payment?.status).toBe("PAID");

    /* ⚠️ وللمقدّمة **فاتورة** كأي مال يدخل */
    const invoice = await prisma.invoice.findFirst({
      where: { paymentId: r.data.downPayment!.paymentId },
      select: { number: true, totalIqd: true },
    });
    expect(invoice?.totalIqd).toBe(10_000_000n);
    expect(invoice?.number).toBe(r.data.downPayment!.invoiceNumber);
  });

  it("🔴 الأقساط على المتبقّي: مجموعها 40 مليوناً لا 50", async () => {
    const r = await createInstallmentPlan(
      { contractId: f.contractId, ...PLAN, startDate: new Date() },
      admin,
    );
    if (!r.ok) throw new Error(r.error.message);

    const rows = await prisma.installment.findMany({
      where: { planId: r.data.planId },
      select: { amountIqd: true },
    });
    expect(rows).toHaveLength(40);

    const sum = rows.reduce((n, x) => n + x.amountIqd, 0n);
    expect(sum, "المجموع ليس المتبقّي").toBe(40_000_000n);
    expect(sum + PLAN.downPaymentIqd).toBe(PLAN.totalAmountIqd);
  });

  it("⚠️ لا قيد استحقاق للأقساط عند الإنشاء", async () => {
    /*
     * الأقساط **صفوف مجدولة** لا قيود. وقيدُ الكلّ مقدّماً كان يجعل الساكن
     * مديناً بأربعين مليوناً في يومه الأول — رقمٌ صحيح محاسبياً وكاذب عملياً.
     */
    const r = await createInstallmentPlan(
      {
        contractId: f.contractId,
        ...PLAN,
        startDate: new Date(Date.now() + 30 * 86_400_000),
      },
      admin,
    );
    if (!r.ok) throw new Error(r.error.message);

    const charges = await prisma.ledgerEntry.count({
      where: { accountId: f.accountId, source: "INSTALLMENT", type: "CHARGE" },
    });
    /* واحدٌ فقط: المقدّمة. لا قيد لأي قسط لم يستحقّ. */
    expect(charges).toBe(1);
  });
});

describe("خطة واحدة لكل عقد", () => {
  it("الثانية مرفوضة برسالة عربية", async () => {
    const first = await createInstallmentPlan(
      { contractId: f.contractId, ...PLAN, startDate: new Date() },
      admin,
    );
    if (!first.ok) throw new Error(first.error.message);

    const second = await createInstallmentPlan(
      { contractId: f.contractId, ...PLAN, startDate: new Date() },
      admin,
    );
    expect(second.ok, "خطة ثانية مرّت").toBe(false);
    if (!second.ok) expect(second.error.message).toContain("خطة أقساط سلفاً");
  });
});

describe("‏cron/installments — الاستحقاق", () => {
  it("🔴 تشغيلان متتاليان ← نفس عدد القيود بالضبط", async () => {
    const r = await createInstallmentPlan(
      { contractId: f.contractId, ...PLAN, startDate: pastStart() },
      admin,
    );
    if (!r.ok) throw new Error(r.error.message);

    const first = await runInstallmentCharges();
    expect(first.errors, JSON.stringify(first.errors)).toEqual([]);
    expect(first.charged, "لم يُقيَّد شيء").toBeGreaterThan(0);

    const afterFirst = await prisma.ledgerEntry.count({
      where: { accountId: f.accountId, source: "INSTALLMENT", type: "CHARGE" },
    });

    /*
     * ⚠️ **الضمانة هي الدفتر لا علمٌ على الصفّ.** علمٌ منفصل يتقادم عند
     * أول قيد يُكتب من مسار آخر، ويبدو صحيحاً دائماً.
     */
    const second = await runInstallmentCharges();
    expect(second.charged, "قُيّد مرّتين").toBe(0);
    expect(second.skipped).toBeGreaterThan(0);

    const afterSecond = await prisma.ledgerEntry.count({
      where: { accountId: f.accountId, source: "INSTALLMENT", type: "CHARGE" },
    });
    expect(afterSecond, "عدد القيود تغيّر").toBe(afterFirst);
  });

  it("يقلب المتأخّر ولا يقلبه مرّتين", async () => {
    const r = await createInstallmentPlan(
      { contractId: f.contractId, ...PLAN, startDate: pastStart() },
      admin,
    );
    if (!r.ok) throw new Error(r.error.message);

    const first = await runInstallmentCharges();
    expect(first.markedOverdue).toBeGreaterThan(0);

    const second = await runInstallmentCharges();
    expect(second.markedOverdue, "قُلب مرّتين").toBe(0);
  });

  it("⚠️ ولا غرامة: القلب تغيير حالة لا قيد", async () => {
    const r = await createInstallmentPlan(
      { contractId: f.contractId, ...PLAN, startDate: pastStart() },
      admin,
    );
    if (!r.ok) throw new Error(r.error.message);

    const run = await runInstallmentCharges();
    const entries = await prisma.ledgerEntry.count({
      where: { accountId: f.accountId, source: "INSTALLMENT", type: "CHARGE" },
    });
    /* القيود = المقدّمة + ما استحقّ. لا قيد إضافي للتأخّر. */
    expect(entries).toBe(1 + run.charged);
  });
});

describe("تعليم الدفع — ذرّي", () => {
  async function firstDue(): Promise<string> {
    const plan = await createInstallmentPlan(
      { contractId: f.contractId, ...PLAN, startDate: pastStart() },
      admin,
    );
    if (!plan.ok) throw new Error(plan.error.message);
    await runInstallmentCharges();

    const item = await prisma.installment.findFirst({
      where: { planId: plan.data.planId, status: { in: ["PENDING", "OVERDUE"] } },
      orderBy: { sequence: "asc" },
      select: { id: true },
    });
    return item!.id;
  }

  it("يُنشئ دفعة وقيداً وفاتورة، ويُنقص الرصيد", async () => {
    const id = await firstDue();
    const before = await prisma.account.findUnique({
      where: { id: f.accountId },
      select: { balanceIqd: true },
    });

    const r = await markInstallmentPaid({ installmentId: id }, admin);
    expect(r.ok, r.ok ? "" : r.error.message).toBe(true);
    if (!r.ok) return;

    const item = await prisma.installment.findUnique({
      where: { id },
      select: { status: true, paidAt: true, paymentId: true },
    });
    expect(item?.status).toBe("PAID");
    expect(item?.paidAt).not.toBeNull();
    expect(item?.paymentId).toBe(r.data.paymentId);

    expect(r.data.balanceIqd).toBe((before?.balanceIqd ?? 0n) - 1_000_000n);
    expect(r.data.invoiceNumber).toBeTruthy();
  });

  it("🔴 نقرتان متزامنتان ← دفعة واحدة وقيد واحد", async () => {
    /*
     * كانتا تُنتجان **دفعتين وقيدين**: سداداً مضاعفاً لدَينٍ واحد، ورصيداً
     * دائناً لا مصدر له. الشرط في جملة التحديث يجعل الثانية تُصيب صفراً.
     */
    const id = await firstDue();

    const [a, b] = await Promise.all([
      markInstallmentPaid({ installmentId: id }, admin),
      markInstallmentPaid({ installmentId: id }, admin),
    ]);

    const ok = [a, b].filter((x) => x.ok);
    expect(ok, "الاثنتان نجحتا — سداد مضاعف").toHaveLength(1);

    /*
     * ⚠️ العدّ على **قيد الدفتر لهذا القسط** لا على دفعات الحساب:
     * الدفعة المقدّمة تحمل `purpose: "INSTALLMENT"` أيضاً، فعدُّها معها
     * كان يُفشل الاختبار على كود سليم — وهو خطأ في التأكيد لا في المنطق.
     *
     * والقيد هو الحقيقة: سدادٌ مضاعف يعني قيدين على قسط واحد.
     */
    const entries = await prisma.ledgerEntry.count({
      where: { installmentId: id, type: "PAYMENT" },
    });
    expect(entries, "أكثر من قيد سداد لقسط واحد").toBe(1);
  });

  it("المدفوع لا يُسدَّد مرّتين", async () => {
    const id = await firstDue();
    const first = await markInstallmentPaid({ installmentId: id }, admin);
    if (!first.ok) throw new Error(first.error.message);

    const again = await markInstallmentPaid({ installmentId: id }, admin);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.message).toContain("مدفوع سلفاً");
  });

  it("⚠️ آخر قسط يُقفل الخطة", async () => {
    const plan = await createInstallmentPlan(
      {
        contractId: f.contractId,
        totalAmountIqd: 3_000_000n,
        downPaymentIqd: 0n,
        installmentsCount: 2,
        intervalMonths: 1,
        startDate: pastStart(),
      },
      admin,
    );
    if (!plan.ok) throw new Error(plan.error.message);
    await runInstallmentCharges();

    const items = await prisma.installment.findMany({
      where: { planId: plan.data.planId },
      orderBy: { sequence: "asc" },
      select: { id: true },
    });

    for (const item of items) {
      const r = await markInstallmentPaid({ installmentId: item.id }, admin);
      if (!r.ok) throw new Error(r.error.message);
    }

    /* خطةٌ مكتملة تبقى ACTIVE تُغرق شاشة المتابعة بما لا يحتاج متابعة */
    const after = await prisma.installmentPlan.findUnique({
      where: { id: plan.data.planId },
      select: { status: true },
    });
    expect(after?.status).toBe("COMPLETED");
  });
});

describe("المتابعة — ملاحظة لا سداد", () => {
  it("🔴 لا تُقيّد شيئاً ولا تُغيّر الحالة", async () => {
    const plan = await createInstallmentPlan(
      { contractId: f.contractId, ...PLAN, startDate: pastStart() },
      admin,
    );
    if (!plan.ok) throw new Error(plan.error.message);
    await runInstallmentCharges();

    const item = await prisma.installment.findFirst({
      where: { planId: plan.data.planId, status: { in: ["PENDING", "OVERDUE"] } },
      select: { id: true, status: true },
    });

    const before = await prisma.account.findUnique({
      where: { id: f.accountId },
      select: { balanceIqd: true },
    });

    const r = await recordFollowUp(
      { installmentId: item!.id, note: "اتُّصل به ووعد بالدفع نهاية الأسبوع" },
      admin,
    );
    expect(r.ok, r.ok ? "" : r.error.message).toBe(true);

    const after = await prisma.installment.findUnique({
      where: { id: item!.id },
      select: {
        status: true,
        followUpStaffId: true,
        followUpNote: true,
        lastFollowUpAt: true,
      },
    });

    /* ⚠️ «سيدفع غداً» ليست سداداً — والخلط بينهما يُسقط الدَين */
    expect(after?.status, "المتابعة غيّرت الحالة").toBe(item!.status);
    expect(after?.followUpStaffId).toBe(admin.userId);
    expect(after?.lastFollowUpAt).not.toBeNull();

    const balance = await prisma.account.findUnique({
      where: { id: f.accountId },
      select: { balanceIqd: true },
    });
    expect(balance?.balanceIqd, "المتابعة غيّرت الرصيد").toBe(before?.balanceIqd);
  });
});

describe("القائمة والتفصيل", () => {
  it("تعرض المتبقّي شاملاً المتأخّر", async () => {
    const plan = await createInstallmentPlan(
      { contractId: f.contractId, ...PLAN, startDate: pastStart() },
      admin,
    );
    if (!plan.ok) throw new Error(plan.error.message);
    await runInstallmentCharges();

    const list = await listInstallmentPlans({}, admin);
    if (!list.ok) throw new Error(list.error.message);

    const row = list.data.rows.find((x) => x.id === plan.data.planId);
    expect(row, "الخطة لم تظهر").toBeDefined();
    expect(row?.overdueCount, "لا متأخّر رغم أن الاستحقاق مضى").toBeGreaterThan(0);

    /*
     * ⚠️ المتبقّي = ما لم يُدفع ولم يُلغَ **شاملاً المتأخّر**. وجمعُ
     * `PENDING` وحدها كان يُخفي المتأخّر — وهو أهمّ ما تُتابعه الشاشة.
     */
    expect(row?.remainingIqd).toBe(40_000_000n);
    expect(row?.downPaymentIqd).toBe(10_000_000n);
  });

  it("التفصيل يُرجع الأقساط مرتَّبة", async () => {
    const plan = await createInstallmentPlan(
      { contractId: f.contractId, ...PLAN, startDate: new Date() },
      admin,
    );
    if (!plan.ok) throw new Error(plan.error.message);

    const detail = await getInstallmentPlan({ planId: plan.data.planId }, admin);
    if (!detail.ok || detail.data === null) throw new Error("لا تفصيل");

    expect(detail.data.installments).toHaveLength(40);
    expect(detail.data.installments[0]?.sequence).toBe(1);
    expect(detail.data.installments[39]?.sequence).toBe(40);
  });
});
