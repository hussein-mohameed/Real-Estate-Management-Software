import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { cleanupTestData, connection, createFixture, type Fixture } from "./helpers";
import { getMyAccount, getMyHome, getMyProfile } from "@/lib/actions/resident-portal";
import { createBuilding } from "@/lib/actions/buildings";
import { activateContract, createContract } from "@/lib/actions/contracts";
import { linkResidentToApartment } from "@/lib/actions/residents";
import { postEntry } from "@/lib/ledger/post-entry";
import type { ActorContext } from "@/lib/actions/define-action";
import { prisma } from "@/lib/prisma";

/**
 * بوّابة الساكن — **اختبار عزل قبل أن يكون اختبار عرض**.
 *
 * العيب الذي يحرسه هذا الملف لا يظهر في أي شاشة: الساكن الذي يرى بيانات
 * ليست له **لا يشتكي**. فالتحقّق الوحيد الممكن هو اختبار يصرّح بما يجب
 * ألّا يُرى.
 *
 * ثلاثة حدود تُختبَر:
 *   1. بين شقة وشقة — ساكن لا يرى وحدة جاره.
 *   2. **داخل الوحدة نفسها** — فردُ الأسرة يرى بيته ولا يرى رصيد صاحب
 *      العقد. تسريب مالي داخل البيت لا يقلّ عن التسريب بين البيوت.
 *   3. تبديل المعرّف في العنوان — حسابُ غيري يجب أن يبدو **غير موجود**،
 *      لا «ممنوع»، وإلا صار الفرق أداةَ استكشاف.
 */

let client: Client;
let f: Fixture;
let admin: ActorContext;
let buildingId = "";
const aptIds: string[] = [];

const HOLDER = "itest_rp_holder";
const FAMILY = "itest_rp_family";
const STRANGER = "itest_rp_stranger";

let holderAccountId = "";
let strangerAccountId = "";

const as = (userId: string): ActorContext => ({ userId, role: "RESIDENT" });

beforeAll(async () => {
  client = connection();
  await client.connect();
  await cleanupTestData(client);
  f = await createFixture(client, "rp");
  admin = { userId: f.roleUsers.ADMIN, role: "ADMIN", ip: "10.0.0.11", userAgent: "vitest" };

  const b = await createBuilding(
    {
      code: "ITrpt",
      floorsCount: 1,
      unitsPerFloor: 3,
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

  for (const [id, name, phone] of [
    [HOLDER, "صاحب العقد للاختبار", "+9647701230001"],
    [FAMILY, "فرد الأسرة للاختبار", "+9647701230002"],
    [STRANGER, "ساكن الشقة الأخرى", "+9647701230003"],
  ] as const) {
    await client.query(
      `insert into "User" (id,"fullName",phone,role,"isActive","updatedAt")
       values ($1,$2,$3,'RESIDENT',true,now())`,
      [id, name, phone],
    );
  }

  // الوحدة 0: صاحب عقد + فرد أسرة
  await linkResidentToApartment(
    { apartmentId: aptIds[0], userId: HOLDER, relationType: "OTHER", isContractHolder: true },
    admin,
  );
  await linkResidentToApartment(
    { apartmentId: aptIds[0], userId: FAMILY, relationType: "FAMILY_MEMBER", isContractHolder: false },
    admin,
  );
  // الوحدة 1: ساكن آخر تماماً
  await linkResidentToApartment(
    { apartmentId: aptIds[1], userId: STRANGER, relationType: "OTHER", isContractHolder: true },
    admin,
  );

  holderAccountId = await makeActiveContract(aptIds[0]!, HOLDER, 1_000_000n);
  strangerAccountId = await makeActiveContract(aptIds[1]!, STRANGER, 250_000n);
}, 180_000);

async function makeActiveContract(
  apartmentId: string,
  holderUserId: string,
  chargeIqd: bigint,
): Promise<string> {
  const c = await createContract(
    {
      apartmentId,
      holderUserId,
      type: "SALE",
      startDate: new Date(),
      totalAmountIqd: 40_000_000n,
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
    amountIqd: chargeIqd,
    descriptionAr: "رسم اختبار",
    reason: "تهيئة رصيد لاختبار عزل البوّابة",
    createdByUserId: admin.userId,
  });

  return a.data.accountId;
}

afterAll(async () => {
  /*
   * ⚠️ **المحفِّزان معاً.** الفاتورة محميّة من الحذف بمحفِّزها هي (‏R35)،
   * وتعطيلُ محفِّز الدفتر وحده يجعل حذف الفواتير يفشل — فيتوقّف التفكيك في
   * منتصفه، ويبقى رمز البناية مستخدَماً، فيفشل **التشغيل القادم** في
   * تهيئته برسالة لا تشير إلى سببها.
   */
  await client.query(`ALTER TABLE "LedgerEntry" DISABLE TRIGGER USER`);
  await client.query(`ALTER TABLE "Invoice" DISABLE TRIGGER USER`);
  try {
    await client.query(
      `delete from "LedgerEntry" where "accountId" in
         (select id from "Account" where "apartmentId" = any($1))`,
      [aptIds],
    );
    /*
     * ⚠️ **الفاتورة ثم الدفعة ثم الحساب** — بهذا الترتيب.
     * `Invoice.paymentId` و`Payment.accountId` مفتاحان أجنبيان حقيقيان،
     * وحذفُ الحساب أولاً يفشل. وفشلُ التفكيك **لا يُفشل الاختبارات** —
     * يُلوّث القاعدة فقط، فيظهر العيب في ملفٍّ آخر بعد حين ولا يُنسب إلى
     * سببه. حدث هذا مرّتين في هذا المشروع.
     */
    await client.query(
      `delete from "Invoice" where "accountId" in
         (select id from "Account" where "apartmentId" = any($1))`,
      [aptIds],
    );
    await client.query(
      `delete from "Payment" where "accountId" in
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
    await client.query(`ALTER TABLE "Invoice" ENABLE TRIGGER USER`);
  }
  await cleanupTestData(client);
  await client.end();
  await prisma.$disconnect();
}, 120_000);

// ═══════════════════════════════════════════════════════════════════════

describe("getMyHome — الحدّ بين الشقق", () => {
  it("صاحب العقد يرى وحدته وحسابه", async () => {
    const r = await getMyHome({}, as(HOLDER));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.data.apartments).toHaveLength(1);
    expect(r.data.apartments[0]!.id).toBe(aptIds[0]);
    expect(r.data.accounts).toHaveLength(1);
    expect(r.data.accounts[0]!.balanceIqd).toBe(1_000_000n);
  });

  it("**ولا يرى وحدة جاره ولا حسابه**", async () => {
    const r = await getMyHome({}, as(HOLDER));
    if (!r.ok) return;

    const ids = r.data.apartments.map((a) => a.id);
    expect(ids).not.toContain(aptIds[1]);

    const accountIds = r.data.accounts.map((a) => a.id);
    expect(accountIds).not.toContain(strangerAccountId);
  });

  it("الساكن الآخر يرى وحدته هو لا وحدة الأول", async () => {
    const r = await getMyHome({}, as(STRANGER));
    if (!r.ok) return;
    expect(r.data.apartments.map((a) => a.id)).toEqual([aptIds[1]]);
    expect(r.data.accounts[0]!.balanceIqd).toBe(250_000n);
  });
});

describe("getMyHome — الحدّ **داخل** الوحدة الواحدة", () => {
  it("فرد الأسرة يرى الوحدة وأفرادها", async () => {
    const r = await getMyHome({}, as(FAMILY));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.data.apartments.map((a) => a.id)).toEqual([aptIds[0]]);
    // يرى صاحب العقد بين أفراد الوحدة — هذا مقصود
    const names = r.data.apartments[0]!.residents.map((x) => x.user.id);
    expect(names).toContain(HOLDER);
  });

  it("⚠️ **ولا يرى رصيد صاحب العقد ولا دفتره**", async () => {
    const r = await getMyHome({}, as(FAMILY));
    if (!r.ok) return;

    // لا حساب على اسمه ← لا رصيد ولا قيود إطلاقاً
    expect(r.data.accounts).toHaveLength(0);

    // وفحص شامل: لا يظهر أي مبلغ في الحمولة كلها
    const payload = JSON.stringify(r.data, (_k, v) =>
      typeof v === "bigint" ? v.toString() : v,
    );
    expect(payload).not.toContain("1000000");
  });
});

describe("getMyAccount — تبديل المعرّف في العنوان", () => {
  it("صاحب العقد يفتح كشفه", async () => {
    const r = await getMyAccount({ accountId: holderAccountId }, as(HOLDER));
    expect(r.ok).toBe(true);
    if (!r.ok || r.data === null) throw new Error("توقّعنا كشفاً");
    expect(r.data.account.balanceIqd).toBe(1_000_000n);
    expect(r.data.entries.length).toBeGreaterThan(0);
  });

  it("**حساب الجار يبدو غير موجود — لا «ممنوع»**", async () => {
    const r = await getMyAccount({ accountId: strangerAccountId }, as(HOLDER));
    expect(r.ok).toBe(true); // ليس خطأ ترخيص
    if (!r.ok) return;
    expect(r.data).toBeNull();
  });

  it("ومعرّف مختلَق يعطي الجواب نفسه بالضبط", async () => {
    const real = await getMyAccount({ accountId: strangerAccountId }, as(HOLDER));
    const fake = await getMyAccount({ accountId: "itest_rp_does_not_exist" }, as(HOLDER));
    expect(real.ok).toBe(fake.ok);
    if (real.ok && fake.ok) expect(real.data).toEqual(fake.data);
  });

  it("فرد الأسرة لا يفتح كشف صاحب العقد بمعرّفه", async () => {
    const r = await getMyAccount({ accountId: holderAccountId }, as(FAMILY));
    if (!r.ok) return;
    expect(r.data).toBeNull();
  });
});

describe("Q41 — الموظف المقيم", () => {
  it("يصل إلى البوّابة بنطاق سكنه لا بدوره", async () => {
    await linkResidentToApartment(
      {
        apartmentId: aptIds[2],
        userId: f.roleUsers.STAFF,
        relationType: "OTHER",
        isContractHolder: false,
      },
      admin,
    );

    const r = await getMyHome({}, { userId: f.roleUsers.STAFF, role: "STAFF" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.apartments.map((a) => a.id)).toEqual([aptIds[2]]);
  });
});

describe("حالة الفراغ", () => {
  it("ساكن بلا ارتباط سكن يحصل على نتيجة فارغة لا خطأ", async () => {
    const r = await getMyHome({}, as(f.roleUsers.RESIDENT));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.apartments).toEqual([]);
    expect(r.data.accounts).toEqual([]);
  });

  it("بلا جلسة يُرفض", async () => {
    const r = await getMyHome({}, null);
    expect(r.ok).toBe(false);
  });
});

describe("getMyProfile — الخصوصية والحدّ", () => {
  it("يعيد بيانات المستخدم نفسه", async () => {
    const r = await getMyProfile({}, as(HOLDER));
    expect(r.ok).toBe(true);
    if (!r.ok || r.data === null) throw new Error("توقّعنا ملفاً");
    expect(r.data.id).toBe(HOLDER);
    expect(r.data.fullName).toBe("صاحب العقد للاختبار");
  });

  it("⚠️ **لا يُخرج روابط صور الهوية وبطاقة السكن**", async () => {
    // رابط ملف خاص بلا توقيع يصير عاماً لمن يحصل عليه. الاستثناء في
    // `select` لا في العرض: الترشيح في العرض يُنسى، والاستثناء لا يُنسى.
    const r = await getMyProfile({}, as(HOLDER));
    if (!r.ok || r.data === null) return;

    const payload = JSON.stringify(r.data);
    expect(payload).not.toContain("nationalIdImageUrl");
    expect(payload).not.toContain("residenceCardImageUrl");
  });

  it("لا يعيد بيانات مستخدم آخر مهما كان المُدخل", async () => {
    // ‏getMyProfile لا يقبل معرّفاً أصلاً — الهوية من الجلسة وحدها.
    const r = await getMyProfile({}, as(FAMILY));
    if (!r.ok || r.data === null) return;
    expect(r.data.id).toBe(FAMILY);
    expect(r.data.id).not.toBe(HOLDER);
  });
});

/**
 * ── فواتير كشف الحساب — الخطوة 3.1 ──────────────────────────────────
 *
 * ⚠️ الفواتير تُعاد من **داخل** `getMyAccount` لا من إجراء ثانٍ، فشرط
 * الملكية واحد لا اثنان. وهذا الاختبار يحرس ما يترتّب على ذلك: أن
 * الفواتير تتبع الحساب المطلوب لا كل حسابات النظام.
 *
 * والعيب الذي يحرسه **لا يشتكي منه أحد**: من يرى فواتير جاره لا يُبلّغ.
 */
describe("فواتير كشف الحساب", () => {
  async function invoiceFor(accountId: string, number: string, totalIqd: bigint) {
    const payment = await prisma.payment.create({
      data: {
        accountId,
        amountIqd: totalIqd,
        /*
         * ⚠️ **لا `CASH_AT_CENTER` هنا**: قيد `payment_cash_needs_drawer`
         * يوجب جلسة صندوق لكل دفعة نقدية (‏B4)، وهو يعمل — رفض هذا السطر
         * فعلاً. وهذا الاختبار عن **عزل الفواتير** لا عن النقد، فبناءُ
         * جلسة صندوق وأمين صندوق فيه ضجيجٌ يخفي ما يُفحص.
         */
        method: "WAYL_LINK",
        status: "PAID",
        purpose: "MANUAL",
        /* ⚠️ `referenceId` فريد على الجدول — فرقم الفاتورة يصلح مفتاحاً */
        referenceId: `ref-${number}`,
        paidAt: new Date(),
      },
      select: { id: true },
    });
    await prisma.invoice.create({
      data: {
        number,
        paymentId: payment.id,
        accountId,
        totalIqd,
        lines: [{ label: "دفعة على الحساب", amountIqd: String(totalIqd) }],
        /* ⚠️ يُملأ عمداً كي يُثبت الاختبار أنه **لا يعبر** إلى الساكن */
        pdfUrl: "https://internal.example/secret.pdf",
      },
    });
  }

  it("يرى فواتير حسابه هو، بأحدثها أولاً", async () => {
    await invoiceFor(holderAccountId, "itest-INV-A-1", 100_000n);
    await invoiceFor(holderAccountId, "itest-INV-A-2", 250_000n);

    const r = await getMyAccount({ accountId: holderAccountId }, as(HOLDER));
    if (!r.ok || r.data === null) throw new Error("توقّعنا كشفاً");

    expect(r.data.invoices.map((i) => i.number)).toEqual([
      "itest-INV-A-2",
      "itest-INV-A-1",
    ]);
    expect(r.data.invoices[0]?.totalIqd).toBe(250_000n);
  });

  it("⚠️ لا يرى فاتورة حساب الجار", async () => {
    await invoiceFor(holderAccountId, "itest-INV-MINE", 100_000n);
    await invoiceFor(strangerAccountId, "itest-INV-THEIRS", 900_000n);

    const r = await getMyAccount({ accountId: holderAccountId }, as(HOLDER));
    if (!r.ok || r.data === null) throw new Error("توقّعنا كشفاً");

    const numbers = r.data.invoices.map((i) => i.number);
    expect(numbers).toContain("itest-INV-MINE");
    expect(numbers, "فاتورة الجار وصلت إلى كشف الساكن").not.toContain(
      "itest-INV-THEIRS",
    );
  });

  it("⚠️ لا يُخرِج `pdfUrl` ولا `lines`", async () => {
    /*
     * رابطٌ لملفّ خاص بلا توقيع يصير عاماً لمن يحصل عليه، ولقطة البنود قد
     * تحمل تفاصيل لا يعرضها هذا الجدول. والاستثناء من `select` لا يُنسى؛
     * الترشيح في طبقة العرض يُنسى.
     */
    await invoiceFor(holderAccountId, "itest-INV-SHAPE", 40_000n);

    const r = await getMyAccount({ accountId: holderAccountId }, as(HOLDER));
    if (!r.ok || r.data === null) throw new Error("توقّعنا كشفاً");

    const invoice = r.data.invoices.find((i) => i.number === "itest-INV-SHAPE");
    expect(invoice).toBeDefined();
    expect(Object.keys(invoice ?? {}).sort()).toEqual([
      "id",
      "issuedAt",
      "number",
      "totalIqd",
    ]);
  });
});
