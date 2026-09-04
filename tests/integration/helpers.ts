import { Client } from "pg";

/*
 * ⚠️ **لا تحميل للبيئة هنا.** كان في هذا الموضع `loadEnv(…)`، وESM يُقيّم
 * كل `import` قبل أي عبارة في جسم الوحدة — فكان يعمل **بعد** استيراد
 * `@/lib/prisma` في ملفّ الاختبار، وترتيبُ ذلك يتغيّر بتغيّر ترتيب
 * الاستيرادات. صار في `setup-env.ts` عبر `setupFiles`، فيعمل قبل كل شيء
 * دائماً — **ويرفض** التشغيل على مخطّط التطوير.
 */

/**
 * مساعدات اختبارات التكامل التي تحتاج **بيانات ملتزَمة فعلاً**.
 *
 * ── لماذا لا تكفي معاملة تُلغى ────────────────────────────────────────
 * اختبار التزامن يحتاج معاملات **متوازية حقيقية** تتنافس على القفل. لو
 * جرت كلها داخل معاملة واحدة لما تنافست على شيء، ولمرّ الاختبار على نظام
 * معطوب. فالبيانات هنا تُلتزَم، ويجب تنظيفها بعدها.
 *
 * ── مشكلة التنظيف ────────────────────────────────────────────────────
 * `LedgerEntry` محميّ بـtrigger يرفض الحذف (‏R29) — وهذا مقصود ويجب أن
 * يبقى. فالتنظيف يعطّل الـtrigger **مؤقتاً** ثم يعيده فوراً.
 * هذا امتياز اختبار لا ثغرة إنتاج: يتطلّب ملكية الجدول، ولا يمرّ إلا من
 * هذا الملف، ويعيد الحماية في `finally` مهما حدث.
 */

const TEST_PREFIX = "itest_";

export function testId(name: string): string {
  return `${TEST_PREFIX}${name}`;
}

export function connection(): Client {
  const url = process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"];

  /**
   * ── ⚠️ `search_path` صريحاً — و`?schema=` في الرابط لا يكفي ─────────
   * `schema` معامل خاصّ بـPrisma؛ `node-postgres` **يتجاهله تماماً**.
   * فبلا هذا السطر تكتب الاستعلامات الخام في `public` (بيانات التطوير)
   * بينما Prisma يكتب في مخطّط الاختبار — أي أن نصف الاختبار في مكان
   * ونصفه في آخر، وبعضُه يمرّ فيبدو الإعداد سليماً.
   *
   * والحارس في `setup-env.ts` يضمن أن `DB_SCHEMA` مضبوط وليس `public`،
   * فالاحتياط هنا للاسم لا لوجوده.
   */
  const schema = process.env["DB_SCHEMA"] ?? "public";
  if (!/^[a-z][a-z0-9_]{0,40}$/.test(schema)) {
    throw new Error(`اسم مخطّط غير صالح في DB_SCHEMA: «${schema}»`);
  }

  return new Client({
    connectionString: url,
    connectionTimeoutMillis: 20000,
    options: `-c search_path=${schema}`,
  });
}

export interface Fixture {
  /** مستخدم حقيقي لكل دور — AuditLog.actorUserId مفتاح أجنبي فعلي. */
  roleUsers: Record<"OWNER"|"ADMIN"|"STAFF"|"RESIDENT", string>;
  ownerId: string;
  holderId: string;
  buildingId: string;
  apartmentId: string;
  contractId: string;
  accountId: string;
}

/** يُنشئ الحد الأدنى الصالح: مستخدم ← بناية ← شقة ← عقد ← حساب. */
export async function createFixture(client: Client, suffix: string): Promise<Fixture> {
  const roleUsers = {
    OWNER: testId(`u_owner_${suffix}`),
    ADMIN: testId(`u_admin_${suffix}`),
    STAFF: testId(`u_staff_${suffix}`),
    RESIDENT: testId(`u_resident_${suffix}`),
  } as const;

  const f: Fixture = {
    roleUsers,
    ownerId: testId(`owner_${suffix}`),
    holderId: testId(`holder_${suffix}`),
    buildingId: testId(`bld_${suffix}`),
    apartmentId: testId(`apt_${suffix}`),
    contractId: testId(`ctr_${suffix}`),
    accountId: testId(`acc_${suffix}`),
  };

  await client.query(
    `insert into "User" (id,"fullName",phone,role,"isActive","updatedAt")
     values ($1,'صاحب عقد للاختبار',$2,'RESIDENT',true,now())`,
    [f.holderId, `+96470${suffix.padStart(8, "0").slice(0, 8)}`],
  );
  await client.query(
    `insert into "Building" (id,code,"floorsCount","unitsPerFloor","numberingScheme",
                             "displayNumberFormat","constructionStatus","updatedAt")
     values ($1,$2,5,4,'SEQUENTIAL','{building}-{floor}-{unit}','COMPLETED',now())`,
    [f.buildingId, `IT${suffix}`],
  );
  await client.query(
    `insert into "Apartment" (id,"buildingId","floorNumber","unitNumber","displayNumber",
                              "constructionStatus","ownershipStatus","occupancyStatus","updatedAt")
     values ($1,$2,1,1,$3,'COMPLETED','SOLD','OCCUPIED_BY_OWNER',now())`,
    [f.apartmentId, f.buildingId, `IT${suffix}-1-1`],
  );
  await client.query(
    `insert into "Contract" (id,"contractNumber","apartmentId","holderUserId",type,status,"startDate","updatedAt")
     values ($1,$2,$3,$4,'SALE','ACTIVE',now(),now())`,
    [f.contractId, `CTR-IT-${suffix}`, f.apartmentId, f.holderId],
  );
  await client.query(
    `insert into "Account" (id,"contractId","apartmentId","holderUserId",status,"balanceIqd","updatedAt")
     values ($1,$2,$3,$4,'OPEN',0,now())`,
    [f.accountId, f.contractId, f.apartmentId, f.holderId],
  );

  // مستخدم لكل دور. المالك غير نشط تفادياً لخرق قيد «مالك نشط واحد»
  // مع مُثبِّتات أخرى تعمل بالتوازي — الترخيص يقرأ الدور لا العلم.
  let i = 0;
  for (const [role, id] of Object.entries(roleUsers)) {
    i += 1;
    await client.query(
      `insert into "User" (id,"fullName",phone,role,"isActive","updatedAt")
       values ($1,$2,$3,$4::"UserRole",$5,now())`,
      [id, `مستخدم ${role}`, `+9647${String(i).padStart(2,"0")}${suffix.slice(0,6).padEnd(6,"0")}`, role, role !== "OWNER"],
    );
  }

  return f;
}

/**
 * يمسح **كل** ما يبدأ بـ`itest_` — بالترتيب العكسي للاعتماد.
 *
 * ⚠️ يعطّل حماية الدفتر مؤقتاً. الحماية تعود في `finally` مهما حدث،
 * ويتحقّق `assertLedgerProtected()` من عودتها فعلاً بعد كل جولة.
 */
export async function cleanupTestData(client: Client): Promise<void> {
  try {
    await client.query(`ALTER TABLE "LedgerEntry" DISABLE TRIGGER USER`);
    await client.query(`ALTER TABLE "Invoice" DISABLE TRIGGER USER`);

    /**
     * ⚠️ **الحذف بالمعرّف وحده لا يكفي.** الصفوف التي يولّد `cuid()` معرّفها
     * — القيود والفواتير والدفعات — لا تحمل بادئة الاختبار، فتبقى وتمنع
     * حذف ما تشير إليه بمفتاح أجنبي. لذلك لكل جدول **مُحدِّده الصريح**،
     * والترتيب عكس الاعتماد: الابن قبل الأب دائماً.
     */
    /*
     * ⚠️ **حسابات الاختبار لا تُطابَق بمعرّفها وحده.**
     * ما يُنشئه `createContract`/`activateContract` يحمل `cuid()` لا بادئة
     * الاختبار — فالمُحدِّد `"accountId" LIKE $1` كان **لا يُطابق شيئاً**
     * منها أبداً. وكل ملفّ يُنشئ حساباً بهذا الطريق اضطرّ إلى تفكيكٍ
     * خاصّ به، وأولُ فشل في ذلك التفكيك لوّث القاعدة لملفّ آخر.
     *
     * والصاحب هو المُحدِّد الصحيح: `holderUserId` **يحمل** البادئة لأن
     * المستخدم يُنشأ بمعرّف صريح.
     */
    const TEST_ACCOUNTS = `(SELECT id FROM "Account" WHERE "id" LIKE $1 OR "holderUserId" LIKE $1)`;

    /**
     * ── 🔴 بنايات الاختبار لا يصل إليها `$1` ──────────────────────────
     * `createBuilding` يولّد `cuid()`، فلا تحمل البناية بادئة `itest_`
     * ولا شققها. وكان كل ملفّ يحذف بنايته في `afterAll` بمعرّفها — فإن
     * انقطع التشغيل، أو رمى التفكيك، بقيت البناية **وأفشلت التشغيل
     * التالي** برسالة «الرمز مستخدم» لا تشير إلى سببها.
     *
     * حدث ذلك أربع مرّات في يوم واحد، وكان علاجه سكربت تنظيف يدوياً
     * أتذكّره أنا. والمُنظِّف يجب أن يُشفي نفسه.
     *
     * والمُحدِّد هو **رمز البناية**: كل رموز الاختبار تبدأ بـ`IT`، ويحرس
     * ذلك `tests/unit/test-data-naming.test.ts`.
     */
    const TEST_BUILDINGS = `(SELECT id FROM "Building" WHERE code LIKE 'IT%')`;
    const TEST_APARTMENTS = `(SELECT id FROM "Apartment" WHERE "buildingId" IN ${TEST_BUILDINGS})`;

    const order: Array<[table: string, predicate: string]> = [
      ["LedgerEntry", `"accountId" LIKE $1 OR "accountId" IN ${TEST_ACCOUNTS}`],
      ["Invoice", `"accountId" LIKE $1 OR "accountId" IN ${TEST_ACCOUNTS}`],
      /*
       * ⚠️ **الخطة تحمل `cuid` لا بادئة الاختبار.**
       * `createInstallmentPlan` يولّدها، فمُحدِّد `"planId" LIKE $1` كان
       * **لا يُطابق شيئاً** — فتبقى الأقساط وتمنع حذف خطّتها بمفتاح أجنبي.
       * نفس عائلة العيب الذي أصاب الحسابات والعقود والبنايات.
       *
       * والمُحدِّد الصحيح هو **العقد**: معرّفه صريح في الفكسچر.
       */
      [
        "Installment",
        `"planId" LIKE $1
           OR "planId" IN (SELECT id FROM "InstallmentPlan" WHERE "contractId" LIKE $1)`,
      ],
      ["InstallmentPlan", `"contractId" LIKE $1`],
      ["Payment", `"accountId" LIKE $1 OR "accountId" IN ${TEST_ACCOUNTS}`],
      /*
       * ⚠️ **بعد `Payment` لا قبله**: `Payment.cashDrawerSessionId` يشير
       * إليها. وأُضيفت مع جدول B4 — نسيتُها أولاً فتعذّر حذف المستخدمين
       * بمفتاح أجنبي وفشلت سبعة عشر اختباراً في التهيئة.
       *
       * ⚠️ **ولا شيء يفرض تحديث هذه القائمة عند إضافة جدول.** كل موديل
       * جديد يشير إلى `User` أو `Account` يجب أن يُضاف هنا، وإلا انهار
       * التنظيف عند أول اختبار يستعمله.
       */
      ["CashDrawerSession", `"staffUserId" LIKE $1 OR "closedByUserId" LIKE $1`],
      [
        "Subscription",
        `"apartmentId" LIKE $1 OR "residentUserId" LIKE $1
           OR "accountId" LIKE $1 OR "accountId" IN ${TEST_ACCOUNTS}`,
      ],
      ["Badge", `"vehicleId" LIKE $1`],
      ["Vehicle", `"apartmentId" LIKE $1`],
      ["RequestComment", `"requestId" LIKE $1 OR "authorUserId" LIKE $1`],
      ["ServiceRequest", `"apartmentId" LIKE $1 OR "createdByUserId" LIKE $1`],
      ["ResidentRequest", `"createdByUserId" LIKE $1`],
      ["Attachment", `"apartmentId" LIKE $1 OR "contractId" LIKE $1 OR "uploadedByUserId" LIKE $1`],
      ["Notification", `"userId" LIKE $1`],
      // ⚠️ التدقيق كان غائباً عن هذه القائمة، فبقيت صفوف الاختبار للأبد.
      // وحذف المستخدم لا يفشل بل يضبط actorUserId على NULL (‏SetNull هو
      // الافتراضي في Prisma للعلاقات الاختيارية) — فتصير الصفوف يتيمة
      // ويصعب تمييزها لاحقاً. تُحذف بمعرّف الكيان لا بالفاعل.
      ["AuditLog", `"entityId" LIKE $1 OR "actorUserId" LIKE $1`],
      [
        "Account",
        `"id" LIKE $1 OR "contractId" LIKE $1 OR "holderUserId" LIKE $1
           OR "apartmentId" IN ${TEST_APARTMENTS}`,
      ],
      [
        "Contract",
        `"id" LIKE $1 OR "apartmentId" LIKE $1 OR "holderUserId" LIKE $1
           OR "apartmentId" IN ${TEST_APARTMENTS}`,
      ],
      [
        "ApartmentResident",
        `"apartmentId" LIKE $1 OR "userId" LIKE $1
           OR "apartmentId" IN ${TEST_APARTMENTS}`,
      ],
      ["Apartment", `"id" LIKE $1 OR "buildingId" LIKE $1 OR "buildingId" IN ${TEST_BUILDINGS}`],
      ["FloorUnitsOverride", `"buildingId" LIKE $1 OR "buildingId" IN ${TEST_BUILDINGS}`],
      ["Building", `"id" LIKE $1 OR code LIKE 'IT%'`],
      ["StaffSkill", `"staffProfileId" LIKE $1`],
      ["StaffProfile", `"userId" LIKE $1`],
      ["ResidentProfile", `"userId" LIKE $1`],
      ["LoginLink", `"userId" LIKE $1`],
      ["Service", `"id" LIKE $1`],
      /*
       * ⚠️ نفس عائلة العيب: القسم يحمل `cuid`، فـ`"departmentId" LIKE $1`
       * لا يُطابق شيئاً — فتبقى المهامّ وتمنع حذف قسمها بمفتاح أجنبي.
       * والمُحدِّد هو **اسم القسم**، كما في `Department` أدناه.
       */
      [
        "DepartmentTask",
        `"departmentId" LIKE $1
           OR "departmentId" IN (SELECT id FROM "Department" WHERE name LIKE '%اختبار%')`,
      ],
      /*
       * ── 🔴 الأقسام والمهارات والمورّدون يحملون `cuid` لا بادئة ────────
       * `createDepartment` وأخواتها تولّد المعرّف، فمُحدِّد `"id" LIKE $1`
       * كان **لا يُطابق شيئاً**. فبقيت أقسام كل تشغيل، ثم فشل تشغيلٌ لاحق
       * بـ«القسم موجود بالفعل» — رسالةٌ تبدو عيباً في الكود وهي بقايا.
       *
       * نفس عائلة العيب الذي أصاب الحسابات والعقود والبنايات والأقساط.
       * والمُحدِّد هنا هو **الاسم**: كل اسم في الاختبارات يحوي «اختبار»،
       * ويحرس ذلك `tests/unit/test-data-naming.test.ts`.
       */
      ["Department", `"id" LIKE $1 OR name LIKE '%اختبار%'`],
      ["Skill", `"id" LIKE $1 OR name LIKE '%اختبار%'`],
      ["Vendor", `"id" LIKE $1 OR name LIKE '%اختبار%'`],
      ["User", `"id" LIKE $1`],
    ];

    for (const [table, predicate] of order) {
      await client.query(`DELETE FROM "${table}" WHERE ${predicate}`, [`${TEST_PREFIX}%`]);
    }
  } finally {
    await client.query(`ALTER TABLE "LedgerEntry" ENABLE TRIGGER USER`);
    await client.query(`ALTER TABLE "Invoice" ENABLE TRIGGER USER`);
  }
}

/** يؤكّد أن حماية الدفتر عادت بعد التنظيف — وإلا تُرك النظام مكشوفاً. */
export async function assertLedgerProtected(client: Client): Promise<boolean> {
  /**
   * ── 🔴 مقيَّد بـ`current_schema()` — ولم يكن ─────────────────────
   * كان الشرط `c.relname = 'LedgerEntry'` وحده. وحين عُزلت الاختبارات في
   * مخطّط منفصل صار في القاعدة **جدولان** بهذا الاسم، بمحفِّزين لكلٍّ —
   * فالعدّ 4 لا 2، وسقط الفحص وهو يفحص شيئاً صحيحاً.
   *
   * والأخطر عكسُه: محفِّزا `public` مُفعَّلان قد يجعلان العدّ يبلغ 2 بينما
   * محفِّزا مخطّط الاختبار **معطَّلان** — فيشهد الفحص بحمايةٍ غير موجودة.
   *
   * وهذا **ثالث** موضع من نفس النمط في يوم واحد: استعلام على `pg_catalog`
   * بلا قيد مخطّط. الأوّلان كانا في `pg_constraint` وفي رسالة نجاح ثابتة.
   */
  const r = await client.query<{ n: string }>(
    `select count(*) n from pg_trigger t
     join pg_class c on c.oid = t.tgrelid
     join pg_namespace ns on ns.oid = c.relnamespace
     where c.relname = 'LedgerEntry' and ns.nspname = current_schema()
       and not t.tgisinternal and t.tgenabled = 'O'`,
  );
  return Number(r.rows[0]?.n ?? 0) === 2;
}
