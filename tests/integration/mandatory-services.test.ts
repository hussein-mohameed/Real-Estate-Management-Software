import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { cleanupTestData, connection, createFixture, testId, type Fixture } from "./helpers";
import { setApartmentOccupancy } from "@/lib/actions/apartments";
import {
  applyMandatoryRollout,
  previewMandatoryRollout,
} from "@/lib/actions/subscriptions";
import type { ActorContext } from "@/lib/actions/define-action";
import { prisma } from "@/lib/prisma";
import { alignedCycleWindow, daysBetweenBaghdad, now } from "@/lib/dates";

/**
 * الخطوة 2.6 — الخدمات الإلزامية والربط مع مفتاح السكن.
 *
 * تعريف الإنجاز حرفياً:
 *   «الإشغال يُنشئ كل الإلزامية على الحسابات الصحيحة»
 *   «الإخلاء يوقفها كلها (شاملةً `subjectType = RESIDENT`)»
 *   «الخدمة الإلزامية الجديدة: إجراء صريح يعرض **عدد الشقق والمبلغ
 *    الإجمالي قبل التأكيد**»
 *
 * ⚠️ فُتحت بحسم `B2`: كانت `generateMandatorySubscriptions` ترمي
 * `PendingDecisionError("B2")` لأن بداية الفترة الأولى غير محسومة.
 */

let client: Client;
let f: Fixture;
let admin: ActorContext;

const SVC_MANDATORY = testId("svc_mnd_a");
const SVC_OPTIONAL = testId("svc_mnd_b");
const BILLING_DAY = 15;
let settingsExisted = false;
let previousBillingDay = 1;

async function addService(
  id: string,
  name: string,
  opts: { mandatory: boolean; base: number; available?: boolean },
) {
  await client.query(
    `insert into "Service" (id,name,"billingType","billingCycle","pricingModel",
                            "basePriceIqd","payerType","appliesTo","isMandatory",
                            "isAvailable","updatedAt")
     values ($1,$2,'RECURRING','MONTHLY','FLAT',$3,'OCCUPANT','APARTMENT',$4,$5,now())`,
    [id, name, opts.base, opts.mandatory, opts.available ?? true],
  );
}

/** يجعل الشقة قابلة للإشغال: عقد بيع نشط موجود من الفكسچر. */
async function resetWorld() {
  await cleanupTestData(client);
  f = await createFixture(client, "mnd");
  admin = { userId: f.roleUsers.ADMIN, role: "ADMIN", ip: "10.0.0.26", userAgent: "vitest" };

  // الفكسچر يُنشئ الشقة مسكونة — تُفرَّغ كي يُختبَر الانتقال إليها
  await client.query(`update "Apartment" set "occupancyStatus" = 'VACANT' where id = $1`, [
    f.apartmentId,
  ]);

  await addService(SVC_MANDATORY, "نظافة إلزامية للاختبار", { mandatory: true, base: 30_000 });
  await addService(SVC_OPTIONAL, "خدمة اختيارية للاختبار", { mandatory: false, base: 99_000 });
}

beforeAll(async () => {
  client = connection();
  await client.connect();

  const existing = await client.query<{ billingDayOfMonth: number }>(
    `select "billingDayOfMonth" from "CompoundSettings" limit 1`,
  );
  settingsExisted = existing.rowCount !== null && existing.rowCount > 0;
  if (settingsExisted) {
    previousBillingDay = existing.rows[0]!.billingDayOfMonth;
    await client.query(`update "CompoundSettings" set "billingDayOfMonth" = $1`, [BILLING_DAY]);
  } else {
    await client.query(
      `insert into "CompoundSettings" (id,name,"billingDayOfMonth","updatedAt")
       values ('singleton','مجمّع اختبار الإلزامية',$1,now())`,
      [BILLING_DAY],
    );
  }

  await resetWorld();
}, 180_000);

beforeEach(async () => {
  await resetWorld();
}, 120_000);

afterAll(async () => {
  if (settingsExisted) {
    await client.query(`update "CompoundSettings" set "billingDayOfMonth" = $1`, [
      previousBillingDay,
    ]);
  } else {
    await client.query(`delete from "CompoundSettings" where id = 'singleton'`);
  }
  // ⚠️ الخدمات يحذفها `cleanupTestData` **بعد** الاشتراكات — لا قبلها
  await cleanupTestData(client);
  await client.end();
  await prisma.$disconnect();
});

describe("الإشغال يُنشئ الإلزامية (‏R27)", () => {
  it("⚠️ الانتقال إلى مسكونة يُنشئ الإلزامية **وحدها** على الحساب الصحيح", async () => {
    const r = await setApartmentOccupancy(
      { apartmentId: f.apartmentId, occupancyStatus: "OCCUPIED_BY_OWNER" },
      admin,
    );
    expect(r.ok, r.ok ? "" : r.error.message).toBe(true);
    if (!r.ok) return;

    expect(r.data.mandatory.created).toBe(1);
    expect(r.data.mandatory.services).toEqual(["نظافة إلزامية للاختبار"]);

    const subs = await prisma.subscription.findMany({
      where: { apartmentId: f.apartmentId, deletedAt: null },
      select: { serviceId: true, status: true, accountId: true, nextChargeDate: true },
    });
    expect(subs).toHaveLength(1);
    expect(subs[0]!.serviceId, "أُنشئت خدمة اختيارية بلا طلب").toBe(SVC_MANDATORY);
    expect(subs[0]!.status).toBe("ACTIVE");
    // R28: الحساب من `payerType` لا مُخمَّناً
    expect(subs[0]!.accountId).toBe(f.accountId);
    expect(subs[0]!.nextChargeDate).not.toBeNull();
  });

  it("⚠️ القيد الأول **مقسَّط بالتناسب** لا بالشهر الكامل (‏B2)", async () => {
    const at = now();
    const r = await setApartmentOccupancy(
      { apartmentId: f.apartmentId, occupancyStatus: "OCCUPIED_BY_OWNER" },
      admin,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const w = alignedCycleWindow(at, BILLING_DAY, "MONTHLY");
    const cycleDays = daysBetweenBaghdad(w.start, w.nextStart);
    const elapsed = daysBetweenBaghdad(w.start, at);
    expect(elapsed, "لم يجرِ تقسيط — الاختبار لا يفحص شيئاً").toBeGreaterThan(0);

    const expected = (30_000n * BigInt(cycleDays - elapsed)) / BigInt(cycleDays);
    expect(r.data.mandatory.chargedIqd).toBe(expected);
    expect(r.data.mandatory.chargedIqd).toBeLessThan(30_000n);

    const entry = await prisma.ledgerEntry.findFirst({
      where: { accountId: f.accountId, source: "SUBSCRIPTION" },
      select: { amountIqd: true, type: true },
    });
    expect(entry!.amountIqd).toBe(expected);
    expect(entry!.type).toBe("CHARGE");
  });

  it("⚠️ مبلغ الدورة الكاملة يبقى على الاشتراك لا المقسَّط", async () => {
    await setApartmentOccupancy(
      { apartmentId: f.apartmentId, occupancyStatus: "OCCUPIED_BY_OWNER" },
      admin,
    );
    const sub = await prisma.subscription.findFirstOrThrow({
      where: { apartmentId: f.apartmentId, serviceId: SVC_MANDATORY },
      select: { periodAmountIqd: true },
    });
    expect(sub.periodAmountIqd).toBe(30_000n);
  });

  it("⚠️ الفاعل `null` — الإشغال قرار إنسان وإنشاء الإلزامية أثرٌ آليّ له", async () => {
    await setApartmentOccupancy(
      { apartmentId: f.apartmentId, occupancyStatus: "OCCUPIED_BY_OWNER" },
      admin,
    );
    const entry = await prisma.ledgerEntry.findFirstOrThrow({
      where: { accountId: f.accountId, source: "SUBSCRIPTION" },
      select: { createdByUserId: true },
    });
    expect(entry.createdByUserId, "نُسب القيد الآليّ إلى الأدمن").toBeNull();
  });

  it("إعادة الإشغال بعد الإخلاء لا تُنشئ اشتراكاً ثانياً", async () => {
    await setApartmentOccupancy(
      { apartmentId: f.apartmentId, occupancyStatus: "OCCUPIED_BY_OWNER" },
      admin,
    );
    await setApartmentOccupancy(
      { apartmentId: f.apartmentId, occupancyStatus: "VACANT" },
      admin,
    );
    const again = await setApartmentOccupancy(
      { apartmentId: f.apartmentId, occupancyStatus: "OCCUPIED_BY_OWNER" },
      admin,
    );
    expect(again.ok).toBe(true);
    if (!again.ok) return;

    // ⚠️ `PAUSED` محسوب موجوداً — لا يُملأ باشتراك ثانٍ يزدوج معه
    expect(again.data.mandatory.created).toBe(0);
    const count = await prisma.subscription.count({
      where: { apartmentId: f.apartmentId, serviceId: SVC_MANDATORY, deletedAt: null },
    });
    expect(count).toBe(1);
  });
});

describe("الإخلاء يوقفها كلها", () => {
  it("⚠️ الدورية تُوقَف ويُصفَّر موعد فوترتها", async () => {
    await setApartmentOccupancy(
      { apartmentId: f.apartmentId, occupancyStatus: "OCCUPIED_BY_OWNER" },
      admin,
    );
    const r = await setApartmentOccupancy(
      { apartmentId: f.apartmentId, occupancyStatus: "VACANT" },
      admin,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.pausedSubscriptions).toBe(1);

    const sub = await prisma.subscription.findFirstOrThrow({
      where: { apartmentId: f.apartmentId, serviceId: SVC_MANDATORY },
      select: { status: true, nextChargeDate: true },
    });
    // PAUSED لا CANCELLED: الإخلاء مؤقّت واللقطة السعرية تُحفظ
    expect(sub.status).toBe("PAUSED");
    expect(sub.nextChargeDate, "بقي موعد فوترة على شقة فارغة").toBeNull();
  });

  it("⚠️ الاشتراك على **ساكن** يُوقَف أيضاً — لا على الشقة وحدها", async () => {
    /**
     * تعريف الإنجاز ينصّ عليه: «شاملةً `subjectType = RESIDENT`». واشتراك
     * الساكن يحمل `apartmentId` بحكم `subscription_subject_consistent`،
     * فترشيح الإيقاف بالشقة يشمله — وهذا ما يثبته الاختبار.
     */
    await setApartmentOccupancy(
      { apartmentId: f.apartmentId, occupancyStatus: "OCCUPIED_BY_OWNER" },
      admin,
    );

    const personal = testId("sub_mnd_person");
    await client.query(
      `insert into "Subscription" (id,"serviceId","subjectType","apartmentId","residentUserId",
                                   "accountId","payerType",quantity,"unitPriceSnapshotIqd",
                                   "periodAmountIqd","billingCycle",status,"startDate",
                                   "nextChargeDate","updatedAt")
       values ($1,$2,'RESIDENT',$3,$4,$5,'OCCUPANT',1,99000,99000,'MONTHLY','ACTIVE',now(),now(),now())`,
      [personal, SVC_OPTIONAL, f.apartmentId, f.holderId, f.accountId],
    );

    const r = await setApartmentOccupancy(
      { apartmentId: f.apartmentId, occupancyStatus: "VACANT" },
      admin,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.pausedSubscriptions).toBe(2);

    const sub = await prisma.subscription.findUniqueOrThrow({
      where: { id: personal },
      select: { status: true, nextChargeDate: true },
    });
    expect(sub.status, "بقي اشتراك الساكن نشطاً على شقة فارغة").toBe("PAUSED");
    expect(sub.nextChargeDate).toBeNull();
  });

  it("⚠️ الإخلاء **لا يُلغي ديناً** — الرصيد يبقى مستحقاً", async () => {
    const occupied = await setApartmentOccupancy(
      { apartmentId: f.apartmentId, occupancyStatus: "OCCUPIED_BY_OWNER" },
      admin,
    );
    expect(occupied.ok).toBe(true);
    if (!occupied.ok) return;

    await setApartmentOccupancy(
      { apartmentId: f.apartmentId, occupancyStatus: "VACANT" },
      admin,
    );

    const account = await prisma.account.findUniqueOrThrow({
      where: { id: f.accountId },
      select: { balanceIqd: true, status: true },
    });
    expect(account.balanceIqd).toBe(occupied.data.mandatory.chargedIqd);
    // الحساب يُغلق بانتهاء العقد لا بخروج الساكن
    expect(account.status).toBe("OPEN");
  });
});

describe("تعميم خدمة إلزامية جديدة", () => {
  it("⚠️ المعاينة تعرض عدد الشقق والمبلغ **ولا تكتب شيئاً**", async () => {
    await setApartmentOccupancy(
      { apartmentId: f.apartmentId, occupancyStatus: "OCCUPIED_BY_OWNER" },
      admin,
    );

    // خدمة إلزامية أُضيفت **بعد** الإشغال — هذا سيناريو 2.6 بعينه
    const late = testId("svc_mnd_late");
    await addService(late, "خدمة إلزامية متأخّرة", { mandatory: true, base: 20_000 });

    const before = await prisma.subscription.count({ where: { serviceId: late } });

    const p = await previewMandatoryRollout({ serviceId: late }, admin);
    expect(p.ok, p.ok ? "" : p.error.message).toBe(true);
    if (!p.ok) return;

    expect(p.data.apartments).toBe(1);
    expect(p.data.totalIqd).toBeGreaterThan(0n);
    expect(p.data.totalIqd, "المعاينة عرضت المبلغ الكامل لا المقسَّط").toBeLessThan(20_000n);

    const after = await prisma.subscription.count({ where: { serviceId: late } });
    expect(after, "المعاينة كتبت في القاعدة").toBe(before);
  });

  it("⚠️ الشقة الفارغة ليست هدفاً — لا تُفوتَر خدماتها الدورية", async () => {
    // الشقة فارغة (‏`resetWorld` أفرغتها) ولم يجرِ إشغال
    const p = await previewMandatoryRollout({ serviceId: SVC_MANDATORY }, admin);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.data.apartments).toBe(0);
    expect(p.data.totalIqd).toBe(0n);
  });

  it("التعميم يُنشئ ويُقيّد، والمبلغ يطابق المعاينة", async () => {
    await setApartmentOccupancy(
      { apartmentId: f.apartmentId, occupancyStatus: "OCCUPIED_BY_OWNER" },
      admin,
    );
    const late = testId("svc_mnd_late2");
    await addService(late, "خدمة إلزامية متأخّرة ثانية", { mandatory: true, base: 20_000 });

    const p = await previewMandatoryRollout({ serviceId: late }, admin);
    expect(p.ok).toBe(true);
    if (!p.ok) return;

    const r = await applyMandatoryRollout(
      { serviceId: late, confirm: true, expectedApartments: p.data.apartments },
      admin,
    );
    expect(r.ok, r.ok ? "" : r.error.message).toBe(true);
    if (!r.ok) return;

    expect(r.data.apartments).toBe(1);
    expect(r.data.chargedIqd, "المبلغ المنفَّذ خالف المعاينة").toBe(p.data.totalIqd);

    const sub = await prisma.subscription.findFirstOrThrow({
      where: { serviceId: late, apartmentId: f.apartmentId },
      select: { status: true, accountId: true, periodAmountIqd: true },
    });
    expect(sub.status).toBe("ACTIVE");
    expect(sub.accountId).toBe(f.accountId);
    expect(sub.periodAmountIqd).toBe(20_000n);
  });

  it("⚠️ بلا تأكيد صريح لا يُنفَّذ — المعاينة لا تُتخطّى باستدعاء مباشر", async () => {
    await setApartmentOccupancy(
      { apartmentId: f.apartmentId, occupancyStatus: "OCCUPIED_BY_OWNER" },
      admin,
    );
    const late = testId("svc_mnd_late3");
    await addService(late, "خدمة إلزامية متأخّرة ثالثة", { mandatory: true, base: 20_000 });

    const r = await applyMandatoryRollout(
      { serviceId: late, confirm: false, expectedApartments: 1 } as never,
      admin,
    );
    expect(r.ok).toBe(false);
    expect(await prisma.subscription.count({ where: { serviceId: late } })).toBe(0);
  });

  it("⚠️ تغيّر العدد منذ المعاينة يُوقف التنفيذ", async () => {
    await setApartmentOccupancy(
      { apartmentId: f.apartmentId, occupancyStatus: "OCCUPIED_BY_OWNER" },
      admin,
    );
    const late = testId("svc_mnd_late4");
    await addService(late, "خدمة إلزامية متأخّرة رابعة", { mandatory: true, base: 20_000 });

    const r = await applyMandatoryRollout(
      // رأى الأدمن 5 شقق والواقع شقة واحدة
      { serviceId: late, confirm: true, expectedApartments: 5 },
      admin,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toContain("أعد المعاينة");
    expect(await prisma.subscription.count({ where: { serviceId: late } })).toBe(0);
  });

  it("الخدمة غير الإلزامية لا تُعمَّم", async () => {
    const r = await previewMandatoryRollout({ serviceId: SVC_OPTIONAL }, admin);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toContain("الإلزامية وحدها");
  });

  it("⚠️ التعميم مرّتين لا يُنتج اشتراكين", async () => {
    await setApartmentOccupancy(
      { apartmentId: f.apartmentId, occupancyStatus: "OCCUPIED_BY_OWNER" },
      admin,
    );
    const late = testId("svc_mnd_late5");
    await addService(late, "خدمة إلزامية متأخّرة خامسة", { mandatory: true, base: 20_000 });

    await applyMandatoryRollout(
      { serviceId: late, confirm: true, expectedApartments: 1 },
      admin,
    );
    // المرّة الثانية: لا هدف متبقٍّ، فالمعاينة تعطي صفراً
    const second = await applyMandatoryRollout(
      { serviceId: late, confirm: true, expectedApartments: 0 },
      admin,
    );
    expect(second.ok).toBe(true);

    const count = await prisma.subscription.count({
      where: { serviceId: late, apartmentId: f.apartmentId, deletedAt: null },
    });
    expect(count, "ازدوج الاشتراك بتعميم ثانٍ").toBe(1);
  });
});

describe("‏F2 — التاريخ الماضي ما زال محجوباً", () => {
  it("⚠️ إشغال بأثر رجعي يُرفض ويسمّي القرار", async () => {
    /**
     * ✅ `F2` محسوم 2026-09-08: الماضي **توثيقيّ**. يُقبَل ويُحفَظ، ولا
     * يُنتج فوترةً عن الفترات الفائتة — الفوترة تبدأ من اليوم.
     */
    const past = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const r = await setApartmentOccupancy(
      {
        apartmentId: f.apartmentId,
        occupancyStatus: "OCCUPIED_BY_OWNER",
        effectiveDate: past,
      },
      admin,
    );
    expect(r.ok, r.ok ? "" : r.error.message).toBe(true);
    if (!r.ok) return;

    /* الاشتراكات تُنشأ — القرار لم يكن يمنعها بل يمنع تأريخها رجعياً */
    const subs = await prisma.subscription.count({
      where: { apartmentId: f.apartmentId },
    });
    expect(subs).toBeGreaterThan(0);

    /*
     * ⚠️ والقيود من **اليوم** لا من قبل ثلاثة أشهر: `B2` يُقسّط الفترة
     * الجارية بالتناسب، ولو مرّ التاريخ الرجعيّ لقسّم من فترةٍ فائتة.
     */
    const oldest = await prisma.ledgerEntry.findFirst({
      where: { account: { apartmentId: f.apartmentId }, type: "CHARGE" },
      select: { periodStart: true },
      orderBy: { createdAt: "asc" },
    });
    if (oldest?.periodStart) {
      expect(
        oldest.periodStart.getTime(),
        "قُيّدت فترة فائتة رغم أن F2 توثيقيّ",
      ).toBeGreaterThan(past.getTime());
    }
  });
});
