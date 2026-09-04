import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { prisma } from "@/lib/prisma";
import type { ActorContext } from "@/lib/actions/define-action";
import { createBuilding } from "@/lib/actions/buildings";
import {
  bulkSetApartmentConstructionStatus,
  setApartmentOccupancy,
} from "@/lib/actions/apartments";
import {
  createDepartment,
  createDepartmentTask,
  createSkill,
  createStaff,
  createVendor,
  setStaffAvailability,
  setStaffCashPermission,
  setStaffSkills,
} from "@/lib/actions/staff";
import { createResident, linkResidentToApartment } from "@/lib/actions/residents";
import { activateContract, createContract } from "@/lib/actions/contracts";
import { createService } from "@/lib/actions/services";
import { createInstallmentPlan } from "@/lib/actions/installments";
import { addRequestComment, setRequestStatus } from "@/lib/actions/requests";
import { createRequestFor } from "@/lib/services/resident-requests";
import { runInstallmentCharges } from "@/lib/services/installment-charges";
import {
  closeCashDrawer,
  getCashDrawer,
  openMyCashDrawer,
} from "@/lib/actions/cash";
import type { ActionResult } from "@/lib/result";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  بيانات تجريبية لبيئة التطوير.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ⚠️ لماذا عبر الإجراءات لا بكتابة مباشرة ─────────────────────────
 * `prisma.contract.create()` أسرع بكثير — ويُنتج بيانات **مستحيلة**:
 * عقدٌ نشط بلا حساب، أو شقة مسكونة بلا اشتراكات إلزامية، أو رصيدٌ لا
 * يطابق مجموع قيوده. ثم تُبنى الشاشات على تلك البيانات وتبدو صحيحة،
 * حتى يدخل مستخدمٌ أول بيانات حقيقية فينكشف أن الشاشة لم تُختبَر قطّ.
 *
 * فالبذر يمرّ من نفس الباب الذي يمرّ منه المستخدم: `createContract` ثم
 * `activateContract` يُنشئ الحساب ويُحلّه بـ`R28`، و`setApartmentOccupancy`
 * يُنشئ الاشتراكات الإلزامية ويُقيّدها بالتناسب (‏B2).
 *
 * وهو بذلك **فحصٌ شاملٌ للنظام**: بذرٌ ينجح يعني أن السلسلة كلّها تعمل.
 *
 * ── ⚠️ ولا يعمل إلا على مخطّط التطوير ───────────────────────────────
 * يرفض العمل إن كان `DB_SCHEMA` مضبوطاً — أي إن وُجِّه إلى مخطّط الاختبار.
 * وبيانات الاختبار تُنشئها الحزمة وتحذفها، وخلطُ الاثنين يجعل التنظيف
 * يمحو ما بذرتَه أو يترك ما يجب محوه.
 *
 * ── والبادئة `seed_` على كل مستخدم ──────────────────────────────────
 * كي يُعرَف المولَّد من المُدخَل يدوياً، ويُحذف وحده عند إعادة البذر.
 *
 *   npm run seed
 *   npm run seed -- --reset     ← يحذف ما بُذر سابقاً أولاً
 */

const SEED = "seed_";
const RESET = process.argv.includes("--reset");

/**
 * ⚠️ **أسماء ما تبذره البذرة — يقرؤها الحذف حرفياً.**
 * الأقسام والمهارات والمورّدون والخدمات لا بادئة لها: أسماؤها عربية عادية
 * مثل ما تُدخله الإدارة بيدها. فالحذف بالاسم الصريح لا بنمط.
 *
 * وكان `--reset` يحذف بـ`deleteMany({})` بلا شرط — أي **كل** أقسام
 * القاعدة ومهاراتها ومورّديها، بذرَتْها البذرة أو أنشأتها الإدارة. ومعه
 * `service.deleteMany({ name: { startsWith: "خدمة " } })`، و«خدمة» بادئة
 * تبدأ بها أسماء خدمات حقيقية كثيرة.
 */
const VENDOR_NAME = "شركة الرافدين للخدمات";
const SERVICE_NAMES = [
  "خدمة النظافة العامّة",
  "خدمة الأمن والحراسة",
  "خدمة المولّدة",
  "خدمة موقف إضافي",
  "خدمة صيانة المصعد",
  "خدمة تنظيف عميق",
] as const;

/** ⚠️ رمز البناية لا يبدأ بـ`IT`: تلك بادئة بنايات الاختبار، ويحذفها منظّفها. */
const BUILDINGS = [
  { code: "BRJ", name: "برج النخيل", floors: 4, units: 5 },
  { code: "WHD", name: "مجمّع الوحدة", floors: 3, units: 4 },
] as const;

const DEPARTMENTS = [
  { name: "الصيانة", description: "الأعطال الكهربائية والصحّية والتكييف." },
  { name: "النظافة", description: "نظافة المرافق المشتركة والسلالم والساحات." },
  { name: "الأمن", description: "بوّابة المجمَّع ومتابعة المركبات والزوّار." },
  { name: "خدمة السكان", description: "استقبال الطلبات والشكاوى وتحصيل الدفعات." },
] as const;

const SKILLS = [
  "كهرباء",
  "سباكة",
  "تكييف",
  "نجارة",
  "دهان",
  "مصاعد",
  "حدائق",
  "أمن",
] as const;

/** أسماء عربية واقعية — بيانات وهمية تُقرأ كبيانات حقيقية. */
const FIRST_M = ["أحمد", "محمد", "علي", "حسين", "عمر", "مصطفى", "يوسف", "كرار", "زيد", "باقر"];
const FIRST_F = ["زينب", "فاطمة", "مريم", "نور", "سارة", "هدى", "رقية", "آية"];
const LAST = ["الجبوري", "العبيدي", "الحسناوي", "الزيدي", "الخفاجي", "الدليمي", "الربيعي", "الساعدي", "الطائي", "العزاوي"];

const JOB_TITLES = [
  "فنّي كهرباء",
  "فنّي سباكة",
  "فنّي تكييف",
  "عامل نظافة",
  "مشرف نظافة",
  "حارس أمن",
  "مشرف أمن",
  "موظّف استقبال",
  "أمين صندوق",
  "بستاني",
];

/**
 * مولّد عشوائي **ثابت البذرة**.
 *
 * ⚠️ `Math.random()` يُنتج بيانات مختلفة في كل تشغيل، فيصير خللٌ يظهر
 * مرّةً غير قابل لإعادة الإنتاج. هذا يعطي نفس البيانات دائماً — ويبقى
 * موزَّعاً بما يكفي لاختبار الترشيح والبحث.
 */
let rngState = 20260901;
function rnd(): number {
  rngState = (rngState * 1103515245 + 12345) % 2147483648;
  return rngState / 2147483648;
}
const pick = <T,>(items: readonly T[]): T => items[Math.floor(rnd() * items.length)]!;
const between = (min: number, max: number): number => min + Math.floor(rnd() * (max - min + 1));

/**
 * بريد فريد لكل موظّف.
 *
 * ⚠️ **إلزامي للموظفين** لا للسكان: الموظف يدخل بحساب Google والمطابقة
 * على البريد، والساكن يدخل برمز على واتساب. و`example.com` نطاق محجوز
 * لا يُسلَّم إليه بريد — فلا يصل شيء إلى صندوق أحد بالخطأ.
 */
let emailCounter = 0;
function email(): string {
  emailCounter += 1;
  return `staff${String(emailCounter).padStart(3, "0")}@example.com`;
}

/**
 * ── 🔴 نطاق هاتف **تملكه البذرة** ──────────────────────────────────
 * البذرة كانت تُعلّم المالك وحده بالبادئة `seed_`، أما الموظفون والسكان
 * فتُنشئهم الإجراءات بمعرّفات `cuid` — **فلا يجدهم `--reset`**. فشل
 * الحذف بمفتاح أجنبي على `StaffSkill`، وبقيت القاعدة نصف منظَّفة.
 *
 * والعلامة الوحيدة التي تنجو من مرورها بالإجراءات هي الهاتف: البذرة
 * تختاره، والإجراء يحفظه كما هو بعد التطبيع.
 *
 * ⚠️ و`77` بادئة مشغّل عراقي صحيحة (`VALID_PREFIXES`)، والرقم الوطني
 * عشرة أرقام بالضبط — وإلا رفضه `normalizePhone` وفشل البذر كلّه.
 *   +964 · 77 001 · XXXXX  →  ‏10 أرقام وطنية
 */
const SEED_PHONE_PREFIX = "+96477001";

let phoneCounter = 0;
function phone(): string {
  phoneCounter += 1;
  return `${SEED_PHONE_PREFIX}${String(phoneCounter).padStart(5, "0")}`;
}

/**
 * ⚠️ يرمي بالرسالة العربية **وبأخطاء الحقول**.
 *
 * «بعض الحقول غير صحيحة» رسالةٌ صحيحة للمستخدم النهائي ولا تفيد من
 * يُصلح بذراً: تُخفي **أيّ** حقل. و`fieldErrors` موجودة في الجواب وكانت
 * تُهمَل هنا.
 */
function must<T>(result: ActionResult<T>, what: string): T {
  if (!result.ok) {
    const fields = result.error.fieldErrors
      ? ` — ${JSON.stringify(result.error.fieldErrors)}`
      : "";
    throw new Error(`${what}: ${result.error.message}${fields}`);
  }
  return result.data;
}

async function resolveActor(): Promise<ActorContext> {
  /**
   * ── ⚠️ الفاعل **أدمن** لا مالك ─────────────────────────────────────
   * المالك يقرأ ولا يكتب (‏D3/2): مصفوفة §3.2 تعطيه `READ` على الأقسام
   * والموظفين، فأوّل `createDepartment` يُردّ. جرّبتُ المالك أوّلاً وردَّني
   * النظام — وهو يعمل كما يجب.
   *
   * ⚠️ والفاعل **حقيقي**: `AuditLog.actorUserId` مفتاح أجنبي، وكل إجراء
   * يكتب تدقيقاً. فمعرّفٌ مختلق يُسقط أوّل كتابة.
   */
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN", isActive: true },
    select: { id: true },
  });
  if (admin) return { userId: admin.id, role: "ADMIN", ip: "127.0.0.1", userAgent: "seed" };

  const created = await prisma.user.create({
    data: {
      id: `${SEED}admin`,
      fullName: "مدير المجمَّع",
      phone: phone(),
      role: "ADMIN",
      isActive: true,
    },
    select: { id: true },
  });
  console.log(`   أُنشئ أدمن للبذر: ${created.id}`);
  return { userId: created.id, role: "ADMIN", ip: "127.0.0.1", userAgent: "seed" };
}

async function reset(): Promise<void> {
  console.log("── حذف ما بُذر سابقاً ──");

  const buildings = await prisma.building.findMany({
    where: { code: { in: BUILDINGS.map((b) => b.code) } },
    select: { id: true },
  });
  const buildingIds = buildings.map((b) => b.id);

  const apartments = await prisma.apartment.findMany({
    where: { buildingId: { in: buildingIds } },
    select: { id: true },
  });
  const apartmentIds = apartments.map((a) => a.id);

  /**
   * ── 🔴 مستخدمو البذر **لا يحملون البادئة** ────────────────────────
   * `createStaff` و`createResident` يمرّان بـ`createUser`، وهو يولّد
   * `cuid()`. فالبادئة `seed_` لا تصيب إلا الأدمن الذي أُنشئ هنا مباشرةً
   * — و`deleteMany({ staffProfileId: { in: seedIds } })` كان يُصيب صفراً،
   * فتبقى `StaffSkill` وتمنع حذف المهارات بمفتاح أجنبي.
   *
   * فيُجمَعون بثلاثة محدِّدات صريحة لا بتخمين:
   *   • الموظفون  ← البريد `@example.com` (نطاق محجوز، يُولّده هذا الملفّ)
   *   • السكان    ← ارتباطهم ببنايات البذر أو عقودها — **قبل** حذفها
   *   • الأدمن    ← البادئة `seed_`
   */
  const staffUsers = await prisma.user.findMany({
    where: { email: { endsWith: "@example.com" } },
    select: { id: true },
  });
  const linked = await prisma.apartmentResident.findMany({
    where: { apartmentId: { in: apartmentIds } },
    select: { userId: true },
  });
  const holders = await prisma.contract.findMany({
    where: { apartmentId: { in: apartmentIds } },
    select: { holderUserId: true },
  });
  /*
   * ⚠️ **والهاتف هو المحدِّد الجامع.** البريد يخصّ الموظفين وحدهم،
   * والارتباطات تختفي إن فشل تشغيل سابق قبل إنشائها. أما الهاتف فتختاره
   * البذرة لكل من تُنشئه — موظفاً كان أو ساكناً أو أدمناً — ويحفظه
   * الإجراء كما هو بعد التطبيع. فبقاياه لا تنجو من الحذف.
   */
  const prefixed = await prisma.user.findMany({
    where: {
      OR: [
        { id: { startsWith: SEED } },
        { phone: { startsWith: SEED_PHONE_PREFIX } },
      ],
    },
    select: { id: true },
  });

  const userIds = [
    ...new Set([
      ...staffUsers.map((u) => u.id),
      ...linked.map((l) => l.userId),
      ...holders.map((h) => h.holderUserId),
      ...prefixed.map((u) => u.id),
    ]),
  ];

  /*
   * ⚠️ الدفتر append-only بمحفِّز — يُعطَّل ويُعاد في `finally`.
   * وهذا امتياز بذرٍ لا ثغرة إنتاج: السكربت لا يعمل إلا محلّياً بأمرٍ يُكتب.
   */
  await prisma.$executeRawUnsafe(`ALTER TABLE "LedgerEntry" DISABLE TRIGGER USER`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Invoice" DISABLE TRIGGER USER`);
  try {
    await prisma.invoice.deleteMany({ where: { account: { apartmentId: { in: apartmentIds } } } });
    await prisma.payment.deleteMany({ where: { account: { apartmentId: { in: apartmentIds } } } });
    await prisma.ledgerEntry.deleteMany({
      where: { account: { apartmentId: { in: apartmentIds } } },
    });
    await prisma.subscription.deleteMany({ where: { apartmentId: { in: apartmentIds } } });
    await prisma.cashDrawerSession.deleteMany({ where: { staffUserId: { in: userIds } } });
    await prisma.account.deleteMany({ where: { apartmentId: { in: apartmentIds } } });

    /*
     * ⚠️ **الأقساط قبل العقد**: `InstallmentPlan.contractId` مفتاح أجنبي،
     * و`Installment.planId` كذلك. والابن قبل الأب دائماً.
     */
    await prisma.installment.deleteMany({
      where: { plan: { contract: { apartmentId: { in: apartmentIds } } } },
    });
    await prisma.installmentPlan.deleteMany({
      where: { contract: { apartmentId: { in: apartmentIds } } },
    });

    await prisma.contract.deleteMany({ where: { apartmentId: { in: apartmentIds } } });

    /*
     * ⚠️ الطلبات والمركبات تشير إلى الشقة — تُحذف قبلها.
     * والتعليقات قبل الطلبات، والباجات قبل المركبات.
     */
    await prisma.requestComment.deleteMany({
      where: { request: { apartmentId: { in: apartmentIds } } },
    });
    await prisma.serviceRequest.deleteMany({
      where: {
        OR: [{ apartmentId: { in: apartmentIds } }, { createdByUserId: { in: userIds } }],
      },
    });
    await prisma.badge.deleteMany({
      where: { vehicle: { apartmentId: { in: apartmentIds } } },
    });
    await prisma.vehicle.deleteMany({ where: { apartmentId: { in: apartmentIds } } });
    await prisma.apartmentResident.deleteMany({ where: { apartmentId: { in: apartmentIds } } });
    await prisma.apartment.deleteMany({ where: { buildingId: { in: buildingIds } } });
    await prisma.building.deleteMany({ where: { id: { in: buildingIds } } });
    /*
     * ⚠️ **بالبادئة مباشرةً لا بالقائمة المجموعة.**
     * `userIds` تُحسب **قبل** الحذف، فما نجا من جولة فاشلة سابقة لا يدخلها
     * — ويبقى، ويُصادم الهاتف أو البريد في الجولة التالية برسالة «مسجَّل
     * لمستخدم آخر» لا تشير إلى سببها.
     */
    const seededUsers = { phone: { startsWith: SEED_PHONE_PREFIX } } as const;
    await prisma.staffSkill.deleteMany({
      where: { OR: [{ staffProfileId: { in: userIds } }, { staffProfile: { user: seededUsers } }] },
    });
    /* ⚠️ وأي مهارة معلَّقة على ملفّ آخر تمنع حذف المهارة نفسها */
    await prisma.staffSkill.deleteMany({ where: { skill: { name: { in: [...SKILLS] } } } });
    await prisma.staffProfile.deleteMany({
      where: { OR: [{ userId: { in: userIds } }, { user: seededUsers }] },
    });
    await prisma.residentProfile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
    /*
     * ⚠️ بالاسم الصريح لا بنمط ولا بلا شرط. راجع `SERVICE_NAMES` أعلاه:
     * `deleteMany({})` هنا كان يمحو ما أنشأته الإدارة بيدها.
     */
    const deptNamesToDrop = DEPARTMENTS.map((d) => d.name);
    await prisma.service.deleteMany({ where: { name: { in: [...SERVICE_NAMES] } } });
    await prisma.departmentTask.deleteMany({
      where: { department: { name: { in: deptNamesToDrop } } },
    });
    await prisma.department.deleteMany({ where: { name: { in: deptNamesToDrop } } });
    await prisma.skill.deleteMany({ where: { name: { in: [...SKILLS] } } });
    await prisma.vendor.deleteMany({ where: { name: VENDOR_NAME } });
    /*
     * ⚠️ المستخدم آخر شيء: كل ما سبق يشير إليه بمفتاح أجنبي.
     * والحذف بالقائمة المجموعة أعلاه لا بالبادئة وحدها.
     */
    await prisma.user.deleteMany({
      where: { OR: [{ id: { in: userIds } }, seededUsers] },
    });
  } finally {
    await prisma.$executeRawUnsafe(`ALTER TABLE "LedgerEntry" ENABLE TRIGGER USER`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "Invoice" ENABLE TRIGGER USER`);
  }
}

async function main(): Promise<void> {
  /*
   * ── 🔴 الرفض على مخطّط الاختبار ────────────────────────────────────
   * حزمة التكامل تنظّف مخطّطها في كل تشغيل. فبذرٌ فيه يُمحى، أو — أسوأ —
   * يبقى فيربك اختباراً يعدّ الصفوف.
   */
  if (process.env["DB_SCHEMA"]) {
    console.error(
      `🔴 البذر يرفض العمل على مخطّط «${process.env["DB_SCHEMA"]}».\n` +
        "بيانات التطوير مكانها `public`. شغّله بلا `.env.test`.",
    );
    process.exit(1);
  }

  if (RESET) await reset();

  const actor = await resolveActor();
  console.log("── الأقسام والمهارات والمورّدون ──");

  /**
   * ── ⚠️ البذر **يُعاد تشغيله** ───────────────────────────────────────
   * `createDepartment` يرفض الاسم المكرَّر — وهو حرسٌ صحيح للمستخدم،
   * وعائقٌ للبذر: أوّل تشغيل ثانٍ بلا `--reset` ينفجر عند أوّل قسم، فلا
   * تصل إلى ما بعده أبداً.
   *
   * فما هو **مرجعيّ** (الأقسام والمهارات والمورّد والخدمات) يُعاد
   * استعماله إن وُجد. وما هو **معاملاتي** (الموظفون والعقود والقيود)
   * يُنشأ دائماً — وتكراره مقصود: يملأ الصفحات لاختبار التصفيح.
   */
  const departments = new Map<string, string>();
  for (const d of DEPARTMENTS) {
    const existing = await prisma.department.findFirst({
      where: { name: d.name },
      select: { id: true },
    });
    if (existing) {
      departments.set(d.name, existing.id);
      continue;
    }
    const r = await createDepartment({ name: d.name, description: d.description }, actor);
    departments.set(d.name, must(r, `قسم ${d.name}`).id);
  }

  for (const name of SKILLS) {
    must(await createSkill({ name }, actor), `مهارة ${name}`);
  }

  /**
   * ⚠️ **المعرّفات تُقرأ من القاعدة لا تُجمع أثناء الإنشاء.**
   * خريطةٌ تُبنى من نتائج `createSkill` تبدو صحيحة، وتتقادم بصمت إن فشل
   * إنشاءٌ في المنتصف أو حُذف صفٌّ بعده — فيمرّ معرّف لا وجود له، ويظهر
   * الخطأ بعد عشرين صفّاً كخرق مفتاح أجنبي لا كسبب.
   */
  const skills = new Map(
    (
      await prisma.skill.findMany({
        where: { name: { in: [...SKILLS] } },
        select: { id: true, name: true },
      })
    ).map((r) => [r.name, r.id] as const),
  );
  if (skills.size !== SKILLS.length) {
    throw new Error(`المهارات في القاعدة ${skills.size} والمطلوب ${SKILLS.length}.`);
  }

  const existingVendor = await prisma.vendor.findFirst({
    where: { name: VENDOR_NAME },
    select: { id: true },
  });
  const vendorId =
    existingVendor?.id ??
    must(
      await createVendor(
        { name: VENDOR_NAME, contactPerson: "سالم الجبوري", phone: phone(), specialty: "صيانة عامّة" },
        actor,
      ),
      "المورّد",
    ).id;

  for (const [dept, tasks] of [
    ["الصيانة", ["إصلاح عطل كهربائي", "معالجة تسرّب مياه", "صيانة مكيّف"]],
    ["النظافة", ["تنظيف السلالم", "رفع النفايات"]],
    ["الأمن", ["جولة ليلية", "تفتيش مركبة زائر"]],
    ["خدمة السكان", ["استلام شكوى", "تحصيل دفعة نقدية"]],
  ] as const) {
    for (const name of tasks) {
      const departmentId = departments.get(dept)!;
      const existing = await prisma.departmentTask.findFirst({
        where: { departmentId, name },
        select: { id: true },
      });
      if (!existing) await createDepartmentTask({ departmentId, name }, actor);
    }
  }

  // ── الموظفون ──────────────────────────────────────────────────────
  /*
   * ⚠️ **٣٨ موظّفاً عمداً** — أكثر من صفحة واحدة (‏25).
   * التصفيح لا يُختبَر ببيانات تسع في صفحة، والبحث لا يُختبَر بعشرة أسماء
   * متشابهة. والتوزيع مقصود: أقسام مختلفة، ومتواجدون وغائبون، وثلاثة
   * أنواع توظيف، ومهارات متفاوتة — كي يُنتج كل مرشّح نتيجة غير فارغة.
   */

  console.log("── الموظفون (٣٨) ──");
  const deptNames = DEPARTMENTS.map((d) => d.name);
  const staffIds: string[] = [];

  for (let i = 0; i < 38; i += 1) {
    const female = i % 4 === 0;
    const fullName = `${pick(female ? FIRST_F : FIRST_M)} ${pick(LAST)}`;
    const employmentType = i % 9 === 0 ? "VENDOR" : i % 5 === 0 ? "FREELANCE" : "INTERNAL";
    const deptName = deptNames[i % deptNames.length]!;

    const deptId = departments.get(deptName)!;

    const staff = must(
      await createStaff(
        {
          fullName,
          phone: phone(),
          email: email(),
          employmentType,
          ...(employmentType === "VENDOR" ? { vendorId } : {}),
          departmentId: deptId,
          jobTitle: pick(JOB_TITLES),
        },
        actor,
      ),
      `موظّف ${fullName}`,
    );
    staffIds.push(staff.userId);

    // مهارة أو اثنتان، وبعضها يحتاج تدريباً — كي يعمل مرشّح المهارة
    const chosen = [pick(SKILLS), pick(SKILLS)].filter((v, idx, a) => a.indexOf(v) === idx);
    await setStaffSkills(
      {
        userId: staff.userId,
        skills: chosen.map((name, idx) => ({
          skillId: skills.get(name)!,
          level: (["BEGINNER", "INTERMEDIATE", "ADVANCED", "EXPERT"] as const)[between(0, 3)]!,
          needsTraining: idx === 0 && i % 6 === 0,
          hasTrained: i % 7 === 0,
        })),
      },
      actor,
    );

    // ⚠️ الثلث غير متواجد — مرشّح «المتواجدون فقط» يجب أن يُغيّر النتيجة
    if (i % 3 === 2) {
      await setStaffAvailability({ userId: staff.userId, isAvailable: false }, actor);
    }

    // ⚠️ ثلاثة أمناء صندوق فقط — الصلاحية استثناء لا قاعدة (‏B4)
    if (i % 13 === 0) {
      await setStaffCashPermission(
        { userId: staff.userId, canReceiveCash: true, reason: "أمين صندوق مركز الخدمة" },
        actor,
      );
    }
  }

  // ── الخدمات ───────────────────────────────────────────────────────
  console.log("── الخدمات ──");
  const services = [
    { name: "خدمة النظافة العامّة", billingType: "RECURRING", billingCycle: "MONTHLY", pricingModel: "FLAT", basePriceIqd: 25_000n, payerType: "OCCUPANT", isMandatory: true, appliesTo: "APARTMENT" },
    { name: "خدمة الأمن والحراسة", billingType: "RECURRING", billingCycle: "MONTHLY", pricingModel: "FLAT", basePriceIqd: 30_000n, payerType: "OWNER", isMandatory: true, appliesTo: "APARTMENT" },
    { name: "خدمة المولّدة", billingType: "RECURRING", billingCycle: "MONTHLY", pricingModel: "PER_UNIT", unitLabel: "أمبير", unitPriceIqd: 15_000n, minUnits: 1, maxUnits: 20, payerType: "OCCUPANT", isMandatory: false, appliesTo: "APARTMENT" },
    { name: "خدمة موقف إضافي", billingType: "RECURRING", billingCycle: "YEARLY", pricingModel: "FLAT", basePriceIqd: 180_000n, payerType: "OCCUPANT", isMandatory: false, appliesTo: "APARTMENT" },
    { name: "خدمة صيانة المصعد", billingType: "RECURRING", billingCycle: "QUARTERLY", pricingModel: "FLAT", basePriceIqd: 60_000n, payerType: "OWNER", isMandatory: true, appliesTo: "APARTMENT" },
    { name: "خدمة تنظيف عميق", billingType: "ONE_TIME", pricingModel: "FLAT", basePriceIqd: 75_000n, payerType: "OCCUPANT", isMandatory: false, appliesTo: "APARTMENT" },
  ] as const;

  for (const s of services) {
    const existing = await prisma.service.findFirst({ where: { name: s.name }, select: { id: true } });
    if (!existing) must(await createService(s, actor), `خدمة ${s.name}`);
  }

  // ── البنايات والشقق ───────────────────────────────────────────────
  console.log("── البنايات والشقق ──");
  const apartmentIds: string[] = [];
  for (const b of BUILDINGS) {
    must(
      await createBuilding(
        {
          code: b.code,
          name: b.name,
          floorsCount: b.floors,
          unitsPerFloor: b.units,
          numberingScheme: "SEQUENTIAL",
          displayNumberFormat: "{building}-{floor}-{unit}",
          constructionStatus: "COMPLETED",
        },
        actor,
      ),
      `بناية ${b.code}`,
    );
  }

  /*
   * ⚠️ **الشقق تُولَّد «تحت الإنشاء» مهما كانت حالة البناية.**
   * وحالةُ السكن لا تُضبط على شقة تحت الإنشاء — وهو حرسٌ صحيح: وحدةٌ لم
   * تكتمل لا يسكنها أحد ولا تُفوتَر. فيُنهى إنشاؤها صراحةً، كما يفعل
   * الأدمن في الشاشة، بدل كتابة العمود مباشرةً.
   */
  for (const b of BUILDINGS) {
    const building = await prisma.building.findUnique({
      where: { code: b.code },
      select: { id: true },
    });
    if (!building) continue;
    must(
      await bulkSetApartmentConstructionStatus(
        { buildingId: building.id, fromFloor: 1, toFloor: b.floors, status: "COMPLETED" },
        actor,
      ),
      `إنهاء إنشاء ${b.code}`,
    );
  }

  const created = await prisma.apartment.findMany({
    where: { building: { code: { in: BUILDINGS.map((x) => x.code) } } },
    select: { id: true },
    orderBy: [{ buildingId: "asc" }, { floorNumber: "asc" }, { unitNumber: "asc" }],
  });
  apartmentIds.push(...created.map((a) => a.id));
  console.log(`   ${apartmentIds.length} شقة`);

  // ── السكان والعقود ────────────────────────────────────────────────
  /*
   * ⚠️ ثلاث حالات لا واحدة: مباعة يسكنها مالكها · مؤجَّرة · فارغة.
   * وشاشةٌ تُبنى على حالة واحدة تنكسر عند أول شقة من الحالتين الأخريين
   * — وهما ليستا نادرتين بل نصف المجمَّع.
   */
  console.log("── السكان والعقود ──");
  let sold = 0;
  let rentedCount = 0;
  let vacant = 0;

  for (const [i, apartmentId] of apartmentIds.entries()) {
    if (i % 5 === 4) {
      vacant += 1;
      continue;
    }

    const female = i % 3 === 0;
    const fullName = `${pick(female ? FIRST_F : FIRST_M)} ${pick(LAST)}`;
    const holder = must(
      await createResident(
        { fullName, phone: phone(), ...(female ? { gender: "FEMALE" as const } : { gender: "MALE" as const }) },
        actor,
      ),
      `ساكن ${fullName}`,
    );

    /**
     * ── ⚠️ المؤجَّرة تحتاج **مالكاً أيضاً** ────────────────────────────
     * خدمتان إلزاميتان يدفعهما المالك (‏الأمن · المصعد). وشقةٌ عليها عقد
     * إيجار وحده ليس لها حساب مالك، فيرفض `R28` تحميلهما — ورفضُه صحيح:
     * لا يوجد من يُقيَّد عليه.
     *
     * وهذه هي الحالة التي صُمّم لها الفهرس الفريد «عقد نشط لكل (شقة +
     * نوع)»: **شقة مباعة يسكنها مستأجر**، بحسابين مستقلّين على وحدة
     * واحدة. فالبذر يُنشئها كما هي في الواقع لا كما يسهل بذرها.
     */
    const rented = i % 2 === 1;

    const ownerContract = must(
      await createContract(
        {
          apartmentId,
          holderUserId: holder.id,
          type: "SALE",
          startDate: new Date(Date.now() - between(120, 900) * 86_400_000),
          totalAmountIqd: BigInt(between(90, 260) * 1_000_000),
          paymentType: "FULL",
        },
        actor,
      ),
      "عقد التمليك",
    );
    must(await activateContract({ contractId: ownerContract.id }, actor), "تفعيل التمليك");

    await linkResidentToApartment(
      { apartmentId, userId: holder.id, relationType: "OTHER", isContractHolder: true },
      actor,
    );

    if (rented) {
      const tenantName = `${pick(FIRST_M)} ${pick(LAST)}`;
      const tenant = must(
        await createResident({ fullName: tenantName, phone: phone(), gender: "MALE" }, actor),
        `مستأجر ${tenantName}`,
      );
      const rentContract = must(
        await createContract(
          {
            apartmentId,
            holderUserId: tenant.id,
            type: "RENTAL",
            startDate: new Date(Date.now() - between(30, 300) * 86_400_000),
            endDate: new Date(Date.now() + 300 * 86_400_000),
            rentAmountIqd: BigInt(between(400, 900) * 1_000),
            rentCycle: "MONTHLY",
          },
          actor,
        ),
        "عقد الإيجار",
      );
      must(await activateContract({ contractId: rentContract.id }, actor), "تفعيل الإيجار");
      await linkResidentToApartment(
        { apartmentId, userId: tenant.id, relationType: "OTHER", isContractHolder: false },
        actor,
      );
    }

    // فردٌ من الأسرة على بعض الشقق — يحرس الحدّ داخل البيت نفسه
    if (i % 4 === 1) {
      const memberName = `${pick(FIRST_F)} ${pick(LAST)}`;
      const member = must(
        await createResident({ fullName: memberName, phone: phone(), gender: "FEMALE" }, actor),
        `فرد أسرة ${memberName}`,
      );
      await linkResidentToApartment(
        { apartmentId, userId: member.id, relationType: "FAMILY_MEMBER", isContractHolder: false },
        actor,
      );
    }

    /*
     * ⚠️ **الإشغال آخر خطوة.** هو مفتاح الفوترة: يُنشئ الاشتراكات
     * الإلزامية ويُقيّدها مقسَّطةً بالتناسب (‏B2). واستدعاؤه قبل العقد
     * كان يفشل لأن الحساب لا يُحلّ بلا عقد نشط (‏R28).
     */
    must(
      await setApartmentOccupancy(
        {
          apartmentId,
          occupancyStatus: rented ? "OCCUPIED_BY_TENANT" : "OCCUPIED_BY_OWNER",
        },
        actor,
      ),
      "ضبط الإشغال",
    );

    if (rented) rentedCount += 1;
    else sold += 1;
  }

  console.log(`   ${sold} يسكنها مالكها · ${rentedCount} مؤجَّرة · ${vacant} فارغة`);

  // ── خطط الأقساط — الخطوة 3.5 · القرار B1 ──────────────────────────
  /**
   * ⚠️ **ثلاث حالات لا واحدة**، وإلا بقيت شاشة المتابعة بلا ما تتابعه:
   *   • خطة جديدة كلّها في المستقبل  ← «جارية بلا متأخّر»
   *   • خطة بدأت في الماضي           ← **متأخّرات** بعد تشغيل المهمّة
   *   • خطة بلا مقدّمة                ← المسار الذي لا يحتاج صندوقاً
   *
   * وشاشةٌ تُبنى على حالة واحدة تبدو صحيحة حتى تصل الثانية.
   */
  console.log("── خطط الأقساط ──");

  /*
   * ⚠️ **الصندوق قبل المقدّمة.** قيد `payment_cash_needs_drawer` (‏B4)
   * يمنع دفعة نقدية بلا جلسة — وهو يشمل الدفعة المقدّمة. فالبذر يفتح
   * صندوقاً كما يفعل المحصِّل، ويُقفله بعد أن يفرغ.
   */
  await prisma.staffProfile.upsert({
    where: { userId: actor.userId },
    create: { userId: actor.userId, employmentType: "INTERNAL", isAvailable: true },
    update: {},
  });
  const permitted = await setStaffCashPermission(
    { userId: actor.userId, canReceiveCash: true, reason: "بذر بيانات التطوير" },
    actor,
  );
  if (!permitted.ok && !permitted.error.message.includes("سلفاً")) {
    throw new Error(`صلاحية النقد: ${permitted.error.message}`);
  }

  const openDrawer = await openMyCashDrawer({}, actor);
  const drawerSessionId = openDrawer.ok ? openDrawer.data.sessionId : null;

  const saleContracts = await prisma.contract.findMany({
    where: {
      type: "SALE",
      status: "ACTIVE",
      plan: null,
      apartment: { building: { code: { in: BUILDINGS.map((b) => b.code) } } },
    },
    select: { id: true },
    take: 9,
  });

  let plansCreated = 0;
  for (const [index, contract] of saleContracts.entries()) {
    const inThePast = index % 3 === 1;
    const withDown = index % 3 !== 2;

    const created = await createInstallmentPlan(
      {
        contractId: contract.id,
        totalAmountIqd: BigInt(between(60, 180) * 1_000_000),
        downPaymentIqd: withDown ? BigInt(between(5, 20) * 1_000_000) : 0n,
        installmentsCount: pick([12, 24, 36]),
        intervalMonths: 1,
        startDate: inThePast
          ? new Date(Date.now() - between(90, 400) * 86_400_000)
          : new Date(Date.now() + between(15, 45) * 86_400_000),
      },
      actor,
    );
    if (!created.ok) {
      console.log(`   تُخطّي عقد: ${created.error.message}`);
      continue;
    }
    plansCreated += 1;
  }

  /*
   * ⚠️ تشغيل مهمّة الاستحقاق **بعد** الإنشاء: هي من تُنتج القيود
   * والمتأخّرات. وبلاها تبقى الخطط الماضية بلا متأخّر واحد، فتبدو شاشة
   * المتابعة فارغة وهي ممتلئة.
   */
  const charges = await runInstallmentCharges();

  if (drawerSessionId) {
    const summary = await getCashDrawer({ sessionId: drawerSessionId }, actor);
    const declared = summary.ok ? summary.data.expectedIqd : 0n;
    await closeCashDrawer(
      { sessionId: drawerSessionId, declaredIqd: declared, notes: "إقفال بذر" },
      actor,
    );
  }

  console.log(
    `   ${plansCreated} خطة · ${charges.charged} قيد استحقاق · ${charges.markedOverdue} متأخّر`,
  );

  // ── المركبات والباجات — لبوّابة الساكن ────────────────────────────
  /**
   * ⚠️ **كتابة مباشرة لا عبر إجراء** — والسبب يُقال لا يُخفى:
   * إجراءات المركبات لم تُبنَ بعد (الخطوة 4.1)، وإصدار الباج محجوب بقرار
   * `B3` (على حساب مَن يُقيَّد الرسم؟). فالخيار بين بذرٍ مباشر مُعلَّم،
   * وشاشةٍ فارغة لا تُختبَر.
   *
   * ⚠️ و`feeIqd` يبقى فارغاً: تركُه فارغاً يقول «لم يُقرَّر» — وملؤه
   * برقمٍ مخترَع يُنتج بياناً يبدو مقرَّراً وليس كذلك.
   */
  console.log("── المركبات والباجات ──");

  const occupied = await prisma.apartment.findMany({
    where: {
      occupancyStatus: { not: "VACANT" },
      building: { code: { in: BUILDINGS.map((b) => b.code) } },
    },
    select: {
      id: true,
      residents: { select: { userId: true }, take: 1 },
    },
    take: 14,
  });

  const PROVINCES = ["بغداد", "البصرة", "أربيل", "النجف", "كربلاء"];
  const MAKES = ["تويوتا", "كيا", "هيونداي", "نيسان", "مرسيدس"];

  let vehicleCount = 0;
  let badgeCount = 0;

  for (const [index, apartment] of occupied.entries()) {
    const existing = await prisma.vehicle.count({ where: { apartmentId: apartment.id } });
    if (existing > 0) continue;

    const vehicle = await prisma.vehicle.create({
      data: {
        apartmentId: apartment.id,
        ownerUserId: apartment.residents[0]?.userId ?? null,
        plateNumber: `${between(10, 99)} ${String(between(10000, 99999))}`,
        plateProvince: pick(PROVINCES),
        make: pick(MAKES),
        color: pick(["أبيض", "أسود", "فضّي", "رمادي"]),
        /* ⚠️ ثلاث حالات: المقبولة والمعلَّقة والمرفوضة — الشاشة تعرضها كلّها */
        status: index % 7 === 6 ? "REJECTED" : index % 5 === 4 ? "PENDING_APPROVAL" : "APPROVED",
      },
      select: { id: true, status: true },
    });
    vehicleCount += 1;

    if (vehicle.status !== "APPROVED") continue;

    /*
     * ⚠️ **باجٌ منتهٍ عمداً** لكل رابع مركبة: حالته `ISSUED` وتاريخه مضى.
     * هذا بالضبط ما يكشفه `effectiveStatus` في الشاشة — وبلا صفٍّ كهذا
     * يبقى الفرق بين العمود والمشتقّ غير مرئيّ في أي اختبار بصري.
     */
    const expired = index % 4 === 3;

    await prisma.badge.create({
      data: {
        vehicleId: vehicle.id,
        code: `BDG-${String(2000 + badgeCount)}`,
        status: "ISSUED",
        issuedAt: new Date(Date.now() - between(60, 400) * 86_400_000),
        expiresAt: expired
          ? new Date(Date.now() - between(5, 60) * 86_400_000)
          : new Date(Date.now() + between(60, 300) * 86_400_000),
        issuedByUserId: actor.userId,
      },
    });
    badgeCount += 1;
  }

  console.log(`   ${vehicleCount} مركبة · ${badgeCount} باج`);

  // ── الطلبات والشكاوى ──────────────────────────────────────────────
  /**
   * ⚠️ **عبر الإجراءات** — بخلاف المركبات، فالخطوة 4.4 مبنيّة. والطلب
   * يُنشأ باسم **الساكن** لا الأدمن: بوّابة الساكن ترشّح بـ`createdByUserId`،
   * فطلبٌ أنشأه الأدمن لا يظهر لصاحب الشقة — وتبدو الشاشة فارغة وهي عاملة.
   */
  console.log("── الطلبات والشكاوى ──");

  const firstTask = await prisma.departmentTask.findFirst({
    where: { isActive: true },
    select: { id: true },
  });

  const TITLES = [
    ["تسرّب ماء في الحمّام", "الماء يتسرّب من أسفل المغسلة منذ يومين."],
    ["المكيّف لا يبرّد", "المكيّف يعمل ولا يبرّد منذ الأسبوع الماضي."],
    ["انقطاع كهرباء متكرّر", "الكهرباء تنقطع عن الشقة مرّات في اليوم."],
    ["باب المصعد لا يُغلق", "باب المصعد في الطابق الثاني يتأخّر في الإغلاق."],
    ["إنارة الممرّ مطفأة", "إنارة ممرّ الطابق الثالث مطفأة منذ ثلاثة أيام."],
  ] as const;

  let requestCount = 0;

  for (const [index, apartment] of occupied.entries()) {
    const residentId = apartment.residents[0]?.userId;
    if (!residentId) continue;

    const [title, description] = TITLES[index % TITLES.length]!;
    /* ⚠️ كل خامس شكوى على المرافق المشتركة — بلا شقة (‏Q35) */
    const commonArea = index % 5 === 4;

    const created = await createRequestFor(residentId, {
      type: index % 3 === 2 ? "COMPLAINT" : "SERVICE_REQUEST",
      scope: commonArea ? "COMMON_AREA" : "APARTMENT",
      ...(commonArea ? {} : { apartmentId: apartment.id }),
      title,
      description,
      ...(firstTask && !commonArea ? { departmentTaskId: firstTask.id } : {}),
    });
    requestCount += 1;

    /* ⚠️ تعليق داخلي على بعضها: تُختبَر به تصفية بوّابة الساكن بصرياً */
    if (index % 3 === 0) {
      await addRequestComment(
        {
          requestId: created.id,
          body: "ملاحظة داخلية: تأكّد من توفّر القطعة قبل زيارة الفنّي.",
          isInternal: true,
        },
        actor,
      );
      await addRequestComment(
        { requestId: created.id, body: "سيصل الفنّي خلال يومين.", isInternal: false },
        actor,
      );
    }

    /* وبعضها يُغلق بوصف — كي تُرى الحالتان في الشاشة */
    if (index % 4 === 1) {
      await setRequestStatus(
        {
          requestId: created.id,
          status: "DONE",
          resolutionNote: "أُصلح العطل وجُرّب أمام الساكن.",
        },
        actor,
      );
    }
  }

  console.log(`   ${requestCount} طلباً وشكوى`);

  const counts = await prisma.$transaction([
    prisma.user.count(),
    prisma.staffProfile.count(),
    prisma.apartment.count(),
    prisma.contract.count(),
    prisma.subscription.count(),
    prisma.ledgerEntry.count(),
  ]);

  console.log("\n✅ البذر تمّ:");
  console.log(`   مستخدمون=${counts[0]}  موظفون=${counts[1]}  شقق=${counts[2]}`);
  console.log(`   عقود=${counts[3]}  اشتراكات=${counts[4]}  قيود=${counts[5]}`);
}

main()
  .catch((error: unknown) => {
    console.error("\n🔴 فشل البذر:", error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
