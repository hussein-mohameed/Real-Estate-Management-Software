import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { cleanupTestData, connection, createFixture, testId, type Fixture } from "./helpers";
import {
  closeCashDrawer,
  getCashDrawer,
  openMyCashDrawer,
  recordCashPayment,
  staffCashHistory,
  staffCollectionToday,
} from "@/lib/actions/cash";
import { formatIqd } from "@/lib/money";
import { setStaffCashPermission } from "@/lib/actions/staff";
import type { ActorContext } from "@/lib/actions/define-action";
import { prisma } from "@/lib/prisma";

/**
 * ‏B4 — سياسة النقد. القرار (‏2026-09-01):
 *   **موظفون مُصرَّح لهم بالعلم · إقفال صندوق يومي إلزامي · لا تأريخ في الماضي.**
 *
 * ⚠️ **الثغرة التي يحرسها هذا الملف:** مصفوفة §3.2 تعطي كل موظف صلاحية
 * تسجيل دفعة نقدية على أي حساب. وموظف يسجّل دفعة ويقبض النقد ولا يورّده =
 * **إسقاط دَين مقابل سرقة**. الدفتر append-only فالقيد لا يُحذف — لكن
 * الدَين سقط والنقد بجيبه.
 *
 * وهي الثغرة الوحيدة في النظام التي **يستفيد منها فاعلها**.
 */

let client: Client;
let f: Fixture;
let admin: ActorContext;
let cashier: ActorContext;

const CASHIER = testId("u_cash_staff");
const OTHER = testId("u_cash_other");

async function addStaff(userId: string, name: string, phone: string) {
  await client.query(
    `insert into "User" (id,"fullName",phone,role,"isActive","updatedAt")
     values ($1,$2,$3,'STAFF',true,now())`,
    [userId, name, phone],
  );
  await client.query(
    `insert into "StaffProfile" ("userId","employmentType","isAvailable","jobTitle","updatedAt")
     values ($1,'INTERNAL',true,'أمين صندوق للاختبار',now())`,
    [userId],
  );
}

/** يمنح الصلاحية عبر الإجراء نفسه — لا بكتابة مباشرة في العمود. */
async function grant(userId: string) {
  const r = await setStaffCashPermission(
    { userId, canReceiveCash: true, reason: "أمين صندوق مركز الخدمة" },
    admin,
  );
  if (!r.ok) throw new Error(r.error.message);
}

async function resetWorld() {
  await cleanupTestData(client);
  f = await createFixture(client, "csh");
  admin = { userId: f.roleUsers.ADMIN, role: "ADMIN", ip: "10.0.0.30", userAgent: "vitest" };

  await addStaff(CASHIER, "أمين صندوق الاختبار", "+9647084000001");
  await addStaff(OTHER, "موظف آخر للاختبار", "+9647084000002");
  cashier = { userId: CASHIER, role: "STAFF", ip: "10.0.0.31", userAgent: "vitest" };
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

describe("الصلاحية — العلم لا يُملأ سهواً", () => {
  it("⚠️ الافتراضي: **لا أحد يقبض نقداً**", async () => {
    const profile = await prisma.staffProfile.findUniqueOrThrow({
      where: { userId: CASHIER },
      select: { canReceiveCash: true },
    });
    expect(profile.canReceiveCash).toBe(false);
  });

  it("⚠️ بلا صلاحية لا يُفتح صندوق", async () => {
    const r = await openMyCashDrawer({}, cashier);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toContain("صلاحية قبض النقد");
  });

  it("المنح فعلٌ صريح بسبب إلزامي", async () => {
    const bad = await setStaffCashPermission(
      { userId: CASHIER, canReceiveCash: true, reason: "" },
      admin,
    );
    expect(bad.ok, "قُبل منح بلا سبب").toBe(false);

    await grant(CASHIER);
    const profile = await prisma.staffProfile.findUniqueOrThrow({
      where: { userId: CASHIER },
      select: { canReceiveCash: true },
    });
    expect(profile.canReceiveCash).toBe(true);
  });

  it("منح مكرّر لا يكتب ولا يُدقَّق", async () => {
    await grant(CASHIER);
    await client.query(`delete from "AuditLog" where "entityId" = $1`, [CASHIER]);

    const again = await setStaffCashPermission(
      { userId: CASHIER, canReceiveCash: true, reason: "تأكيد" },
      admin,
    );
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.data.changed).toBe(false);
  });

  it("⚠️ **السحب مرفوض وصندوقه مفتوح** — النقد بيده", async () => {
    /**
     * سحبُ الصلاحية وترك الجلسة مفتوحة يُخفي النقد ولا يستعيده: الموظف
     * لم يُقرّ بما ورّده، ولا أحد يعرف كم بيده.
     */
    await grant(CASHIER);
    const opened = await openMyCashDrawer({}, cashier);
    expect(opened.ok).toBe(true);

    const revoke = await setStaffCashPermission(
      { userId: CASHIER, canReceiveCash: false, reason: "نُقل إلى قسم آخر" },
      admin,
    );
    expect(revoke.ok, "سُحبت الصلاحية وصندوقه مفتوح").toBe(false);
    if (revoke.ok) return;
    expect(revoke.error.message).toContain("صندوقه مفتوح");

    // ما زال يملكها فعلاً — لم تُسحب على نصف الطريق
    const profile = await prisma.staffProfile.findUniqueOrThrow({
      where: { userId: CASHIER },
      select: { canReceiveCash: true },
    });
    expect(profile.canReceiveCash).toBe(true);
  });

  it("السحب يمضي بعد الإقفال", async () => {
    await grant(CASHIER);
    const opened = await openMyCashDrawer({}, cashier);
    if (!opened.ok) throw new Error(opened.error.message);

    await closeCashDrawer(
      { sessionId: opened.data.sessionId, declaredIqd: 0n },
      cashier,
    );

    const revoke = await setStaffCashPermission(
      { userId: CASHIER, canReceiveCash: false, reason: "نُقل إلى قسم آخر" },
      admin,
    );
    expect(revoke.ok, revoke.ok ? "" : revoke.error.message).toBe(true);
  });
});

describe("الصندوق", () => {
  it("⚠️ جلسة مفتوحة **واحدة** لكل موظف", async () => {
    await grant(CASHIER);
    const first = await openMyCashDrawer({}, cashier);
    expect(first.ok).toBe(true);

    const second = await openMyCashDrawer({}, cashier);
    expect(second.ok, "فُتح صندوق ثانٍ بجانب المفتوح").toBe(false);
    if (second.ok) return;
    expect(second.error.message).toContain("صندوق مفتوح");
  });

  it("⚠️ محاولتان متوازيتان لفتح صندوق ← واحدة تنجح", async () => {
    /**
     * الفهرس الفريد الجزئي `uniq_open_cash_drawer_per_staff` هو الحارس،
     * لا الشرط في الكود: الطلبان يقرآن «لا جلسة» كلاهما قبل أن يكتب أحدهما.
     */
    await grant(CASHIER);
    const [a, b] = await Promise.all([
      openMyCashDrawer({}, cashier),
      openMyCashDrawer({}, cashier),
    ]);
    expect([a, b].filter((r) => r.ok).length, "فُتحت جلستان").toBe(1);

    expect(
      await prisma.cashDrawerSession.count({
        where: { staffUserId: CASHIER, closedAt: null },
      }),
    ).toBe(1);
  });

  it("⚠️ الإقفال يوجب مبلغاً مُقرّاً، ولا يُقفَل مرّتين", async () => {
    await grant(CASHIER);
    const opened = await openMyCashDrawer({}, cashier);
    if (!opened.ok) throw new Error(opened.error.message);

    const closed = await closeCashDrawer(
      { sessionId: opened.data.sessionId, declaredIqd: 0n },
      cashier,
    );
    expect(closed.ok).toBe(true);

    const again = await closeCashDrawer(
      { sessionId: opened.data.sessionId, declaredIqd: 0n },
      cashier,
    );
    expect(again.ok, "أُقفل الصندوق مرّتين").toBe(false);
  });

  it("مبلغ مُقرّ سالب مرفوض", async () => {
    await grant(CASHIER);
    const opened = await openMyCashDrawer({}, cashier);
    if (!opened.ok) throw new Error(opened.error.message);

    const r = await closeCashDrawer(
      { sessionId: opened.data.sessionId, declaredIqd: -1n },
      cashier,
    );
    expect(r.ok).toBe(false);
  });
});

describe("الدفعة النقدية", () => {
  it("⚠️ **بلا صندوق مفتوح لا نقد يُقبَض**", async () => {
    await grant(CASHIER);
    // لم يُفتح صندوق
    const r = await recordCashPayment(
      { accountId: f.accountId, amountIqd: 100_000n },
      cashier,
    );
    expect(r.ok, "قُبض نقد بلا صندوق").toBe(false);
    if (r.ok) return;
    expect(r.error.message).toContain("صندوق مفتوح");

    expect(await prisma.payment.count({ where: { accountId: f.accountId } })).toBe(0);
  });

  it("الدفعة تُنقص الرصيد وتُربط بالصندوق وبمن قبضها", async () => {
    await grant(CASHIER);
    const opened = await openMyCashDrawer({}, cashier);
    if (!opened.ok) throw new Error(opened.error.message);

    // دَين قائم على الحساب
    await client.query(`update "Account" set "balanceIqd" = 0 where id = $1`, [f.accountId]);

    const r = await recordCashPayment(
      { accountId: f.accountId, amountIqd: 100_000n, notes: "قسط أول" },
      cashier,
    );
    expect(r.ok, r.ok ? "" : r.error.message).toBe(true);
    if (!r.ok) return;

    // الرصيد نقص: القيد `PAYMENT` يُطرَح (‏D2)
    expect(r.data.balanceIqd).toBe(-100_000n);

    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: r.data.paymentId },
      select: {
        method: true,
        status: true,
        receivedByUserId: true,
        cashDrawerSessionId: true,
        paidAt: true,
      },
    });
    expect(payment.method).toBe("CASH_AT_CENTER");
    expect(payment.status).toBe("PAID");
    // ⚠️ **المسؤولية عن نقد حقيقي** (‏N4)
    expect(payment.receivedByUserId).toBe(CASHIER);
    expect(payment.cashDrawerSessionId).toBe(opened.data.sessionId);
    expect(payment.paidAt).not.toBeNull();
  });

  it("⚠️ القيد في نفس المعاملة — لا دفعة بلا قيد", async () => {
    await grant(CASHIER);
    const opened = await openMyCashDrawer({}, cashier);
    if (!opened.ok) throw new Error(opened.error.message);

    const r = await recordCashPayment(
      { accountId: f.accountId, amountIqd: 50_000n },
      cashier,
    );
    if (!r.ok) throw new Error(r.error.message);

    const entry = await prisma.ledgerEntry.findFirstOrThrow({
      where: { paymentId: r.data.paymentId },
      select: { type: true, source: true, amountIqd: true, reason: true, createdByUserId: true },
    });
    expect(entry.type).toBe("PAYMENT");
    // ⚠️ `MANUAL` يوجب سبباً — والقاعدة ترفضه بلا سبب
    expect(entry.source).toBe("MANUAL");
    expect(entry.reason).toBeTruthy();
    expect(entry.amountIqd).toBe(50_000n);
    expect(entry.createdByUserId).toBe(CASHIER);
  });

  it("لا دفعة على حساب مغلق (‏R16)", async () => {
    await grant(CASHIER);
    const opened = await openMyCashDrawer({}, cashier);
    if (!opened.ok) throw new Error(opened.error.message);

    await client.query(
      `update "Account" set status = 'CLOSED', "closedAt" = now() where id = $1`,
      [f.accountId],
    );

    const r = await recordCashPayment(
      { accountId: f.accountId, amountIqd: 10_000n },
      cashier,
    );
    expect(r.ok).toBe(false);
  });

  it("مبلغ صفر أو سالب مرفوض", async () => {
    await grant(CASHIER);
    const opened = await openMyCashDrawer({}, cashier);
    if (!opened.ok) throw new Error(opened.error.message);

    for (const amount of [0n, -5_000n]) {
      const r = await recordCashPayment(
        { accountId: f.accountId, amountIqd: amount },
        cashier,
      );
      expect(r.ok, `قُبل مبلغ ${amount}`).toBe(false);
    }
  });
});

describe("الإقفال والفرق — جوهر B4", () => {
  it("⚠️ المتوقَّع **محسوب** من الدفعات لا مخزَّناً", async () => {
    await grant(CASHIER);
    const opened = await openMyCashDrawer({}, cashier);
    if (!opened.ok) throw new Error(opened.error.message);

    await recordCashPayment({ accountId: f.accountId, amountIqd: 60_000n }, cashier);
    await recordCashPayment({ accountId: f.accountId, amountIqd: 40_000n }, cashier);

    const state = await getCashDrawer({ sessionId: opened.data.sessionId }, cashier);
    expect(state.ok).toBe(true);
    if (!state.ok) return;
    expect(state.data.expectedIqd).toBe(100_000n);
    expect(state.data.paymentsCount).toBe(2);
    // مفتوحة ← لا مُقرّ ولا فرق
    expect(state.data.declaredIqd).toBeNull();
    expect(state.data.varianceIqd).toBeNull();
  });

  it("إقفال مطابق ← فرق صفر", async () => {
    await grant(CASHIER);
    const opened = await openMyCashDrawer({}, cashier);
    if (!opened.ok) throw new Error(opened.error.message);
    await recordCashPayment({ accountId: f.accountId, amountIqd: 75_000n }, cashier);

    const closed = await closeCashDrawer(
      { sessionId: opened.data.sessionId, declaredIqd: 75_000n },
      cashier,
    );
    expect(closed.ok).toBe(true);
    if (!closed.ok) return;
    expect(closed.data.varianceIqd).toBe(0n);
    expect(closed.data.varianceLabelAr).toBe("مطابق");
  });

  it("⚠️ **النقص يُسجَّل ولا يمنع الإقفال**", async () => {
    /**
     * رفضُ الإقفال بسبب النقص يجعل الموظف يترك الصندوق مفتوحاً بلا إقفال،
     * فيضيع الضابط كلّه ويبقى النقص مخفياً. الإقفال يمضي، والفرق يظهر
     * باسم صاحبه وفي يومه.
     */
    await grant(CASHIER);
    const opened = await openMyCashDrawer({}, cashier);
    if (!opened.ok) throw new Error(opened.error.message);
    await recordCashPayment({ accountId: f.accountId, amountIqd: 100_000n }, cashier);

    // ورّد 60 ألفاً من 100 — نقص 40 ألفاً
    const closed = await closeCashDrawer(
      { sessionId: opened.data.sessionId, declaredIqd: 60_000n, notes: "نقص غير مبرَّر" },
      cashier,
    );
    expect(closed.ok, "رُفض الإقفال بسبب النقص فبقي الصندوق مفتوحاً").toBe(true);
    if (!closed.ok) return;

    expect(closed.data.expectedIqd).toBe(100_000n);
    expect(closed.data.declaredIqd).toBe(60_000n);
    expect(closed.data.varianceIqd).toBe(-40_000n);
    expect(closed.data.varianceLabelAr).toContain("نقص");

    // والجلسة أُقفلت فعلاً — لا تبقى مفتوحة
    const row = await prisma.cashDrawerSession.findUniqueOrThrow({
      where: { id: opened.data.sessionId },
      select: { closedAt: true, closedByUserId: true, declaredIqd: true },
    });
    expect(row.closedAt).not.toBeNull();
    expect(row.closedByUserId).toBe(CASHIER);
    expect(row.declaredIqd).toBe(60_000n);
  });

  it("الزيادة تُسجَّل أيضاً", async () => {
    await grant(CASHIER);
    const opened = await openMyCashDrawer({}, cashier);
    if (!opened.ok) throw new Error(opened.error.message);
    await recordCashPayment({ accountId: f.accountId, amountIqd: 50_000n }, cashier);

    const closed = await closeCashDrawer(
      { sessionId: opened.data.sessionId, declaredIqd: 55_000n },
      cashier,
    );
    if (!closed.ok) throw new Error(closed.error.message);
    expect(closed.data.varianceIqd).toBe(5_000n);
    expect(closed.data.varianceLabelAr).toContain("زيادة");
  });

  it("⚠️ الدفعة بعد الإقفال تحتاج صندوقاً جديداً", async () => {
    await grant(CASHIER);
    const first = await openMyCashDrawer({}, cashier);
    if (!first.ok) throw new Error(first.error.message);
    await closeCashDrawer({ sessionId: first.data.sessionId, declaredIqd: 0n }, cashier);

    const r = await recordCashPayment(
      { accountId: f.accountId, amountIqd: 10_000n },
      cashier,
    );
    expect(r.ok, "قُبض نقد على صندوق مُقفَل").toBe(false);
  });
});

describe("تقرير تحصيل الموظف", () => {
  it("يعرض الجلسات بفروقها، والأحدث أولاً", async () => {
    await grant(CASHIER);

    // جلسة أولى بنقص
    const s1 = await openMyCashDrawer({}, cashier);
    if (!s1.ok) throw new Error(s1.error.message);
    await recordCashPayment({ accountId: f.accountId, amountIqd: 80_000n }, cashier);
    await closeCashDrawer({ sessionId: s1.data.sessionId, declaredIqd: 70_000n }, cashier);

    // جلسة ثانية مطابقة
    const s2 = await openMyCashDrawer({}, cashier);
    if (!s2.ok) throw new Error(s2.error.message);
    await recordCashPayment({ accountId: f.accountId, amountIqd: 20_000n }, cashier);
    await closeCashDrawer({ sessionId: s2.data.sessionId, declaredIqd: 20_000n }, cashier);

    const r = await staffCashHistory({ staffUserId: CASHIER, limit: 10 }, admin);
    expect(r.ok, r.ok ? "" : r.error.message).toBe(true);
    if (!r.ok) return;

    expect(r.data).toHaveLength(2);
    // الأحدث أولاً
    expect(r.data[0]!.sessionId).toBe(s2.data.sessionId);
    expect(r.data[0]!.varianceIqd).toBe(0n);
    expect(r.data[1]!.sessionId).toBe(s1.data.sessionId);
    expect(r.data[1]!.varianceIqd, "لم يُحفظ النقص في التقرير").toBe(-10_000n);
  });

  it("⚠️ لا يرى صناديق موظف آخر", async () => {
    await grant(CASHIER);
    const s = await openMyCashDrawer({}, cashier);
    if (!s.ok) throw new Error(s.error.message);

    const r = await staffCashHistory({ staffUserId: OTHER, limit: 10 }, admin);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.map((d) => d.sessionId)).not.toContain(s.data.sessionId);
  });
});

/**
 * ── تقرير التحصيل الدُفعي — عمود شاشة الموظفين ──────────────────────
 *
 * ⚠️ يحرس شيئين لا يكشفهما شيء آخر:
 *  1. **الرقم نفسه** الذي تعرضه شاشة الصندوق. لو رشّح أحد المسارين حالة
 *     دفعة وتركها الآخر، اختلف رقمان عن نفس المال في نفس اليوم.
 *  2. أن الحقول تعبر إلى العميل: `Map` و`BigInt` لا يعبران حدّ RSC،
 *     ويصلان فارغين **بلا خطأ** — فيبدو أن أحداً لم يحصّل شيئاً.
 */
describe("تحصيل اليوم لمجموعة موظفين", () => {
  it("يجمع دفعات الموظف ويطابق ما تعرضه شاشة صندوقه", async () => {
    await grant(CASHIER);
    const opened = await openMyCashDrawer({}, cashier);
    if (!opened.ok) throw new Error(opened.error.message);

    for (const amount of [100_000n, 250_000n, 50_000n]) {
      const r = await recordCashPayment({ accountId: f.accountId, amountIqd: amount }, cashier);
      if (!r.ok) throw new Error(r.error.message);
    }

    const report = await staffCollectionToday({ staffUserIds: [CASHIER, OTHER] }, admin);
    expect(report.ok, report.ok ? "" : report.error.message).toBe(true);
    if (!report.ok) return;

    const mine = report.data.find((r) => r.staffUserId === CASHIER);
    expect(mine, "الموظف الذي فتح صندوقاً لم يظهر في التقرير").toBeDefined();
    expect(mine?.payments).toBe(3);
    expect(mine?.hasOpenDrawer).toBe(true);

    /*
     * ⚠️ **يُقارَن بشاشة الصندوق لا برقم مكتوب باليد.** رقمٌ ثابت في
     * الاختبار يوافق قاعدةَ حساب خاطئة بنفس سهولة موافقته للصحيحة.
     */
    const drawer = await getCashDrawer({ sessionId: opened.data.sessionId }, cashier);
    if (!drawer.ok) throw new Error(drawer.error.message);
    expect(mine?.collectedLabel).toBe(formatIqd(drawer.data.expectedIqd));

    /* ومن لم يفتح صندوقاً لا صفَّ له — «لم يفتح» ≠ «حصّل صفراً» */
    expect(report.data.find((r) => r.staffUserId === OTHER)).toBeUndefined();
  });

  it("يُعلِم أن الصندوق أُقفِل، ويُبقي المبلغ المحصَّل", async () => {
    await grant(CASHIER);
    const opened = await openMyCashDrawer({}, cashier);
    if (!opened.ok) throw new Error(opened.error.message);

    const paid = await recordCashPayment(
      { accountId: f.accountId, amountIqd: 75_000n },
      cashier,
    );
    if (!paid.ok) throw new Error(paid.error.message);

    const closed = await closeCashDrawer(
      { sessionId: opened.data.sessionId, declaredIqd: 75_000n },
      cashier,
    );
    if (!closed.ok) throw new Error(closed.error.message);

    const report = await staffCollectionToday({ staffUserIds: [CASHIER] }, admin);
    if (!report.ok) throw new Error(report.error.message);

    const mine = report.data.find((r) => r.staffUserId === CASHIER);
    /* ⚠️ الإقفال لا يمحو التحصيل: التقرير رقابيّ عن اليوم كلّه لا عن اللحظة */
    expect(mine?.hasOpenDrawer).toBe(false);
    expect(mine?.payments).toBe(1);
    expect(mine?.collectedLabel).toBe(formatIqd(75_000n));
  });

  /**
   * ⚠️ **هذا الاختبار كشف عيباً حقيقياً، لا خطأ اختبار.**
   * كانت قدرة التقريرين `DEPARTMENTS_SKILLS_STAFF`، وهي تمنح الموظف
   * `READ` على كل الموظفين — مقصودٌ للدليل، كارثةٌ لأرقام النقد. فكل
   * موظف كان يقرأ فروق صناديق زملائه، والضابط على الثغرة التي وُجد
   * `cash-drawer.ts` من أجلها كان مقروءاً لمن يُراقَب.
   *
   * والتقريران معاً هنا: العيب كان في القديم كما في الجديد.
   */
  it("يمنع الموظف من قراءة تحصيل غيره — التقريران", async () => {
    await grant(CASHIER);

    const today = await staffCollectionToday({ staffUserIds: [OTHER] }, cashier);
    expect(today.ok, "موظف قرأ تحصيل اليوم لموظف آخر").toBe(false);

    const history = await staffCashHistory({ staffUserId: OTHER }, cashier);
    expect(history.ok, "موظف قرأ سجلّ صناديق موظف آخر").toBe(false);

    /* ⚠️ ولا يقرأ **تحصيل نفسه** من هذا الطريق: التقرير رقابيّ لا شخصيّ */
    const mine = await staffCollectionToday({ staffUserIds: [CASHIER] }, cashier);
    expect(mine.ok, "موظف قرأ التقرير الرقابي عن نفسه").toBe(false);
  });

  /**
   * ⚠️ **الحالة التي كان العمود يُخفيها.**
   * الترشيح بـ`openedAt >= اليوم` وحده جعل صندوقاً بقي مفتوحاً من أمس
   * يظهر «لم يفتح صندوقاً» — أي أن التقرير يطمئن حيث يجب أن يُنذر، وعن
   * **الخرق الوحيد** الذي يوجبه القرار B4 صراحةً (إقفال يومي إلزامي).
   */
  it("يُنذر عن صندوق بقي مفتوحاً من أمس", async () => {
    await grant(CASHIER);
    const opened = await openMyCashDrawer({}, cashier);
    if (!opened.ok) throw new Error(opened.error.message);

    const paid = await recordCashPayment(
      { accountId: f.accountId, amountIqd: 30_000n },
      cashier,
    );
    if (!paid.ok) throw new Error(paid.error.message);

    /*
     * ⚠️ يُؤرَّخ الفتح إلى أمس **بكتابة مباشرة**: لا إجراء في النظام
     * يفتح صندوقاً في الماضي — والقرار B4 يمنع التأريخ في الماضي عمداً.
     * فالحالة لا تُنتَج إلا بمرور الوقت، وإنتاجها في اختبار يلزمه هذا.
     */
    const yesterday = new Date(Date.now() - 26 * 60 * 60 * 1000);
    await prisma.cashDrawerSession.update({
      where: { id: opened.data.sessionId },
      data: { openedAt: yesterday },
    });

    const report = await staffCollectionToday({ staffUserIds: [CASHIER] }, admin);
    if (!report.ok) throw new Error(report.error.message);

    const mine = report.data.find((r) => r.staffUserId === CASHIER);
    expect(mine, "الصندوق المفتوح من أمس اختفى من التقرير").toBeDefined();
    expect(mine?.staleDrawer, "لم يُعلَّم الصندوق العالق").toBe(true);
    expect(mine?.hasOpenDrawer).toBe(true);

    /*
     * ⚠️ والمجموع يبقى على **اليوم**: دفعةُ أمس ليست تحصيل اليوم، وخلطُ
     * يومين في رقم واحد يجعل العمود يكذب على من يراجع.
     */
    expect(mine?.collectedLabel).toBe(formatIqd(0n));
    expect(mine?.payments).toBe(0);
  });

  it("يقرؤه المالك — يشرف ولا يقبض", async () => {
    const owner: ActorContext = {
      userId: f.roleUsers.OWNER,
      role: "OWNER",
      ip: "10.0.0.32",
      userAgent: "vitest",
    };
    const r = await staffCollectionToday({ staffUserIds: [CASHIER] }, owner);
    expect(r.ok, r.ok ? "" : r.error.message).toBe(true);
  });
});
