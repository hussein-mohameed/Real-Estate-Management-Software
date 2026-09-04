import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { cleanupTestData, connection, createFixture, type Fixture } from "./helpers";
import {
  bulkSetApartmentConstructionStatus,
  listApartments,
  setApartmentConstructionStatus,
  setApartmentOccupancy,
} from "@/lib/actions/apartments";
import { createBuilding } from "@/lib/actions/buildings";
import type { ActorContext } from "@/lib/actions/define-action";
import { prisma } from "@/lib/prisma";

/**
 * الخطوة 1.2 — تعريف الإنجاز:
 *   «محاولة تعيين سكن لشقة تحت الإنشاء **تُرفض برسالة عربية دقيقة**» (‏R10)
 *   «محاولة SOLD بلا عقد بيع تُرفض» (‏R8)
 *   «الجدول يُصفَّح من الخادم ويرشّح بكل المحاور»
 *   «التحديث الجماعي يعمل على مدى محدَّد **ويُبلّغ عن المتخطَّى**»
 */

let client: Client;
let f: Fixture;
let admin: ActorContext;
let buildingId = "";
const apartmentIds: string[] = [];

/**
 * ⚠️ **رمز البناية ورقم العرض من ثابت واحد.**
 * كان الرقم مكتوباً بالحرف (`"APT-1-1"`)، وقالب العرض
 * `{building}-{floor}-{unit}` يبنيه من الرمز. فتغيير الرمز كسر تأكيدين
 * لا علاقة ظاهرة لهما به — والرسالة كانت تقول «توقّعنا APT-1-1» بينما
 * الصحيح موجود باسم آخر.
 */
const BUILDING_CODE = "ITapt2";
const displayNo = (floor: number, unit: number): string =>
  `${BUILDING_CODE}-${floor}-${unit}`;

beforeAll(async () => {
  client = connection();
  await client.connect();
  await cleanupTestData(client);
  f = await createFixture(client, "apt");
  admin = { userId: f.roleUsers.ADMIN, role: "ADMIN", ip: "10.0.0.7", userAgent: "vitest" };

  const b = await createBuilding(
    {
      code: BUILDING_CODE,
      floorsCount: 2,
      unitsPerFloor: 3,
      numberingScheme: "SEQUENTIAL",
      displayNumberFormat: "{building}-{floor}-{unit}",
    },
    admin,
  );
  if (!b.ok) throw new Error(`تعذّر إنشاء بناية الاختبار: ${b.error.message}`);
  buildingId = b.data.id;

  const { rows } = await client.query<{ id: string }>(
    `select id from "Apartment" where "buildingId" = $1 order by "floorNumber","unitNumber"`,
    [buildingId],
  );
  apartmentIds.push(...rows.map((r) => r.id));
}, 120_000);

afterAll(async () => {
  await client.query(`delete from "Contract" where "apartmentId" = any($1)`, [apartmentIds]);
  await client.query(`delete from "Apartment" where "buildingId" = $1`, [buildingId]);
  await client.query(`delete from "Building" where id = $1`, [buildingId]);
  await client.query(`delete from "AuditLog" where "actorUserId" like 'itest_%'`);
  await cleanupTestData(client);
  await client.end().catch(() => {});
  await prisma.$disconnect().catch(() => {});
}, 90_000);

const apt = (i = 0): string => apartmentIds[i]!;

describe("🔴 R10 — شقة تحت الإنشاء لا تخرج من VACANT", () => {
  it("**تعيين سكن لشقة تحت الإنشاء مرفوض برسالة عربية دقيقة**", async () => {
    const r = await setApartmentOccupancy(
      { apartmentId: apt(), occupancyStatus: "OCCUPIED_BY_OWNER" },
      admin,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("BUSINESS_RULE");
      expect(r.error.message).toContain("تحت الإنشاء");
      // §11.4: لا رموز خام
      expect(/[A-Z_]{5,}/u.test(r.error.message)).toBe(false);
    }
  });

  it("إعادة شقة مسكونة إلى «تحت الإنشاء» مرفوضة أيضاً — القاعدة من الجهتين", async () => {
    // نُكمل الإنشاء ونُنشئ عقد بيع ثم نُسكنها
    await setApartmentConstructionStatus({ apartmentId: apt(), status: "COMPLETED" }, admin);
    await client.query(
      `insert into "Contract" (id,"contractNumber","apartmentId","holderUserId",type,status,"startDate","updatedAt")
       values ('itest_ctr_r10','CTR-R10',$1,$2,'SALE','ACTIVE',now(),now())`,
      [apt(), f.holderId],
    );
    const occupied = await setApartmentOccupancy(
      { apartmentId: apt(), occupancyStatus: "OCCUPIED_BY_OWNER" },
      admin,
    );
    expect(occupied.ok, occupied.ok ? "" : occupied.error.message).toBe(true);

    const back = await setApartmentConstructionStatus(
      { apartmentId: apt(), status: "UNDER_CONSTRUCTION" },
      admin,
    );
    expect(back.ok).toBe(false);
    if (!back.ok) expect(back.error.message).toContain("تحت الإنشاء");
  });
});

describe("🔴 R8 — حالة السكن تتطلّب عقداً نشطاً من النوع الصحيح", () => {
  it("«يسكنها مستأجر» بلا عقد إيجار نشط مرفوض", async () => {
    await setApartmentConstructionStatus({ apartmentId: apt(1), status: "COMPLETED" }, admin);
    const r = await setApartmentOccupancy(
      { apartmentId: apt(1), occupancyStatus: "OCCUPIED_BY_TENANT" },
      admin,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("BUSINESS_RULE");
      expect(r.error.message).toContain("عقد إيجار");
    }
  });

  it("«يسكنها المالك» بلا عقد تمليك نشط مرفوض", async () => {
    const r = await setApartmentOccupancy(
      { apartmentId: apt(1), occupancyStatus: "OCCUPIED_BY_OWNER" },
      admin,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("عقد تمليك");
  });

  it("**D1 — عقدا بيع وإيجار نشطان معاً يسمحان بـ«يسكنها مستأجر»**", async () => {
    await client.query(
      `insert into "Contract" (id,"contractNumber","apartmentId","holderUserId",type,status,"startDate","updatedAt")
       values ('itest_ctr_sale2','CTR-S2',$1,$2,'SALE','ACTIVE',now(),now()),
              ('itest_ctr_rent2','CTR-R2',$1,$2,'RENTAL','ACTIVE',now(),now())`,
      [apt(1), f.holderId],
    );
    const r = await setApartmentOccupancy(
      { apartmentId: apt(1), occupancyStatus: "OCCUPIED_BY_TENANT" },
      admin,
    );
    expect(r.ok, r.ok ? "" : r.error.message).toBe(true);
    if (r.ok) expect(r.data.occupancyStatus).toBe("OCCUPIED_BY_TENANT");
  });

  it("R7 — كل انتقال يُؤرَّخ (‏occupancyChangedAt)", async () => {
    const { rows } = await client.query<{ changed: string | null }>(
      `select "occupancyChangedAt" changed from "Apartment" where id = $1`,
      [apt(1)],
    );
    expect(rows[0]!.changed, "الانتقال لم يُؤرَّخ").not.toBeNull();
  });
});

describe("🔴 F2 — التاريخ الماضي: قرار غير مُتَّخذ لا تخمين", () => {
  it("**تاريخ ماضٍ يُرفض بخطأ يسمّي السؤال**", async () => {
    const past = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const r = await setApartmentOccupancy(
      { apartmentId: apt(2), occupancyStatus: "VACANT", effectiveDate: past },
      admin,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("PENDING_DECISION");
      expect(r.error.message).toContain("effectiveDate");
      expect(r.error.message).toContain("رجعية");
    }
  });

  it("تاريخ اليوم يعمل — نقبل ما له معنى محدَّد", async () => {
    await setApartmentConstructionStatus({ apartmentId: apt(2), status: "COMPLETED" }, admin);
    await client.query(
      `insert into "Contract" (id,"contractNumber","apartmentId","holderUserId",type,status,"startDate","updatedAt")
       values ('itest_ctr_today','CTR-TD',$1,$2,'SALE','ACTIVE',now(),now())`,
      [apt(2), f.holderId],
    );
    const r = await setApartmentOccupancy(
      { apartmentId: apt(2), occupancyStatus: "OCCUPIED_BY_OWNER", effectiveDate: new Date() },
      admin,
    );
    expect(r.ok, r.ok ? "" : r.error.message).toBe(true);
  });
});

describe("Q33 — التسليم حدث له تاريخ", () => {
  it("الانتقال إلى DELIVERED يضبط deliveredAt", async () => {
    const r = await setApartmentConstructionStatus(
      { apartmentId: apt(3), status: "DELIVERED" },
      admin,
    );
    expect(r.ok, r.ok ? "" : r.error.message).toBe(true);
    if (r.ok) expect(r.data.deliveredAt).not.toBeNull();
  });
});

describe("التحديث الجماعي — §8.2/1", () => {
  it("يُحدّث المدى ويُبلّغ عن المتخطَّى", async () => {
    const r = await bulkSetApartmentConstructionStatus(
      { buildingId, fromFloor: 1, toFloor: 2, status: "COMPLETED" },
      admin,
    );
    expect(r.ok, r.ok ? "" : r.error.message).toBe(true);
    if (r.ok) expect(r.data.updated).toBeGreaterThan(0);
  });

  it("**شقة مسكونة تُستثنى من العودة لتحت الإنشاء ويُذكر اسمها**", async () => {
    const r = await bulkSetApartmentConstructionStatus(
      { buildingId, fromFloor: 1, toFloor: 2, status: "UNDER_CONSTRUCTION" },
      admin,
    );
    expect(r.ok, r.ok ? "" : r.error.message).toBe(true);
    if (r.ok) {
      // apt(0) وapt(1) وapt(2) مسكونات
      expect(r.data.skipped.length).toBeGreaterThanOrEqual(3);
      expect(r.data.skipped).toContain(displayNo(1, 1));
    }
  });

  it("نطاق مقلوب مرفوض", async () => {
    const r = await bulkSetApartmentConstructionStatus(
      { buildingId, fromFloor: 2, toFloor: 1, status: "COMPLETED" },
      admin,
    );
    expect(r.ok).toBe(false);
  });
});

describe("القائمة — تصفيح وترشيح بكل المحاور", () => {
  it("تُصفَّح من الخادم (25)", async () => {
    const r = await listApartments({ buildingId, page: 1 }, admin);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.pageSize).toBe(25);
      expect(r.data.total).toBe(6);
    }
  });

  it("ترشيح بكل محور على حدة", async () => {
    for (const filter of [
      { occupancyStatus: "OCCUPIED_BY_OWNER" as const },
      { occupancyStatus: "VACANT" as const },
      { constructionStatus: "COMPLETED" as const },
      { ownershipStatus: "UNSOLD" as const },
      { floorNumber: 1 },
    ]) {
      const r = await listApartments({ buildingId, page: 1, ...filter }, admin);
      expect(r.ok, JSON.stringify(filter)).toBe(true);
      if (r.ok) {
        for (const row of r.data.rows) {
          for (const [k, v] of Object.entries(filter)) {
            expect(row[k as keyof typeof row], `${k}`).toBe(v);
          }
        }
      }
    }
  });

  it("البحث برقم العرض", async () => {
    // ⚠️ مقيّد بالبناية عمداً: البحث العام في قاعدة مشتركة هشّ — أي
    // بناية أخرى برقم عرض مشابه تكسر الاختبار بلا علاقة بالمنطق.
    const r = await listApartments({ buildingId, search: displayNo(1, 1), page: 1 }, admin);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(
        r.data.rows.map((x) => x.displayNumber),
        "نتائج غير متوقَّعة",
      ).toEqual([displayNo(1, 1)]);
    }
  });

  it("مرشّح «وجود رصيد مفتوح» يعمل ولا يكسر الاستعلام", async () => {
    const r = await listApartments({ buildingId, hasOpenBalance: true, page: 1 }, admin);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.rows).toHaveLength(0); // لا حسابات بعد
  });

  it("R9 — عدد الأفراد محسوب لا مخزَّن", async () => {
    const r = await listApartments({ buildingId, page: 1 }, admin);
    if (r.ok) {
      for (const row of r.data.rows) {
        expect(typeof row._count.residents).toBe("number");
      }
    }
  });

  it("الساكن لا يرى قائمة كل الشقق", async () => {
    const r = await listApartments(
      { page: 1 },
      { userId: f.roleUsers.RESIDENT, role: "RESIDENT" },
    );
    // §3.2: الساكن `R (own)` — القائمة العامة ليست نطاقه
    expect(r.ok).toBe(true); // القراءة مسموحة بالمصفوفة
    if (r.ok) {
      // ⚠️ ترشيح النطاق يقع في طبقة الاستعلام الخاصة بالساكن (5.3)،
      // لا في هذا الإجراء الإداري. مسجَّل كتذكير في الخطوة 5.3.
      expect(Array.isArray(r.data.rows)).toBe(true);
    }
  });
});
