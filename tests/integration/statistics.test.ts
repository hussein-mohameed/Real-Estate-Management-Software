import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { cleanupTestData, connection, createFixture, type Fixture } from "./helpers";
import {
  allBuildingsStats,
  buildingStats,
  completedApartmentNumbers,
  compoundStats,
  expectedMonthlyRevenue,
  residentsCountByApartment,
  residentsInApartment,
  serviceStats,
  apartmentCurrentBalance,
} from "@/lib/services/statistics";
import { STATISTICS, safePercentage } from "@/lib/domain/statistics";
import { prisma } from "@/lib/prisma";

/**
 * الخطوة 1.7 — تعريف الإنجاز:
 *   «اختبار لكل إحصاء ببيانات معلومة»
 *   «حالات القسمة على صفر تعيد `null`»
 *   «لا استعلام N+1»
 *
 * ⚠️ **البيانات هنا مبنيّة بـSQL خام لا بالإجراءات.** الإجراءات تفرض
 * قواعد عمل (‏R8 يوجب عقداً نشطاً للإشغال، R10 يمنع إشغال ما تحت
 * الإنشاء)، وهي قواعد صحيحة لكنها تجعل بناء **تركيبة معلومة بالضبط**
 * لاختبار الحساب معركةً في نفسها. المطلوب هنا: هل الاستعلام يحسب ما
 * تقوله المواصفة على بيانات نعرف جوابها سلفاً.
 */

let client: Client;
let f: Fixture;

const B1 = "itest_st_b1"; // 5 شقق: 3 مكتملة (‏2 COMPLETED + 1 DELIVERED)
const B2 = "itest_st_b2"; // 2 شقة: صفر مكتملة
const B3 = "itest_st_b3"; // **صفر شقق** ← حدّية القسمة على صفر
const SVC = "itest_st_svc";

const aptsB1: string[] = [];

beforeAll(async () => {
  client = connection();
  await client.connect();
  await cleanupTestData(client);
  f = await createFixture(client, "st");

  const building = async (id: string, code: string) =>
    client.query(
      `insert into "Building" (id,code,"floorsCount","unitsPerFloor","numberingScheme",
                               "displayNumberFormat","constructionStatus","updatedAt")
       values ($1,$2,5,4,'SEQUENTIAL','{building}-{floor}-{unit}','COMPLETED',now())`,
      [id, code],
    );
  await building(B1, "STA");
  await building(B2, "STB");
  await building(B3, "STC"); // بلا شقق عمداً

  const apt = async (
    id: string,
    buildingId: string,
    floor: number,
    unit: number,
    construction: string,
    occupancy: string,
  ) => {
    await client.query(
      `insert into "Apartment" (id,"buildingId","floorNumber","unitNumber","displayNumber",
                                "constructionStatus","ownershipStatus","occupancyStatus","updatedAt")
       values ($1,$2,$3,$4,$5,$6::"ConstructionStatus",'UNSOLD',$7::"OccupancyStatus",now())`,
      [id, buildingId, floor, unit, `${buildingId.slice(-2)}-${floor}-${unit}`, construction, occupancy],
    );
  };

  // البناية 1 — 5 شقق، 3 منها «مكتملة» (‏DELIVERED تُحتسب مكتملة)
  await apt("itest_st_a1", B1, 1, 1, "COMPLETED", "OCCUPIED_BY_OWNER");
  await apt("itest_st_a2", B1, 1, 2, "COMPLETED", "OCCUPIED_BY_TENANT");
  await apt("itest_st_a3", B1, 2, 1, "DELIVERED", "VACANT");
  await apt("itest_st_a4", B1, 2, 2, "UNDER_CONSTRUCTION", "VACANT");
  await apt("itest_st_a5", B1, 3, 1, "UNDER_CONSTRUCTION", "VACANT");
  aptsB1.push("itest_st_a1", "itest_st_a2", "itest_st_a3", "itest_st_a4", "itest_st_a5");

  // البناية 2 — شقتان، صفر مكتملة
  await apt("itest_st_b2a1", B2, 1, 1, "UNDER_CONSTRUCTION", "VACANT");
  await apt("itest_st_b2a2", B2, 1, 2, "UNDER_CONSTRUCTION", "VACANT");

  // سكان: شقة a1 فيها 3 (‏واحد خرج ← لا يُحتسب) · a2 فيها 1 · a3 صفر
  const link = async (id: string, aptId: string, userId: string, active: boolean) =>
    client.query(
      `insert into "ApartmentResident" (id,"apartmentId","userId","relationType",
                                        "isContractHolder","movedInAt","isActive","movedOutAt","updatedAt")
       values ($1,$2,$3,'OTHER',false,now(),$4,$5,now())`,
      [id, aptId, userId, active, active ? null : new Date()],
    );
  await link("itest_st_r1", "itest_st_a1", f.holderId, true);
  await link("itest_st_r2", "itest_st_a1", f.roleUsers.RESIDENT, true);
  await link("itest_st_r3", "itest_st_a1", f.roleUsers.STAFF, true);
  await link("itest_st_r4", "itest_st_a1", f.roleUsers.ADMIN, false); // خرج
  await link("itest_st_r5", "itest_st_a2", f.roleUsers.OWNER, true);

  // خدمة + اشتراكات بدورات مختلفة — لاختبار التطبيع الشهري (‏Q45)
  await client.query(
    `insert into "Service" (id,name,"billingType","billingCycle","pricingModel",
                            "basePriceIqd","payerType","isMandatory","isAvailable",
                            "appliesTo","updatedAt")
     values ($1,'خدمة إحصاءات للاختبار','RECURRING','MONTHLY','FLAT',
             50000,'OCCUPANT',false,true,'APARTMENT',now())`,
    [SVC],
  );

  const sub = async (
    id: string,
    apartmentId: string | null,
    residentUserId: string | null,
    cycle: string | null,
    amount: number,
    status: string,
    subject: string,
  ) =>
    client.query(
      `insert into "Subscription"
         (id,"serviceId","subjectType","apartmentId","residentUserId","accountId","payerType",
          quantity,"unitPriceSnapshotIqd","periodAmountIqd","billingCycle",status,"startDate","updatedAt")
       values ($1,$2,$3::"SubscriptionSubjectType",$4,$5,$6,'OCCUPANT',1,$7,$7,
               $8::"BillingCycle",$9::"SubscriptionStatus",now(),now())`,
      [id, SVC, subject, apartmentId, residentUserId, f.accountId, amount, cycle, status],
    );

  // شهري 50,000 · ربعي 150,000 (=50,000/شهر) · سنوي 600,000 (=50,000/شهر)
  // + اشتراك ساكن شهري 20,000 ← المتوقّع شهرياً = 170,000
  await sub("itest_st_s1", "itest_st_a1", null, "MONTHLY", 50_000, "ACTIVE", "APARTMENT");
  await sub("itest_st_s2", "itest_st_a2", null, "QUARTERLY", 150_000, "ACTIVE", "APARTMENT");
  await sub("itest_st_s3", "itest_st_a3", null, "YEARLY", 600_000, "ACTIVE", "APARTMENT");
  // ملغى ← لا يُحتسب في شيء
  await sub("itest_st_s4", "itest_st_a4", null, "MONTHLY", 999_000, "CANCELLED", "APARTMENT");
  /**
   * اشتراك موضوعه **ساكن**.
   * ⚠️ ويحمل `apartmentId` أيضاً: القيد `subscription_subject_consistent`
   * يوجبه حتى في هذه الحالة (‏§4.14) — الساكن يسكن وحدةً، والاشتراك
   * يُقيَّد على حسابها. الشقة a1 محسوبة سلفاً فلا يتغيّر العدّ المتميّز.
   */
  await sub("itest_st_s5", "itest_st_a1", f.holderId, "MONTHLY", 20_000, "ACTIVE", "RESIDENT");
}, 180_000);

afterAll(async () => {
  await client.query(`delete from "Subscription" where "serviceId" = $1`, [SVC]);
  await client.query(`delete from "Service" where id = $1`, [SVC]);
  await client.query(`delete from "ApartmentResident" where id like 'itest_st_r%'`);
  await client.query(`delete from "Apartment" where "buildingId" = any($1)`, [[B1, B2, B3]]);
  await client.query(`delete from "Building" where id = any($1)`, [[B1, B2, B3]]);
  await cleanupTestData(client);
  await client.end();
  await prisma.$disconnect();
}, 120_000);

// ═══════════════════════════════════════════════════════════════════════

describe("نطاق البناية", () => {
  it("عدد الشقق والمكتملة — DELIVERED تُحتسب مكتملة", async () => {
    const s = await buildingStats(B1);
    expect(s.apartmentsInBuilding).toBe(5);
    // 2 COMPLETED + 1 DELIVERED = 3
    expect(s.completedApartments).toBe(3);
    expect(s.completionPercentage).toBe(60);
  });

  it("بناية بلا شقة مكتملة ← 0% لا null (المقام موجود)", async () => {
    const s = await buildingStats(B2);
    expect(s.apartmentsInBuilding).toBe(2);
    expect(s.completedApartments).toBe(0);
    expect(s.completionPercentage).toBe(0);
  });

  it("🔴 **بناية بلا شقق ← null لا 0% ولا NaN**", async () => {
    const s = await buildingStats(B3);
    expect(s.apartmentsInBuilding).toBe(0);
    // 0% كذبة: تقول إن الإنجاز صفر بينما لا يوجد ما يُنجَز
    expect(s.completionPercentage).toBeNull();
  });

  it("«منو الشقق المكتملة» مرتَّبة بالطابق ثم الوحدة", async () => {
    const nums = await completedApartmentNumbers(B1);
    expect(nums).toEqual(["b1-1-1", "b1-1-2", "b1-2-1"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════

describe("نطاق الشقة", () => {
  it("R9: عدد الأفراد محسوب — والخارج لا يُحتسب", async () => {
    // 4 صفوف على a1، أحدها movedOut ← 3
    expect(await residentsInApartment("itest_st_a1")).toBe(3);
    expect(await residentsInApartment("itest_st_a2")).toBe(1);
    expect(await residentsInApartment("itest_st_a3")).toBe(0);
  });

  it("الدفعة تُرجع صفراً للشقق بلا سكان لا تُسقطها", async () => {
    const m = await residentsCountByApartment(aptsB1);
    // ⚠️ `groupBy` لا يُرجع صفوفاً للمجموعات الفارغة. لو تُركت مفقودة
    // لأظهرت الواجهة «—» بدل «0»، وهما معنيان مختلفان.
    expect(m.size).toBe(aptsB1.length);
    expect(m.get("itest_st_a1")).toBe(3);
    expect(m.get("itest_st_a3")).toBe(0);
    expect(m.get("itest_st_a5")).toBe(0);
  });

  it("🔴 B3: «رصيد الشقة الحالي» يرفض ولا يخمّن", async () => {
    await expect(apartmentCurrentBalance("itest_st_a1")).rejects.toThrow(/B3/);
  });
});

// ═══════════════════════════════════════════════════════════════════════

describe("نطاق الخدمة", () => {
  it("عدد الشقق المشتركة — المتميّزة والنشطة فقط", async () => {
    const s = await serviceStats(SVC);
    // a1 · a2 · a3 نشطة · a4 ملغاة ← 3
    expect(s.apartmentsSubscribed).toBe(3);
  });

  it("عدد الأفراد المشتركين — subjectType = RESIDENT وحده", async () => {
    const s = await serviceStats(SVC);
    expect(s.residentsSubscribed).toBe(1);
  });

  it("🔴 Q45: الإيراد الشهري **مُطبَّع** — الربعي ÷3 والسنوي ÷12", async () => {
    /**
     * لو رُشِّح `MONTHLY` وحده كما في نصّ §4.20 لكان الجواب 50,000 —
     * أي **ثلث الحقيقة**، ويقرأه المالك ليقرّر.
     */
    const revenue = await expectedMonthlyRevenue(SVC);
    /**
     * 50,000 (شهري) + 150,000÷3 + 600,000÷12 + 20,000 (اشتراك ساكن)
     * = 50,000 + 50,000 + 50,000 + 20,000 = 170,000
     *
     * ⚠️ اشتراك الساكن **يُحتسب**: تعريف §4.20 لا يرشّح `subjectType`،
     * وهو إيراد حقيقي للخدمة. استثناؤه كان سيُنقص الرقم الذي يقرأه المالك.
     */
    expect(revenue).toBe(170_000n);
  });

  it("الملغى لا يدخل الإيراد", async () => {
    const revenue = await expectedMonthlyRevenue(SVC);
    expect(revenue).not.toBe(1_049_000n); // لو دخل الملغى (999,000)
  });

  it("نسبة الاشتراك: مقامها الشقق **المسكونة** لا كلّها", async () => {
    const s = await serviceStats(SVC);
    const occupied = await prisma.apartment.count({
      where: { deletedAt: null, occupancyStatus: { not: "VACANT" } },
    });
    expect(s.subscriptionPercentage).toBe(safePercentage(3, occupied));
    // شقة فارغة لا تشترك ولا يُتوقَّع منها — إدخالها يُنتج نسبة لا تعني شيئاً
    expect(occupied).toBeLessThan(await prisma.apartment.count({ where: { deletedAt: null } }));
  });

  it("خدمة بلا اشتراكات ← صفر لا خطأ", async () => {
    const s = await serviceStats("itest_st_no_such_service");
    expect(s.apartmentsSubscribed).toBe(0);
    expect(s.expectedMonthlyRevenueIqd).toBe(0n);
  });
});

// ═══════════════════════════════════════════════════════════════════════

describe("نطاق المجمّع", () => {
  it("توزيع الإشغال يجمع كل الحالات ولا يُسقط الصفر", async () => {
    const s = await compoundStats();
    expect(
      s.occupancy.VACANT + s.occupancy.OCCUPIED_BY_OWNER + s.occupancy.OCCUPIED_BY_TENANT,
    ).toBe(s.totalApartments);
    expect(s.occupiedTotal).toBe(
      s.occupancy.OCCUPIED_BY_OWNER + s.occupancy.OCCUPIED_BY_TENANT,
    );
    expect(s.occupancyPercentage).toBe(safePercentage(s.occupiedTotal, s.totalApartments));
  });

  it("إجمالي المستحقات يجمع الحسابات المفتوحة الموجبة وحدها", async () => {
    const s = await compoundStats();
    const manual = await prisma.account.aggregate({
      where: { status: "OPEN", balanceIqd: { gt: 0 } },
      _sum: { balanceIqd: true },
    });
    expect(s.totalOutstandingIqd).toBe(manual._sum.balanceIqd ?? 0n);
  });

  it("⚠️ الرصيد الدائن **لا يُطرح** من الإجمالي", async () => {
    /**
     * سلفة دفعها ساكن ليست مستحقة على أحد. طرحُها كانت ستُظهر مستحقات
     * **أقلّ** من الواقع، فيبدو التحصيل أفضل مما هو — وهو تضليل في
     * الاتجاه الذي لا يشتكي منه أحد.
     */
    await client.query(
      `update "Account" set "balanceIqd" = -500000 where id = $1`,
      [f.accountId],
    );
    const s = await compoundStats();
    const positives = await prisma.account.aggregate({
      where: { status: "OPEN", balanceIqd: { gt: 0 } },
      _sum: { balanceIqd: true },
    });
    expect(s.totalOutstandingIqd).toBe(positives._sum.balanceIqd ?? 0n);
    await client.query(`update "Account" set "balanceIqd" = 0 where id = $1`, [f.accountId]);
  });
});

// ═══════════════════════════════════════════════════════════════════════

describe("لا استعلام N+1", () => {
  it("إحصاءات كل البنايات تطابق حسابها واحدةً واحدة", async () => {
    const all = await allBuildingsStats();
    for (const id of [B1, B2]) {
      const one = await buildingStats(id);
      expect(all.get(id)).toEqual(one);
    }
  });

  it("🔴 عدد الاستعلامات **ثابت** مهما زاد عدد البنايات", async () => {
    /**
     * ⚠️ **عدٌّ حقيقي لا قياس زمن.**
     * كتبتُ أولاً اختباراً يقيس المدّة ويقارنها بحدّ — وهو أجوف: يمرّ على
     * جهاز سريع مهما بلغ عدد الاستعلامات، ويتذبذب على البطيء بلا سبب.
     *
     * البديل: وسيطٌ يعدّ نداءات المحرّك فعلاً. الدالّة تقبل `db`، فنمرّر
     * غلافاً يحصي ثم يفوّض. النتيجة رقم قاطع لا تقدير.
     */
    let calls = 0;
    const counting = new Proxy(prisma, {
      get(target, model: string) {
        const real = Reflect.get(target, model) as unknown;
        if (typeof real !== "object" || real === null) return real;
        return new Proxy(real, {
          get(m, op: string) {
            const fn = Reflect.get(m, op) as unknown;
            if (typeof fn !== "function") return fn;
            return (...args: unknown[]) => {
              calls += 1;
              return (fn as (...a: unknown[]) => unknown).apply(m, args);
            };
          },
        });
      },
    }) as typeof prisma;

    const all = await allBuildingsStats(counting);

    // استعلامان مجمَّعان مهما بلغ عدد البنايات (‏3 هنا على الأقل)
    expect(all.size).toBeGreaterThanOrEqual(2);
    expect(calls, `توقّعنا استعلامين مجمَّعين، جرى ${calls}`).toBe(2);
  });

  it("والدفعة كذلك: عدد الأفراد لكل الشقق باستعلام واحد", async () => {
    let calls = 0;
    const counting = new Proxy(prisma, {
      get(target, model: string) {
        const real = Reflect.get(target, model) as unknown;
        if (typeof real !== "object" || real === null) return real;
        return new Proxy(real, {
          get(m, op: string) {
            const fn = Reflect.get(m, op) as unknown;
            if (typeof fn !== "function") return fn;
            return (...args: unknown[]) => {
              calls += 1;
              return (fn as (...a: unknown[]) => unknown).apply(m, args);
            };
          },
        });
      },
    }) as typeof prisma;

    await residentsCountByApartment(aptsB1, counting);
    expect(calls, `5 شقق: توقّعنا استعلاماً واحداً، جرى ${calls}`).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════

describe("سجلّ التعريفات مطابق للتنفيذ", () => {
  it("الاثنا عشر تعريفاً موجودة، وواحد وحده محجوب", () => {
    expect(STATISTICS).toHaveLength(12);
    const blocked = STATISTICS.filter((s) => s.blockedBy);
    expect(blocked.map((s) => s.key)).toEqual(["apartmentCurrentBalance"]);
    expect(blocked[0]!.blockedBy).toBe("B3");
  });

  it("كل تعريف قابل للقسمة على صفر مُعلَّم nullable", () => {
    const nullable = STATISTICS.filter((s) => s.nullable).map((s) => s.key);
    expect(nullable).toContain("buildingCompletionPercentage");
    expect(nullable).toContain("serviceSubscriptionPercentage");
  });
});
