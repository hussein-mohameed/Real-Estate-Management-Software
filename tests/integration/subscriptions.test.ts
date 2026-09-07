import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { cleanupTestData, connection, createFixture, testId, type Fixture } from "./helpers";
import {
  approveSubscription,
  cancelSubscription,
  createSubscription,
  dismissCancellationRequest,
  listSubscriptions,
  rejectSubscription,
  requestSubscription,
  requestSubscriptionCancellation,
  updateSubscriptionQuantity,
  withdrawSubscriptionCancellation,
} from "@/lib/actions/subscriptions";
import type { ActorContext } from "@/lib/actions/define-action";
import { prisma } from "@/lib/prisma";
import { alignedCycleWindow, daysBetweenBaghdad, now } from "@/lib/dates";

/**
 * الخطوة 2.4 — دورة حياة الاشتراك. تعريف الإنجاز حرفياً:
 *   «طلب الساكن لا يُنتج قيداً (‏R25)»
 *   «موافقة مكرّرة على `ONE_TIME` تُنتج قيداً واحداً» (‏`periodStart = startDate`)
 *   «تغيير الكمية يكتب لقطة سعر جديدة وتدقيقاً»
 *   «الإلغاء لا يعدّل قيوداً سابقة»
 *
 * ومعها قرار `B2` (‏2026-08-28): **التقسيط بالتناسب** للفترة الأولى.
 */

let client: Client;
let f: Fixture;
let admin: ActorContext;
let resident: ActorContext;

const SVC_MONTHLY = testId("svc_sub_m");
const SVC_ONCE = testId("svc_sub_1");
const SVC_UNIT = testId("svc_sub_u");
const SVC_OFF = testId("svc_sub_off");
const created: string[] = [];

/**
 * ⚠️ **يوم الفوترة مثبَّت لا مأخوذ من الإعدادات.**
 *
 * وقعتُ في اختبار أجوف: يوم تشغيل الاختبارات كان **الأول** من الشهر ويوم
 * الفوترة الافتراضي `1`، فصار `elapsed = 0` ولم يجرِ أي تقسيط — ومرّ
 * اختبار «الفترة الأولى مقسَّطة» وهو لا يفحص شيئاً، ومرّ معه كسرٌ متعمَّد
 * في حقل الإيراد.
 *
 * ‏15 يضمن أن المرساة في **الشهر الماضي** أياً كان اليوم: إن كان اليوم
 * قبل 15 فالمرساة الشهر الماضي، وإن كان بعده فالمرساة هذا الشهر — وفي
 * الحالتين `elapsed ≥ 1` إلا في الخامس عشر نفسه. ولهذا يفحص الاختبار
 * `elapsed > 0` صراحةً بدل أن يفترضه.
 */
const BILLING_DAY = 15;
let settingsExisted = false;
let previousBillingDay = 1;

async function addService(
  id: string,
  name: string,
  billingType: "RECURRING" | "ONE_TIME",
  pricingModel: "FLAT" | "PER_UNIT",
  opts: { available?: boolean; base?: number; unit?: number; max?: number } = {},
) {
  await client.query(
    /*
     * ⚠️ `unitLabel` إلزامي لـ`PER_UNIT` بقيد `service_pricing_fields`.
     * أسقطتُه أولاً فرفضته القاعدة — وهي محقّة: خدمة بسعر وحدة بلا اسم
     * للوحدة تعرض «5 × 10,000» بلا أن يعرف الساكن خمسةَ ماذا.
     */
    `insert into "Service" (id,name,"billingType","billingCycle","pricingModel",
                            "basePriceIqd","unitPriceIqd","unitLabel","maxUnits","payerType",
                            "appliesTo","isAvailable","updatedAt")
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'OCCUPANT','BOTH',$10,now())`,
    [
      id,
      name,
      billingType,
      billingType === "RECURRING" ? "MONTHLY" : null,
      pricingModel,
      opts.base ?? null,
      opts.unit ?? null,
      pricingModel === "PER_UNIT" ? "أمبير" : null,
      opts.max ?? null,
      opts.available ?? true,
    ],
  );
}

/** ينشئ اشتراكاً معلّقاً على خدمة، ويسجّله للتنظيف. */
async function pending(serviceId: string, quantity?: number) {
  const r = await createSubscription(
    {
      serviceId,
      subjectType: "APARTMENT",
      apartmentId: f.apartmentId,
      ...(quantity === undefined ? {} : { quantity }),
    },
    admin,
  );
  if (!r.ok) throw new Error(r.error.message);
  created.push(r.data.id);
  return r.data.id;
}

/**
 * عالَم نظيف لكل اختبار.
 *
 * ⚠️ **الخدمات تُنشأ هنا لا في `beforeAll`.** ‏`cleanupTestData` يحذف صفوف
 * `Service` التي تبدأ ببادئة الاختبار — فخدمةٌ أُنشئت مرّة في `beforeAll`
 * تُمحى عند أول تنظيف، وتفشل بقيّة الاختبارات بـ«الخدمة غير موجود».
 * وقعتُ في هذا حرفياً.
 *
 * ⚠️ والتنظيف الكامل لكل اختبار مقصود: القيود **لا تُحذف** بترتيب عادي
 * (‏trigger يرفض)، والتنظيف يعطّله مؤقتاً ثم يعيده. وبلا عالَم نظيف يرث
 * كل اختبار رصيد سابقه فتصير النتائج مرتبطة بالترتيب.
 */
async function resetWorld() {
  await cleanupTestData(client);
  f = await createFixture(client, "sub");
  admin = { userId: f.roleUsers.ADMIN, role: "ADMIN", ip: "10.0.0.24", userAgent: "vitest" };
  resident = { userId: f.holderId, role: "RESIDENT" };
  created.length = 0;

  /**
   * ⚠️ **الفكسچر لا يُنشئ ارتباط سكن.** صاحب العقد فيه صاحبُ عقدٍ لا
   * ساكنٌ مسجَّل، و`residentApartmentIds` يقرأ `ApartmentResident` لا
   * `Contract.holderUserId`. فبلا هذا الصفّ يُرفض كل طلب ساكن بـ«شقة غير
   * مرتبطة بحسابك» — وهو رفضٌ صحيح على بيانات ناقصة.
   */
  await client.query(
    `insert into "ApartmentResident" (id,"apartmentId","userId","relationType",
                                      "isContractHolder","isActive","movedInAt","updatedAt")
     values ($1,$2,$3,'FAMILY_MEMBER',true,true,now(),now())`,
    [testId("lnk_sub"), f.apartmentId, f.holderId],
  );

  await addService(SVC_MONTHLY, "نظافة اختبار الاشتراك", "RECURRING", "FLAT", { base: 50_000 });
  await addService(SVC_ONCE, "تركيب اختبار مرّة واحدة", "ONE_TIME", "FLAT", { base: 75_000 });
  await addService(SVC_UNIT, "أمبير اختبار", "RECURRING", "PER_UNIT", { unit: 10_000, max: 30 });
  await addService(SVC_OFF, "خدمة موقوفة للاختبار", "RECURRING", "FLAT", {
    base: 1_000,
    available: false,
  });
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
       values ('singleton','مجمّع اختبار الاشتراكات',$1,now())`,
      [BILLING_DAY],
    );
  }

  await resetWorld();
}, 180_000);

beforeEach(async () => {
  await resetWorld();
}, 120_000);

afterAll(async () => {
  // ⚠️ الإعدادات صفٌّ مفرد يقرأه النظام كلّه — تُعاد كما كانت لا تُترك
  if (settingsExisted) {
    await client.query(`update "CompoundSettings" set "billingDayOfMonth" = $1`, [
      previousBillingDay,
    ]);
  } else {
    await client.query(`delete from "CompoundSettings" where id = 'singleton'`);
  }
  /**
   * ⚠️ **لا حذف صريح للخدمات هنا.** `cleanupTestData` يحذفها بنفسه، وبعد
   * الاشتراكات التي تشير إليها. وحذفُها قبله يخرق `Subscription_serviceId_fkey`
   * ويُفشل التفكيك — وقع فعلاً: مرّت الاثنان والعشرون ثم انهار `afterAll`
   * وتُركت بيانات الاختبار في القاعدة.
   */
  await cleanupTestData(client);
  await client.end();
  await prisma.$disconnect();
});

describe("‏R25 — الطلب لا يُنتج قيداً", () => {
  it("⚠️ طلب الساكن: اشتراك معلّق · بلا حساب · بلا قيد", async () => {
    const r = await requestSubscription(
      { serviceId: SVC_MONTHLY, subjectType: "APARTMENT", apartmentId: f.apartmentId },
      resident.userId,
    );
    created.push(r.id);

    const sub = await prisma.subscription.findUnique({
      where: { id: r.id },
      select: { status: true, accountId: true },
    });
    expect(sub!.status).toBe("PENDING_APPROVAL");
    // ⚠️ Q26: بلا حساب حتى الموافقة
    expect(sub!.accountId).toBeNull();

    const entries = await prisma.ledgerEntry.count({ where: { subscriptionId: r.id } });
    expect(entries, "الطلب أنتج قيداً — خرق R25").toBe(0);
  });

  it("⚠️ الطلب مُدقَّق — ولا `defineAction` يكتبه هنا", async () => {
    const r = await requestSubscription(
      { serviceId: SVC_MONTHLY, subjectType: "APARTMENT", apartmentId: f.apartmentId },
      resident.userId,
    );
    created.push(r.id);

    const rows = await prisma.auditLog.findMany({
      where: { entityId: r.id, action: "subscription.request" },
      select: { actorUserId: true, entityType: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorUserId).toBe(resident.userId);
    expect(rows[0]!.entityType).toBe("Subscription");
  });

  it("⚠️ الطلب على شقة غير مرتبطة بحسابي مرفوض — النطاق البنيويّ", async () => {
    const stranger = testId("u_sub_stranger");
    await client.query(
      `insert into "User" (id,"fullName",phone,role,"isActive","updatedAt")
       values ($1,'ساكن بلا شقة للاختبار','+9647083000001','RESIDENT',true,now())`,
      [stranger],
    );
    try {
      await expect(
        requestSubscription(
          { serviceId: SVC_MONTHLY, subjectType: "APARTMENT", apartmentId: f.apartmentId },
          stranger,
        ),
      ).rejects.toThrow(/غير مرتبطة/);
    } finally {
      await client.query(`delete from "User" where id = $1`, [stranger]);
    }
  });

  it("🔴 طلبٌ ثانٍ على خدمة لها طلب معلّق مرفوض", async () => {
    /*
     * ── العيب الذي وُجد هذا الفحص من أجله ───────────────────────────
     * لم يكن في `createPending` حرسٌ ضدّ التكرار، ولا في القاعدة فهرسٌ
     * فريد. فضغطةٌ مزدوجة على «إرسال الطلب» تُنتج صفّين، يوافق الأدمن
     * عليهما، **فيُقيَّد المبلغ مرّتين كل دورة**.
     *
     * ⚠️ والازدواج لا يُلاحَظ: `B2` يُقسّط الفترة الأولى بالتناسب، فيبدو
     * اختلافُ المبلغين مبرَّراً.
     */
    const first = await requestSubscription(
      { serviceId: SVC_MONTHLY, subjectType: "APARTMENT", apartmentId: f.apartmentId },
      resident.userId,
    );
    created.push(first.id);

    await expect(
      requestSubscription(
        { serviceId: SVC_MONTHLY, subjectType: "APARTMENT", apartmentId: f.apartmentId },
        resident.userId,
      ),
      "قُبل طلبٌ ثانٍ على خدمة لها طلب معلّق",
    ).rejects.toThrow(/معلّق/);
  });

  it("🔴 وطلبٌ على خدمة مشترَك بها فعلاً مرفوض", async () => {
    const first = await requestSubscription(
      { serviceId: SVC_MONTHLY, subjectType: "APARTMENT", apartmentId: f.apartmentId },
      resident.userId,
    );
    created.push(first.id);

    const approved = await approveSubscription({ subscriptionId: first.id }, admin);
    expect(approved.ok, approved.ok ? "" : approved.error.message).toBe(true);

    await expect(
      requestSubscription(
        { serviceId: SVC_MONTHLY, subjectType: "APARTMENT", apartmentId: f.apartmentId },
        resident.userId,
      ),
      "قُبل اشتراك ثانٍ على خدمة نشطة",
    ).rejects.toThrow(/سلفاً/);
  });

  it("والملغى يُطلَب ثانيةً — الإلغاء ليس حظراً", async () => {
    /*
     * ⚠️ الحرس يعدّ `ACTIVE` و`PAUSED` و`PENDING_APPROVAL` قائمةً.
     * و`CANCELLED` **لا**: ساكنٌ ألغى اشتراكه ثم عاد يريده لا سبب لمنعه،
     * ومنعُه يجعل الإلغاء قراراً لا رجعة فيه بلا أن يقول ذلك لأحد.
     */
    const first = await requestSubscription(
      { serviceId: SVC_MONTHLY, subjectType: "APARTMENT", apartmentId: f.apartmentId },
      resident.userId,
    );
    created.push(first.id);

    const approved = await approveSubscription({ subscriptionId: first.id }, admin);
    expect(approved.ok, approved.ok ? "" : approved.error.message).toBe(true);

    const cancelled = await cancelSubscription(
      { subscriptionId: first.id, reason: "بطلب الساكن" },
      admin,
    );
    expect(cancelled.ok, cancelled.ok ? "" : cancelled.error.message).toBe(true);

    const again = await requestSubscription(
      { serviceId: SVC_MONTHLY, subjectType: "APARTMENT", apartmentId: f.apartmentId },
      resident.userId,
    );
    created.push(again.id);
    expect(again.id).not.toBe(first.id);
  });

  it("⚠️ طلب خدمة شخصية باسم ساكن آخر مرفوض", async () => {
    /**
     * سكنُهما في وحدة واحدة يجعل الشقة مشتركة، ولا يجعل أحدهما وكيلاً عن
     * الآخر في التزام مالي.
     */
    await expect(
      requestSubscription(
        {
          serviceId: SVC_MONTHLY,
          subjectType: "RESIDENT",
          apartmentId: f.apartmentId,
          residentUserId: f.roleUsers.ADMIN,
        },
        resident.userId,
      ),
    ).rejects.toThrow(/ساكن آخر/);
  });

  it("خدمة غير متاحة تُرفض عند الطلب (‏R24)", async () => {
    await expect(
      requestSubscription(
        { serviceId: SVC_OFF, subjectType: "APARTMENT", apartmentId: f.apartmentId },
        resident.userId,
      ),
    ).rejects.toThrow(/غير متاحة/);
  });

  it("الرفض لا يُنتج قيداً ولا يفتح حساباً", async () => {
    const id = await pending(SVC_MONTHLY);
    const r = await rejectSubscription({ subscriptionId: id, reason: "خارج النطاق" }, admin);
    expect(r.ok).toBe(true);

    const sub = await prisma.subscription.findUnique({
      where: { id },
      select: { status: true, accountId: true, notes: true },
    });
    expect(sub!.status).toBe("CANCELLED");
    expect(sub!.accountId).toBeNull();
    expect(sub!.notes).toContain("خارج النطاق");
    expect(await prisma.ledgerEntry.count({ where: { subscriptionId: id } })).toBe(0);
  });
});

describe("الموافقة — التقسيط بالتناسب (‏B2)", () => {
  it("⚠️ الفترة الأولى مقسَّطة بأيامها، لا بالشهر الكامل", async () => {
    const id = await pending(SVC_MONTHLY);
    const at = now();
    const r = await approveSubscription({ subscriptionId: id }, admin);
    expect(r.ok, r.ok ? "" : r.error.message).toBe(true);
    if (!r.ok) return;

    const w = alignedCycleWindow(at, BILLING_DAY, "MONTHLY");
    const cycleDays = daysBetweenBaghdad(w.start, w.nextStart);
    const elapsed = daysBetweenBaghdad(w.start, at);

    /**
     * ⚠️ **حراسة ضدّ اختبار أجوف.** لو صادف يوم التشغيل مرساةَ الدورة
     * لكان `elapsed = 0` ولم يجرِ تقسيط، ومرّ الاختبار بلا أن يفحص شيئاً.
     * هذا ما وقع فعلاً قبل تثبيت يوم الفوترة.
     */
    expect(elapsed, "لم يجرِ تقسيط — الاختبار لا يفحص شيئاً").toBeGreaterThan(0);

    const expected = (50_000n * BigInt(cycleDays - elapsed)) / BigInt(cycleDays);
    expect(r.data.amountIqd).toBe(expected);
    expect(r.data.amountIqd, "المبلغ لم ينقص عن الدورة الكاملة").toBeLessThan(50_000n);

    const entry = await prisma.ledgerEntry.findFirst({
      where: { subscriptionId: id },
      select: { amountIqd: true, type: true, source: true, periodEnd: true },
    });
    expect(entry!.amountIqd).toBe(expected);
    expect(entry!.type).toBe("CHARGE");
    expect(entry!.source).toBe("SUBSCRIPTION");
    // نهاية الفترة = بداية التالية ناقص مللي ثانية
    expect(entry!.periodEnd!.getTime()).toBe(w.nextStart.getTime() - 1);
  });

  it("⚠️ `periodAmountIqd` على الاشتراك يبقى **الدورة الكاملة** لا المقسَّط", async () => {
    /**
     * مهمة الفوترة تقرأ هذا الحقل لكل دورة تالية. لو كُتب فيه المبلغ
     * المقسَّط لبقي الاشتراك يُفوتَر بأقلّ من سعره **إلى الأبد** — خطأ
     * إيراد صامت لا يظهر في أي شاشة.
     */
    const id = await pending(SVC_MONTHLY);
    const r = await approveSubscription({ subscriptionId: id }, admin);
    expect(r.ok).toBe(true);

    const sub = await prisma.subscription.findUnique({
      where: { id },
      select: { periodAmountIqd: true, unitPriceSnapshotIqd: true, nextChargeDate: true },
    });
    expect(sub!.periodAmountIqd).toBe(50_000n);
    expect(sub!.unitPriceSnapshotIqd).toBe(50_000n);
    expect(sub!.nextChargeDate).not.toBeNull();

    /**
     * ⚠️ والقيد الأول **أقلّ** من مبلغ الدورة. بلا هذا الفحص كان كتابةُ
     * المبلغ المقسَّط في `periodAmountIqd` تمرّ صامتة — وهي خطأ إيراد
     * يتكرّر إلى الأبد.
     */
    const entry = await prisma.ledgerEntry.findFirst({
      where: { subscriptionId: id },
      select: { amountIqd: true },
    });
    expect(entry!.amountIqd).toBeLessThan(sub!.periodAmountIqd);
  });

  it("الموافقة تفتح الحساب من `payerType` (‏R28) وتضبط الحالة", async () => {
    const id = await pending(SVC_MONTHLY);
    await approveSubscription({ subscriptionId: id }, admin);

    const sub = await prisma.subscription.findUnique({
      where: { id },
      select: { status: true, accountId: true, approvedByUserId: true },
    });
    expect(sub!.status).toBe("ACTIVE");
    expect(sub!.accountId).toBe(f.accountId);
    expect(sub!.approvedByUserId).toBe(f.roleUsers.ADMIN);
  });

  it("موافقة على اشتراك نشط تُرفض برسالة عربية", async () => {
    const id = await pending(SVC_MONTHLY);
    await approveSubscription({ subscriptionId: id }, admin);

    const again = await approveSubscription({ subscriptionId: id }, admin);
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error.message).toContain("بانتظار الموافقة");
    expect(await prisma.ledgerEntry.count({ where: { subscriptionId: id } })).toBe(1);
  });
});

describe("‏ONE_TIME — القيد الواحد (‏Q39)", () => {
  it("⚠️ لا يُقسَّط: ليست فترة كي تُقسَّم", async () => {
    const id = await pending(SVC_ONCE);
    const r = await approveSubscription({ subscriptionId: id }, admin);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.amountIqd).toBe(75_000n);
    expect(r.data.nextChargeDate, "خدمة مرّة واحدة لها موعد فوترة قادم").toBeNull();
  });

  it("⚠️ `periodStart` مكتوب لا `null` — وإلا بطل فهرس التفريد", async () => {
    const id = await pending(SVC_ONCE);
    await approveSubscription({ subscriptionId: id }, admin);

    const entry = await prisma.ledgerEntry.findFirst({
      where: { subscriptionId: id },
      select: { periodStart: true, periodEnd: true },
    });
    expect(entry!.periodStart, "periodStart فارغ ← الفهرس الجزئي لا يشمل الصفّ").not.toBeNull();
    expect(entry!.periodEnd).toBeNull();
  });

  it("🔴 **موافقتان متوازيتان ← قيد واحد فقط**", async () => {
    /**
     * ⚠️ هذا ما تمنعه القاعدة لا الكود. النقرة المزدوجة تصل الخادم مرّتين
     * فتقرأ كلتاهما `PENDING_APPROVAL` قبل أن تكتب الأخرى — والشرط في
     * الكود لا يرى ذلك. الفهرس `uniq_subscription_charge_per_period` يراه.
     */
    const id = await pending(SVC_ONCE);

    const [a, b] = await Promise.all([
      approveSubscription({ subscriptionId: id }, admin),
      approveSubscription({ subscriptionId: id }, admin),
    ]);

    const succeeded = [a, b].filter((r) => r.ok).length;
    expect(succeeded, "نجحت الموافقتان معاً").toBe(1);

    const entries = await prisma.ledgerEntry.count({ where: { subscriptionId: id } });
    expect(entries, "أنتجت النقرة المزدوجة قيدين").toBe(1);
  });
});

describe("🔴 التزامن على الاشتراك الدوري", () => {
  it("**موافقتان متوازيتان على اشتراك دوري ← قيد واحد**", async () => {
    /**
     * ⚠️ **هذا المسار تحميه حراسة `updateMany` وحدها.**
     * الفهرس `uniq_subscription_charge_per_period` يحمي `ONE_TIME` لأن
     * `periodStart = startDate` **ثابت**. أما الدوري فـ`periodStart` هو
     * لحظة الموافقة، فيختلف بالمللي ثانية بين استدعاءين ولا يرى الفهرس
     * تكراراً. فبلا شرط الحالة في `updateMany` يمرّ القيدان.
     *
     * وأثره مالي مباشر: الساكن يُقيَّد عليه ضِعف ما يستحقّ بنقرة مزدوجة.
     */
    const id = await pending(SVC_MONTHLY);

    const [a, b] = await Promise.all([
      approveSubscription({ subscriptionId: id }, admin),
      approveSubscription({ subscriptionId: id }, admin),
    ]);

    const succeeded = [a, b].filter((r) => r.ok).length;
    expect(succeeded, "نجحت الموافقتان معاً على اشتراك دوري").toBe(1);

    const entries = await prisma.ledgerEntry.count({ where: { subscriptionId: id } });
    expect(entries, "أنتجت النقرة المزدوجة قيدين على اشتراك دوري").toBe(1);

    const account = await prisma.account.findUnique({
      where: { id: f.accountId },
      select: { balanceIqd: true },
    });
    const entry = await prisma.ledgerEntry.findFirst({
      where: { subscriptionId: id },
      select: { amountIqd: true },
    });
    expect(account!.balanceIqd, "الرصيد يحمل ضِعف المستحقّ").toBe(entry!.amountIqd);
  });
});

describe("تغيير الكمية", () => {
  it("⚠️ يكتب لقطة سعر جديدة **ولا يمسّ القيد السابق**", async () => {
    const id = await pending(SVC_UNIT, 3);
    await approveSubscription({ subscriptionId: id }, admin);

    const before = await prisma.ledgerEntry.findFirst({
      where: { subscriptionId: id },
      select: { id: true, amountIqd: true },
    });

    const r = await updateSubscriptionQuantity({ subscriptionId: id, quantity: 5 }, admin);
    expect(r.ok, r.ok ? "" : r.error.message).toBe(true);

    const sub = await prisma.subscription.findUnique({
      where: { id },
      select: { quantity: true, periodAmountIqd: true, unitPriceSnapshotIqd: true },
    });
    expect(sub!.quantity).toBe(5);
    expect(sub!.periodAmountIqd).toBe(50_000n); // 10,000 × 5
    expect(sub!.unitPriceSnapshotIqd).toBe(10_000n);

    const after = await prisma.ledgerEntry.findUnique({
      where: { id: before!.id },
      select: { amountIqd: true },
    });
    expect(after!.amountIqd, "تغيّر قيد ماضٍ بتغيير الكمية").toBe(before!.amountIqd);
  });

  it("⚠️ يكتب تدقيقاً بالقيمة قبل وبعد", async () => {
    const id = await pending(SVC_UNIT, 3);
    await approveSubscription({ subscriptionId: id }, admin);
    await updateSubscriptionQuantity({ subscriptionId: id, quantity: 5 }, admin);

    const rows = await prisma.auditLog.findMany({
      where: { entityId: id, action: "subscription.quantity.change" },
      select: { actorUserId: true, entityType: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorUserId).toBe(f.roleUsers.ADMIN);
    expect(rows[0]!.entityType).toBe("Subscription");
  });

  it("كمية فوق الحدّ تُرفض — والحدّ يُفحص في الخادم لا في الواجهة", async () => {
    const id = await pending(SVC_UNIT, 3);
    await approveSubscription({ subscriptionId: id }, admin);

    const r = await updateSubscriptionQuantity({ subscriptionId: id, quantity: 999 }, admin);
    expect(r.ok).toBe(false);
  });

  it("⚠️ `PER_PERSON` و`FLAT` لا تُغيَّر كميتهما يدوياً (‏Q5)", async () => {
    const id = await pending(SVC_MONTHLY);
    await approveSubscription({ subscriptionId: id }, admin);

    const r = await updateSubscriptionQuantity({ subscriptionId: id, quantity: 4 }, admin);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toContain("سعر الوحدة");
  });
});

describe("الإلغاء", () => {
  it("⚠️ لا يعدّل قيوداً سابقة — ما استُهلك يُدفع", async () => {
    const id = await pending(SVC_MONTHLY);
    await approveSubscription({ subscriptionId: id }, admin);

    const before = await prisma.ledgerEntry.findMany({
      where: { subscriptionId: id },
      select: { id: true, amountIqd: true },
    });
    expect(before).toHaveLength(1);

    const r = await cancelSubscription({ subscriptionId: id, reason: "انتقل الساكن" }, admin);
    expect(r.ok).toBe(true);

    const after = await prisma.ledgerEntry.findMany({
      where: { subscriptionId: id },
      select: { id: true, amountIqd: true },
    });
    expect(after, "تغيّر الدفتر بالإلغاء").toEqual(before);
  });

  it("⚠️ يُصفّر `nextChargeDate` — هذا ما يوقف الفوترة القادمة", async () => {
    const id = await pending(SVC_MONTHLY);
    await approveSubscription({ subscriptionId: id }, admin);
    await cancelSubscription({ subscriptionId: id }, admin);

    const sub = await prisma.subscription.findUnique({
      where: { id },
      select: { status: true, endDate: true, nextChargeDate: true },
    });
    expect(sub!.status).toBe("CANCELLED");
    expect(sub!.endDate).not.toBeNull();
    expect(sub!.nextChargeDate, "بقي موعد فوترة على اشتراك ملغى").toBeNull();
  });

  it("الرصيد يبقى مستحقّاً بعد الإلغاء", async () => {
    const id = await pending(SVC_MONTHLY);
    const approved = await approveSubscription({ subscriptionId: id }, admin);
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;

    await cancelSubscription({ subscriptionId: id }, admin);

    const account = await prisma.account.findUnique({
      where: { id: f.accountId },
      select: { balanceIqd: true },
    });
    expect(account!.balanceIqd).toBe(approved.data.amountIqd);
  });

  it("إلغاء مكرّر يُرفض بدل أن يمرّ صامتاً", async () => {
    const id = await pending(SVC_MONTHLY);
    await approveSubscription({ subscriptionId: id }, admin);
    await cancelSubscription({ subscriptionId: id }, admin);

    const again = await cancelSubscription({ subscriptionId: id }, admin);
    expect(again.ok).toBe(false);
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  طلب إلغاء الاشتراك — §3.2 «unsubscribe» · §8.4 · الخيار (أ).
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── لماذا عمودان على الصفّ لا حالة جديدة ────────────────────────────
 * `CANCELLATION_REQUESTED` كحالة كانت ستُخرج الاشتراك من كل استعلام يسأل
 * «هل هو نشط؟» — أي **تُوقف فوترته بمجرّد الطلب**، وهو إلغاءٌ فعليّ بلا
 * قرار من أحد. العمودان يتركان الحالة `ACTIVE` كما هي.
 */
describe("طلب إلغاء الاشتراك", () => {
  async function activeSubscription(): Promise<string> {
    const r = await requestSubscription(
      { serviceId: SVC_MONTHLY, subjectType: "APARTMENT", apartmentId: f.apartmentId },
      resident.userId,
    );
    created.push(r.id);
    const approved = await approveSubscription({ subscriptionId: r.id }, admin);
    if (!approved.ok) throw new Error(approved.error.message);
    return r.id;
  }

  it("🔴 الطلب **لا يوقف الفوترة** — الحالة تبقى ACTIVE", async () => {
    const id = await activeSubscription();

    await requestSubscriptionCancellation({ subscriptionId: id }, resident.userId);

    const sub = await prisma.subscription.findUnique({
      where: { id },
      select: { status: true, nextChargeDate: true, cancellationRequestedAt: true },
    });

    /* ⚠️ هذا هو جوهر الخيار (أ): الطلب علمٌ لا قرار */
    expect(sub!.status, "الطلب غيّر الحالة — أوقف فوترةً بلا قرار").toBe("ACTIVE");
    expect(sub!.nextChargeDate, "الطلب صفّر موعد الفوترة").not.toBeNull();
    expect(sub!.cancellationRequestedAt).not.toBeNull();
  });

  it("⚠️ والطلب مُدقَّق باسم الساكن", async () => {
    const id = await activeSubscription();
    await requestSubscriptionCancellation(
      { subscriptionId: id, reason: "لم أعد بحاجة إليها" },
      resident.userId,
    );

    const rows = await prisma.auditLog.findMany({
      where: { entityId: id, action: "subscription.cancellation_request" },
      select: { actorUserId: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorUserId).toBe(resident.userId);
  });

  it("🔴 الخدمة الإلزامية لا يُطلَب إلغاؤها", async () => {
    /*
     * ⚠️ الإلزامية يعيدها الإشغال إن أُلغيت (`mandatory-subscriptions.ts`).
     * فطلبُ إلغائها يفتح دورةً عبثية: يوافق الأدمن، ثم يعيدها النظام.
     */
    await prisma.service.update({
      where: { id: SVC_MONTHLY },
      data: { isMandatory: true },
    });
    try {
      const id = await activeSubscription();
      await expect(
        requestSubscriptionCancellation({ subscriptionId: id }, resident.userId),
        "قُبل طلب إلغاء خدمة إلزامية",
      ).rejects.toThrow(/إلزامية/);
    } finally {
      await prisma.service.update({
        where: { id: SVC_MONTHLY },
        data: { isMandatory: false },
      });
    }
  });

  it("⚠️ وطلبٌ على اشتراك شقة ليست لي مرفوض", async () => {
    const id = await activeSubscription();
    const stranger = testId("u_sub_cx_stranger");
    await client.query(
      `insert into "User" (id,"fullName",phone,role,"isActive","updatedAt")
       values ($1,'ساكن بلا شقة','+9647083000009','RESIDENT',true,now())`,
      [stranger],
    );
    try {
      await expect(
        requestSubscriptionCancellation({ subscriptionId: id }, stranger),
      ).rejects.toThrow(/غير مرتبطة/);
    } finally {
      await client.query(`delete from "User" where id = $1`, [stranger]);
    }
  });

  it("وطلبٌ مكرّر مرفوض", async () => {
    const id = await activeSubscription();
    await requestSubscriptionCancellation({ subscriptionId: id }, resident.userId);
    await expect(
      requestSubscriptionCancellation({ subscriptionId: id }, resident.userId),
    ).rejects.toThrow(/سلفاً/);
  });

  it("🔴 الردّ يُصفّر الأعمدة الثلاثة — وإلا بقي العلم مرفوعاً أبداً", async () => {
    const id = await activeSubscription();
    await requestSubscriptionCancellation(
      { subscriptionId: id, reason: "غيّرت رأيي" },
      resident.userId,
    );

    const dismissed = await dismissCancellationRequest({ subscriptionId: id }, admin);
    expect(dismissed.ok, dismissed.ok ? "" : dismissed.error.message).toBe(true);

    const sub = await prisma.subscription.findUnique({
      where: { id },
      select: {
        status: true,
        cancellationRequestedAt: true,
        cancellationRequestedByUserId: true,
        cancellationReason: true,
      },
    });
    /* ⚠️ الاشتراك باقٍ — الردّ يلغي **الطلب** لا الاشتراك */
    expect(sub!.status).toBe("ACTIVE");
    expect(sub!.cancellationRequestedAt).toBeNull();
    expect(sub!.cancellationRequestedByUserId).toBeNull();
    /* وسببٌ بلا تاريخ نصٌّ معلّق لا يعرف قارئُه متى قيل ولا هل هو قائم */
    expect(sub!.cancellationReason).toBeNull();

    /* وبعد الردّ يُطلَب ثانيةً — الردّ ليس حظراً */
    await requestSubscriptionCancellation({ subscriptionId: id }, resident.userId);
  });

  it("🔴 الساكن يسحب طلبه — والأعمدة الثلاثة تُصفَّر", async () => {
    const id = await activeSubscription();
    await requestSubscriptionCancellation(
      { subscriptionId: id, reason: "ضغطتُ بالخطأ" },
      resident.userId,
    );

    await withdrawSubscriptionCancellation({ subscriptionId: id }, resident.userId);

    const sub = await prisma.subscription.findUnique({
      where: { id },
      select: {
        status: true,
        cancellationRequestedAt: true,
        cancellationRequestedByUserId: true,
        cancellationReason: true,
      },
    });
    expect(sub!.status).toBe("ACTIVE");
    expect(sub!.cancellationRequestedAt).toBeNull();
    expect(sub!.cancellationRequestedByUserId).toBeNull();
    expect(sub!.cancellationReason).toBeNull();

    /* ⚠️ والسحب ليس حظراً: يُطلَب ثانيةً */
    await requestSubscriptionCancellation({ subscriptionId: id }, resident.userId);
  });

  it("⚠️ والسحب مُدقَّق", async () => {
    const id = await activeSubscription();
    await requestSubscriptionCancellation({ subscriptionId: id }, resident.userId);
    await withdrawSubscriptionCancellation({ subscriptionId: id }, resident.userId);

    const rows = await prisma.auditLog.findMany({
      where: { entityId: id, action: "subscription.cancellation_withdraw" },
      select: { actorUserId: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorUserId).toBe(resident.userId);
  });

  it("🔴 وساكنٌ آخر في نفس الشقة **لا يسحب طلب غيره**", async () => {
    /*
     * ── العيب الذي وُجد هذا الفحص من أجله ───────────────────────────
     * أوّل تنفيذ كان يفحص النطاق وحده — «هل الشقة شقّتك؟». وفي الشقة أكثر
     * من ساكن، فكان أيُّهم يبطل طلب الآخر بلا أن يعلم أوّلهما.
     *
     * ⚠️ وطلب الإلغاء قرارٌ ماليّ على حساب صاحب العقد، لا تفضيلُ واجهة.
     * ومن أراد إبطال طلب غيره فطريقه الإدارة — ويُدقَّق باسم الأدمن.
     */
    const roommate = testId("u_sub_roommate");
    await client.query(
      `insert into "User" (id,"fullName",phone,role,"isActive","updatedAt")
       values ($1,'ساكن ثانٍ في الشقة','+9647083000011','RESIDENT',true,now())`,
      [roommate],
    );
    await client.query(
      `insert into "ApartmentResident" (id,"apartmentId","userId","relationType","isContractHolder","isActive","movedInAt","updatedAt")
       values ($1,$2,$3,'FAMILY_MEMBER',false,true,now(),now())`,
      [testId("ar_roommate"), f.apartmentId, roommate],
    );

    try {
      const id = await activeSubscription();
      await requestSubscriptionCancellation({ subscriptionId: id }, resident.userId);

      await expect(
        withdrawSubscriptionCancellation({ subscriptionId: id }, roommate),
        "سحب ساكنٌ طلب غيره",
      ).rejects.toThrow(/ساكن آخر/);

      /* والطلب باقٍ كما هو */
      const sub = await prisma.subscription.findUnique({
        where: { id },
        select: { cancellationRequestedAt: true },
      });
      expect(sub!.cancellationRequestedAt).not.toBeNull();
    } finally {
      await client.query(`delete from "ApartmentResident" where "userId" = $1`, [roommate]);
      await client.query(`delete from "User" where id = $1`, [roommate]);
    }
  });

  it("ولا يُسحَب ما لا طلب عليه", async () => {
    const id = await activeSubscription();
    await expect(
      withdrawSubscriptionCancellation({ subscriptionId: id }, resident.userId),
    ).rejects.toThrow(/لا طلب/);
  });

  it("ولا يُردّ ما لا طلب عليه", async () => {
    const id = await activeSubscription();
    const r = await dismissCancellationRequest({ subscriptionId: id }, admin);
    expect(r.ok).toBe(false);
  });

  it("⚠️ ويُرشَّح في شاشة الإدارة — لأن الحالة لا تدلّ عليه", async () => {
    /*
     * الاشتراك يبقى `ACTIVE`، فمرشّح الحالة لا يجده. وبلا مرشّح مستقلّ
     * وعدّاد يبقى الطلب في صفٍّ لا ينظر إليه أحد حتى يشتكي صاحبه.
     */
    const id = await activeSubscription();
    await requestSubscriptionCancellation({ subscriptionId: id }, resident.userId);

    const listed = await listSubscriptions({ cancellationRequested: true }, admin);
    if (!listed.ok) throw new Error(listed.error.message);

    expect(listed.data.rows.map((r) => r.id)).toContain(id);
    expect(listed.data.rows.every((r) => r.cancellationRequestedAt !== null)).toBe(true);
    expect(listed.data.cancellationCount).toBeGreaterThanOrEqual(1);
  });
});
