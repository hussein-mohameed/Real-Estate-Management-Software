import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { cleanupTestData, connection, createFixture, type Fixture } from "./helpers";
import { createBuilding, listBuildings, regenerateApartments } from "@/lib/actions/buildings";
import type { ActorContext } from "@/lib/actions/define-action";
import { prisma } from "@/lib/prisma";

/**
 * الخطوة 1.1 — تعريف الإنجاز:
 *   «بناية بـ5 طوابق × 5 وحدات تُنتج 25 شقة بحالات صحيحة»
 *   «إعادة توليد على مدى طوابق **تتجاوز الشقق المتعاقدة وتُبلّغ عنها**»
 *   «إعادة توليد بعد حذف ناعم **لا** تفشل بخطأ تفريد» (‏T1)
 */

let client: Client;
let f: Fixture;
const buildingIds: string[] = [];

let admin: ActorContext;

beforeAll(async () => {
  client = connection();
  await client.connect();
  await cleanupTestData(client);
  f = await createFixture(client, "bld");
  admin = { userId: f.roleUsers.ADMIN, role: "ADMIN", ip: "10.0.0.5", userAgent: "vitest" };
}, 90_000);

afterAll(async () => {
  for (const id of buildingIds) {
    await client.query(`delete from "Apartment" where "buildingId" = $1`, [id]);
    await client.query(`delete from "FloorUnitsOverride" where "buildingId" = $1`, [id]);
    await client.query(`delete from "Building" where id = $1`, [id]);
  }
  await client.query(`delete from "AuditLog" where "actorUserId" like 'itest_%'`);
  await cleanupTestData(client);
  await client.end().catch(() => {});
  await prisma.$disconnect().catch(() => {});
}, 90_000);

let codeSeq = 0;
const nextCode = (): string => `T${++codeSeq}`;

async function makeBuilding(over: Record<string, unknown> = {}) {
  const r = await createBuilding(
    {
      code: nextCode(),
      floorsCount: 5,
      unitsPerFloor: 5,
      numberingScheme: "SEQUENTIAL",
      displayNumberFormat: "{building}-{floor}-{unit}",
      ...over,
    },
    admin,
  );
  if (r.ok) buildingIds.push(r.data.id);
  return r;
}

describe("إنشاء بناية وتوليد شققها في معاملة واحدة", () => {
  it("**‏5 × 5 ← 25 شقة** بالحالات الابتدائية الصحيحة", async () => {
    const r = await makeBuilding();
    expect(r.ok, r.ok ? "" : r.error.message).toBe(true);
    if (!r.ok) return;
    expect(r.data.apartmentsCreated).toBe(25);

    const { rows } = await client.query<{
      n: string; construction: string; ownership: string; occupancy: string;
    }>(
      `select count(*) n, "constructionStatus"::text construction,
              "ownershipStatus"::text ownership, "occupancyStatus"::text occupancy
       from "Apartment" where "buildingId" = $1
       group by 2,3,4`,
      [r.data.id],
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.n)).toBe(25);
    expect(rows[0]!.construction).toBe("UNDER_CONSTRUCTION");
    expect(rows[0]!.ownership).toBe("UNSOLD");
    expect(rows[0]!.occupancy).toBe("VACANT");
  });

  it("**قالب خاطئ يُردّ قبل أي كتابة** — لا بناية ولا شقة", async () => {
    const before = await client.query<{ n: string }>(`select count(*) n from "Building"`);
    const r = await makeBuilding({ displayNumberFormat: "ثابت بلا رمز" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("BUSINESS_RULE");

    const after = await client.query<{ n: string }>(`select count(*) n from "Building"`);
    expect(Number(after.rows[0]!.n), "أُنشئت بناية رغم فشل التوليد!").toBe(
      Number(before.rows[0]!.n),
    );
  });

  it("رمز بناية مكرَّر ← رسالة عربية لا خطأ خام", async () => {
    const code = nextCode();
    const first = await makeBuilding({ code });
    expect(first.ok).toBe(true);
    const second = await makeBuilding({ code });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.code).toBe("CONFLICT");
      expect(second.error.message).toContain(code);
    }
  });

  it("Q43 — تجاوز طابق يُنتج عدداً مختلفاً", async () => {
    const r = await makeBuilding({
      floorsCount: 3,
      unitsPerFloor: 4,
      floorOverrides: [{ floorNumber: 2, unitsCount: 6 }],
    });
    expect(r.ok, r.ok ? "" : r.error.message).toBe(true);
    if (r.ok) expect(r.data.apartmentsCreated).toBe(14);
  });

  it("PER_FLOOR يُنتج displayNumber فريداً رغم تكرار unitNumber", async () => {
    const r = await makeBuilding({
      floorsCount: 3,
      unitsPerFloor: 4,
      numberingScheme: "PER_FLOOR",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const { rows } = await client.query<{ units: string; displays: string }>(
      `select count(distinct "unitNumber") units, count(distinct "displayNumber") displays
       from "Apartment" where "buildingId" = $1`,
      [r.data.id],
    );
    expect(Number(rows[0]!.units)).toBe(4);   // مكرَّر بين الطوابق
    expect(Number(rows[0]!.displays)).toBe(12); // وفريد للعرض
  });
});

describe("🔴 Q31 — إعادة التوليد لا تلمس شقة لها أي صفّ تابع", () => {
  it("**شقة لها عقد تُتخطّى ويُبلَّغ عنها بالاسم**", async () => {
    const b = await makeBuilding({ floorsCount: 2, unitsPerFloor: 2 });
    expect(b.ok).toBe(true);
    if (!b.ok) return;

    // نعلّق عقداً على أول شقة
    const { rows } = await client.query<{ id: string; displayNumber: string }>(
      `select id, "displayNumber" from "Apartment" where "buildingId" = $1
       order by "floorNumber", "unitNumber" limit 1`,
      [b.data.id],
    );
    const target = rows[0]!;
    await client.query(
      `insert into "Contract" (id,"contractNumber","apartmentId","holderUserId",type,status,"startDate","updatedAt")
       values ($1,$2,$3,$4,'SALE','DRAFT',now(),now())`,
      [`itest_ctr_regen`, `CTR-REGEN-1`, target.id, f.holderId],
    );

    const r = await regenerateApartments(
      { buildingId: b.data.id, fromFloor: 1, toFloor: 2 },
      admin,
    );
    expect(r.ok, r.ok ? "" : r.error.message).toBe(true);
    if (!r.ok) return;

    // ⚠️ التخطّي **مُبلَّغ عنه بالاسم** لا صامتاً
    expect(r.data.skipped).toContain(target.displayNumber);
    expect(r.data.softDeleted).toBe(3); // الثلاث الباقيات

    // والشقة المتعاقدة **لم تُمسّ**
    const still = await client.query<{ deletedAt: string | null }>(
      `select "deletedAt" from "Apartment" where id = $1`,
      [target.id],
    );
    expect(still.rows[0]!.deletedAt, "حُذفت شقة متعاقدة!").toBeNull();

    await client.query(`delete from "Contract" where id = 'itest_ctr_regen'`);
  });

  it("**‏T1 — إعادة التوليد بعد حذف ناعم لا تفشل بخطأ تفريد**", async () => {
    const b = await makeBuilding({ floorsCount: 2, unitsPerFloor: 2 });
    expect(b.ok).toBe(true);
    if (!b.ok) return;

    // جولة أولى: تحذف الأربع ناعماً وتُعيد إنشاءها
    const first = await regenerateApartments({ buildingId: b.data.id, fromFloor: 1, toFloor: 2 }, admin);
    expect(first.ok, first.ok ? "" : first.error.message).toBe(true);
    if (first.ok) {
      expect(first.data.softDeleted).toBe(4);
      expect(first.data.created).toBe(4);
    }

    // جولة ثانية على شقق أُعيد إنشاؤها فوق محذوفات — الفهرس الكامل
    // كان سيفشل هنا؛ الجزئي WHERE deletedAt IS NULL يمرّ.
    const second = await regenerateApartments({ buildingId: b.data.id, fromFloor: 1, toFloor: 2 }, admin);
    expect(second.ok, second.ok ? "" : second.error.message).toBe(true);

    const alive = await client.query<{ n: string }>(
      `select count(*) n from "Apartment" where "buildingId" = $1 and "deletedAt" is null`,
      [b.data.id],
    );
    expect(Number(alive.rows[0]!.n)).toBe(4);
  });

  it("نطاق طوابق مقلوب مرفوض", async () => {
    const b = await makeBuilding({ floorsCount: 3, unitsPerFloor: 2 });
    if (!b.ok) return;
    const r = await regenerateApartments({ buildingId: b.data.id, fromFloor: 3, toFloor: 1 }, admin);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("نطاق الطوابق");
  });

  it("بناية غير موجودة ← NOT_FOUND", async () => {
    const r = await regenerateApartments(
      { buildingId: "itest_missing_building", fromFloor: 1, toFloor: 1 },
      admin,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NOT_FOUND");
  });
});

describe("القائمة — الإحصاءات محسوبة لا مخزَّنة (المبدأ 1)", () => {
  it("عدد الشقق والمكتملة يأتيان باستعلام مجمَّع", async () => {
    const r = await listBuildings({ page: 1 }, admin);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.pageSize).toBe(25);
    const mine = r.data.rows.filter((b) => buildingIds.includes(b.id));
    expect(mine.length).toBeGreaterThan(0);
    for (const b of mine) {
      expect(typeof b.apartmentsCount).toBe("number");
      expect(b.completedCount).toBe(0); // كلها تحت الإنشاء
    }
  });

  it("الساكن لا يرى البنايات إطلاقاً (‏§3.2)", async () => {
    const r = await listBuildings(
      { page: 1 },
      { userId: f.roleUsers.RESIDENT, role: "RESIDENT" },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });
});
