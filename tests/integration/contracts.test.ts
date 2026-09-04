import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { cleanupTestData, connection, createFixture, type Fixture } from "./helpers";
import {
  activateContract,
  createContract,
  endContract,
  listContracts,
} from "@/lib/actions/contracts";
import { createBuilding } from "@/lib/actions/buildings";
import { postEntry } from "@/lib/ledger/post-entry";
import type { ActorContext } from "@/lib/actions/define-action";
import { prisma } from "@/lib/prisma";

/**
 * الخطوة 1.5 — تعريف الإنجاز حرفياً:
 *   «تفعيل يُنشئ الحساب في نفس المعاملة (اختبار يُفشل خطوة وسطى ويؤكّد
 *    التراجع الكامل)»
 *   «إنهاء إيجار **لا يمسّ** حساب البيع (اختبار صريح)»
 *   «إنهاء بيع أثناء إيجار نشط مرفوض»
 *   «رصيد غير صفري يطلب تأكيداً»
 *   «الدفتر القديم مرئي بعد إنشاء عقد جديد»
 */

let client: Client;
let f: Fixture;
let admin: ActorContext;
let buildingId = "";
const aptIds: string[] = [];

const DAY = 86_400_000;
const future = (days: number) => new Date(Date.now() + days * DAY);

beforeAll(async () => {
  client = connection();
  await client.connect();
  await cleanupTestData(client);
  f = await createFixture(client, "ctr");
  admin = { userId: f.roleUsers.ADMIN, role: "ADMIN", ip: "10.0.0.9", userAgent: "vitest" };

  const b = await createBuilding(
    {
      code: "ITctr2",
      floorsCount: 1,
      unitsPerFloor: 8,
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
}, 120_000);

afterAll(async () => {
  // الترتيب عكس الاعتماد: الدفتر محميّ بـtrigger، فيُعطَّل مؤقتاً.
  await client.query(`ALTER TABLE "LedgerEntry" DISABLE TRIGGER USER`);
  try {
    await client.query(
      `delete from "LedgerEntry" where "accountId" in
         (select id from "Account" where "apartmentId" = any($1))`,
      [aptIds],
    );
    await client.query(`delete from "Badge" where "vehicleId" in
       (select id from "Vehicle" where "apartmentId" = any($1))`, [aptIds]);
    await client.query(`delete from "Vehicle" where "apartmentId" = any($1)`, [aptIds]);
    await client.query(`delete from "Subscription" where "apartmentId" = any($1)`, [aptIds]);
    await client.query(`delete from "Account" where "apartmentId" = any($1)`, [aptIds]);
    await client.query(`delete from "AuditLog" where "entityId" in
       (select id from "Contract" where "apartmentId" = any($1))`, [aptIds]);
    await client.query(`delete from "Contract" where "apartmentId" = any($1)`, [aptIds]);
    await client.query(`delete from "ApartmentResident" where "apartmentId" = any($1)`, [aptIds]);
    await client.query(`delete from "Apartment" where "buildingId" = $1`, [buildingId]);
    await client.query(`delete from "Building" where id = $1`, [buildingId]);
  } finally {
    await client.query(`ALTER TABLE "LedgerEntry" ENABLE TRIGGER USER`);
  }
  await cleanupTestData(client);
  await client.end();
  await prisma.$disconnect();
}, 120_000);

// ═══════════════════════════════════════════════════════════════════════
//  الإنشاء
// ═══════════════════════════════════════════════════════════════════════

describe("createContract", () => {
  it("ينشئ مسوّدة برقم بصيغة CTR-{السنة}-{تسلسل}", async () => {
    const r = await createContract(
      {
        apartmentId: aptIds[0],
        holderUserId: f.holderId,
        type: "SALE",
        startDate: new Date(),
        totalAmountIqd: 50_000_000n,
        paymentType: "FULL",
      },
      admin,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.data.status).toBe("DRAFT");
    const year = new Date().getFullYear();
    expect(r.data.contractNumber).toMatch(new RegExp(`^CTR-${year}-\\d{4}$`));
  });

  it("لا يفتح حساباً — المسوّدة بلا دفتر", async () => {
    const r = await createContract(
      {
        apartmentId: aptIds[1],
        holderUserId: f.holderId,
        type: "SALE",
        startDate: new Date(),
        totalAmountIqd: 10_000_000n,
        paymentType: "FULL",
      },
      admin,
    );
    if (!r.ok) throw new Error(r.error.message);

    const account = await prisma.account.findUnique({ where: { contractId: r.data.id } });
    expect(account).toBeNull();
  });

  it("§4.11: عقد الإيجار بلا تاريخ نهاية مرفوض", async () => {
    const r = await createContract(
      {
        apartmentId: aptIds[2],
        holderUserId: f.holderId,
        type: "RENTAL",
        startDate: new Date(),
        rentAmountIqd: 500_000n,
        rentCycle: "MONTHLY",
      },
      admin,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.fieldErrors?.["endDate"]?.[0]).toContain("تاريخ نهاية العقد مطلوب");
  });

  it("تاريخ نهاية قبل البداية مرفوض", async () => {
    const r = await createContract(
      {
        apartmentId: aptIds[2],
        holderUserId: f.holderId,
        type: "RENTAL",
        startDate: future(30),
        endDate: future(10),
        rentAmountIqd: 500_000n,
        rentCycle: "MONTHLY",
      },
      admin,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.fieldErrors?.["endDate"]?.[0]).toContain("بعد تاريخ البداية");
  });

  it("عقد التمليك بلا قيمة مرفوض", async () => {
    const r = await createContract(
      { apartmentId: aptIds[2], holderUserId: f.holderId, type: "SALE", startDate: new Date() },
      admin,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.fieldErrors?.["totalAmountIqd"]?.[0]).toContain("قيمة البيع مطلوبة");
  });

  it("مبلغ صفري أو سالب مرفوض", async () => {
    const r = await createContract(
      {
        apartmentId: aptIds[2],
        holderUserId: f.holderId,
        type: "SALE",
        startDate: new Date(),
        totalAmountIqd: 0n,
        paymentType: "FULL",
      },
      admin,
    );
    expect(r.ok).toBe(false);
  });

  it("صاحب عقد معطَّل مرفوض", async () => {
    const dead = "itest_ctr_dead";
    await client.query(
      `insert into "User" (id,"fullName",phone,role,"isActive","updatedAt")
       values ($1,'معطَّل للاختبار','+9647701119999','RESIDENT',false,now())`,
      [dead],
    );
    const r = await createContract(
      {
        apartmentId: aptIds[2],
        holderUserId: dead,
        type: "SALE",
        startDate: new Date(),
        totalAmountIqd: 1_000_000n,
        paymentType: "FULL",
      },
      admin,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toContain("معطَّل");
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  التفعيل — R15 والذرّية
// ═══════════════════════════════════════════════════════════════════════

describe("activateContract", () => {
  it("R15: يفتح الحساب برصيد صفر في نفس المعاملة", async () => {
    const c = await createContract(
      {
        apartmentId: aptIds[3],
        holderUserId: f.holderId,
        type: "SALE",
        startDate: new Date(),
        totalAmountIqd: 75_000_000n,
        paymentType: "FULL",
      },
      admin,
    );
    if (!c.ok) throw new Error(c.error.message);

    const a = await activateContract({ contractId: c.data.id }, admin);
    expect(a.ok).toBe(true);
    if (!a.ok) return;

    expect(a.data.accountStatus).toBe("OPEN");
    expect(a.data.balanceIqd).toBe(0n);

    const account = await prisma.account.findUnique({ where: { contractId: c.data.id } });
    expect(account?.status).toBe("OPEN");
    expect(account?.balanceIqd).toBe(0n);

    // تفعيل البيع يضبط حالة التمليك
    const apt = await prisma.apartment.findUnique({ where: { id: aptIds[3] } });
    expect(apt?.ownershipStatus).toBe("SOLD");
  });

  it("**لا يغيّر الإشغال** — الفوترة لها مفتاحها (1.6)", async () => {
    const apt = await prisma.apartment.findUnique({ where: { id: aptIds[3] } });
    expect(apt?.occupancyStatus).toBe("VACANT");
  });

  /**
   * ⚠️ **الاختبار الذي يطلبه تعريف الإنجاز حرفياً.**
   * نُفشل خطوة **وسطى** — إنشاء الحساب — بزرع حساب مسبق على العقد
   * (`contractId` فريد). لو لم تكن الخطوتان معاملة واحدة لبقي العقد
   * `ACTIVE` بلا حساب: عطبٌ لا يظهر عند التفعيل بل بعد شهر عند أول
   * دورة فوترة، بصمت.
   */
  it("التراجع الكامل: فشل إنشاء الحساب يُبقي العقد DRAFT", async () => {
    const c = await createContract(
      {
        apartmentId: aptIds[4],
        holderUserId: f.holderId,
        type: "SALE",
        startDate: new Date(),
        totalAmountIqd: 20_000_000n,
        paymentType: "FULL",
      },
      admin,
    );
    if (!c.ok) throw new Error(c.error.message);

    // زرع حساب على العقد نفسه ← account.create سيخرق قيد التفرّد
    const planted = "itest_ctr_planted_acc";
    await client.query(
      `insert into "Account" (id,"contractId","apartmentId","holderUserId",status,"balanceIqd","updatedAt")
       values ($1,$2,$3,$4,'OPEN',0,now())`,
      [planted, c.data.id, aptIds[4], f.holderId],
    );

    const a = await activateContract({ contractId: c.data.id }, admin);
    expect(a.ok).toBe(false);

    // ── الإثبات: العقد لم يتحرّك ────────────────────────────────────
    const after = await prisma.contract.findUnique({ where: { id: c.data.id } });
    expect(after?.status).toBe("DRAFT");

    // ولا حساب ثانٍ وُلد
    const count = await prisma.account.count({ where: { contractId: c.data.id } });
    expect(count).toBe(1);

    await client.query(`delete from "Account" where id = $1`, [planted]);
  });

  it("B1: تفعيل عقد بالأقساط موقوف ويسمّي القرار", async () => {
    const c = await createContract(
      {
        apartmentId: aptIds[5],
        holderUserId: f.holderId,
        type: "SALE",
        startDate: new Date(),
        totalAmountIqd: 50_000_000n,
        paymentType: "INSTALLMENTS",
      },
      admin,
    );
    if (!c.ok) throw new Error(c.error.message);

    const a = await activateContract({ contractId: c.data.id }, admin);
    expect(a.ok).toBe(false);
    if (a.ok) return;
    expect(a.error.message).toContain("B1");
    // ولا شيء تسرّب: لا حساب ولا تغيير حالة
    expect(await prisma.account.count({ where: { contractId: c.data.id } })).toBe(0);
    const after = await prisma.contract.findUnique({ where: { id: c.data.id } });
    expect(after?.status).toBe("DRAFT");
  });

  it("D1: عقد إيجار ينشط على شقة عليها بيع نشط", async () => {
    // aptIds[3] عليه بيع نشط من الاختبار الأول
    const rental = await createContract(
      {
        apartmentId: aptIds[3],
        holderUserId: f.roleUsers.RESIDENT,
        type: "RENTAL",
        startDate: new Date(),
        endDate: future(365),
        rentAmountIqd: 750_000n,
        rentCycle: "MONTHLY",
      },
      admin,
    );
    if (!rental.ok) throw new Error(rental.error.message);

    const a = await activateContract({ contractId: rental.data.id }, admin);
    expect(a.ok).toBe(true);

    // **حسابان مستقلّان على الشقة نفسها** — جوهر D1
    const accounts = await prisma.account.findMany({
      where: { apartmentId: aptIds[3], status: "OPEN" },
    });
    expect(accounts).toHaveLength(2);
  });

  it("Q36: تفعيل الإيجار لا يمسّ حالة التمليك", async () => {
    // RENTED_BY_COMPANY قرار مفتوح — لا يُضبط بالتخمين
    const apt = await prisma.apartment.findUnique({ where: { id: aptIds[3] } });
    expect(apt?.ownershipStatus).toBe("SOLD");
  });

  it("عقد ثانٍ من النوع نفسه مرفوض برسالة عربية", async () => {
    const dup = await createContract(
      {
        apartmentId: aptIds[3],
        holderUserId: f.holderId,
        type: "SALE",
        startDate: new Date(),
        totalAmountIqd: 1_000_000n,
        paymentType: "FULL",
      },
      admin,
    );
    if (!dup.ok) throw new Error(dup.error.message);

    const a = await activateContract({ contractId: dup.data.id }, admin);
    expect(a.ok).toBe(false);
    if (a.ok) return;
    expect(a.error.message).toContain("عقد تمليك نشط");
    /**
     * ── ⚠️ «لا إنكليزية» تعني لا **نثراً** إنكليزياً، لا لا معرّفات ─────
     * كان التأكيد يفحص الرسالة كلّها بـ`/[A-Za-z]{4,}/`. ورمز البناية
     * ورقم العقد **لاتينيان بحكم تعريفهما** — `CTR-2026-0050` مرّ لأن
     * «CTR» ثلاثة أحرف، ورمزٌ من أربعة («TOWER» مثلاً) كان سيُسقط
     * الاختبار على بيانات صحيحة تماماً في الإنتاج.
     *
     * فالمعرّفات تُقتطَع أولاً: كل ما بين «…» بيانات لا كلام. والباقي —
     * وهو ما يقرؤه المستخدم فعلاً — يجب أن يخلو من الإنكليزية، وهو ما
     * كان يُقصد أصلاً: ألّا يتسرّب اسم قيد Prisma أو رسالة محرّك خام.
     */
    const prose = a.error.message.replace(/«[^»]*»/g, "");
    expect(prose, "نثرٌ إنكليزي في رسالة يقرؤها المستخدم").not.toMatch(/[A-Za-z]{4,}/);
  });

  it("تفعيل عقد نشط أصلاً مرفوض", async () => {
    const active = await prisma.contract.findFirst({
      where: { apartmentId: aptIds[3], type: "SALE", status: "ACTIVE" },
    });
    const a = await activateContract({ contractId: active!.id }, admin);
    expect(a.ok).toBe(false);
    if (a.ok) return;
    expect(a.error.message).toContain("نشط أصلاً");
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  الإنهاء — §7.11 وأثر D1
// ═══════════════════════════════════════════════════════════════════════

describe("endContract", () => {
  it("D1/5: إنهاء البيع أثناء إيجار نشط **مرفوض**", async () => {
    const sale = await prisma.contract.findFirst({
      where: { apartmentId: aptIds[3], type: "SALE", status: "ACTIVE" },
    });
    const r = await endContract(
      { contractId: sale!.id, outcome: "TERMINATED" },
      admin,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toContain("لا يمكن إنهاء عقد التمليك");
    expect(r.error.message).toContain("نشط");
  });

  /**
   * ⚠️ **الاختبار الصريح الذي يطلبه تعريف الإنجاز.**
   * §7.11 كُتب لعقد واحد. مع D1 صار على الشقة عقدان، ولو أنهى الكود
   * «كل اشتراكات الشقة» أو «كل حساباتها» لخسر المالك دفتره لأن مستأجره
   * غادر — وهو ضياع مال لا عيب عرض.
   */
  it("إنهاء الإيجار **لا يمسّ** حساب البيع ولا رصيده", async () => {
    const sale = await prisma.contract.findFirst({
      where: { apartmentId: aptIds[3], type: "SALE", status: "ACTIVE" },
      include: { account: true },
    });
    const rental = await prisma.contract.findFirst({
      where: { apartmentId: aptIds[3], type: "RENTAL", status: "ACTIVE" },
      include: { account: true },
    });

    // رصيد حقيقي على حساب البيع عبر مسار الكتابة الوحيد
    await postEntry({
      accountId: sale!.account!.id,
      type: "CHARGE",
      source: "MANUAL",
      amountIqd: 1_250_000n,
      descriptionAr: "رسم اختبار على حساب التمليك",
      reason: "تهيئة رصيد لاختبار عزل الحسابين",
      createdByUserId: admin.userId,
    });

    const r = await endContract(
      { contractId: rental!.id, outcome: "EXPIRED" },
      admin,
    );
    expect(r.ok).toBe(true);

    // ── حساب البيع: مفتوح، برصيده كما هو ──────────────────────────
    const saleAccountAfter = await prisma.account.findUnique({
      where: { id: sale!.account!.id },
    });
    expect(saleAccountAfter?.status).toBe("OPEN");
    expect(saleAccountAfter?.balanceIqd).toBe(1_250_000n);

    // ── عقد البيع: نشط كما كان ────────────────────────────────────
    const saleAfter = await prisma.contract.findUnique({ where: { id: sale!.id } });
    expect(saleAfter?.status).toBe("ACTIVE");

    // ── حساب الإيجار وحده أُغلق ───────────────────────────────────
    const rentalAccountAfter = await prisma.account.findUnique({
      where: { id: rental!.account!.id },
    });
    expect(rentalAccountAfter?.status).toBe("CLOSED");
    expect(rentalAccountAfter?.closedAt).not.toBeNull();
  });

  it("§7.11/3: رصيد غير صفري يطلب تأكيداً ولا يُمنع", async () => {
    const c = await createContract(
      {
        apartmentId: aptIds[6],
        holderUserId: f.holderId,
        type: "SALE",
        startDate: new Date(),
        totalAmountIqd: 30_000_000n,
        paymentType: "FULL",
      },
      admin,
    );
    if (!c.ok) throw new Error(c.error.message);
    const a = await activateContract({ contractId: c.data.id }, admin);
    if (!a.ok) throw new Error(a.error.message);

    await postEntry({
      accountId: a.data.accountId,
      type: "CHARGE",
      source: "MANUAL",
      amountIqd: 400_000n,
      descriptionAr: "رصيد مستحق للاختبار",
      reason: "تهيئة رصيد لاختبار تأكيد الإغلاق",
      createdByUserId: admin.userId,
    });

    // ── بلا تأكيد: يُرفض، والرسالة تذكر المبلغ ──────────────────────
    const first = await endContract({ contractId: c.data.id, outcome: "TERMINATED" }, admin);
    expect(first.ok).toBe(false);
    if (!first.ok) {
      expect(first.error.message).toContain("رصيد مستحق");
      expect(first.error.message).toContain("400,000");
      expect(first.error.message).toContain("يُجمَّد");
    }

    // العقد لم يتغيّر بالمحاولة المرفوضة
    expect((await prisma.contract.findUnique({ where: { id: c.data.id } }))?.status).toBe("ACTIVE");

    // ── مع التأكيد: يمرّ، **والرصيد يُجمَّد لا يُصفَّر** ─────────────
    const second = await endContract(
      { contractId: c.data.id, outcome: "TERMINATED", confirmNonZeroBalance: true },
      admin,
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data.frozenBalanceIqd).toBe(400_000n);

    const acc = await prisma.account.findUnique({ where: { id: a.data.accountId } });
    expect(acc?.status).toBe("CLOSED");
    expect(acc?.balanceIqd).toBe(400_000n); // ← لم يُصفَّر
  });

  it("R38: الإنهاء يُلغي الباجات بسبب «انتهاء العقد»", async () => {
    const c = await createContract(
      {
        apartmentId: aptIds[7],
        holderUserId: f.holderId,
        type: "RENTAL",
        startDate: new Date(),
        endDate: future(180),
        rentAmountIqd: 600_000n,
        rentCycle: "MONTHLY",
      },
      admin,
    );
    if (!c.ok) throw new Error(c.error.message);
    const a = await activateContract({ contractId: c.data.id }, admin);
    if (!a.ok) throw new Error(a.error.message);

    // سيارة + باج مُصدَر + ساكن نشط
    const vehId = "itest_ctr_veh";
    const badgeId = "itest_ctr_badge";
    const resId = "itest_ctr_res";
    await client.query(
      `insert into "Vehicle" (id,"apartmentId","plateNumber",status,"updatedAt")
       values ($1,$2,'12345 بغداد','APPROVED',now())`,
      [vehId, aptIds[7]],
    );
    await client.query(
      // القيد `badge_issued_needs_code` يوجب رمزاً للباج المُصدَر
      `insert into "Badge" (id,"vehicleId",status,code,"issuedAt","expiresAt","updatedAt")
       values ($1,$2,'ISSUED',$3,now(),now() + interval '1 year',now())`,
      [badgeId, vehId, "itest-badge-ctr"],
    );
    await client.query(
      `insert into "ApartmentResident" (id,"apartmentId","userId","relationType",
                                        "isContractHolder","movedInAt","isActive","updatedAt")
       values ($1,$2,$3,'OTHER',false,now(),true,now())`,
      [resId, aptIds[7], f.roleUsers.RESIDENT],
    );

    const r = await endContract({ contractId: c.data.id, outcome: "EXPIRED" }, admin);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.data.revokedBadges).toBe(1);
    expect(r.data.movedOutResidents).toBe(1);

    const badge = await prisma.badge.findUnique({ where: { id: badgeId } });
    expect(badge?.status).toBe("REVOKED");
    expect(badge?.revokeReason).toBe("انتهاء العقد");

    const res = await prisma.apartmentResident.findUnique({ where: { id: resId } });
    expect(res?.isActive).toBe(false);
    expect(res?.movedOutAt).not.toBeNull();

    // §7.11: الشقة تصبح فارغة
    const apt = await prisma.apartment.findUnique({ where: { id: aptIds[7] } });
    expect(apt?.occupancyStatus).toBe("VACANT");
  });

  it("§7.11: ownershipStatus لا يُمسّ عند الإنهاء", async () => {
    // aptIds[6] أُنهي بيعه أعلاه — ويبقى SOLD لأن §7.11 لا يذكر عكسه
    const apt = await prisma.apartment.findUnique({ where: { id: aptIds[6] } });
    expect(apt?.ownershipStatus).toBe("SOLD");
  });

  it("إنهاء عقد غير نشط مرفوض", async () => {
    const ended = await prisma.contract.findFirst({
      where: { apartmentId: aptIds[6], status: "TERMINATED" },
    });
    const r = await endContract({ contractId: ended!.id, outcome: "EXPIRED" }, admin);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toContain("غير نشط");
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  المبدأ 3 — الدفتر يتبع العقد
// ═══════════════════════════════════════════════════════════════════════

describe("المبدأ 3: عقد جديد = حساب من صفر، والقديم يبقى مقروءاً", () => {
  it("A2: الدفتر القديم مرئي بعد إنشاء عقد جديد، والجديد يبدأ من صفر", async () => {
    // aptIds[6]: عقد مُنهى برصيد مجمَّد 400,000
    const old = await prisma.contract.findFirst({
      where: { apartmentId: aptIds[6], status: "TERMINATED" },
      include: { account: { include: { entries: true } } },
    });
    expect(old?.account?.status).toBe("CLOSED");
    expect(old!.account!.entries.length).toBeGreaterThan(0);

    // عقد جديد على الشقة نفسها
    const fresh = await createContract(
      {
        apartmentId: aptIds[6],
        holderUserId: f.roleUsers.RESIDENT,
        type: "SALE",
        startDate: new Date(),
        totalAmountIqd: 33_000_000n,
        paymentType: "FULL",
      },
      admin,
    );
    if (!fresh.ok) throw new Error(fresh.error.message);
    const a = await activateContract({ contractId: fresh.data.id }, admin);
    if (!a.ok) throw new Error(a.error.message);

    // ── الجديد من صفر، لا يرث شيئاً ────────────────────────────────
    expect(a.data.balanceIqd).toBe(0n);
    const freshEntries = await prisma.ledgerEntry.count({ where: { accountId: a.data.accountId } });
    expect(freshEntries).toBe(0);

    // ── والقديم ما زال قائماً برصيده وقيوده ────────────────────────
    const oldAgain = await prisma.account.findUnique({
      where: { id: old!.account!.id },
      include: { entries: true },
    });
    expect(oldAgain?.balanceIqd).toBe(400_000n);
    expect(oldAgain?.entries.length).toBe(old!.account!.entries.length);
  });

  it("listContracts يُظهر العقود المُنهاة وحساباتها المغلقة", async () => {
    const r = await listContracts({ apartmentId: aptIds[6], page: 1, pageSize: 25 }, admin);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const terminated = r.data.rows.find((c) => c.status === "TERMINATED");
    expect(terminated).toBeDefined();
    expect(terminated?.account?.status).toBe("CLOSED");
    expect(terminated?.account?.balanceIqd).toBe(400_000n);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  الترخيص
// ═══════════════════════════════════════════════════════════════════════

describe("الترخيص", () => {
  it("D3: المالك لا ينشئ عقداً (قراءة فقط على العمليات)", async () => {
    const owner: ActorContext = { userId: f.roleUsers.OWNER, role: "OWNER" };
    const r = await createContract(
      {
        apartmentId: aptIds[0],
        holderUserId: f.holderId,
        type: "SALE",
        startDate: new Date(),
        totalAmountIqd: 1_000_000n,
        paymentType: "FULL",
      },
      owner,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toContain("العقود");
    expect(r.error.message).not.toContain("CONTRACTS"); // §11.4: لا رموز خام
  });

  it("الساكن لا يصل إلى العقود إطلاقاً", async () => {
    const resident: ActorContext = { userId: f.roleUsers.RESIDENT, role: "RESIDENT" };
    const r = await createContract(
      {
        apartmentId: aptIds[0],
        holderUserId: f.holderId,
        type: "SALE",
        startDate: new Date(),
        totalAmountIqd: 1_000_000n,
        paymentType: "FULL",
      },
      resident,
    );
    expect(r.ok).toBe(false);
  });

  it("بلا جلسة يُرفض", async () => {
    const r = await createContract({ apartmentId: aptIds[0] }, null);
    expect(r.ok).toBe(false);
  });
});
