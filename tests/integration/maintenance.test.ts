import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { cleanupTestData, connection, createFixture, testId, type Fixture } from "./helpers";
import { runDailyMaintenance } from "@/lib/services/maintenance";
import { NextRequest } from "next/server";
import { POST as maintenanceRoute } from "@/app/api/cron/maintenance/route";
import { prisma } from "@/lib/prisma";

/**
 * الصيانة اليومية — الخطوة 2.8 و`Q40`.
 *
 * ⚠️ **ادّعاءان، كلٌّ منهما ثقب لو انكسر:**
 *   • **الباج المنتهي يصير `EXPIRED` في القاعدة.** عالجتُ العرض في بوّابة
 *     الساكن، لكن شاشة بوّابة الأمن تقرأ الحالة من القاعدة — والعرض لا
 *     يحرس البوّابة. لو لم تقلبه هذه المهمّة دخلت السيارة بلا تفتيش.
 *   • **الانحراف يُبلَّغ ولا يُصحَّح.** التصحيح الصامت يخفي سببه — معاملة
 *     ناقصة أو عبث — فيضيع الدليل الوحيد ويبقى السبب يعمل.
 */

let client: Client;
let f: Fixture;

const VEHICLE = testId("veh_mt");
const B_STALE = testId("bdg_mt_stale");
const B_FRESH = testId("bdg_mt_fresh");
const B_NOEXP = testId("bdg_mt_noexp");
const B_REVOKED = testId("bdg_mt_revoked");
const V2 = testId("veh_mt_2");
const V3 = testId("veh_mt_3");

/** يعيد زرع الباجات إلى حالتها الابتدائية قبل كل اختبار. */
async function reseedBadges() {
  await client.query(`delete from "AuditLog" where "entityId" like $1`, [`${testId("bdg_mt")}%`]);
  await client.query(`delete from "Badge" where id like $1`, [`${testId("bdg_mt")}%`]);

  const rows: Array<[string, string, string, string, string | null]> = [
    // منتهٍ وحالته ISSUED — هذا هو عيب Q40 حرفياً
    [B_STALE, VEHICLE, "ISSUED", "MT-STALE", "2020-01-01"],
    // صالح — يجب ألّا يُمسّ
    [B_FRESH, V2, "ISSUED", "MT-FRESH", "2099-01-01"],
    // بلا تاريخ انتهاء — لا معنى لانتهائه
    [B_NOEXP, V3, "ISSUED", "MT-NOEXP", null],
  ];
  for (const [id, veh, status, code, exp] of rows) {
    await client.query(
      `insert into "Badge" (id,"vehicleId",code,status,"issuedAt","expiresAt","updatedAt")
       values ($1,$2,$3,$4,now(),$5,now())`,
      [id, veh, code, status, exp],
    );
  }
  /*
   * ملغى ومنتهٍ على **نفس** سيارة الباج المنتهي: الفهرس الفريد الجزئي
   * `uniq_active_badge_per_vehicle` يستثني REVOKED، فيجوز بجانبه.
   */
  await client.query(
    `insert into "Badge" (id,"vehicleId",code,status,"issuedAt","expiresAt","revokedAt","updatedAt")
     values ($1,$2,'MT-REVOKED','REVOKED',now(),'2020-01-01',now(),now())`,
    [B_REVOKED, VEHICLE],
  );
}

beforeAll(async () => {
  client = connection();
  await client.connect();
  await cleanupTestData(client);
  f = await createFixture(client, "mnt");

  for (const [id, plate] of [
    [VEHICLE, "MT-1 بغداد"],
    [V2, "MT-2 بغداد"],
    [V3, "MT-3 بغداد"],
  ]) {
    await client.query(
      `insert into "Vehicle" (id,"apartmentId","plateNumber",status,"updatedAt")
       values ($1,$2,$3,'APPROVED',now())`,
      [id, f.apartmentId, plate],
    );
  }
}, 180_000);

beforeEach(async () => {
  await reseedBadges();
  // الرصيد المخزَّن يطابق الدفتر ما لم يُفسده اختبار بعينه
  await client.query(`update "Account" set "balanceIqd" = 0 where id = $1`, [f.accountId]);
  await client.query(`delete from "AuditLog" where "entityId" = $1`, [f.accountId]);
});

afterAll(async () => {
  await client.query(`delete from "AuditLog" where "entityId" like $1`, [`${testId("bdg_mt")}%`]);
  await client.query(`delete from "Badge" where id like $1`, [`${testId("bdg_mt")}%`]);
  await client.query(`delete from "Vehicle" where id like $1`, [`${testId("veh_mt")}%`]);
  await cleanupTestData(client);
  await client.end();
  await prisma.$disconnect();
});

describe("انتهاء الباجات (‏Q40)", () => {
  it("⚠️ الباج المنتهي يصير EXPIRED **في القاعدة** لا في العرض", async () => {
    const before = await prisma.badge.findUnique({
      where: { id: B_STALE },
      select: { status: true },
    });
    expect(before!.status, "الفكسچر لا يمثّل العيب — الاختبار أجوف").toBe("ISSUED");

    const r = await runDailyMaintenance();
    expect(r.badgesExpired).toBe(1);

    const after = await prisma.badge.findUnique({
      where: { id: B_STALE },
      select: { status: true },
    });
    expect(after!.status).toBe("EXPIRED");
  });

  it("الباج الصالح لا يُمسّ", async () => {
    await runDailyMaintenance();
    const fresh = await prisma.badge.findUnique({
      where: { id: B_FRESH },
      select: { status: true },
    });
    expect(fresh!.status).toBe("ISSUED");
  });

  it("⚠️ بلا تاريخ انتهاء لا ينتهي — لا يُعامَل الـnull كماضٍ", async () => {
    await runDailyMaintenance();
    const b = await prisma.badge.findUnique({
      where: { id: B_NOEXP },
      select: { status: true },
    });
    expect(b!.status).toBe("ISSUED");
  });

  it("⚠️ الملغى يبقى ملغى — الوقت لا يمحو قرار إنسان", async () => {
    await runDailyMaintenance();
    const b = await prisma.badge.findUnique({
      where: { id: B_REVOKED },
      select: { status: true },
    });
    expect(b!.status, "دهس الانتهاءُ الإلغاءَ").toBe("REVOKED");
  });

  it("⚠️ يكتب سطر تدقيق **لكل باج** — «متى انتهى باج هذه السيارة» سؤال حادثة", async () => {
    await runDailyMaintenance();
    const rows = await prisma.auditLog.findMany({
      where: { entityId: B_STALE, action: "badge.expire" },
      select: { actorUserId: true, entityType: true, before: true, after: true },
    });
    expect(rows).toHaveLength(1);
    // النظام هو الفاعل لا مستخدم
    expect(rows[0]!.actorUserId).toBeNull();
    expect(rows[0]!.entityType).toBe("Badge");
    expect(rows[0]!.after).toMatchObject({ status: "EXPIRED" });
  });

  it("تشغيلان متتاليان: الثاني لا يجد شيئاً ولا يكرّر التدقيق", async () => {
    const first = await runDailyMaintenance();
    expect(first.badgesExpired).toBe(1);

    const second = await runDailyMaintenance();
    expect(second.badgesExpired, "أعاد قلب ما انقلب").toBe(0);

    const rows = await prisma.auditLog.count({
      where: { entityId: B_STALE, action: "badge.expire" },
    });
    expect(rows, "سطرا تدقيق لنفس الانتهاء").toBe(1);
  });
});

describe("كشف انحراف الرصيد (‏2.8 · R31)", () => {
  it("لا انحراف ← قائمة فارغة", async () => {
    const r = await runDailyMaintenance();
    expect(r.drifts.find((d) => d.accountId === f.accountId)).toBeUndefined();
  });

  it("⚠️ انحراف مفتعل: يُكشف بالمقدار الصحيح **ولا يُصحَّح**", async () => {
    await client.query(`update "Account" set "balanceIqd" = 777000 where id = $1`, [
      f.accountId,
    ]);

    const r = await runDailyMaintenance();
    const drift = r.drifts.find((d) => d.accountId === f.accountId);
    expect(drift, "لم يُكشف انحراف مفتعل").toBeDefined();
    expect(drift!.cachedIqd).toBe(777_000n);
    expect(drift!.computedIqd).toBe(0n);
    expect(drift!.driftIqd).toBe(777_000n);

    const after = await prisma.account.findUnique({
      where: { id: f.accountId },
      select: { balanceIqd: true },
    });
    expect(
      after!.balanceIqd,
      "صُحِّح الرصيد آلياً — يضيع الدليل ويبقى السبب يعمل",
    ).toBe(777_000n);
  });

  it("⚠️ الانحراف يُكتب في التدقيق — وإلا لم يُنبَّه عليه أحد", async () => {
    await client.query(`update "Account" set "balanceIqd" = 555000 where id = $1`, [
      f.accountId,
    ]);
    await runDailyMaintenance();

    const rows = await prisma.auditLog.findMany({
      where: { entityId: f.accountId, action: "account.balance.drift" },
      select: { actorUserId: true, after: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorUserId).toBeNull();
    // ⚠️ BigInt يُخزَّن نصّاً: JSON لا يحمله، والعائم يفقد الدقّة على المال
    expect(rows[0]!.after).toMatchObject({ driftIqd: "555000" });
  });

  it("انحراف مستمرّ يُسجَّل كل ليلة — «منذ متى؟» سؤال له جواب", async () => {
    await client.query(`update "Account" set "balanceIqd" = 111000 where id = $1`, [
      f.accountId,
    ]);
    await runDailyMaintenance();
    await runDailyMaintenance();

    const count = await prisma.auditLog.count({
      where: { entityId: f.accountId, action: "account.balance.drift" },
    });
    expect(count).toBe(2);
  });
});

describe("التقرير", () => {
  it("يذكر ما لم يُنفَّذ ولماذا بدل أن يصمت عنه", async () => {
    const r = await runDailyMaintenance();
    const skipped = r.skipped.find((s) => s.task === "payment-link.expire");
    expect(skipped, "سقطت المهمّة المحجوبة من التقرير").toBeDefined();
    expect(skipped!.blockedBy).toBe("B6");
    expect(skipped!.reason.length).toBeGreaterThan(20);
  });

  it("بلا أخطاء في المسار السليم", async () => {
    const r = await runDailyMaintenance();
    expect(r.errors).toEqual([]);
  });
});

/**
 * حارس المسار.
 *
 * ⚠️ **مسارٌ يكتب في القاعدة ويُشغَّل من الخارج.** لو عمل بلا سرّ لصار
 * لأي أحد أن يقلب باجات المجمّع بطلب واحد. والاختبار هنا على المسار نفسه
 * لا على المنطق: المنطق مُختبَر أعلاه، وهذا يفحص ما يحرسه.
 */
describe("‏POST /api/cron/maintenance — الحارس", () => {
  const SECRET = process.env["CRON_SECRET"];

  function call(auth?: string) {
    return maintenanceRoute(
      new NextRequest("http://localhost/api/cron/maintenance", {
        method: "POST",
        ...(auth ? { headers: { authorization: auth } } : {}),
      }),
    );
  }

  it("بلا ترويسة ← 401", async () => {
    expect(SECRET, "‏CRON_SECRET غير مضبوط في البيئة — الاختبار أجوف").toBeTruthy();
    const res = await call();
    expect(res.status).toBe(401);
  });

  it("⚠️ سرّ خاطئ ← 401، وبنفس جواب الغياب كي لا يُستدلّ", async () => {
    const wrong = await call("Bearer not-the-secret");
    const missing = await call();
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual(await missing.json());
  });

  it("⚠️ السرّ الصحيح بلا Bearer ← 401 — لا يُقبل خاماً", async () => {
    const res = await call(SECRET!);
    expect(res.status).toBe(401);
  });

  it("السرّ الصحيح ← 200 وتقرير", async () => {
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["ranAt"]).toBeTypeOf("string");
    expect(body["badgesExpired"]).toBeTypeOf("number");
    expect(Array.isArray(body["skipped"])).toBe(true);
  });

  it("⚠️ بلا سرّ مُهيَّأ ← 503، والمهمّة **لا تعمل مفتوحة**", async () => {
    delete process.env["CRON_SECRET"];
    try {
      const res = await call("Bearer anything");
      expect(res.status, "عملت المهمّة بلا سرّ مُهيَّأ").toBe(503);
    } finally {
      process.env["CRON_SECRET"] = SECRET;
    }
  });

  it("⚠️ المبالغ نصوص في JSON لا أرقام عائمة", async () => {
    await client.query(`update "Account" set "balanceIqd" = 999000 where id = $1`, [
      f.accountId,
    ]);
    const res = await call(`Bearer ${SECRET}`);
    const body = (await res.json()) as { drifts: Array<Record<string, unknown>> };
    const drift = body.drifts.find((d) => d["accountId"] === f.accountId);
    expect(drift, "لم يظهر الانحراف في جواب المسار").toBeDefined();
    // ‏BigInt لا يُسلسَل، والعائم يفقد الدقّة على المال
    expect(drift!["driftIqd"]).toBe("999000");
  });
});
