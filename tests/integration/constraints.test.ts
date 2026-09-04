import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * اختبار التكامل الأول (الخطوة `N1`).
 *
 * ── لماذا هذا الاختبار موجود ─────────────────────────────────────────
 * الثوابت المالية **لا تُختبر على وهميات**. سباق تزامن لا يظهر في mock،
 * وفهرس فريد جزئي لا معنى له خارج Postgres، وtrigger لا وجود له إلا في
 * المحرّك. فكل ما هنا يعمل على **قاعدة حقيقية**.
 *
 * ── العزل ────────────────────────────────────────────────────────────
 * كل اختبار داخل معاملة تُلغى (`ROLLBACK`) في نهايته، فلا يترك أثراً.
 * وعند خرق قيد داخل معاملة يصير الاتصال في حالة خطأ، فنستعمل
 * `SAVEPOINT` لاستئناف العمل بعد كل محاولة فاشلة متوقَّعة.
 */

const url = process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"];

const client = new Client({ connectionString: url, connectionTimeoutMillis: 20000 });

/** ينفّذ استعلاماً يُتوقَّع فشله، ويعيد رسالة الخطأ. */
async function expectRejection(sql: string, params: unknown[] = []): Promise<string> {
  await client.query("SAVEPOINT sp");
  try {
    await client.query(sql, params);
    await client.query("RELEASE SAVEPOINT sp");
    throw new Error("لم يُرفض! القيد غير مفروض.");
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT sp");
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("لم يُرفض")) throw error;
    return message;
  }
}

// مُعرّفات ثابتة داخل المعاملة المُلغاة
const ids = {
  owner: "test_owner_1",
  holder: "test_holder_1",
  building: "test_bld_1",
  apartment: "test_apt_1",
  contract: "test_ctr_1",
  account: "test_acc_1",
  vehicle: "test_veh_1",
};

beforeAll(async () => {
  await client.connect();
  await client.query("BEGIN");

  // ⚠️ مالك المُثبِّت **غير نشط** عمداً: يوجد مالك نشط حقيقي في النظام،
  // وR1 يمنع الثاني. الاختبار يحتاج صفّ User لإرضاء المفاتيح الأجنبية
  // لا حالةً نشطة. اصطدام سابق بهذا كشف أن القيد يعمل على بيانات حقيقية.
  await client.query(
    `insert into "User" (id, "fullName", phone, role, "isActive", "updatedAt")
     values ($1,'مالك الاختبار','+9647000000001','OWNER',false,now()),
            ($2,'صاحب عقد','+9647000000002','RESIDENT',true,now())`,
    [ids.owner, ids.holder],
  );
  await client.query(
    `insert into "Building" (id, code, "floorsCount", "unitsPerFloor", "numberingScheme",
                             "displayNumberFormat", "constructionStatus", "updatedAt")
     values ($1,'TEST',5,4,'SEQUENTIAL','{building}-{floor}-{unit}','UNDER_CONSTRUCTION',now())`,
    [ids.building],
  );
  await client.query(
    `insert into "Apartment" (id, "buildingId", "floorNumber", "unitNumber", "displayNumber",
                              "constructionStatus", "ownershipStatus", "occupancyStatus", "updatedAt")
     values ($1,$2,1,1,'TEST-1-1','COMPLETED','SOLD','VACANT',now())`,
    [ids.apartment, ids.building],
  );
  await client.query(
    `insert into "Contract" (id, "contractNumber", "apartmentId", "holderUserId", type, status,
                             "startDate", "updatedAt")
     values ($1,'CTR-TEST-1',$2,$3,'SALE','ACTIVE',now(),now())`,
    [ids.contract, ids.apartment, ids.holder],
  );
  await client.query(
    `insert into "Account" (id, "contractId", "apartmentId", "holderUserId", status, "balanceIqd", "updatedAt")
     values ($1,$2,$3,$4,'OPEN',0,now())`,
    [ids.account, ids.contract, ids.apartment, ids.holder],
  );
}, 60_000);

afterAll(async () => {
  await client.query("ROLLBACK").catch(() => {});
  await client.end().catch(() => {});
});

describe("الدفتر — append-only مفروض في المحرّك (R29)", () => {
  it("يقبل قيداً سليماً", async () => {
    const r = await client.query(
      `insert into "LedgerEntry" (id,"accountId",type,source,"amountIqd","descriptionAr")
       values ('le_ok',$1,'CHARGE','SUBSCRIPTION',75000,'اشتراك المولدة - 5 أمبير') returning id`,
      [ids.account],
    );
    expect(r.rows).toHaveLength(1);
  });

  it("**يرفض تعديل** قيد — حتى من psql (‏trigger لا اصطلاح)", async () => {
    const msg = await expectRejection(
      `update "LedgerEntry" set "amountIqd" = 1 where id = 'le_ok'`,
    );
    expect(msg).toContain("append-only");
  });

  it("**يرفض حذف** قيد", async () => {
    const msg = await expectRejection(`delete from "LedgerEntry" where id = 'le_ok'`);
    expect(msg).toContain("append-only");
  });

  it("يرفض مبلغاً صفراً أو سالباً (‏D2/3)", async () => {
    for (const amount of [0, -1]) {
      const msg = await expectRejection(
        `insert into "LedgerEntry" (id,"accountId",type,source,"amountIqd","descriptionAr")
         values ('le_bad',$1,'CHARGE','SUBSCRIPTION',$2,'مبلغ غير صالح')`,
        [ids.account, amount],
      );
      expect(msg).toContain("ledger_amount_positive");
    }
  });

  it("يرفض قيد MANUAL بلا سبب (‏D2/1)", async () => {
    const msg = await expectRejection(
      `insert into "LedgerEntry" (id,"accountId",type,source,"amountIqd","descriptionAr")
       values ('le_manual',$1,'CHARGE','MANUAL',5000,'تسوية بلا سبب')`,
      [ids.account],
    );
    expect(msg).toContain("ledger_manual_needs_reason");
  });

  it("يقبل قيد MANUAL مع سبب", async () => {
    const r = await client.query(
      `insert into "LedgerEntry" (id,"accountId",type,source,"amountIqd","descriptionAr",reason)
       values ('le_manual_ok',$1,'PAYMENT','MANUAL',5000,'تسوية','خطأ في قيد سابق') returning id`,
      [ids.account],
    );
    expect(r.rows).toHaveLength(1);
  });
});

describe("‏Q3/V1 — إعادة تشغيل الفوترة لا تُضاعف الإيجار", () => {
  it("قيد إيجار أول لفترة يمرّ", async () => {
    const r = await client.query(
      `insert into "LedgerEntry" (id,"accountId",type,source,"amountIqd","descriptionAr","periodStart")
       values ('le_rent_1',$1,'CHARGE','RENT',500000,'إيجار شهر 8/2026','2026-08-01') returning id`,
      [ids.account],
    );
    expect(r.rows).toHaveLength(1);
  });

  it("**القيد الثاني لنفس الفترة مرفوض** — وهذا ما يمنع مضاعفة إيجار كل مستأجر", async () => {
    const msg = await expectRejection(
      `insert into "LedgerEntry" (id,"accountId",type,source,"amountIqd","descriptionAr","periodStart")
       values ('le_rent_2',$1,'CHARGE','RENT',500000,'إيجار شهر 8/2026','2026-08-01')`,
      [ids.account],
    );
    expect(msg).toContain("uniq_rent_charge_per_period");
  });

  it("قيد افتتاحي ثانٍ لنفس الحساب مرفوض (‏N3)", async () => {
    await client.query(
      `insert into "LedgerEntry" (id,"accountId",type,source,"amountIqd","descriptionAr")
       values ('le_open_1',$1,'CHARGE','OPENING',1200000,'رصيد افتتاحي من الكشف الورقي')`,
      [ids.account],
    );
    const msg = await expectRejection(
      `insert into "LedgerEntry" (id,"accountId",type,source,"amountIqd","descriptionAr")
       values ('le_open_2',$1,'CHARGE','OPENING',900000,'رصيد افتتاحي مكرّر')`,
      [ids.account],
    );
    expect(msg).toContain("uniq_opening_entry_per_account");
  });
});

describe("‏S1/D1 — عقد نشط واحد لكل (شقة + نوع)", () => {
  it("**عقد إيجار نشط يتعايش مع عقد البيع** — «شقة مباعة يسكنها مستأجر»", async () => {
    const r = await client.query(
      `insert into "Contract" (id,"contractNumber","apartmentId","holderUserId",type,status,"startDate","updatedAt")
       values ('ctr_rent','CTR-TEST-2',$1,$2,'RENTAL','ACTIVE',now(),now()) returning id`,
      [ids.apartment, ids.holder],
    );
    expect(r.rows).toHaveLength(1);
  });

  it("عقد بيع نشط **ثانٍ** على نفس الشقة مرفوض", async () => {
    const msg = await expectRejection(
      `insert into "Contract" (id,"contractNumber","apartmentId","holderUserId",type,status,"startDate","updatedAt")
       values ('ctr_dup','CTR-TEST-3',$1,$2,'SALE','ACTIVE',now(),now())`,
      [ids.apartment, ids.holder],
    );
    expect(msg).toContain("uniq_active_contract_per_type");
  });
});

describe("‏R1 — مالك نشط واحد", () => {
  it("مالك نشط ثانٍ مرفوض", async () => {
    /**
     * ── 🔴 الاختبار يُنشئ المالك النشط بنفسه ─────────────────────────
     * كان يقرأ عددهم ويشترط ‏≥1 — أي أنه يستند إلى **مالك البوت‑ستراب في
     * قاعدة التطوير**، وهو بيانٌ لم يُنشئه. فحين عُزلت الاختبارات في
     * مخطّط خاص لم يكن هناك مالك، فسقط على شرطه المسبق لا على ما يفحصه.
     *
     * واختبارٌ يستند إلى بيانات لم يُنشئها **يمرّ لأسباب لا يعرفها** حين
     * توجد. نفس العيب أُصلح في `users.test.ts`.
     */
    await client.query(
      `insert into "User" (id,"fullName",phone,role,"isActive","updatedAt")
       values ('itest_owner_active','مالك نشط للاختبار','+9647000000009','OWNER',true,now())`,
    );

    try {
      const msg = await expectRejection(
        `insert into "User" (id,"fullName",phone,role,"isActive","updatedAt")
         values ('u_owner2','مالك ثانٍ','+9647000000003','OWNER',true,now())`,
      );
      expect(msg).toContain("uniq_active_owner");
    } finally {
      /*
       * ⚠️ يُعطَّل في `finally`: بقاؤه نشطاً يمنع أي اختبار لاحق من إنشاء
       * مالك — والفهرس الجزئي لا يفرّق بين مالكٍ نسيه اختبار وآخر حقيقي.
       */
      await client.query(
        `update "User" set "isActive" = false where id = 'itest_owner_active'`,
      );
    }
  });

  it("مالك **غير نشط** مسموح — التاريخ يبقى", async () => {
    const r = await client.query(
      `insert into "User" (id,"fullName",phone,role,"isActive","updatedAt")
       values ('u_owner_old','مالك سابق','+9647000000004','OWNER',false,now()) returning id`,
    );
    expect(r.rows).toHaveLength(1);
  });
});

describe("‏S7/T1 — الفهارس الجزئية تسمح بما يجب أن يُسمح", () => {
  it("لوحة سيارة أُزيلت **قابلة للتسجيل من جديد**", async () => {
    await client.query(
      `insert into "Vehicle" (id,"apartmentId","plateNumber",status,"updatedAt")
       values ($1,$2,'12345BGD','REMOVED',now())`,
      [ids.vehicle, ids.apartment],
    );
    const r = await client.query(
      `insert into "Vehicle" (id,"apartmentId","plateNumber",status,"updatedAt")
       values ('veh_new',$1,'12345BGD','APPROVED',now()) returning id`,
      [ids.apartment],
    );
    expect(r.rows).toHaveLength(1);
  });

  it("لوحة مكرّرة بين سيارتين **نشطتين** مرفوضة", async () => {
    const msg = await expectRejection(
      `insert into "Vehicle" (id,"apartmentId","plateNumber",status,"updatedAt")
       values ('veh_dup',$1,'12345BGD','PENDING_APPROVAL',now())`,
      [ids.apartment],
    );
    expect(msg).toContain("uniq_active_plate");
  });

  it("شقة محذوفة ناعماً لا تمنع إعادة التوليد (‏T1)", async () => {
    await client.query(
      `update "Apartment" set "deletedAt" = now() where id = $1`,
      [ids.apartment],
    );
    const r = await client.query(
      `insert into "Apartment" (id,"buildingId","floorNumber","unitNumber","displayNumber",
                                "constructionStatus","ownershipStatus","occupancyStatus","updatedAt")
       values ('apt_regen',$1,1,1,'TEST-1-1','UNDER_CONSTRUCTION','UNSOLD','VACANT',now()) returning id`,
      [ids.building],
    );
    expect(r.rows).toHaveLength(1);
  });

  it("**استرجاع الشقة المحذوفة يفشل** ما دام بديلها موجوداً — وهذا صحيح", async () => {
    // بعد إعادة التوليد صار للشقة بديل يحمل نفس (buildingId, floor, unit).
    // استرجاع الأصل يخرق التفريد الجزئي — والرفض هو السلوك المطلوب لا عيباً.
    const msg = await expectRejection(
      `update "Apartment" set "deletedAt" = null where id = $1`,
      [ids.apartment],
    );
    expect(msg).toContain("uniq_apartment_unit_alive");
  });
});

describe("قيود المجال الأخرى", () => {
  it("طلب DONE بلا ملاحظة حلّ مرفوض", async () => {
    const msg = await expectRejection(
      `insert into "ServiceRequest" (id,number,type,"apartmentId",scope,"createdByUserId",
                                     title,description,priority,status,"updatedAt")
       values ('req_bad','REQ-T-1','COMPLAINT',$1,'APARTMENT',$2,'عطل','وصف','NORMAL','DONE',now())`,
      [ids.apartment, ids.holder],
    );
    expect(msg).toContain("request_done_needs_resolution");
  });

  it("شكوى منطقة مشتركة بلا شقة **مسموحة** (‏Q35)", async () => {
    const r = await client.query(
      `insert into "ServiceRequest" (id,number,type,"apartmentId",scope,"createdByUserId",
                                     title,description,priority,status,"updatedAt")
       values ('req_common','REQ-T-2','COMPLAINT',null,'COMMON_AREA',$1,'عطل المصعد','لا يعمل','HIGH','NEW',now())
       returning id`,
      [ids.holder],
    );
    expect(r.rows).toHaveLength(1);
  });

  it("طلب شقة بلا شقة مرفوض", async () => {
    const msg = await expectRejection(
      `insert into "ServiceRequest" (id,number,type,"apartmentId",scope,"createdByUserId",
                                     title,description,priority,status,"updatedAt")
       values ('req_bad2','REQ-T-3','COMPLAINT',null,'APARTMENT',$1,'عطل','وصف','NORMAL','NEW',now())`,
      [ids.holder],
    );
    expect(msg).toContain("request_scope_apartment");
  });

  it("خدمة إلزامية على ساكن مرفوضة (‏V11)", async () => {
    const msg = await expectRejection(
      `insert into "Service" (id,name,"billingType","pricingModel","basePriceIqd",
                              "payerType","isMandatory","isAvailable","appliesTo","updatedAt")
       values ('svc_bad','خدمة إلزامية على ساكن','RECURRING','FLAT',10000,'OCCUPANT',true,true,'RESIDENT',now())`,
    );
    expect(msg).toContain("service_mandatory_not_resident_only");
  });

  it("خدمة PER_UNIT بلا سعر وحدة مرفوضة", async () => {
    const msg = await expectRejection(
      `insert into "Service" (id,name,"billingType","pricingModel","payerType",
                              "isMandatory","isAvailable","appliesTo","updatedAt")
       values ('svc_bad2','مولدة بلا سعر','RECURRING','PER_UNIT','OCCUPANT',false,true,'APARTMENT',now())`,
    );
    expect(msg).toContain("service_pricing_fields");
  });

  it("تقييم خارج 1–5 مرفوض", async () => {
    const msg = await expectRejection(
      `insert into "ServiceRequest" (id,number,type,"apartmentId",scope,"createdByUserId",
                                     title,description,priority,status,"ratedStars","updatedAt")
       values ('req_bad3','REQ-T-4','COMPLAINT',$1,'APARTMENT',$2,'ع','و','NORMAL','NEW',9,now())`,
      [ids.apartment, ids.holder],
    );
    expect(msg).toContain("request_rating_range");
  });
});
