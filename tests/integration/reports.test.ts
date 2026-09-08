import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { cleanupTestData, connection, createFixture, testId, type Fixture } from "./helpers";
import {
  collectionsReport,
  installmentAgeingReport,
  ledgerMovementReport,
  outstandingReport,
  serviceRevenueReport,
} from "@/lib/services/reports";
import { resolveRange } from "@/lib/domain/report-range";
import { now } from "@/lib/dates";
import { prisma } from "@/lib/prisma";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  تقارير المال.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ⚠️ ما يحرسه هذا الملفّ ──────────────────────────────────────────
 *   • **الحدّ الأعلى مفتوح** — دفعة في آخر ثانية من المدّة داخلة، وأوّل
 *     ثانية بعدها خارجة. وهذا الخطأ لا يظهر في الشاشة: يعرض رقماً أصغر
 *     بقليل ويُقرأ صحيحاً.
 *   • **`PAID` وحدها تحصيل** — `PENDING` رابطٌ لم يُسدَّد، و`FAILED`
 *     محاولةٌ سقطت. وعدُّهما يُنتج رقماً أكبر من النقد في الصندوق.
 *   • **التقادُم من `dueDate` لا من `status`** — `OVERDUE` تكتبها مهمّة
 *     ليلية، فقسطٌ استحقّ اليوم يبقى `PENDING` حتى الليل.
 *   • **المستحقّ من `Account.balanceIqd`** — لا يُعاد جمع القيود.
 */

let client: Client;
let f: Fixture;

const DAY_MS = 86_400_000;

beforeAll(async () => {
  /* ⚠️ `connection()` متزامنة — يجب `connect()` بعدها */
  client = connection();
  await client.connect();
}, 120_000);

let drawerId = "";

beforeEach(async () => {
  await cleanupTestData(client);
  f = await createFixture(client, "rep");

  /*
   * ⚠️ **جلسة صندوق مفتوحة.** القيد `payment_cash_needs_drawer` (‏B4)
   * يمنع دفعةً نقدية بلا جلسة — في **القاعدة** لا في الإجراء. فبذرٌ خام
   * يتخطّى الإجراء لا يتخطّى القيد، وهذا هو المقصود منه.
   */
  drawerId = testId("drawer_rep");
  await client.query(
    `insert into "CashDrawerSession" (id,"staffUserId","openedAt","updatedAt")
     values ($1,$2,now(),now())`,
    [drawerId, f.roleUsers.STAFF],
  );
}, 120_000);

afterAll(async () => {
  await cleanupTestData(client);
  await client.end();
  await prisma.$disconnect();
});

/**
 * ── 🔴 التواريخ تُمرَّر **نصّاً بـUTC** لا كائن `Date` ─────────────────
 * `node-postgres` يُسلسِل `Date` بإزاحة **جهاز التشغيل**، وعمود
 * `timestamp` بلا منطقة زمنية يبتلع الإزاحة ويخزّن ساعة الحائط. بينما
 * Prisma يقرأ العمود على أنه UTC.
 *
 * فقيمةٌ كُتبت خاماً على جهازٍ بـ+03 تُقرأ **متقدّمة ثلاث ساعات**. ودفعةٌ
 * في آخر ثانية من اليوم تخرج من نافذة اليوم فيُرجع التقرير صفراً — وهو
 * ما وقع هنا حرفياً، ولم يظهر في الاختبارات ذات الهامش الواسع.
 *
 * ⚠️ و`toISOString()` يُنهي اللبس: يحمل `Z`، فتُخزَّن ساعة الحائط UTC —
 * وهي بالضبط ما يقرؤه Prisma.
 */
const at = (d: Date): string => d.toISOString();

/** دفعة خام — الإجراء يوجب صندوقاً مفتوحاً، والتقرير يقرأ الصفّ لا المسار. */
async function seedPayment(opts: {
  id: string;
  amount: bigint;
  paidAt: Date;
  status?: "PAID" | "PENDING" | "FAILED";
  method?: "CASH_AT_CENTER" | "WAYL_LINK";
  receivedBy?: string | null;
}): Promise<void> {
  await client.query(
    `insert into "Payment"
       (id,"accountId","amountIqd",method,status,purpose,"referenceId","paidAt","receivedByUserId","updatedAt","cashDrawerSessionId")
     values ($1,$2,$3,$4,$5,'MANUAL',$6,$7,$8,now(),$9)`,
    [
      testId(opts.id),
      f.accountId,
      opts.amount.toString(),
      opts.method ?? "CASH_AT_CENTER",
      opts.status ?? "PAID",
      `REF-${opts.id}`,
      at(opts.paidAt),
      opts.receivedBy === undefined ? f.roleUsers.STAFF : opts.receivedBy,
      /* الرابط لا يحتاج صندوقاً — والقيد يشترطه للنقد وحده */
      (opts.method ?? "CASH_AT_CENTER") === "CASH_AT_CENTER" ? drawerId : null,
    ],
  );
}

describe("🔴 تقرير التحصيل — حدود المدّة", () => {
  it("آخر ثانية داخلة، وأوّل ثانية بعدها خارجة", async () => {
    const range = resolveRange({ preset: "today" }, now());

    /* آخر مللي ثانية قبل الحدّ الأعلى المفتوح */
    await seedPayment({
      id: "pay_in",
      amount: 100_000n,
      paidAt: new Date(range.to.getTime() - 1),
    });
    /* والحدّ نفسه — أوّل لحظة من الغد */
    await seedPayment({ id: "pay_out", amount: 999_000n, paidAt: range.to });

    const r = await collectionsReport(range);
    expect(r.totalIqd, "سقطت دفعة آخر اليوم أو دخلت دفعة الغد").toBe(100_000n);
    expect(r.count).toBe(1);
  });

  it("🔴 و`PENDING` و`FAILED` ليستا تحصيلاً", async () => {
    const range = resolveRange({ preset: "today" }, now());
    const payAt = new Date(range.from.getTime() + 3_600_000);

    await seedPayment({ id: "p_paid", amount: 50_000n, paidAt: payAt });
    await seedPayment({ id: "p_pend", amount: 70_000n, paidAt: payAt, status: "PENDING" });
    await seedPayment({ id: "p_fail", amount: 90_000n, paidAt: payAt, status: "FAILED" });

    const r = await collectionsReport(range);
    expect(r.totalIqd, "عُدّت دفعة غير مسدَّدة تحصيلاً").toBe(50_000n);
  });

  it("والتقسيم بالطريقة والمحصِّل يجمع إلى الإجمالي", async () => {
    const range = resolveRange({ preset: "today" }, now());
    const payAt = new Date(range.from.getTime() + 3_600_000);

    await seedPayment({ id: "m_cash", amount: 40_000n, paidAt: payAt });
    await seedPayment({
      id: "m_link",
      amount: 60_000n,
      paidAt: payAt,
      method: "WAYL_LINK",
      receivedBy: null,
    });

    const r = await collectionsReport(range);
    expect(r.totalIqd).toBe(100_000n);

    const byMethod = r.byMethod.reduce((n, m) => n + m.totalIqd, 0n);
    const byCollector = r.byCollector.reduce((n, c) => n + c.totalIqd, 0n);
    /* ⚠️ تقسيمٌ لا يجمع إلى الإجمالي يعني صفّاً ضاع في التجميع */
    expect(byMethod, "التقسيم بالطريقة لا يطابق الإجمالي").toBe(100_000n);
    expect(byCollector, "التقسيم بالمحصِّل لا يطابق الإجمالي").toBe(100_000n);
  });

  it("ودفعة الشهر الماضي خارج «هذا الشهر»", async () => {
    const range = resolveRange({ preset: "month" }, now());
    await seedPayment({
      id: "p_old",
      amount: 500_000n,
      paidAt: new Date(range.from.getTime() - DAY_MS),
    });

    const r = await collectionsReport(range);
    expect(r.totalIqd).toBe(0n);
  });
});

describe("تقرير المستحقّات", () => {
  it("🔴 يقرأ رصيد الحساب ولا يُعيد جمع القيود", async () => {
    /*
     * ⚠️ نضبط الرصيد يدوياً بلا قيود مقابلة. تقريرٌ يجمع القيود بنفسه
     * سيُرجع صفراً — والصحيح أن يقرأ العمود، فهو مصدر الحقيقة الذي
     * تحرسه المهمّة الليلية.
     */
    await client.query(`update "Account" set "balanceIqd" = 250000 where id = $1`, [
      f.accountId,
    ]);

    const r = await outstandingReport();
    const mine = r.rows.find((x) => x.accountId === f.accountId);
    expect(mine?.balanceIqd, "لم يُقرأ الرصيد من العمود").toBe(250_000n);
    expect(r.totalIqd).toBeGreaterThanOrEqual(250_000n);
  });

  it("والحساب المسدَّد لا يظهر", async () => {
    await client.query(`update "Account" set "balanceIqd" = 0 where id = $1`, [
      f.accountId,
    ]);
    const r = await outstandingReport();
    expect(r.rows.some((x) => x.accountId === f.accountId)).toBe(false);
  });

  it("والرصيد الدائن (سالب) ليس مستحقّاً", async () => {
    await client.query(`update "Account" set "balanceIqd" = -50000 where id = $1`, [
      f.accountId,
    ]);
    const r = await outstandingReport();
    expect(r.rows.some((x) => x.accountId === f.accountId)).toBe(false);
  });
});

describe("🔴 تقادُم الأقساط — من التاريخ لا من الحالة", () => {
  /**
   * ⚠️ **خطّة واحدة وأقساط متعدّدة.** `InstallmentPlan.contractId` فريد —
   * خطّةٌ لكل قسط تصطدم به. والبنية الحقيقية هي هذه أصلاً: خطّةٌ على
   * العقد، وجدولُ أقساطها تحتها.
   */
  let planId = "";
  let seq = 0;

  async function ensurePlan(): Promise<void> {
    if (planId) return;
    planId = testId("plan_rep");
    seq = 0;
    await client.query(
      `insert into "InstallmentPlan"
         (id,"contractId","totalAmountIqd","downPaymentIqd","installmentsCount","intervalMonths","startDate",status,"updatedAt")
       values ($1,$2,1000000,0,12,1,now(),'ACTIVE',now())`,
      [planId, f.contractId],
    );
  }

  beforeEach(() => {
    /* ⚠️ يُصفَّر مع كل اختبار: `cleanupTestData` حذف خطّة الاختبار السابق */
    planId = "";
  });

  async function seedInstallment(dueDaysAgo: number, status: string): Promise<void> {
    await ensurePlan();
    seq += 1;
    await client.query(
      `insert into "Installment"
         (id,"planId",sequence,"dueDate","amountIqd",status,"updatedAt")
       values ($1,$2,$3,$4,100000,$5,now())`,
      [
        testId(`inst_rep_${seq}`),
        planId,
        seq,
        at(new Date(now().getTime() - dueDaysAgo * DAY_MS)),
        status,
      ],
    );
  }

  it("قسطٌ استحقّ اليوم وحالته PENDING يُحتسب متأخّراً", async () => {
    /*
     * ── العيب الذي وُجد هذا الفحص من أجله ───────────────────────────
     * `OVERDUE` تكتبها مهمّة ليلية. فتقريرٌ يرشّح بالحالة يُسقط كل ما
     * استحقّ اليوم — والفرق يظهر في أوّل يوم من كل شهر، وهو أكثر يوم
     * يُقرأ فيه التقرير.
     */
    await seedInstallment(2, "PENDING");

    const r = await installmentAgeingReport();
    expect(r.rows.length, "أُسقط قسطٌ متأخّر لأن حالته لم تُقلَب بعد").toBe(1);
    expect(r.totalIqd).toBe(100_000n);
  });

  it("والشرائح تُوزَّع بالأيام", async () => {
    await seedInstallment(10, "OVERDUE");
    await seedInstallment(45, "OVERDUE");
    await seedInstallment(120, "OVERDUE");

    const r = await installmentAgeingReport();
    const by = new Map(r.buckets.map((b) => [b.key, b.count]));
    expect(by.get("d30")).toBe(1);
    expect(by.get("d60")).toBe(1);
    expect(by.get("d90plus")).toBe(1);
    expect(r.rows.length).toBe(3);
  });

  it("والمدفوع والملغى خارجان", async () => {
    await seedInstallment(30, "PAID");
    await seedInstallment(30, "CANCELLED");
    const r = await installmentAgeingReport();
    expect(r.rows.length).toBe(0);
  });

  it("وما لم يحن استحقاقه خارج", async () => {
    await seedInstallment(-10, "PENDING");
    const r = await installmentAgeingReport();
    expect(r.rows.length).toBe(0);
  });
});

describe("دفتر الحركة", () => {
  it("🔴 المجاميع على المدّة كلّها لا على الصفحة", async () => {
    const range = resolveRange({ preset: "today" }, now());
    const entryAt = new Date(range.from.getTime() + 3_600_000);

    for (let i = 0; i < 5; i += 1) {
      await client.query(
        `insert into "LedgerEntry"
           (id,"accountId",type,source,"amountIqd","descriptionAr","createdAt")
         values ($1,$2,'CHARGE','SUBSCRIPTION',10000,'قيد اختبار',$3)`,
        [testId(`led_${i}`), f.accountId, at(entryAt)],
      );
    }

    const page = await ledgerMovementReport(range, { page: 1, pageSize: 2 });
    expect(page.rows.length, "الصفحة صفّان").toBe(2);
    expect(page.total).toBe(5);
    /*
     * ⚠️ مجموعٌ يتغيّر بالتصفيح ليس مجموعاً — خمسة قيود × 10000
     * مهما كان حجم الصفحة.
     */
    expect(page.chargedIqd, "المجموع حُسب على الصفحة لا على المدّة").toBe(50_000n);
  });

  it("والترشيح بالنوع يعمل", async () => {
    const range = resolveRange({ preset: "today" }, now());
    const entryAt = new Date(range.from.getTime() + 3_600_000);
    await client.query(
      /* ⚠️ `ledger_manual_needs_reason`: مصدر `MANUAL` يوجب سبباً في القاعدة */
      `insert into "LedgerEntry"
         (id,"accountId",type,source,"amountIqd","descriptionAr","createdAt",reason)
       values ($1,$2,'CHARGE','SUBSCRIPTION',10000,'قيد',$3,null),
              ($4,$2,'PAYMENT','MANUAL',4000,'دفعة',$3,'دفعة اختبار')`,
      [testId("led_c"), f.accountId, at(entryAt), testId("led_p")],
    );

    const charges = await ledgerMovementReport(range, {
      page: 1,
      pageSize: 50,
      type: "CHARGE",
    });
    expect(charges.rows.every((r) => r.type === "CHARGE")).toBe(true);
    expect(charges.total).toBe(1);
  });
});

describe("إيراد الخدمات", () => {
  it("⚠️ المقيَّد والمحصَّل رقمان منفصلان لا يُطرح أحدهما من الآخر", async () => {
    const range = resolveRange({ preset: "today" }, now());
    const payAt = new Date(range.from.getTime() + 3_600_000);

    await seedPayment({ id: "svc_pay", amount: 30_000n, paidAt: payAt });

    const r = await serviceRevenueReport(range);
    /*
     * ⚠️ المحصَّل مجموعٌ على حِدَة **لا يُنسَب إلى خدمة**: الدفعة تُسدَّد
     * على الحساب لا على قيدٍ بعينه، وتوزيعُها يحتاج قاعدة محاسبية لم
     * تُتَّخذ.
     */
    expect(r.collectedTotalIqd).toBe(30_000n);
    expect(r.chargedTotalIqd, "نُسب المحصَّل إلى المقيَّد").toBe(0n);
  });
});
