import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { cleanupTestData, connection, createFixture, testId, type Fixture } from "./helpers";
import { NextRequest } from "next/server";
import { POST as billingRoute } from "@/app/api/cron/billing/route";
import { runPeriodicBilling } from "@/lib/services/billing";
import { prisma } from "@/lib/prisma";
import { addMonthsBaghdad, toBaghdadParts } from "@/lib/dates";

/**
 * الخطوة 2.7 — مهمة الفوترة الدورية. تعريف الإنجاز حرفياً:
 *   «**تشغيلان متتاليان ← نفس عدد القيود بالضبط، اشتراكات وإيجارات معاً**»
 *   «اشتراك على شقة `VACANT` يُوقَف ويُتخطّى»
 *   «اختبار على حدّ الشهر بتوقيت بغداد»
 *   «بلا `CRON_SECRET` ← 401»
 *   «**رسالة ملخّص واحدة لكل حساب** لا رسالة لكل اشتراك»
 */

let client: Client;
let f: Fixture;

const SVC_A = testId("svc_bil_a");
const SVC_B = testId("svc_bil_b");
const SUB_A = testId("sub_bil_a");
const SUB_B = testId("sub_bil_b");

/** أمس — كي يكون الاستحقاق قد حلّ فعلاً. */
function yesterday(): Date {
  return new Date(Date.now() - 24 * 60 * 60 * 1000);
}

async function addService(id: string, name: string, price: number) {
  await client.query(
    `insert into "Service" (id,name,"billingType","billingCycle","pricingModel",
                            "basePriceIqd","payerType","appliesTo","isAvailable","updatedAt")
     values ($1,$2,'RECURRING','MONTHLY','FLAT',$3,'OCCUPANT','APARTMENT',true,now())`,
    [id, name, price],
  );
}

/**
 * ⚠️ **الزرع بـPrisma لا بـ`pg` الخام — والفرق ثلاث ساعات.**
 *
 * أعمدة التاريخ `timestamp` **بلا منطقة زمنية**. ومُشغّل `pg` يكتب ساعة
 * الحائط المحلّية (بغداد UTC+3)، وPrisma يكتب ويقرأ UTC. فزرعٌ بـ`pg`
 * وقراءةٌ بـPrisma يُنتجان انزياحاً ثابتاً بثلاث ساعات.
 *
 * وقعتُ فيه: فشل اختباران بفارق 10,800,000 مللي ثانية بالضبط — والكود
 * سليم، والفكسچر هو من خلط المُشغّلَين. وبقيّة الملفّات لا تراه لأنها لا
 * تقارن طوابع زمنية بالمللي ثانية.
 */
async function addSubscription(id: string, serviceId: string, amount: number, due: Date) {
  await prisma.subscription.create({
    data: {
      id,
      serviceId,
      subjectType: "APARTMENT",
      apartmentId: f.apartmentId,
      accountId: f.accountId,
      payerType: "OCCUPANT",
      quantity: 1,
      unitPriceSnapshotIqd: BigInt(amount),
      periodAmountIqd: BigInt(amount),
      billingCycle: "MONTHLY",
      status: "ACTIVE",
      startDate: due,
      nextChargeDate: due,
    },
  });
}

async function resetWorld() {
  await cleanupTestData(client);
  f = await createFixture(client, "bil");
  await addService(SVC_A, "خدمة فوترة أ", 30_000);
  await addService(SVC_B, "خدمة فوترة ب", 20_000);
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

describe("🔴 التكرار — تشغيلان متتاليان", () => {
  it("**نفس عدد القيود بالضبط، اشتراكات وإيجارات معاً**", async () => {
    await addSubscription(SUB_A, SVC_A, 30_000, yesterday());

    /**
     * عقد إيجار نشط على **الشقة نفسها**: `D1` يسمح بعقدَي بيع وإيجار
     * معاً، والفكسچر يُنشئ عقد بيع. فيُختبَر الفرعان في تشغيل واحد كما
     * ينصّ تعريف الإنجاز.
     */
    const rentContract = testId("ctr_bil_rent");
    const rentAccount = testId("acc_bil_rent");
    await client.query(
      `insert into "Contract" (id,"contractNumber","apartmentId","holderUserId",type,status,
                               "startDate","rentAmountIqd","rentCycle","updatedAt")
       values ($1,$2,$3,$4,'RENTAL','ACTIVE',$5,500000,'MONTHLY',now())`,
      [rentContract, "BIL-RENT-1", f.apartmentId, f.holderId, yesterday()],
    );
    await client.query(
      `insert into "Account" (id,"contractId","apartmentId","holderUserId",status,"balanceIqd","updatedAt")
       values ($1,$2,$3,$4,'OPEN',0,now())`,
      [rentAccount, rentContract, f.apartmentId, f.holderId],
    );

    const first = await runPeriodicBilling();
    expect(first.errors, JSON.stringify(first.errors)).toEqual([]);
    expect(first.subscriptions.charged).toBe(1);
    expect(first.rents.charged).toBeGreaterThanOrEqual(1);

    const countAfterFirst = await prisma.ledgerEntry.count({
      where: { accountId: { in: [f.accountId, rentAccount] } },
    });

    const second = await runPeriodicBilling();
    expect(second.subscriptions.charged, "أعادت الفوترة قيد اشتراك").toBe(0);
    expect(second.rents.charged, "أعادت الفوترة قيد إيجار").toBe(0);

    const countAfterSecond = await prisma.ledgerEntry.count({
      where: { accountId: { in: [f.accountId, rentAccount] } },
    });
    expect(countAfterSecond, "تغيّر عدد القيود بتشغيل ثانٍ").toBe(countAfterFirst);
  });

  it("⚠️ `nextChargeDate` يتقدّم دورةً واحدة لا أكثر", async () => {
    const due = yesterday();
    await addSubscription(SUB_A, SVC_A, 30_000, due);

    await runPeriodicBilling();

    const sub = await prisma.subscription.findUniqueOrThrow({
      where: { id: SUB_A },
      select: { nextChargeDate: true, lastChargedPeriodStart: true },
    });
    expect(sub.nextChargeDate!.getTime()).toBe(addMonthsBaghdad(due, 1).getTime());
    expect(sub.lastChargedPeriodStart!.getTime()).toBe(due.getTime());
  });

  it("⚠️ تشغيلٌ انقطع بعد القيد وقبل تحديث الموعد ← لا يُعيد الفوترة أبداً", async () => {
    /**
     * ⚠️ **هذه الحالة هي ما يحرسه تقدُّم `nextChargeDate` عند التعارض.**
     * تشغيلٌ يُقيّد ثم ينقطع قبل تحديث الموعد يترك الاشتراك مستحقّاً على
     * فترة مُقيَّدة سلفاً. فإن تقدّم الموعد في حالة النجاح وحدها، أعادت
     * المهمّة المحاولةَ **كل ليلة إلى الأبد** على قيد موجود — وتضخّمت
     * قائمة الأخطاء بلا سبب حقيقي.
     *
     * تُحاكى الحالة بإرجاع الموعد إلى الفترة التي قُيّدت فعلاً.
     */
    const due = yesterday();
    await addSubscription(SUB_A, SVC_A, 30_000, due);

    const first = await runPeriodicBilling();
    expect(first.subscriptions.charged).toBe(1);

    // محاكاة الانقطاع: القيد موجود والموعد ما زال على فترته
    await prisma.subscription.update({
      where: { id: SUB_A },
      data: { nextChargeDate: due },
    });

    const second = await runPeriodicBilling();
    expect(second.subscriptions.alreadyCharged, "لم يُرصد القيد الموجود").toBe(1);
    expect(second.subscriptions.charged).toBe(0);
    expect(second.errors, "عُدّ التعارض خطأً").toEqual([]);

    // والموعد تقدّم فعلاً — وإلا تكرّرت المحاولة أبداً
    const sub = await prisma.subscription.findUniqueOrThrow({
      where: { id: SUB_A },
      select: { nextChargeDate: true },
    });
    expect(
      sub.nextChargeDate!.getTime(),
      "لم يتقدّم الموعد عند التعارض — إعادة محاولة أبدية",
    ).toBe(addMonthsBaghdad(due, 1).getTime());

    // ولا قيد ثانٍ
    expect(await prisma.ledgerEntry.count({ where: { subscriptionId: SUB_A } })).toBe(1);
  });

  it("⚠️ تشغيلان متوازيان لا يُنتجان قيدين", async () => {
    /**
     * المُشغّل قد يُعيد المحاولة قبل أن ينتهي التشغيل الأول. والحماية
     * فهرس في القاعدة لا شرط في الكود.
     */
    await addSubscription(SUB_A, SVC_A, 30_000, yesterday());

    const [a, b] = await Promise.all([runPeriodicBilling(), runPeriodicBilling()]);
    const charged = a.subscriptions.charged + b.subscriptions.charged;
    expect(charged, "قُيّد الاشتراك مرّتين").toBe(1);

    expect(
      await prisma.ledgerEntry.count({ where: { subscriptionId: SUB_A } }),
    ).toBe(1);
  });
});

describe("الشقة الفارغة", () => {
  it("⚠️ الاشتراك يُوقَف **ويُتخطّى** لا يُفوتَر", async () => {
    await addSubscription(SUB_A, SVC_A, 30_000, yesterday());
    await client.query(`update "Apartment" set "occupancyStatus" = 'VACANT' where id = $1`, [
      f.apartmentId,
    ]);

    const r = await runPeriodicBilling();
    expect(r.subscriptions.charged, "فُوتِرت شقة فارغة").toBe(0);
    expect(r.subscriptions.pausedVacant).toBe(1);

    const sub = await prisma.subscription.findUniqueOrThrow({
      where: { id: SUB_A },
      select: { status: true, nextChargeDate: true },
    });
    expect(sub.status).toBe("PAUSED");
    /**
     * ⚠️ التصفير هو ما يمنع إعادة المحاولة كل ليلة. التخطّي وحده يُبقي
     * `nextChargeDate` في الماضي فتُعاد المحاولة إلى الأبد.
     */
    expect(sub.nextChargeDate, "بقي موعد فوترة على شقة فارغة").toBeNull();
    expect(await prisma.ledgerEntry.count({ where: { subscriptionId: SUB_A } })).toBe(0);
  });
});

describe("حدّ الشهر بتوقيت بغداد", () => {
  it("⚠️ استحقاق في اللحظة الأولى من الشهر يُفوتَر، والشهر المذكور صحيح", async () => {
    /**
     * ⚠️ **هذا ما يكسره حساب التوقيت الخاطئ.** بغداد UTC+3، فمنتصف ليل
     * الأول من الشهر محلّياً هو 21:00 من اليوم الأخير للشهر السابق بـUTC.
     * ودالّة تقرأ الشهر بتوقيت الخادم تكتب في الوصف **الشهر الخطأ**،
     * ويقرأ الساكن «إيجار تموز» على فترة آب.
     */
    const p = toBaghdadParts(new Date());
    // منتصف ليل الأول من الشهر الحالي بتوقيت بغداد = 21:00 UTC لليوم السابق
    const firstOfMonthBaghdad = new Date(Date.UTC(p.year, p.month - 1, 1, -3));
    expect(firstOfMonthBaghdad.getTime()).toBeLessThan(Date.now());

    await addSubscription(SUB_A, SVC_A, 30_000, firstOfMonthBaghdad);

    const r = await runPeriodicBilling();
    expect(r.subscriptions.charged).toBe(1);

    const entry = await prisma.ledgerEntry.findFirstOrThrow({
      where: { subscriptionId: SUB_A },
      select: { descriptionAr: true, periodStart: true, periodEnd: true },
    });

    // الشهر في الوصف يطابق شهر بداية الفترة **بتوقيت بغداد**
    const started = toBaghdadParts(entry.periodStart!);
    expect(started.month).toBe(p.month);
    expect(started.day, "انزلق يوم بداية الفترة بسبب فرق التوقيت").toBe(1);

    // نهاية الفترة = بداية التالية ناقص مللي ثانية، بلا فجوة ولا تداخل
    const nextStart = addMonthsBaghdad(firstOfMonthBaghdad, 1);
    expect(entry.periodEnd!.getTime()).toBe(nextStart.getTime() - 1);
  });

  it("استحقاق في المستقبل لا يُفوتَر", async () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await addSubscription(SUB_A, SVC_A, 30_000, tomorrow);

    const r = await runPeriodicBilling();
    expect(r.subscriptions.charged).toBe(0);
    expect(await prisma.ledgerEntry.count({ where: { subscriptionId: SUB_A } })).toBe(0);
  });
});

describe("الملخّص — رسالة واحدة لكل حساب", () => {
  it("⚠️ أربع خدمات على حساب واحد ← **رسالة واحدة**", async () => {
    await addSubscription(SUB_A, SVC_A, 30_000, yesterday());
    await addSubscription(SUB_B, SVC_B, 20_000, yesterday());

    const before = await prisma.notification.count({
      where: { userId: f.holderId, templateKey: "billing.summary" },
    });

    const r = await runPeriodicBilling();
    expect(r.subscriptions.charged).toBe(2);
    expect(r.accountsNotified, "رسالة لكل اشتراك لا لكل حساب").toBe(1);

    const rows = await prisma.notification.findMany({
      where: { userId: f.holderId, templateKey: "billing.summary" },
      select: { body: true, channel: true, status: true, readAt: true },
    });
    expect(rows).toHaveLength(before + 1);
    // الملخّص يذكر الخدمتين معاً
    expect(rows[0]!.body).toContain("خدمة فوترة أ");
    expect(rows[0]!.body).toContain("خدمة فوترة ب");
    expect(rows[0]!.channel).toBe("IN_APP");
    // ⚠️ معلّقة لا مُرسَلة: الإرسال محجوب بـB7
    expect(rows[0]!.status).toBe("PENDING");
    // غير مقروءة ← تظهر في الجرس فوراً (‏Q44)
    expect(rows[0]!.readAt).toBeNull();
  });

  it("بلا قيود لا رسالة", async () => {
    const r = await runPeriodicBilling();
    expect(r.subscriptions.charged).toBe(0);
    expect(r.accountsNotified).toBe(0);
  });
});

describe("الرصيد", () => {
  it("الرصيد يساوي مجموع ما قُيّد", async () => {
    await addSubscription(SUB_A, SVC_A, 30_000, yesterday());
    await addSubscription(SUB_B, SVC_B, 20_000, yesterday());

    const r = await runPeriodicBilling();
    expect(r.subscriptions.totalIqd).toBe(50_000n);

    const account = await prisma.account.findUniqueOrThrow({
      where: { id: f.accountId },
      select: { balanceIqd: true },
    });
    expect(account.balanceIqd).toBe(50_000n);
  });
});

describe("حارس المسار", () => {
  const SECRET = process.env["CRON_SECRET"];

  function call(auth?: string) {
    return billingRoute(
      new NextRequest("http://localhost/api/cron/billing", {
        method: "POST",
        ...(auth ? { headers: { authorization: auth } } : {}),
      }),
    );
  }

  it("⚠️ بلا `CRON_SECRET` في الترويسة ← 401", async () => {
    expect(SECRET, "‏CRON_SECRET غير مضبوط — الاختبار أجوف").toBeTruthy();
    const res = await call();
    expect(res.status).toBe(401);
  });

  it("سرّ خاطئ ← 401 بنفس جواب الغياب", async () => {
    const wrong = await call("Bearer nope");
    const missing = await call();
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual(await missing.json());
  });

  it("⚠️ بلا سرّ مُهيَّأ ← 503 ولا تعمل مفتوحة", async () => {
    delete process.env["CRON_SECRET"];
    try {
      const res = await call("Bearer anything");
      expect(res.status).toBe(503);
    } finally {
      process.env["CRON_SECRET"] = SECRET;
    }
  });

  it("السرّ الصحيح ← 200، والمبالغ نصوص لا أرقام عائمة", async () => {
    await addSubscription(SUB_A, SVC_A, 30_000, yesterday());

    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      subscriptions: Record<string, unknown>;
      skipped: Array<{ blockedBy: string }>;
    };
    expect(body.subscriptions["charged"]).toBe(1);
    // ‏BigInt لا يُسلسَل، والعائم يفقد الدقّة على المال
    expect(body.subscriptions["totalIqd"]).toBe("30000");
    // ما لم يُنفَّذ يُذكر بسببه
    expect(body.skipped.map((s) => s.blockedBy)).toEqual(
      expect.arrayContaining(["B7", "B1"]),
    );
  });
});
