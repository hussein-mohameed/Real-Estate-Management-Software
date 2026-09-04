import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { cleanupTestData, connection, createFixture, type Fixture } from "./helpers";
import {
  createService,
  listServices,
  setServiceAvailability,
  updateService,
} from "@/lib/actions/services";
import type { ActorContext } from "@/lib/actions/define-action";
import { prisma } from "@/lib/prisma";

/**
 * الخطوة 2.1 — تعريف الإنجاز حرفياً:
 *   «خدمة `PER_UNIT` بلا `unitPriceIqd` تُرفض»
 *   «خدمة لها اشتراكات لا تُحذف»
 *   «تغيير السعر لا يمسّ اشتراكاً قائماً»
 *   «خدمة `isMandatory` مع `appliesTo = RESIDENT` تُرفض عند الحفظ» (‏V11)
 */

let client: Client;
let f: Fixture;
let admin: ActorContext;

const created: string[] = [];
let generatorId = "";
let subscriptionId = "";

const base = {
  billingType: "RECURRING" as const,
  billingCycle: "MONTHLY" as const,
  payerType: "OCCUPANT" as const,
  appliesTo: "APARTMENT" as const,
};

beforeAll(async () => {
  client = connection();
  await client.connect();
  await cleanupTestData(client);
  await client.query(`delete from "Service" where name like '%اختبار الكتالوج%'`);
  f = await createFixture(client, "svc");
  admin = { userId: f.roleUsers.ADMIN, role: "ADMIN", ip: "10.0.0.14", userAgent: "vitest" };
}, 180_000);

afterAll(async () => {
  await client.query(`delete from "Subscription" where "serviceId" = any($1)`, [created]);
  await client.query(`delete from "AuditLog" where "entityId" = any($1)`, [created]);
  await client.query(`delete from "Service" where id = any($1)`, [created]);
  await cleanupTestData(client);
  await client.end();
  await prisma.$disconnect();
}, 120_000);

async function make(input: Record<string, unknown>) {
  const r = await createService({ ...base, ...input }, admin);
  if (r.ok) created.push(r.data.id);
  return r;
}

// ═══════════════════════════════════════════════════════════════════════

describe("🔴 التوافقات بين الحقول", () => {
  it("**`PER_UNIT` بلا سعر وحدة تُرفض**", async () => {
    const r = await make({
      name: "مولّدة اختبار الكتالوج بلا سعر",
      pricingModel: "PER_UNIT",
      unitLabel: "أمبير",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.fieldErrors?.["unitPriceIqd"]?.[0]).toContain("سعر الوحدة مطلوب");
  });

  it("`PER_UNIT` بلا اسم وحدة تُرفض — «الكمية: 5» بلا معنى", async () => {
    const r = await make({
      name: "مولّدة اختبار الكتالوج بلا وحدة",
      pricingModel: "PER_UNIT",
      unitPriceIqd: 15_000n,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.fieldErrors?.["unitLabel"]?.[0]).toContain("اسم الوحدة مطلوب");
  });

  it("`FLAT` بلا سعر تُرفض", async () => {
    const r = await make({ name: "نظافة اختبار الكتالوج بلا سعر", pricingModel: "FLAT" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.fieldErrors?.["basePriceIqd"]?.[0]).toContain("سعر الخدمة مطلوب");
  });

  it("`PER_PERSON` بلا سعر فرد تُرفض", async () => {
    const r = await make({ name: "رسم اختبار الكتالوج بالشخص", pricingModel: "PER_PERSON" });
    expect(r.ok).toBe(false);
  });

  it("`RECURRING` بلا دورة تُرفض", async () => {
    const r = await createService(
      {
        name: "خدمة اختبار الكتالوج بلا دورة",
        billingType: "RECURRING",
        pricingModel: "FLAT",
        basePriceIqd: 25_000n,
        payerType: "OCCUPANT",
        appliesTo: "APARTMENT",
      },
      admin,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.fieldErrors?.["billingCycle"]?.[0]).toContain("دورة الفوترة مطلوبة");
  });

  it("`ONE_TIME` بدورة تُرفض", async () => {
    const r = await make({
      name: "خدمة اختبار الكتالوج لمرّة بدورة",
      billingType: "ONE_TIME",
      pricingModel: "FLAT",
      basePriceIqd: 25_000n,
    });
    expect(r.ok).toBe(false);
  });

  it("حدود الكمية على تسعير ليس بالوحدة تُرفض", async () => {
    // ‏Q5: عدد الأشخاص **مشتقّ** لا مُدخَل — حدٌّ عليه يمنع الفوترة على
    // أسرة كبيرة بلا أن يفهم أحد لماذا.
    const r = await make({
      name: "رسم اختبار الكتالوج محدود",
      pricingModel: "PER_PERSON",
      basePriceIqd: 10_000n,
      minUnits: 1,
      maxUnits: 5,
    });
    expect(r.ok).toBe(false);
  });

  it("مبلغ صفري مرفوض", async () => {
    const r = await make({
      name: "خدمة اختبار الكتالوج مجانية",
      pricingModel: "FLAT",
      basePriceIqd: 0n,
    });
    expect(r.ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════

describe("🔴 V11 — «إلزامية على ساكن» لا يُنشئها أي تدفق", () => {
  it("تُرفض عند الحفظ برسالة عربية على الحقل", async () => {
    const r = await make({
      name: "خدمة اختبار الكتالوج إلزامية للساكن",
      pricingModel: "FLAT",
      basePriceIqd: 10_000n,
      isMandatory: true,
      appliesTo: "RESIDENT",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.fieldErrors?.["appliesTo"]?.[0]).toContain("تنطبق على الشقق");
  });

  it("والقيد في قاعدة البيانات يمنع الالتفاف", async () => {
    await expect(
      client.query(
        `insert into "Service" (id,name,"billingType","billingCycle","pricingModel",
                                "basePriceIqd","payerType","isMandatory","isAvailable",
                                "appliesTo","updatedAt")
         values ('itest_svc_bypass','التفاف اختبار الكتالوج','RECURRING','MONTHLY','FLAT',
                 10000,'OCCUPANT',true,true,'RESIDENT',now())`,
      ),
    ).rejects.toThrow(/service_mandatory_not_resident_only/);
  });

  it("«إلزامية على BOTH» مسموحة — تشمل الشقق", async () => {
    const r = await make({
      name: "خدمة اختبار الكتالوج إلزامية للاثنين",
      pricingModel: "FLAT",
      basePriceIqd: 5_000n,
      isMandatory: true,
      appliesTo: "BOTH",
    });
    expect(r.ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════

describe("الحقول المخصّصة تُتحقَّق عند الحفظ", () => {
  it("مخطّط صالح يُحفظ ويُقرأ كما هو", async () => {
    const r = await make({
      name: "مولّدة اختبار الكتالوج",
      pricingModel: "PER_UNIT",
      unitLabel: "أمبير",
      unitPriceIqd: 15_000n,
      minUnits: 1,
      maxUnits: 30,
      customFieldsSchema: [
        { key: "meterNumber", labelAr: "رقم العداد", type: "text", required: false },
        { key: "amperes", labelAr: "عدد الأمبيرات", type: "number", required: true, min: 1, max: 30 },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    generatorId = r.data.id;

    const saved = await prisma.service.findUnique({ where: { id: generatorId } });
    expect(saved?.customFieldsSchema).toHaveLength(2);
  });

  it("🔴 مخطّط مكسور **لا يُحفظ** — العمود Json يقبل أي شكل", async () => {
    const r = await make({
      name: "خدمة اختبار الكتالوج بمخطّط مكسور",
      pricingModel: "FLAT",
      basePriceIqd: 10_000n,
      customFieldsSchema: [{ key: "رقم عربي", labelAr: "س", type: "text" }],
    });
    expect(r.ok).toBe(false);
  });

  it("ومفتاح مكرّر لا يُحفظ", async () => {
    const r = await make({
      name: "خدمة اختبار الكتالوج بمفتاح مكرّر",
      pricingModel: "FLAT",
      basePriceIqd: 10_000n,
      customFieldsSchema: [
        { key: "a", labelAr: "أ", type: "text" },
        { key: "a", labelAr: "ب", type: "text" },
      ],
    });
    expect(r.ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════

describe("🔴 R23 — تغيير السعر لا يرتدّ على القائم", () => {
  it("الاشتراك يحتفظ بلقطة سعره بعد رفع سعر الخدمة", async () => {
    // اشتراك بسعر اليوم: 15,000 × 5 أمبير = 75,000
    subscriptionId = "itest_svc_sub";
    await client.query(
      `insert into "Subscription"
         (id,"serviceId","subjectType","apartmentId","accountId","payerType",
          quantity,"unitPriceSnapshotIqd","periodAmountIqd","billingCycle",
          status,"startDate","updatedAt")
       values ($1,$2,'APARTMENT',$3,$4,'OCCUPANT',5,15000,75000,'MONTHLY','ACTIVE',now(),now())`,
      [subscriptionId, generatorId, f.apartmentId, f.accountId],
    );

    // رفع السعر إلى الضعف
    const r = await updateService(
      {
        serviceId: generatorId,
        name: "مولّدة اختبار الكتالوج",
        billingType: "RECURRING",
        billingCycle: "MONTHLY",
        pricingModel: "PER_UNIT",
        unitLabel: "أمبير",
        unitPriceIqd: 30_000n,
        minUnits: 1,
        maxUnits: 30,
        payerType: "OCCUPANT",
        appliesTo: "APARTMENT",
      },
      admin,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // ⚠️ الإجراء **يُبلّغ** بعدد ما لم يتأثّر — لئلا يظنّ الأدمن أنه سرى
    expect(r.data.priceChanged).toBe(true);
    expect(r.data.unaffectedSubscriptions).toBe(1);

    // ── الإثبات: اللقطة والمبلغ كما هما ────────────────────────────
    const sub = await prisma.subscription.findUnique({ where: { id: subscriptionId } });
    expect(sub?.unitPriceSnapshotIqd).toBe(15_000n);
    expect(sub?.periodAmountIqd).toBe(75_000n);

    // والخدمة نفسها تحمل السعر الجديد للاشتراكات الجديدة
    const svc = await prisma.service.findUnique({ where: { id: generatorId } });
    expect(svc?.unitPriceIqd).toBe(30_000n);
  });

  it("تغيير **نموذج التسعير** على خدمة لها اشتراكات مرفوض", async () => {
    /**
     * الاشتراك القائم يحمل `quantity = 5` محسوبةً بالأمبير. تحويل
     * الخدمة إلى `PER_PERSON` يجعلها «خمسة أشخاص» — رقمٌ صحيح الشكل
     * وخاطئ المعنى، ويُفوتَر شهرياً بلا أن يعترض شيء.
     */
    const r = await updateService(
      {
        serviceId: generatorId,
        name: "مولّدة اختبار الكتالوج",
        billingType: "RECURRING",
        billingCycle: "MONTHLY",
        pricingModel: "PER_PERSON",
        basePriceIqd: 30_000n,
        payerType: "OCCUPANT",
        appliesTo: "APARTMENT",
      },
      admin,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toContain("نموذج تسعير");
  });
});

// ═══════════════════════════════════════════════════════════════════════

describe("🔴 R24 — خدمة لها اشتراكات لا تُحذف", () => {
  it("لا يوجد إجراء حذف إطلاقاً — الإيقاف هو البديل", async () => {
    const mod = await import("@/lib/actions/services");
    const names = Object.keys(mod);
    expect(names.some((n) => /delete|remove/i.test(n)), "ظهر إجراء حذف").toBe(false);
  });

  it("الإيقاف يمنع الجديد **ويُبقي القائم يعمل**", async () => {
    const r = await setServiceAvailability({ serviceId: generatorId, isAvailable: false }, admin);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.data.isAvailable).toBe(false);
    // إيقاف الكتالوج قرار عرض لا قرار فوترة
    expect(r.data.continuingSubscriptions).toBe(1);

    const sub = await prisma.subscription.findUnique({ where: { id: subscriptionId } });
    expect(sub?.status).toBe("ACTIVE");
  });

  it("الموقوفة تختفي من القائمة الافتراضية وتظهر عند طلبها", async () => {
    const def = await listServices({ includeUnavailable: false, onlyMandatory: false }, admin);
    const all = await listServices({ includeUnavailable: true, onlyMandatory: false }, admin);
    if (!def.ok || !all.ok) return;
    expect(def.data.some((s) => s.id === generatorId)).toBe(false);
    expect(all.data.some((s) => s.id === generatorId)).toBe(true);
  });

  it("⚠️ خدمة **إلزامية** لا تُوقَف — تناقض مع R27", async () => {
    /**
     * `R27` يقول تُنشأ تلقائياً مع كل إشغال، و`isAvailable = false` يقول
     * لا تُنشأ. النتيجة سلوك يعتمد على أيّ الشرطين يُفحص أولاً — ولا يجوز
     * ترك ذلك للصدفة.
     */
    const mandatory = created.find((id) => id !== generatorId);
    const svc = await prisma.service.findFirst({ where: { id: { in: created }, isMandatory: true } });
    expect(svc, "لم نجد خدمة إلزامية في المُثبِّت").not.toBeNull();
    void mandatory;

    const r = await setServiceAvailability({ serviceId: svc!.id, isAvailable: false }, admin);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toContain("إلزامية");
  });
});

// ═══════════════════════════════════════════════════════════════════════

describe("R22 — إحصاءات المشتركين محسوبة دائماً", () => {
  it("العدد يتبع الاشتراكات النشطة وحدها", async () => {
    const all = await listServices({ includeUnavailable: true, onlyMandatory: false }, admin);
    if (!all.ok) return;
    const gen = all.data.find((s) => s.id === generatorId);
    expect(gen?.activeSubscriptions).toBe(1);

    await client.query(`update "Subscription" set status = 'CANCELLED' where id = $1`, [
      subscriptionId,
    ]);

    const after = await listServices({ includeUnavailable: true, onlyMandatory: false }, admin);
    if (!after.ok) return;
    expect(after.data.find((s) => s.id === generatorId)?.activeSubscriptions).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════

describe("الاسم والترخيص", () => {
  it("اسم مكرّر مرفوض برسالة عربية", async () => {
    const r = await make({
      name: "مولّدة اختبار الكتالوج",
      pricingModel: "FLAT",
      basePriceIqd: 1_000n,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toContain("موجودة بالفعل");
  });

  it("المالك يقرأ ولا ينشئ", async () => {
    const owner: ActorContext = { userId: f.roleUsers.OWNER, role: "OWNER" };
    const read = await listServices({ includeUnavailable: false, onlyMandatory: false }, owner);
    expect(read.ok).toBe(true);

    const write = await createService(
      { ...base, name: "خدمة يحاولها المالك", pricingModel: "FLAT", basePriceIqd: 1_000n },
      owner,
    );
    expect(write.ok).toBe(false);
  });

  it("الساكن **يقرأ** الكتالوج — §3.2 يعطيه «R (available ones)»", async () => {
    const resident: ActorContext = { userId: f.roleUsers.RESIDENT, role: "RESIDENT" };
    const r = await listServices({ includeUnavailable: false, onlyMandatory: false }, resident);
    expect(r.ok).toBe(true);
  });

  it("🔴 **ولا يرى الموقوفة ولو طلبها صراحةً**", async () => {
    /**
     * §3.2 يقيّده بـ«‏available ones». والمُدخل يصل من العميل، فتجاهله
     * قسراً في الإجراء: خدمة أُوقفت لسبب تظهر له فيطلبها، فيُرفض طلبه
     * بلا أن يفهم لماذا عُرضت أصلاً.
     */
    const resident: ActorContext = { userId: f.roleUsers.RESIDENT, role: "RESIDENT" };
    const r = await listServices({ includeUnavailable: true, onlyMandatory: false }, resident);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.every((s) => s.isAvailable)).toBe(true);
    expect(r.data.some((s) => s.id === generatorId), "الموقوفة ظهرت للساكن").toBe(false);

    // والأدمن يراها — الفرق في الدور لا في المُدخل
    const asAdmin = await listServices({ includeUnavailable: true, onlyMandatory: false }, admin);
    if (!asAdmin.ok) return;
    expect(asAdmin.data.some((s) => s.id === generatorId)).toBe(true);
  });
});
