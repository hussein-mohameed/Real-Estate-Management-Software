import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { cleanupTestData, connection, createFixture, type Fixture } from "./helpers";
import { setApartmentOccupancy } from "@/lib/actions/apartments";
import { createBuilding } from "@/lib/actions/buildings";
import { activateContract, createContract } from "@/lib/actions/contracts";
import { postEntry } from "@/lib/ledger/post-entry";
import type { ActorContext } from "@/lib/actions/define-action";
import { prisma } from "@/lib/prisma";

/**
 * الخطوة 1.6 — **مفتاح الفوترة**.
 *
 * `setApartmentOccupancy` أهمّ عملية **غير مالية** في النظام، لأنها
 * **تُنتج مالاً**: الإشغال يبدأ تدفّقاً، والإخلاء يوقفه.
 *
 * تعريف الإنجاز حرفياً:
 *   «انتقال إلى مسكونة يضبط التاريخ ويستدعي مُنشئ الاشتراكات الإلزامية»
 *   «انتقال إلى VACANT يوقف كل اشتراك **ويُبقي الرصيد**»
 *   «شقة تحت الإنشاء تُرفض»
 *   «صف تدقيق لكل انتقال»
 */

let client: Client;
let f: Fixture;
let admin: ActorContext;
let buildingId = "";
const aptIds: string[] = [];

let apt = "";
let accountId = "";

const SERVICE_ID = "itest_ob_service";
const SUB_RECURRING = "itest_ob_sub_monthly";
const SUB_ONE_TIME = "itest_ob_sub_once";
const SERVICE_MANDATORY = "itest_ob_service_mand";

beforeAll(async () => {
  client = connection();
  await client.connect();
  await cleanupTestData(client);
  f = await createFixture(client, "ob");
  admin = { userId: f.roleUsers.ADMIN, role: "ADMIN", ip: "10.0.0.12", userAgent: "vitest" };

  const b = await createBuilding(
    {
      code: "ITobl",
      floorsCount: 1,
      unitsPerFloor: 3,
      numberingScheme: "SEQUENTIAL",
      displayNumberFormat: "{building}-{unit}",
    },
    admin,
  );
  if (!b.ok) throw new Error(b.error.message);
  buildingId = b.data.id;

  const { rows } = await client.query<{ id: string }>(
    `select id from "Apartment" where "buildingId" = $1 order by "unitNumber"`,
    [buildingId],
  );
  aptIds.push(...rows.map((r) => r.id));
  apt = aptIds[0]!;

  // ⚠️ `createBuilding` ينشئ الشقق **تحت الإنشاء** (الافتراضي في المخطّط)،
  // وR10 يمنع إشغال ما هو تحت الإنشاء. الإنجاز شرط مسبق لكل ما يلي.
  await client.query(
    `update "Apartment" set "constructionStatus" = 'COMPLETED' where "buildingId" = $1`,
    [buildingId],
  );

  // عقد تمليك نشط ← يسمح بـ«يسكنها المالك» (‏R8) ويفتح حساباً
  const c = await createContract(
    {
      apartmentId: apt,
      holderUserId: f.holderId,
      type: "SALE",
      startDate: new Date(),
      totalAmountIqd: 60_000_000n,
      paymentType: "FULL",
    },
    admin,
  );
  if (!c.ok) throw new Error(c.error.message);
  const a = await activateContract({ contractId: c.data.id }, admin);
  if (!a.ok) throw new Error(a.error.message);
  accountId = a.data.accountId;

  // خدمة **غير إلزامية** + اشتراكان عليها: دوري ولمرّة واحدة
  await client.query(
    `insert into "Service" (id,name,"billingType","billingCycle","pricingModel",
                            "basePriceIqd","payerType","isMandatory","isAvailable",
                            "appliesTo","updatedAt")
     values ($1,'خدمة اختبار الإشغال','RECURRING','MONTHLY','FLAT',
             75000,'OCCUPANT',false,true,'APARTMENT',now())`,
    [SERVICE_ID],
  );

  for (const [id, cycle] of [
    [SUB_RECURRING, "MONTHLY"],
    [SUB_ONE_TIME, null],
  ] as const) {
    await client.query(
      `insert into "Subscription"
         (id,"serviceId","subjectType","apartmentId","accountId","payerType",
          quantity,"unitPriceSnapshotIqd","periodAmountIqd","billingCycle",
          status,"startDate","nextChargeDate","updatedAt")
       values ($1,$2,'APARTMENT',$3,$4,'OCCUPANT',1,75000,75000,
               $5::"BillingCycle",'ACTIVE',now(),now() + interval '10 days',now())`,
      [id, SERVICE_ID, apt, accountId, cycle],
    );
  }
}, 180_000);

afterAll(async () => {
  await client.query(`ALTER TABLE "LedgerEntry" DISABLE TRIGGER USER`);
  try {
    await client.query(`delete from "Subscription" where "apartmentId" = any($1)`, [aptIds]);
    await client.query(`delete from "Service" where id = any($1)`, [[SERVICE_ID, SERVICE_MANDATORY]]);
    await client.query(
      `delete from "LedgerEntry" where "accountId" in
         (select id from "Account" where "apartmentId" = any($1))`,
      [aptIds],
    );
    await client.query(`delete from "Account" where "apartmentId" = any($1)`, [aptIds]);
    await client.query(
      `delete from "AuditLog" where "entityId" = any($1) or "entityId" in
         (select id from "Contract" where "apartmentId" = any($1))`,
      [aptIds],
    );
    await client.query(`delete from "Contract" where "apartmentId" = any($1)`, [aptIds]);
    await client.query(`delete from "Apartment" where "buildingId" = $1`, [buildingId]);
    await client.query(`delete from "Building" where id = $1`, [buildingId]);
  } finally {
    await client.query(`ALTER TABLE "LedgerEntry" ENABLE TRIGGER USER`);
  }
  await cleanupTestData(client);
  await client.end();
  await prisma.$disconnect();
}, 120_000);


/**
 * ⚠️ **كل اختبار يهيّئ حالته بنفسه.**
 * كانت الاختبارات تعتمد على ما تركه سابقها: أوّلها يُخلي الشقة فيوقف
 * الاشتراك، فيجد الذي بعده اشتراكاً موقوفاً وهو يتوقّعه نشطاً. الاعتماد
 * على الترتيب يجعل الفشل يتنقّل عند أي إعادة ترتيب أو تشغيل منفرد.
 */
async function reset(occupied: boolean): Promise<void> {
  await client.query(
    `update "Subscription"
        set status = 'ACTIVE',
            "nextChargeDate" = now() + interval '10 days'
      where id = any($1)`,
    [[SUB_RECURRING, SUB_ONE_TIME]],
  );
  await client.query(
    `update "Apartment"
        set "occupancyStatus" = $2::"OccupancyStatus"
      where id = $1`,
    [apt, occupied ? "OCCUPIED_BY_OWNER" : "VACANT"],
  );
}

// ═══════════════════════════════════════════════════════════════════════

describe("الإشغال — الفرع الذي يبدأ المال", () => {
  it("R7: الانتقال إلى مسكونة يضبط occupancyChangedAt", async () => {
    const before = await prisma.apartment.findUnique({ where: { id: apt } });
    expect(before?.occupancyStatus).toBe("VACANT");

    const r = await setApartmentOccupancy(
      { apartmentId: apt, occupancyStatus: "OCCUPIED_BY_OWNER" },
      admin,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.data.occupancyStatus).toBe("OCCUPIED_BY_OWNER");
    expect(r.data.occupancyChangedAt).not.toBeNull();
  });

  it("يستدعي مولّد الإلزامية — ولا خدمة إلزامية اليوم فلا شيء يُنشأ", async () => {
    const r = await setApartmentOccupancy(
      { apartmentId: apt, occupancyStatus: "VACANT" },
      admin,
    );
    if (!r.ok) throw new Error(r.error.message);

    const back = await setApartmentOccupancy(
      { apartmentId: apt, occupancyStatus: "OCCUPIED_BY_OWNER" },
      admin,
    );
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.data.mandatory.created).toBe(0);
    expect(back.data.mandatory.services).toEqual([]);
  });

  it("صف تدقيق لكل انتقال", async () => {
    const logs = await prisma.auditLog.findMany({
      where: { entityId: apt, action: "apartment.occupancy.change" },
    });
    expect(logs.length).toBeGreaterThanOrEqual(3);
    expect(logs.every((l) => l.actorUserId === admin.userId)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════

describe("الإخلاء — الفرع الذي يوقف المال ولا يمحو الدَّين", () => {
  it("يوقف الاشتراك الدوري ويصفّر nextChargeDate", async () => {
    await reset(true);

    // تأكيد الحالة قبل: نشط وله موعد فوترة
    const before = await prisma.subscription.findUnique({ where: { id: SUB_RECURRING } });
    expect(before?.status).toBe("ACTIVE");
    expect(before?.nextChargeDate).not.toBeNull();

    const r = await setApartmentOccupancy(
      { apartmentId: apt, occupancyStatus: "VACANT" },
      admin,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.pausedSubscriptions).toBe(1);

    const after = await prisma.subscription.findUnique({ where: { id: SUB_RECURRING } });
    // ⚠️ PAUSED لا CANCELLED: الإخلاء مؤقّت، وانتهاء العقد وحده نهائي
    expect(after?.status).toBe("PAUSED");
    // ⚠️ التصفير ضروري: مهمة الفوترة تقرأ هذا الحقل، وتركُه على تاريخ
    // ماضٍ يجعلها تُفوتِر شقة **فارغة** عند أول تشغيل
    expect(after?.nextChargeDate).toBeNull();
  });

  it("**ولا يمسّ الاشتراك غير الدوري** — خدمة لمرّة واحدة قُيّدت وانتهت", async () => {
    await reset(true);
    await setApartmentOccupancy({ apartmentId: apt, occupancyStatus: "VACANT" }, admin);

    const once = await prisma.subscription.findUnique({ where: { id: SUB_ONE_TIME } });
    expect(once?.status).toBe("ACTIVE");
  });

  it("🔴 **الإخلاء لا يُلغي ديناً** — الرصيد يبقى كما هو", async () => {
    await reset(true);

    await postEntry({
      accountId,
      type: "CHARGE",
      source: "MANUAL",
      amountIqd: 320_000n,
      descriptionAr: "رسم اختبار قبل الإخلاء",
      reason: "تهيئة رصيد لاختبار بقاء الدَّين بعد الإخلاء",
      createdByUserId: admin.userId,
    });

    const r = await setApartmentOccupancy(
      { apartmentId: apt, occupancyStatus: "VACANT" },
      admin,
    );
    expect(r.ok).toBe(true);

    const account = await prisma.account.findUnique({ where: { id: accountId } });
    expect(account?.balanceIqd).toBe(320_000n);
    // والحساب يبقى **مفتوحاً**: يُغلق بانتهاء العقد لا بخروج الساكن
    expect(account?.status).toBe("OPEN");
  });

  it("§7.3: **لا استئناف تلقائياً** للاشتراك الموقوف عند إشغال جديد", async () => {
    await reset(true);
    // نُخلي فعلياً ليُوقَف الاشتراك بالمسار الحقيقي لا بحقن حالة
    const out = await setApartmentOccupancy(
      { apartmentId: apt, occupancyStatus: "VACANT" },
      admin,
    );
    if (!out.ok) throw new Error(out.error.message);

    const before = await prisma.subscription.findUnique({ where: { id: SUB_RECURRING } });
    expect(before?.status).toBe("PAUSED");

    const r = await setApartmentOccupancy(
      { apartmentId: apt, occupancyStatus: "OCCUPIED_BY_OWNER" },
      admin,
    );
    expect(r.ok).toBe(true);

    const after = await prisma.subscription.findUnique({ where: { id: SUB_RECURRING } });
    // الساكن الجديد قد لا يريد ما أراده السابق. الاستئناف قرار الأدمن.
    expect(after?.status).toBe("PAUSED");
    expect(after?.nextChargeDate).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════

describe("‏B2 — الإلزامية تُنشأ بالتقسيط بالتناسب", () => {
  /**
   * ⚠️ **هذا الوصف كان «لا تُنشأ بالتخمين»، والاختبار كان يتحقّق أن
   * الإشغال يُحجَب** بـ`PendingDecisionError("B2")`: بداية الفترة الأولى
   * غير محسومة، والتخمين فيها يغيّر الإيراد السنوي.
   *
   * **حُسم `B2` في 2026-08-28: التقسيط بالتناسب.** فالحجب زال، والاختبار
   * الذي كان يحرسه صار يفحص سلوكاً ملغى. أُعيد كتابته ليفحص السلوك الجديد
   * لا حُذف: «الإشغال يُنشئ الإلزامية» ادّعاءٌ يحتاج حرساً كما احتاجه
   * الرفض من قبل.
   */
  it("خدمة إلزامية **بلا اشتراك قائم** تُنشأ مع الإشغال وتُقيَّد مقسَّطة", async () => {
    await reset(false);
    await client.query(
      `insert into "Service" (id,name,"billingType","billingCycle","pricingModel",
                              "basePriceIqd","payerType","isMandatory","isAvailable",
                              "appliesTo","updatedAt")
       values ($1,'نظافة إلزامية للاختبار','RECURRING','MONTHLY','FLAT',
               40000,'OCCUPANT',true,true,'APARTMENT',now())`,
      [SERVICE_MANDATORY],
    );
    try {
      const r = await setApartmentOccupancy(
        { apartmentId: apt, occupancyStatus: "OCCUPIED_BY_OWNER" },
        admin,
      );
      expect(r.ok, r.ok ? "" : r.error.message).toBe(true);
      if (!r.ok) return;

      expect(r.data.mandatory.services).toContain("نظافة إلزامية للاختبار");
      expect(r.data.mandatory.created).toBeGreaterThanOrEqual(1);

      // الشقة صارت مسكونة فعلاً — لا تراجع
      const after = await prisma.apartment.findUnique({ where: { id: apt } });
      expect(after?.occupancyStatus).toBe("OCCUPIED_BY_OWNER");

      /**
       * ⚠️ المبلغ المقيَّد **لا يتجاوز** مبلغ الدورة: التقسيط ينقص ولا
       * يزيد. والقيمة الدقيقة مُختبَرة في `mandatory-services.test.ts`
       * بيوم فوترة مثبَّت؛ هنا يوم الفوترة هو إعداد القاعدة، فالفحص على
       * الحدّ لا على رقم يتغيّر بتاريخ التشغيل.
       */
      expect(r.data.mandatory.chargedIqd).toBeGreaterThan(0n);
      expect(r.data.mandatory.chargedIqd).toBeLessThanOrEqual(40_000n);

      const sub = await prisma.subscription.findFirstOrThrow({
        where: { apartmentId: apt, serviceId: SERVICE_MANDATORY },
        select: { status: true, periodAmountIqd: true, nextChargeDate: true },
      });
      expect(sub.status).toBe("ACTIVE");
      // مبلغ الدورة الكاملة يبقى على الاشتراك لا المقسَّط
      expect(sub.periodAmountIqd).toBe(40_000n);
      expect(sub.nextChargeDate).not.toBeNull();
    } finally {
      /**
       * ⚠️ **تُعطَّل الخدمة ولا تُحذف صفوفها.** الاشتراك صار له قيد،
       * والقيد `append-only` بـtrigger (‏R29) — فحذفُه يفشل، فيفشل حذف
       * الاشتراك بمفتاح أجنبي، فتفشل الخدمة. جرّبتُ الحذف فانهار التفكيك.
       *
       * والتعطيل يكفي: الاختبارات التالية تقرأ الإلزامية **المتاحة**، فلا
       * تراها. والصفوف يحذفها `afterAll` وهو يعطّل الـtrigger مؤقّتاً.
       */
      await client.query(
        `update "Service" set "isMandatory" = false, "isAvailable" = false where id = $1`,
        [SERVICE_MANDATORY],
      );
    }
  });

  it("والمغطّى سلفاً لا يحجب — الاشتراك القائم يُطرَح من المطلوب", async () => {
    /**
     * ⚠️ كشفه تحذير lint: `apartmentId` كان **غير مستعمَل** في المولّد،
     * أي أنه يفحص الكتالوج وحده. فكانت خدمة إلزامية واحدة تحجب **كل**
     * انتقال إلى الإشغال حتى لو كانت اشتراكات الشقة قائمة ولا شيء
     * يُنشَأ — وحدة أُخليت ثم أُعيد إشغالها كانت تتعطّل بلا سبب.
     */
    await reset(false);
    await client.query(`update "Service" set "isMandatory" = true where id = $1`, [SERVICE_ID]);
    try {
      const r = await setApartmentOccupancy(
        { apartmentId: apt, occupancyStatus: "OCCUPIED_BY_OWNER" },
        admin,
      );
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.data.mandatory.created).toBe(0);
      expect(r.data.mandatory.services).toContain("خدمة اختبار الإشغال");
    } finally {
      await client.query(`update "Service" set "isMandatory" = false where id = $1`, [SERVICE_ID]);
    }
  });

  it("و«موقوف» يُحتسب مغطّى — لا يُنشأ ثانٍ يزدوج معه", async () => {
    await reset(false);
    await client.query(
      `update "Subscription" set status = 'PAUSED', "nextChargeDate" = null where id = $1`,
      [SUB_RECURRING],
    );
    await client.query(`update "Service" set "isMandatory" = true where id = $1`, [SERVICE_ID]);
    try {
      const r = await setApartmentOccupancy(
        { apartmentId: apt, occupancyStatus: "OCCUPIED_BY_OWNER" },
        admin,
      );
      expect(r.ok).toBe(true);
    } finally {
      await client.query(`update "Service" set "isMandatory" = false where id = $1`, [SERVICE_ID]);
    }
  });

  it("V11: التركيبة «إلزامية على ساكن» **ترفضها قاعدة البيانات** أصلاً", async () => {
    /**
     * ⚠️ اكتُشف أثناء كتابة هذا الاختبار: كنت أختبر أن **المولّد** يتخطّى
     * الخدمة الإلزامية التي `appliesTo = RESIDENT` — لكن القيد
     * `service_mandatory_not_resident_only` يمنع وجود الصفّ من أساسه.
     *
     * فالترشيح في المولّد حزامٌ فوق حمّالة لا حدٌّ وحيد، والحدّ الحقيقي
     * هنا. اختبار المولّد كان سيمرّ دائماً بلا أن يثبت شيئاً.
     */
    await expect(
      client.query(
        `update "Service" set "isMandatory" = true, "appliesTo" = 'RESIDENT' where id = $1`,
        [SERVICE_ID],
      ),
    ).rejects.toThrow(/service_mandatory_not_resident_only/);
  });
});

describe("R10 — شقة تحت الإنشاء تُرفض", () => {
  it("لا يمكن إشغال شقة تحت الإنشاء، ولا اشتراك يُنشأ", async () => {
    const other = aptIds[1]!;
    await client.query(
      `update "Apartment" set "constructionStatus" = 'UNDER_CONSTRUCTION' where id = $1`,
      [other],
    );

    const r = await setApartmentOccupancy(
      { apartmentId: other, occupancyStatus: "OCCUPIED_BY_OWNER" },
      admin,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toContain("تحت الإنشاء");

    const subs = await prisma.subscription.count({ where: { apartmentId: other } });
    expect(subs).toBe(0);
  });
});
