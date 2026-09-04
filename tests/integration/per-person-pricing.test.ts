import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { cleanupTestData, connection, createFixture, type Fixture } from "./helpers";
import { linkResidentToApartment, unlinkResident } from "@/lib/actions/residents";
import { expectedMonthlyRevenue } from "@/lib/services/statistics";
import type { ActorContext } from "@/lib/actions/define-action";
import { prisma } from "@/lib/prisma";

/**
 * الخطوة 2.2 — **شرط `Q5` اللازم**.
 *
 * ‏`Q5` يقرّر أن عدد الأشخاص **مشتقّ**. لكن `periodAmountIqd` مخزَّن،
 * ويقرأه مؤشّر «الإيراد الشهري المتوقّع» (‏`Q45` — بُني في 1.7).
 *
 * فلو أُعيد الحساب **عند الفوترة فقط** لصار المؤشّر بين دورتين يقرأ قيمةً
 * قديمة: أسرة كبرت من ثلاثة إلى خمسة، والمالك يرى إيراداً أقلّ من الحقيقة
 * لأسابيع — **بلا خطأ ولا تحذير**. هذا الملف يمنع ذلك.
 */

let client: Client;
let f: Fixture;
let admin: ActorContext;

const SVC = "itest_pp_service";
const SUB = "itest_pp_sub";
const FLAT_SVC = "itest_pp_flat_service";
const FLAT_SUB = "itest_pp_flat_sub";

const residents: string[] = [];
const links: string[] = [];

/** سعر الفرد 25,000 — فكل ساكن يزيد الإيراد الشهري 25,000. */
const PER_PERSON_PRICE = 25_000n;

beforeAll(async () => {
  client = connection();
  await client.connect();
  await cleanupTestData(client);
  f = await createFixture(client, "pp");
  admin = { userId: f.roleUsers.ADMIN, role: "ADMIN", ip: "10.0.0.15", userAgent: "vitest" };

  for (let i = 1; i <= 3; i += 1) {
    const id = `itest_pp_r${i}`;
    residents.push(id);
    await client.query(
      `insert into "User" (id,"fullName",phone,role,"isActive","updatedAt")
       values ($1,$2,$3,'RESIDENT',true,now())`,
      [id, `ساكن تسعير ${i}`, `+964770222000${i}`],
    );
  }

  // خدمة PER_PERSON + خدمة FLAT للمقارنة (لا يجب أن تُمسّ)
  await client.query(
    `insert into "Service" (id,name,"billingType","billingCycle","pricingModel",
                            "basePriceIqd","payerType","isMandatory","isAvailable",
                            "appliesTo","updatedAt")
     values ($1,'رسم مرافق بالشخص للاختبار','RECURRING','MONTHLY','PER_PERSON',
             $2,'OCCUPANT',false,true,'APARTMENT',now())`,
    [SVC, PER_PERSON_PRICE.toString()],
  );
  await client.query(
    `insert into "Service" (id,name,"billingType","billingCycle","pricingModel",
                            "basePriceIqd","payerType","isMandatory","isAvailable",
                            "appliesTo","updatedAt")
     values ($1,'نظافة ثابتة للاختبار','RECURRING','MONTHLY','FLAT',
             60000,'OCCUPANT',false,true,'APARTMENT',now())`,
    [FLAT_SVC],
  );

  // اشتراك PER_PERSON يبدأ بصفر ساكن (المُثبِّت لا ينشئ سكاناً)
  await client.query(
    `insert into "Subscription"
       (id,"serviceId","subjectType","apartmentId","accountId","payerType",
        quantity,"unitPriceSnapshotIqd","periodAmountIqd","billingCycle",
        status,"startDate","updatedAt")
     values ($1,$2,'APARTMENT',$3,$4,'OCCUPANT',0,$5,0,'MONTHLY','ACTIVE',now(),now())`,
    [SUB, SVC, f.apartmentId, f.accountId, PER_PERSON_PRICE.toString()],
  );
  await client.query(
    `insert into "Subscription"
       (id,"serviceId","subjectType","apartmentId","accountId","payerType",
        quantity,"unitPriceSnapshotIqd","periodAmountIqd","billingCycle",
        status,"startDate","updatedAt")
     values ($1,$2,'APARTMENT',$3,$4,'OCCUPANT',1,60000,60000,'MONTHLY','ACTIVE',now(),now())`,
    [FLAT_SUB, FLAT_SVC, f.apartmentId, f.accountId],
  );
}, 180_000);

afterAll(async () => {
  await client.query(`delete from "Subscription" where id = any($1)`, [[SUB, FLAT_SUB]]);
  await client.query(`delete from "Service" where id = any($1)`, [[SVC, FLAT_SVC]]);
  await client.query(`delete from "ApartmentResident" where "apartmentId" = $1`, [f.apartmentId]);
  await client.query(`delete from "AuditLog" where "entityId" = any($1)`, [links]);
  await client.query(`delete from "User" where id = any($1)`, [residents]);
  await cleanupTestData(client);
  await client.end();
  await prisma.$disconnect();
}, 120_000);

async function link(userId: string): Promise<string> {
  const r = await linkResidentToApartment(
    { apartmentId: f.apartmentId, userId, relationType: "OTHER", isContractHolder: false },
    admin,
  );
  if (!r.ok) throw new Error(r.error.message);
  links.push(r.data.id);
  return r.data.id;
}

const sub = () => prisma.subscription.findUnique({ where: { id: SUB } });

// ═══════════════════════════════════════════════════════════════════════

describe("🔴 المبلغ يتبع أفراد الأسرة لحظياً", () => {
  it("يبدأ بصفر — شقة بلا سكان", async () => {
    const s = await sub();
    expect(s?.periodAmountIqd).toBe(0n);
    expect(s?.quantity).toBe(0);
  });

  it("ربط ساكن أول يرفع المبلغ **في نفس المعاملة**", async () => {
    const r = await linkResidentToApartment(
      {
        apartmentId: f.apartmentId,
        userId: residents[0]!,
        relationType: "OTHER",
        isContractHolder: false,
      },
      admin,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    links.push(r.data.id);

    // الإجراء يُبلّغ بما أُعيد حسابه — لا أثر خفيّ
    expect(r.data.perPersonRecomputed).toBe(1);
    expect(r.data.personsCount).toBe(1);

    const s = await sub();
    expect(s?.periodAmountIqd).toBe(PER_PERSON_PRICE);
    expect(s?.quantity).toBe(1);
  });

  it("كل ساكن إضافي يزيد المبلغ بسعر الفرد", async () => {
    await link(residents[1]!);
    expect((await sub())?.periodAmountIqd).toBe(PER_PERSON_PRICE * 2n);

    await link(residents[2]!);
    const s = await sub();
    expect(s?.periodAmountIqd).toBe(PER_PERSON_PRICE * 3n);
    expect(s?.quantity).toBe(3);
  });

  it("والخروج يُنقصه — الاتجاهان سواء", async () => {
    const r = await unlinkResident({ apartmentResidentId: links[links.length - 1]! }, admin);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.perPersonRecomputed).toBe(1);

    expect((await sub())?.periodAmountIqd).toBe(PER_PERSON_PRICE * 2n);
  });

  it("⚠️ **اللقطة السعرية لا تُمسّ** — تغيّر العدد لا السعر", async () => {
    /**
     * إعادة كتابة `unitPriceSnapshotIqd` هنا كانت ستُخفي تغييرَ سعر
     * حقيقياً وقع بين الربطين — وهو ما يحرسه `R23`.
     */
    const s = await sub();
    expect(s?.unitPriceSnapshotIqd).toBe(PER_PERSON_PRICE);
  });
});

// ═══════════════════════════════════════════════════════════════════════

describe("ما لا يُمسّ", () => {
  it("اشتراك `FLAT` لا يتأثّر بعدد السكان إطلاقاً", async () => {
    const flat = await prisma.subscription.findUnique({ where: { id: FLAT_SUB } });
    expect(flat?.periodAmountIqd).toBe(60_000n);
    expect(flat?.quantity).toBe(1);
  });

  it("والاشتراك الملغى تاريخٌ لا يُعاد حسابه", async () => {
    await client.query(`update "Subscription" set status = 'CANCELLED' where id = $1`, [SUB]);
    const before = await sub();

    await link(residents[2]!); // ربط من جديد

    const after = await sub();
    expect(after?.periodAmountIqd).toBe(before?.periodAmountIqd);
    await client.query(`update "Subscription" set status = 'ACTIVE' where id = $1`, [SUB]);
  });
});

// ═══════════════════════════════════════════════════════════════════════

describe("🔴 Q5 لا يكسر Q45 — المؤشّر يقرأ رقماً حيّاً", () => {
  it("«الإيراد الشهري المتوقّع» يتبع تغيّر الأسرة فوراً", async () => {
    /**
     * ⚠️ **هذا هو الاختبار الذي يربط القرارين.**
     * لو أُعيد الحساب عند الفوترة وحدها، لبقي هذا الرقم كما هو حتى
     * الدورة القادمة — والمالك يقرأه ليقرّر.
     */
    // نضبط حالة معلومة: نُخرج الجميع ثم نربط اثنين
    await client.query(
      `update "ApartmentResident" set "isActive" = false, "movedOutAt" = now()
        where "apartmentId" = $1 and "isActive"`,
      [f.apartmentId],
    );
    await link(residents[0]!);
    await link(residents[1]!);

    const before = await expectedMonthlyRevenue(SVC);
    expect(before).toBe(PER_PERSON_PRICE * 2n);

    // ساكن ثالث ينضمّ
    await link(residents[2]!);

    const after = await expectedMonthlyRevenue(SVC);
    expect(after).toBe(PER_PERSON_PRICE * 3n);
    expect(after - before).toBe(PER_PERSON_PRICE);
  });
});
