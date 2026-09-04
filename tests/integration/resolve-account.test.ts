import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { cleanupTestData, connection, createFixture, type Fixture } from "./helpers";
import { resolveAccountForApartment } from "@/lib/services/resolve-account";
import { createBuilding } from "@/lib/actions/buildings";
import { activateContract, createContract, endContract } from "@/lib/actions/contracts";
import type { ActorContext } from "@/lib/actions/define-action";
import { prisma } from "@/lib/prisma";

/**
 * الخطوة 2.3 — الحالات الثماني على **بيانات حقيقية**.
 *
 * الجدول النقيّ في `lib/domain/payer.test.ts` يثبت المنطق. هذا الملف يثبت
 * أن **القراءة تُغذّيه بالصحيح**: عقود نشطة وحدها، وحسابات فعلية، وحالة
 * تمليك من الشقة لا من التخمين.
 */

let client: Client;
let f: Fixture;
let admin: ActorContext;
let buildingId = "";
const aptIds: string[] = [];

/** يبني شقة بالحالة المطلوبة ويُعيد معرّفها. */
async function unit(
  index: number,
  opts: { sale?: boolean; rental?: boolean; ownership?: string },
): Promise<string> {
  const apt = aptIds[index]!;
  if (opts.ownership) {
    await client.query(
      `update "Apartment" set "ownershipStatus" = $2::"OwnershipStatus" where id = $1`,
      [apt, opts.ownership],
    );
  }
  if (opts.sale) await activate(apt, "SALE");
  if (opts.rental) await activate(apt, "RENTAL");
  return apt;
}

async function activate(apartmentId: string, type: "SALE" | "RENTAL"): Promise<string> {
  const c = await createContract(
    {
      apartmentId,
      holderUserId: type === "SALE" ? f.holderId : f.roleUsers.RESIDENT,
      type,
      startDate: new Date(),
      ...(type === "SALE"
        ? { totalAmountIqd: 40_000_000n, paymentType: "FULL" as const }
        : {
            endDate: new Date(Date.now() + 365 * 86_400_000),
            rentAmountIqd: 500_000n,
            rentCycle: "MONTHLY" as const,
          }),
    },
    admin,
  );
  if (!c.ok) throw new Error(c.error.message);
  const a = await activateContract({ contractId: c.data.id }, admin);
  if (!a.ok) throw new Error(a.error.message);
  return a.data.accountId;
}

beforeAll(async () => {
  client = connection();
  await client.connect();
  await cleanupTestData(client);
  f = await createFixture(client, "ra");
  admin = { userId: f.roleUsers.ADMIN, role: "ADMIN", ip: "10.0.0.16", userAgent: "vitest" };

  const b = await createBuilding(
    {
      code: "ITrac",
      floorsCount: 1,
      unitsPerFloor: 6,
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
  await client.query(
    `update "Apartment" set "constructionStatus" = 'COMPLETED' where "buildingId" = $1`,
    [buildingId],
  );
}, 180_000);

afterAll(async () => {
  await client.query(`ALTER TABLE "LedgerEntry" DISABLE TRIGGER USER`);
  try {
    await client.query(
      `delete from "LedgerEntry" where "accountId" in
         (select id from "Account" where "apartmentId" = any($1))`,
      [aptIds],
    );
    await client.query(`delete from "Account" where "apartmentId" = any($1)`, [aptIds]);
    await client.query(
      `delete from "AuditLog" where "entityId" in
         (select id from "Contract" where "apartmentId" = any($1))`,
      [aptIds],
    );
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

const accountOf = (apartmentId: string, type: "SALE" | "RENTAL") =>
  prisma.account.findFirst({
    where: { apartmentId, contract: { type, status: "ACTIVE" } },
    select: { id: true },
  });

// ═══════════════════════════════════════════════════════════════════════

describe("🔴 الحالات الثماني على بيانات حقيقية", () => {
  it("1+2) مباعة ومؤجّرة — المالك ← التمليك · الساكن ← الإيجار", async () => {
    const apt = await unit(0, { sale: true, rental: true, ownership: "SOLD" });
    const sale = await accountOf(apt, "SALE");
    const rental = await accountOf(apt, "RENTAL");

    const owner = await resolveAccountForApartment(apt, "OWNER");
    expect(owner.ok).toBe(true);
    if (owner.ok) expect(owner.accountId).toBe(sale!.id);

    const occ = await resolveAccountForApartment(apt, "OCCUPANT");
    expect(occ.ok).toBe(true);
    if (occ.ok) expect(occ.accountId).toBe(rental!.id);

    // ⚠️ حسابان مختلفان على الشقة نفسها — جوهر D1
    if (owner.ok && occ.ok) expect(owner.accountId).not.toBe(occ.accountId);
  });

  it("3+4) مباعة غير مؤجّرة — كلاهما ← التمليك", async () => {
    const apt = await unit(1, { sale: true, ownership: "SOLD" });
    const sale = await accountOf(apt, "SALE");

    for (const payer of ["OWNER", "OCCUPANT"] as const) {
      const r = await resolveAccountForApartment(apt, payer);
      expect(r.ok, payer).toBe(true);
      if (r.ok) expect(r.accountId).toBe(sale!.id);
    }
  });

  it("5) غير مباعة ومؤجّرة — المالك ← **يُرفض ويُشرَح**", async () => {
    const apt = await unit(2, { rental: true, ownership: "UNSOLD" });
    const r = await resolveAccountForApartment(apt, "OWNER");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.messageAr).toContain("عقد تمليك نشط");
    expect(r.messageAr).toMatch(/فعّل|غيّر/); // يقترح الفعل لا يعتذر
  });

  it("6) غير مباعة ومؤجّرة — الساكن ← الإيجار", async () => {
    const apt = aptIds[2]!;
    const rental = await accountOf(apt, "RENTAL");
    const r = await resolveAccountForApartment(apt, "OCCUPANT");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.accountId).toBe(rental!.id);
  });

  it("7+8) بلا عقد نشط — كلاهما يُرفض", async () => {
    const apt = aptIds[3]!;
    for (const payer of ["OWNER", "OCCUPANT"] as const) {
      const r = await resolveAccountForApartment(apt, payer);
      expect(r.ok, payer).toBe(false);
      if (!r.ok) expect(r.messageAr).toContain("عقد");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════

describe("🔴 Q36 — وحدة يملكها المجمّع ويؤجّرها", () => {
  it("المالك ← **حساب الإيجار** (المجمّع ليس له حساب)", async () => {
    const apt = await unit(4, { rental: true, ownership: "RENTED_BY_COMPANY" });
    const rental = await accountOf(apt, "RENTAL");

    const r = await resolveAccountForApartment(apt, "OWNER");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.accountId).toBe(rental!.id);
    expect(r.reasonAr).toContain("Q36");
  });

  it("⚠️ ونفس الشقة لو صارت `UNSOLD` تُرفض — القيد محصور", async () => {
    const apt = aptIds[4]!;
    await client.query(
      `update "Apartment" set "ownershipStatus" = 'UNSOLD' where id = $1`,
      [apt],
    );
    const r = await resolveAccountForApartment(apt, "OWNER");
    expect(r.ok).toBe(false);

    await client.query(
      `update "Apartment" set "ownershipStatus" = 'RENTED_BY_COMPANY' where id = $1`,
      [apt],
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════

describe("العقود المنتهية لا تُقرأ", () => {
  it("إنهاء الإيجار ينقل الساكن إلى حساب التمليك", async () => {
    const apt = aptIds[0]!; // مباعة ومؤجّرة
    const sale = await accountOf(apt, "SALE");
    const rentalContract = await prisma.contract.findFirst({
      where: { apartmentId: apt, type: "RENTAL", status: "ACTIVE" },
    });

    const e = await endContract(
      { contractId: rentalContract!.id, outcome: "EXPIRED" },
      admin,
    );
    expect(e.ok).toBe(true);

    // ⚠️ الساكن الفعلي صار المالك — والحساب المغلق لا يُقرأ أصلاً
    const occ = await resolveAccountForApartment(apt, "OCCUPANT");
    expect(occ.ok).toBe(true);
    if (occ.ok) expect(occ.accountId).toBe(sale!.id);
  });

  it("وإنهاء الكل يُرجع الرفض", async () => {
    const apt = aptIds[1]!;
    const saleContract = await prisma.contract.findFirst({
      where: { apartmentId: apt, type: "SALE", status: "ACTIVE" },
    });
    await endContract({ contractId: saleContract!.id, outcome: "TERMINATED" }, admin);

    const r = await resolveAccountForApartment(apt, "OCCUPANT");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.messageAr).toContain("لا إيجار ولا تمليك");
  });
});

// ═══════════════════════════════════════════════════════════════════════

describe("عطب البيانات لا يُسقَط صامتاً", () => {
  it("🔴 عقد نشط **بلا حساب** يُبلَّغ عنه لا يُتجاهَل", async () => {
    /**
     * ⚠️ حالة لا ينبغي أن توجد (‏R15 يفتح الحساب في نفس المعاملة).
     * لكن إسقاطها صامتاً كان سيُنتج رسالة «لا عقد نشط» **وهي كذبة**:
     * العقد موجود، والعطب في مكان آخر تماماً — فيبحث الأدمن حيث لا شيء.
     */
    const apt = aptIds[5]!;
    await client.query(
      `insert into "Contract" (id,"contractNumber","apartmentId","holderUserId",
                               type,status,"startDate","totalAmountIqd","paymentType","updatedAt")
       values ('itest_ra_orphan','CTR-IT-ORPHAN',$1,$2,'SALE','ACTIVE',now(),1000000,'FULL',now())`,
      [apt, f.holderId],
    );

    const r = await resolveAccountForApartment(apt, "OWNER");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.messageAr).toContain("بلا حساب مالي");
    expect(r.messageAr).toContain("راجع مسؤول النظام");

    await client.query(`delete from "Contract" where id = 'itest_ra_orphan'`);
  });

  it("شقة غير موجودة ترمي", async () => {
    await expect(
      resolveAccountForApartment("itest_ra_nothing", "OWNER"),
    ).rejects.toThrow();
  });
});
