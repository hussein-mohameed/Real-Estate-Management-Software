import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { cleanupTestData, connection, createFixture, testId, type Fixture } from "./helpers";
import { compoundPortfolioStats, compoundStats } from "@/lib/services/statistics";
import { prisma } from "@/lib/prisma";

/**
 * أرقام لوحة المالك — `compoundPortfolioStats`.
 *
 * ⚠️ **لماذا تُختبَر هذه بالذات.**
 * المالك يقرأ هذه الأرقام **ليقرّر**، وخطأٌ فيها لا يُكتشف: الرقم يبدو
 * معقولاً دائماً. وفيها ثلاثة مواضع كلٌّ منها خطأ محتمل بعينه:
 *   • **السكّان أشخاص لا ارتباطات** — عدُّ الارتباطات يحتسب من له شقّتان
 *     مرّتين، فيرى المالك سكّاناً أكثر من الواقع.
 *   • **`DELIVERED` منجَزة** — حصرُ الإنجاز في `COMPLETED` يُنقص النسبة
 *     كلّما سُلّمت شقة، أي كلّما تقدّم المشروع.
 *   • **تطبيع `Q45`** — بلا تطبيع الربعي والسنوي يرى المالك إيراداً أقلّ
 *     من الحقيقة.
 */

let client: Client;
let f: Fixture;

const SERVICE_A = testId("svc_pf_a");
const SERVICE_B = testId("svc_pf_b");
const SECOND_APT = testId("apt_pf_second");
const SUBS = [testId("sub_pf_m"), testId("sub_pf_q"), testId("sub_pf_y")];

beforeAll(async () => {
  client = connection();
  await client.connect();
  await cleanupTestData(client);
  f = await createFixture(client, "pfs");

  /**
   * شقة ثانية في نفس البناية بحالة `DELIVERED`.
   *
   * ⚠️ الفكسچر يُنشئ شقةً واحدة `COMPLETED`. وبلا شقة `DELIVERED` كان
   * «التسليم يُحتسب إنجازاً» سيمرّ بلا اختبار.
   */
  await client.query(
    `insert into "Apartment" (id,"buildingId","floorNumber","unitNumber","displayNumber",
                              "constructionStatus","ownershipStatus","occupancyStatus","updatedAt")
     values ($1,$2,1,2,$3,'DELIVERED','RENTED_BY_COMPANY','OCCUPIED_BY_TENANT',now())`,
    [SECOND_APT, f.buildingId, "ITpfs-1-2"],
  );

  /**
   * ⚠️ **ارتباطان لشخص واحد.** هذا هو ما يميّز «عدد الأشخاص» عن «عدد
   * الارتباطات»: `holderId` ساكنٌ في الشقّتين، فيجب أن يُعَدّ **مرّة**.
   */
  for (const [i, aptId] of [f.apartmentId, SECOND_APT].entries()) {
    await client.query(
      `insert into "ApartmentResident" (id,"apartmentId","userId","relationType",
                                        "isContractHolder","isActive","movedInAt","updatedAt")
       values ($1,$2,$3,'FAMILY_MEMBER',false,true,now(),now())`,
      [testId(`link_pf_${i}`), aptId, f.holderId],
    );
  }

  // خدمتان: كي يثبت أن الإيراد يُجمع **على الخدمات كلها** لا على واحدة
  for (const [id, name] of [
    [SERVICE_A, "خدمة محفظة اختبار أ"],
    [SERVICE_B, "خدمة محفظة اختبار ب"],
  ]) {
    await client.query(
      `insert into "Service" (id,name,"billingType","billingCycle","pricingModel",
                              "basePriceIqd","payerType","appliesTo","updatedAt")
       values ($1,$2,'RECURRING','MONTHLY','FLAT',10000,'OCCUPANT','APARTMENT',now())`,
      [id, name],
    );
  }

  /**
   * ثلاثة اشتراكات نشطة بثلاث دورات — والمبالغ مختارة لتقسم بلا كسر:
   *   شهري  120,000 ← 120,000
   *   ربعي  300,000 ÷ 3 ← 100,000
   *   سنوي  240,000 ÷ 12 ← 20,000
   *   ────────────────────────
   *   المجموع المتوقّع        240,000
   *
   * ⚠️ لو كانت المبالغ متساوية لما كشف الاختبار خطأً في المقسوم عليه:
   * ‏«÷ 3» و«÷ 12» مقلوبتين تعطيان نفس المجموع مع مبالغ متماثلة.
   */
  const cycles: Array<[string, string, number]> = [
    [SUBS[0]!, "MONTHLY", 120_000],
    [SUBS[1]!, "QUARTERLY", 300_000],
    [SUBS[2]!, "YEARLY", 240_000],
  ];
  for (const [id, cycle, amount] of cycles) {
    await client.query(
      `insert into "Subscription" (id,"serviceId","subjectType","apartmentId","accountId",
                                   "payerType",quantity,"unitPriceSnapshotIqd","periodAmountIqd",
                                   "billingCycle",status,"startDate","updatedAt")
       values ($1,$2,'APARTMENT',$3,$4,'OCCUPANT',1,$5,$5,$6,'ACTIVE',now(),now())`,
      [id, cycle === "MONTHLY" ? SERVICE_A : SERVICE_B, f.apartmentId, f.accountId, amount, cycle],
    );
  }

  /**
   * ⚠️ رصيد موجب على الحساب: بلا مدين واحد على الأقل كان «عدد الحسابات
   * المدينة» سيقرأ صفراً في كل الأحوال — ويمرّ الاختبار على منطق مكسور.
   */
  await client.query(`update "Account" set "balanceIqd" = 500000 where id = $1`, [
    f.accountId,
  ]);
}, 180_000);

afterAll(async () => {
  await client.query(`delete from "Subscription" where id = any($1)`, [SUBS]);
  await client.query(`delete from "Service" where id = any($1)`, [[SERVICE_A, SERVICE_B]]);
  await cleanupTestData(client);
  await client.end();
  await prisma.$disconnect();
});

describe("الإنجاز", () => {
  it("⚠️ المُسلَّمة تُحتسب منجَزة — وإلا نقصت النسبة كلّما تقدّم المشروع", async () => {
    const p = await compoundPortfolioStats();
    // الشقّتان: واحدة COMPLETED وأخرى DELIVERED — كلتاهما منجَزة
    expect(p.construction.COMPLETED).toBeGreaterThanOrEqual(1);
    expect(p.construction.DELIVERED).toBeGreaterThanOrEqual(1);
    expect(p.completedApartments).toBe(
      p.construction.COMPLETED + p.construction.DELIVERED,
    );
  });

  it("مجموع أجزاء الإنشاء = إجمالي الشقق", async () => {
    /**
     * ⚠️ هذا ما يمنع «‎٪٦٠ من ١٠٠» وتحته أجزاءٌ تجمع ٩٩: المجموع مُشتقّ من
     * التوزيع نفسه لا من استعلام سابع قد يقع في لحظة أخرى.
     */
    const [p, s] = await Promise.all([compoundPortfolioStats(), compoundStats()]);
    const sum =
      p.construction.UNDER_CONSTRUCTION +
      p.construction.COMPLETED +
      p.construction.DELIVERED;
    expect(sum).toBe(s.totalApartments);
  });

  it("مجموع أجزاء التملّك = إجمالي الشقق", async () => {
    const [p, s] = await Promise.all([compoundPortfolioStats(), compoundStats()]);
    const sum = p.ownership.UNSOLD + p.ownership.SOLD + p.ownership.RENTED_BY_COMPANY;
    expect(sum).toBe(s.totalApartments);
  });

  it("النسبة null لا 0٪ حين لا مقام", async () => {
    // مجمّع بلا شقق: يُختبَر بالوحدة على `safePercentage`؛ وهنا نتحقّق أن
    // النسبة رقمٌ فعلاً ما دامت هناك شقق — أي أن المقام ليس صفراً بالخطأ.
    const p = await compoundPortfolioStats();
    expect(typeof p.completionPercentage).toBe("number");
    expect(p.completionPercentage).toBeGreaterThan(0);
  });
});

describe("السكّان", () => {
  it("⚠️ أشخاص لا ارتباطات — من له شقّتان يُعَدّ مرّة", async () => {
    const links = await prisma.apartmentResident.count({
      where: { userId: f.holderId, isActive: true },
    });
    expect(links, "الفكسچر لم يُنشئ ارتباطين — الاختبار سيصير أجوف").toBe(2);

    const p = await compoundPortfolioStats();
    const people = await prisma.user.count({
      where: { apartmentLinks: { some: { isActive: true } } },
    });
    expect(p.activeResidents).toBe(people);
    // ولو عُدّت الارتباطات لكان الرقم أكبر من عدد الأشخاص
    expect(p.activeResidents).toBeLessThan(
      await prisma.apartmentResident.count({ where: { isActive: true } }),
    );
  });
});

describe("العقود والحسابات", () => {
  it("العقود النشطة موزَّعة بالنوع، والمجموع يساوي الأجزاء", async () => {
    const p = await compoundPortfolioStats();
    expect(p.activeContractsTotal).toBe(
      p.activeContracts.SALE + p.activeContracts.RENTAL,
    );
    const actual = await prisma.contract.count({
      where: { status: "ACTIVE", deletedAt: null },
    });
    expect(p.activeContractsTotal).toBe(actual);
  });

  it("عدد الحسابات المدينة يعدّ الموجب وحده", async () => {
    const p = await compoundPortfolioStats();
    expect(p.debtorAccounts).toBeGreaterThanOrEqual(1);

    const expected = await prisma.account.count({
      where: { status: "OPEN", balanceIqd: { gt: 0 } },
    });
    expect(p.debtorAccounts).toBe(expected);
  });
});

describe("الإيراد الشهري المتوقّع", () => {
  it("⚠️ يطبّع الدورات: ربعي ÷ 3 · سنوي ÷ 12 (‏Q45)", async () => {
    const p = await compoundPortfolioStats();

    /**
     * القاعدة تجمع **كل** الاشتراكات النشطة في القاعدة، ومنها ما تصنعه
     * ملفّات أخرى. فالمقارنة بمساهمة اشتراكاتنا الثلاثة وحدها: 240,000.
     * والفكسچر لا يُنشئ اشتراكات، فالباقي صفر ما لم تتسرّب بيانات — وهو
     * ما يجعل المساواة الحرفية صالحة هنا.
     */
    expect(p.expectedMonthlyServiceRevenueIqd).toBe(240_000n);
  });

  it("⚠️ يجمع على الخدمات كلها لا على واحدة", async () => {
    // الاشتراكات موزَّعة على خدمتين؛ لو رُشِّح بخدمة واحدة لنقص الرقم
    const p = await compoundPortfolioStats();
    const perService = await prisma.subscription.groupBy({
      by: ["serviceId"],
      where: { status: "ACTIVE", deletedAt: null },
      _count: { _all: true },
    });
    expect(perService.length, "الاشتراكات على خدمة واحدة — الاختبار أجوف").toBeGreaterThan(1);
    expect(p.expectedMonthlyServiceRevenueIqd).toBeGreaterThan(120_000n);
  });

  it("الاشتراك غير النشط لا يُحسَب", async () => {
    await client.query(`update "Subscription" set status = 'CANCELLED' where id = $1`, [
      SUBS[0],
    ]);
    const after = await compoundPortfolioStats();
    // سقط الشهري 120,000 فبقي 100,000 + 20,000
    expect(after.expectedMonthlyServiceRevenueIqd).toBe(120_000n);

    await client.query(`update "Subscription" set status = 'ACTIVE' where id = $1`, [
      SUBS[0],
    ]);
  });
});

describe("البنايات", () => {
  it("العدّ لا يُرشَّح بـdeletedAt — لا وجود له على Building", async () => {
    const p = await compoundPortfolioStats();
    expect(p.buildingsCount).toBe(await prisma.building.count());
    expect(p.buildingsCount).toBeGreaterThanOrEqual(1);
  });
});
