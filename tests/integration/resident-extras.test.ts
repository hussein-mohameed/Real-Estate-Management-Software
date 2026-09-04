import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { cleanupTestData, connection, createFixture, testId, type Fixture } from "./helpers";
import {
  effectiveBadgeStatus,
  myVehicles,
  mySubscriptions,
} from "@/lib/services/resident-extras";
import { prisma } from "@/lib/prisma";

/**
 * بوّابة الساكن — الاشتراكات والسيارات.
 *
 * ⚠️ **سطران أمنيّان يحرسهما هذا الملف:**
 *   • الاشتراك الشخصي لا يراه ساكنٌ آخر في نفس الوحدة. مرشّح واحد
 *     بـ`apartmentId` كان سيُري الابنَ اشتراكَ أبيه وثمنه — تسريب مالي
 *     داخل البيت الواحد، وهو ما يمنعه كشف الحساب أصلاً.
 *   • **رسم الباج مستثنى من الاستعلام** لا مُرشَّح في العرض. الترشيح في
 *     العرض يُنسى؛ الاستثناء من `select` لا يُنسى.
 *
 * ⚠️ وثالثٌ تشغيليّ: `Q40` — لا مهمة تقلب الباج إلى `EXPIRED`، فباجٌ انتهى
 * يبقى `ISSUED` في القاعدة. وعرضُه «صادر» يجعل الساكن يقف عند البوّابة
 * واثقاً فيُمنع.
 */

let client: Client;
let f: Fixture;

const HOLDER = testId("u_rx_holder");
const FAMILY = testId("u_rx_family");
const STRANGER = testId("u_rx_stranger");
const OTHER_APT = testId("apt_rx_other");
const SVC_UNIT = testId("svc_rx_unit");
const SVC_PERSONAL = testId("svc_rx_personal");
const VEHICLE_MINE = testId("veh_rx_mine");
const VEHICLE_FAMILY = testId("veh_rx_family");
const VEHICLE_REMOVED = testId("veh_rx_gone");
const VEHICLE_OTHER_APT = testId("veh_rx_other");

beforeAll(async () => {
  client = connection();
  await client.connect();
  await cleanupTestData(client);
  f = await createFixture(client, "rxs");

  // الفكسچر يُنشئ `holderId` صاحب العقد. نضيف فرد أسرة وغريباً في وحدة أخرى.
  for (const [id, name, phone] of [
    [HOLDER, "صاحب العقد للاختبار", "+9647082000001"],
    [FAMILY, "فرد أسرة للاختبار", "+9647082000002"],
    [STRANGER, "ساكن وحدة أخرى", "+9647082000003"],
  ]) {
    await client.query(
      `insert into "User" (id,"fullName",phone,role,"isActive","updatedAt")
       values ($1,$2,$3,'RESIDENT',true,now())`,
      [id, name, phone],
    );
  }

  await client.query(
    `insert into "Apartment" (id,"buildingId","floorNumber","unitNumber","displayNumber",
                              "constructionStatus","ownershipStatus","occupancyStatus","updatedAt")
     values ($1,$2,2,1,$3,'COMPLETED','SOLD','OCCUPIED_BY_OWNER',now())`,
    [OTHER_APT, f.buildingId, "ITrxs-2-1"],
  );

  // صاحب العقد وفرد الأسرة في وحدة الفكسچر؛ الغريب في وحدة أخرى
  const links: Array<[string, string, string]> = [
    [testId("lnk_rx_h"), f.apartmentId, HOLDER],
    [testId("lnk_rx_f"), f.apartmentId, FAMILY],
    [testId("lnk_rx_s"), OTHER_APT, STRANGER],
  ];
  for (const [id, aptId, userId] of links) {
    await client.query(
      `insert into "ApartmentResident" (id,"apartmentId","userId","relationType",
                                        "isContractHolder","isActive","movedInAt","updatedAt")
       values ($1,$2,$3,'FAMILY_MEMBER',false,true,now(),now())`,
      [id, aptId, userId],
    );
  }

  for (const [id, name] of [
    [SVC_UNIT, "نظافة الوحدة للاختبار"],
    [SVC_PERSONAL, "خدمة شخصية للاختبار"],
  ]) {
    await client.query(
      `insert into "Service" (id,name,"billingType","billingCycle","pricingModel",
                              "basePriceIqd","payerType","appliesTo","updatedAt")
       values ($1,$2,'RECURRING','MONTHLY','FLAT',50000,'OCCUPANT','BOTH',now())`,
      [id, name],
    );
  }

  /**
   * اشتراكان على نفس الوحدة:
   *   • موضوعه **الوحدة**  ← يراه الساكنان
   *   • موضوعه **صاحب العقد** ← لصاحبه وحده
   *
   * ⚠️ قيد `subscription_subject_consistent` يوجب `apartmentId` حتى لموضوع
   * الساكن — فوجودُه في الصفّ **لا** يعني أن الاشتراك للوحدة. وهذا بالضبط
   * ما يجعل الترشيح بـ`apartmentId` وحده خاطئاً.
   */
  await client.query(
    `insert into "Subscription" (id,"serviceId","subjectType","apartmentId","residentUserId",
                                 "accountId","payerType",quantity,"unitPriceSnapshotIqd",
                                 "periodAmountIqd","billingCycle",status,"startDate","updatedAt")
     values ($1,$2,'APARTMENT',$3,null,$4,'OCCUPANT',1,50000,50000,'MONTHLY','ACTIVE',now(),now())`,
    [testId("sub_rx_unit"), SVC_UNIT, f.apartmentId, f.accountId],
  );
  await client.query(
    `insert into "Subscription" (id,"serviceId","subjectType","apartmentId","residentUserId",
                                 "accountId","payerType",quantity,"unitPriceSnapshotIqd",
                                 "periodAmountIqd","billingCycle",status,"startDate","updatedAt")
     values ($1,$2,'RESIDENT',$3,$4,$5,'OCCUPANT',1,90000,90000,'MONTHLY','ACTIVE',now(),now())`,
    [testId("sub_rx_personal"), SVC_PERSONAL, f.apartmentId, HOLDER, f.accountId],
  );
  // ملغى — لا يُعرض
  await client.query(
    `insert into "Subscription" (id,"serviceId","subjectType","apartmentId","residentUserId",
                                 "accountId","payerType",quantity,"unitPriceSnapshotIqd",
                                 "periodAmountIqd","billingCycle",status,"startDate","updatedAt")
     values ($1,$2,'APARTMENT',$3,null,$4,'OCCUPANT',1,50000,50000,'MONTHLY','CANCELLED',now(),now())`,
    [testId("sub_rx_dead"), SVC_UNIT, f.apartmentId, f.accountId],
  );

  const vehicles: Array<[string, string, string | null, string, string]> = [
    [VEHICLE_MINE, f.apartmentId, HOLDER, "12345 بغداد", "APPROVED"],
    [VEHICLE_FAMILY, f.apartmentId, FAMILY, "67890 بغداد", "PENDING_APPROVAL"],
    [VEHICLE_REMOVED, f.apartmentId, HOLDER, "11111 بغداد", "REMOVED"],
    [VEHICLE_OTHER_APT, OTHER_APT, STRANGER, "99999 بغداد", "APPROVED"],
  ];
  for (const [id, aptId, ownerId, plate, status] of vehicles) {
    await client.query(
      `insert into "Vehicle" (id,"apartmentId","ownerUserId","plateNumber",status,"updatedAt")
       values ($1,$2,$3,$4,$5,now())`,
      [id, aptId, ownerId, plate, status],
    );
  }

  /**
   * ثلاثة باجات: صادر وصالح · صادر ومنتهٍ · ملغى.
   *
   * ⚠️ **المنتهي على سيارة أخرى بالضرورة.** الفهرس الفريد الجزئي
   * `uniq_active_badge_per_vehicle` يمنع أكثر من باج غير ملغى على السيارة
   * الواحدة. حاولتُ وضع الصالح والمنتهي على نفس السيارة فرفضته القاعدة —
   * وهي محقّة: باجان حيّان على سيارة واحدة يعني رقمين مقبولين عند البوّابة.
   * والملغى مستثنى من الفهرس، فيجوز بجانب الصالح.
   *
   * ⚠️ والمنتهي هو محور `Q40`: حالته في القاعدة `ISSUED` رغم مضيّ تاريخه.
   */
  const badges: Array<[string, string, string, string | null, string | null]> = [
    [testId("bdg_rx_ok"), VEHICLE_MINE, "ISSUED", "RX-OK-1", "2099-01-01"],
    [testId("bdg_rx_stale"), VEHICLE_FAMILY, "ISSUED", "RX-OLD-1", "2020-01-01"],
    [testId("bdg_rx_gone"), VEHICLE_MINE, "REVOKED", "RX-REV-1", null],
  ];
  for (const [id, vehId, status, code, expires] of badges) {
    await client.query(
      `insert into "Badge" (id,"vehicleId",code,status,"feeIqd","issuedAt","expiresAt","updatedAt")
       values ($1,$2,$3,$4,250000,now(),$5,now())`,
      [id, vehId, code, status, expires],
    );
  }
}, 180_000);

afterAll(async () => {
  await client.query(`delete from "Badge" where id like $1`, [`${testId("bdg_rx")}%`]);
  await client.query(`delete from "Vehicle" where id like $1`, [`${testId("veh_rx")}%`]);
  await client.query(`delete from "Subscription" where id like $1`, [`${testId("sub_rx")}%`]);
  await client.query(`delete from "Service" where id like $1`, [`${testId("svc_rx")}%`]);
  await client.query(`delete from "ApartmentResident" where id like $1`, [`${testId("lnk_rx")}%`]);
  await client.query(`delete from "Apartment" where id = $1`, [OTHER_APT]);
  await client.query(`delete from "User" where id like $1`, [`${testId("u_rx")}%`]);
  await cleanupTestData(client);
  await client.end();
  await prisma.$disconnect();
});

describe("اشتراكاتي", () => {
  it("صاحب العقد يرى اشتراك الوحدة واشتراكه الشخصي", async () => {
    const subs = await mySubscriptions(HOLDER);
    const names = subs.map((s) => s.serviceName);
    expect(names).toContain("نظافة الوحدة للاختبار");
    expect(names).toContain("خدمة شخصية للاختبار");
    expect(subs.find((s) => s.isPersonal)?.serviceName).toBe("خدمة شخصية للاختبار");
  });

  it("⚠️ فرد الأسرة يرى اشتراك الوحدة **ولا يرى الشخصي**", async () => {
    const subs = await mySubscriptions(FAMILY);
    const names = subs.map((s) => s.serviceName);
    expect(names).toContain("نظافة الوحدة للاختبار");
    expect(
      names,
      "تسرّب اشتراك شخصي إلى ساكن آخر في نفس الوحدة — الترشيح بـapartmentId وحده",
    ).not.toContain("خدمة شخصية للاختبار");
  });

  it("⚠️ ساكن وحدة أخرى لا يرى شيئاً منها", async () => {
    const subs = await mySubscriptions(STRANGER);
    expect(subs.map((s) => s.serviceName)).not.toContain("نظافة الوحدة للاختبار");
  });

  it("الملغى لا يُعرض — قائمةٌ فيها ملغى تُقرأ كالتزامات قائمة", async () => {
    const subs = await mySubscriptions(HOLDER);
    expect(subs.every((s) => s.status !== "CANCELLED")).toBe(true);
  });

  it("مبلغ الدورة كما هو بلا تطبيع — الساكن يسأل «كم أدفع»", async () => {
    const subs = await mySubscriptions(HOLDER);
    const personal = subs.find((s) => s.isPersonal);
    expect(personal!.periodAmountIqd).toBe(90_000n);
    expect(personal!.billingCycle).toBe("MONTHLY");
  });

  it("بلا شقة: قائمة فارغة لا انفجار", async () => {
    const orphan = testId("u_rx_orphan");
    await client.query(
      `insert into "User" (id,"fullName",phone,role,"isActive","updatedAt")
       values ($1,'ساكن بلا شقة','+9647082000009','RESIDENT',true,now())`,
      [orphan],
    );
    try {
      expect(await mySubscriptions(orphan)).toEqual([]);
      expect(await myVehicles(orphan)).toEqual([]);
    } finally {
      await client.query(`delete from "User" where id = $1`, [orphan]);
    }
  });
});

describe("سياراتي", () => {
  it("سيارات الوحدة كلها، ومع تمييز ما هو باسمي", async () => {
    const vs = await myVehicles(HOLDER);
    const plates = vs.map((v) => v.plateNumber);
    expect(plates).toContain("12345 بغداد");
    // على مستوى الوحدة: سيارة فرد الأسرة تظهر أيضاً
    expect(plates).toContain("67890 بغداد");
    expect(vs.find((v) => v.plateNumber === "12345 بغداد")!.isMine).toBe(true);
    expect(vs.find((v) => v.plateNumber === "67890 بغداد")!.isMine).toBe(false);
  });

  it("⚠️ سيارة وحدة أخرى لا تظهر", async () => {
    const vs = await myVehicles(HOLDER);
    expect(vs.map((v) => v.plateNumber)).not.toContain("99999 بغداد");
  });

  it("المُزالة لا تظهر — سيارة بيعت ليست «سيارتي»", async () => {
    const vs = await myVehicles(HOLDER);
    expect(vs.map((v) => v.plateNumber)).not.toContain("11111 بغداد");
  });

  it("⚠️ رسم الباج لا يخرج من الاستعلام إطلاقاً", async () => {
    const vs = await myVehicles(HOLDER);
    const badges = vs.flatMap((v) => v.badges);
    expect(badges.length).toBeGreaterThan(0);

    // الرسم موجود في القاعدة — فلو خرج لكان الاختبار قادراً على رصده
    const stored = await prisma.badge.findFirst({
      where: { id: testId("bdg_rx_ok") },
      select: { feeIqd: true },
    });
    expect(stored!.feeIqd, "الفكسچر بلا رسم — الاختبار سيصير أجوف").toBe(250_000n);

    for (const b of badges) {
      expect(Object.keys(b), "خرج feeIqd إلى بوّابة الساكن").not.toContain("feeIqd");
    }
  });

  it("الباج الملغى لا يُعرض", async () => {
    const vs = await myVehicles(HOLDER);
    const codes = vs.flatMap((v) => v.badges).map((b) => b.code);
    expect(codes).not.toContain("RX-REV-1");
  });

  it("⚠️ الباج المنتهي يُعرض منتهياً رغم أن القاعدة تقول ISSUED (‏Q40)", async () => {
    const stored = await prisma.badge.findFirst({
      where: { id: testId("bdg_rx_stale") },
      select: { status: true },
    });
    expect(stored!.status, "الفكسچر لا يمثّل عيب Q40 — الاختبار أجوف").toBe("ISSUED");

    const vs = await myVehicles(HOLDER);
    const stale = vs.flatMap((v) => v.badges).find((b) => b.code === "RX-OLD-1");
    expect(stale!.status).toBe("ISSUED");
    expect(
      stale!.effectiveStatus,
      "عُرض باج منتهٍ على أنه صادر — يذهب الساكن إلى البوّابة فيُمنع",
    ).toBe("EXPIRED");

    const fresh = vs.flatMap((v) => v.badges).find((b) => b.code === "RX-OK-1");
    expect(fresh!.effectiveStatus).toBe("ISSUED");
  });
});

describe("حساب حالة الباج", () => {
  const t = new Date("2026-06-15T00:00:00.000Z");

  it("بلا تاريخ انتهاء يبقى كما هو", () => {
    expect(effectiveBadgeStatus("ISSUED", null, t)).toBe("ISSUED");
  });

  it("لا يمسّ الحالات غير ISSUED", () => {
    // باج مطلوب لم يُصدر بعد لا معنى لانتهائه
    expect(effectiveBadgeStatus("REQUESTED", new Date("2020-01-01"), t)).toBe("REQUESTED");
    expect(effectiveBadgeStatus("REVOKED", new Date("2020-01-01"), t)).toBe("REVOKED");
  });

  it("ينتهي بعد التاريخ لا قبله", () => {
    expect(effectiveBadgeStatus("ISSUED", new Date("2026-06-16"), t)).toBe("ISSUED");
    expect(effectiveBadgeStatus("ISSUED", new Date("2026-06-14"), t)).toBe("EXPIRED");
  });
});
