import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { cleanupTestData, connection, createFixture, type Fixture } from "./helpers";
import {
  createDepartment,
  createDepartmentTask,
  createSkill,
  createStaff,
  createVendor,
  listDepartments,
  listStaff,
  listVendors,
  setStaffAvailability,
  setStaffCashPermission,
  setStaffSkills,
  updateStaff,
  getStaff,
} from "@/lib/actions/staff";
import { createUser, setUserActive } from "@/lib/actions/users";
import type { ActorContext } from "@/lib/actions/define-action";
import { prisma } from "@/lib/prisma";

/**
 * الخطوة 1.8 — تعريف الإنجاز:
 *   «موظف بائع بلا `vendorId` يُرفض»
 *   «صفحة القسم تعرض عدد الأشخاص **محسوباً**»
 *   «مهارات موظف تُحفظ بمستوياتها»
 */

let client: Client;
let f: Fixture;
let admin: ActorContext;

let deptId = "";
let vendorId = "";
const skillIds: string[] = [];
const createdUsers: string[] = [];

beforeAll(async () => {
  client = connection();
  await client.connect();
  await cleanupTestData(client);
  await client.query(`delete from "User" where "fullName" like 'موظف اختبار%'`);
  f = await createFixture(client, "stf");
  admin = { userId: f.roleUsers.ADMIN, role: "ADMIN", ip: "10.0.0.13", userAgent: "vitest" };

  const d = await createDepartment({ name: "قسم اختبار الصيانة" }, admin);
  if (!d.ok) throw new Error(d.error.message);
  deptId = d.data.id;

  const v = await createVendor({ name: "شركة اختبار للمصاعد", specialty: "مصاعد" }, admin);
  if (!v.ok) throw new Error(v.error.message);
  vendorId = v.data.id;

  for (const name of ["كهرباء اختبار", "سباكة اختبار"]) {
    const s = await createSkill({ name }, admin);
    if (!s.ok) throw new Error(s.error.message);
    skillIds.push(s.data.id);
  }
}, 180_000);

afterAll(async () => {
  await client.query(`delete from "StaffSkill" where "skillId" = any($1)`, [skillIds]);
  await client.query(
    `delete from "StaffProfile" where "departmentId" = $1 or "vendorId" = $2 or "userId" = any($3)`,
    [deptId, vendorId, createdUsers.concat(f.roleUsers.STAFF, f.holderId)],
  );
  await client.query(`delete from "Skill" where id = any($1)`, [skillIds]);
  await client.query(`delete from "DepartmentTask" where "departmentId" = $1`, [deptId]);
  await client.query(`delete from "Department" where id = $1`, [deptId]);
  await client.query(`delete from "Vendor" where id = $1`, [vendorId]);
  if (createdUsers.length > 0) {
    await client.query(`delete from "AuditLog" where "entityId" = any($1)`, [createdUsers]);
    await client.query(`delete from "User" where id = any($1)`, [createdUsers]);
  }
  await cleanupTestData(client);
  await client.end();
  await prisma.$disconnect();
}, 120_000);

// ═══════════════════════════════════════════════════════════════════════

describe("🔴 vendorId — شرط مشروط لا يُعبَّر عنه في Prisma", () => {
  it("**موظف بائع بلا شركة يُرفض** — والخطأ على الحقل الصحيح", async () => {
    const r = await createStaff(
      {
        fullName: "موظف اختبار بلا شركة",
        phone: "07701110001",
        email: "novendor@itest.local",
        employmentType: "VENDOR",
      },
      admin,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.fieldErrors?.["vendorId"]?.[0]).toContain("الشركة مطلوبة");
  });

  it("والعكس: شركة على موظف داخلي تُرفض", async () => {
    /**
     * بيانٌ لا معنى له يضلّل التقارير: «كم موظفاً لدى الشركة س؟» يصير
     * جواباً خاطئاً لأن داخليّاً محسوب عليها.
     */
    const r = await createStaff(
      {
        fullName: "موظف اختبار داخلي بشركة",
        phone: "07701110002",
        email: "internal@itest.local",
        employmentType: "INTERNAL",
        vendorId,
      },
      admin,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.fieldErrors?.["vendorId"]?.[0]).toContain("البائعين فقط");
  });

  it("موظف بائع بشركة صالحة يُقبل", async () => {
    const r = await createStaff(
      {
        fullName: "موظف اختبار بائع",
        phone: "07701110003",
        email: "vendorstaff@itest.local",
        employmentType: "VENDOR",
        vendorId,
        departmentId: deptId,
        jobTitle: "فنّي مصاعد",
      },
      admin,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    createdUsers.push(r.data.userId);
    expect(r.data.vendorId).toBe(vendorId);
    expect(r.data.employmentType).toBe("VENDOR");
  });

  it("🔴 القيد في قاعدة البيانات يمنع الالتفاف على zod", async () => {
    /**
     * ⚠️ الفحص في zod يعطي رسالة عربية على الحقل، لكنه **ليس الحدّ**:
     * الحدّ هو `staff_vendor_requires_vendor`. لو كُتب الصفّ بأي مسار
     * آخر — سكربت، ترحيل، إصلاح يدوي — يبقى القيد قائماً.
     */
    await expect(
      client.query(
        `insert into "StaffProfile" ("userId","employmentType","updatedAt")
         values ($1,'VENDOR',now())`,
        [f.roleUsers.STAFF],
      ),
    ).rejects.toThrow(/staff_vendor_requires_vendor/);
  });

  it("شركة غير موجودة تُرفض", async () => {
    const r = await createStaff(
      {
        fullName: "موظف اختبار شركة وهمية",
        phone: "07701110004",
        email: "fakevendor@itest.local",
        employmentType: "VENDOR",
        vendorId: "itest_stf_no_vendor",
      },
      admin,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toContain("الشركة");
  });
});

// ═══════════════════════════════════════════════════════════════════════

describe("ربط ملف وظيفي بمستخدم قائم", () => {
  it("مستخدم أُنشئ بـcreateUser يبقى **بلا ملف وظيفي** حتى يُربط", async () => {
    /**
     * ⚠️ فجوة حقيقية: `createUser` يُنشئ مستخدماً بدور `STAFF` بلا ملف،
     * فيبقى بلا قسم ولا علم تواجد ولا مهارات — **موجوداً وغير قابل
     * للتكليف**، ولا شيء يشير إلى ذلك.
     */
    const u = await createUser(
      {
        fullName: "موظف اختبار بلا ملف",
        phone: "07701110005",
        email: "noprofile@itest.local",
        role: "STAFF",
      },
      admin,
    );
    if (!u.ok) throw new Error(u.error.message);
    createdUsers.push(u.data.id);

    const before = await prisma.staffProfile.findUnique({ where: { userId: u.data.id } });
    expect(before).toBeNull();

    const r = await createStaff(
      { userId: u.data.id, employmentType: "INTERNAL", departmentId: deptId },
      admin,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.userId).toBe(u.data.id);
    expect(r.data.departmentId).toBe(deptId);
  });

  it("🔴 **موظف جديد بلا بريد مرفوض** — وإلا نتج حساب لا يستطيع الدخول", async () => {
    /**
     * ⚠️ كشفه فشل اختبار: `createUser` يفرض القاعدة (‏§7.1 — الموظفون
     * يدخلون بـGoogle والمطابقة على البريد) و`createStaff` كان لا يفرضها.
     * فالمسار الثاني كان يُنتج **حسابات ميتة**: تظهر في كل قائمة،
     * وتُكلَّف بطلبات، ولا ترى شيئاً منها — ولا يشتكي شيء.
     */
    const r = await createStaff(
      {
        fullName: "موظف اختبار بلا بريد",
        phone: "07701110008",
        employmentType: "INTERNAL",
      },
      admin,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.fieldErrors?.["email"]?.[0]).toContain("البريد الإلكتروني مطلوب");
  });

  it("والربط بمستخدم قائم لا يشترط بريداً — القاعدة على الإنشاء لا الربط", async () => {
    // المستخدم القائم مرّ بقاعدته عند إنشائه؛ إعادة فرضها هنا تمنع ربط
    // ملف وظيفي بساكن صار موظفاً (‏Q41) وهو يدخل برمز واتساب لا بـGoogle.
    const { rows } = await client.query<{ id: string }>(
      `select id from "User" where id = $1`,
      [f.holderId],
    );
    expect(rows).toHaveLength(1);
    const r = await createStaff(
      { userId: f.holderId, employmentType: "INTERNAL", departmentId: deptId },
      admin,
    );
    expect(r.ok).toBe(true);
  });

  it("ملف وظيفي ثانٍ لنفس المستخدم مرفوض", async () => {
    const existing = createdUsers[createdUsers.length - 1]!;
    const r = await createStaff({ userId: existing, employmentType: "INTERNAL" }, admin);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toContain("ملف وظيفي بالفعل");
  });
});

// ═══════════════════════════════════════════════════════════════════════

describe("القسم — «الأشخاص» محسوب لا مخزَّن (‏§4.6)", () => {
  it("العدد يتبع الواقع بلا أي عمود يُحدَّث", async () => {
    const before = await listDepartments({ includeInactive: false }, admin);
    if (!before.ok) throw new Error(before.error.message);
    const d0 = before.data.find((d) => d.id === deptId);
    const count0 = d0!._count.staff;

    const r = await createStaff(
      {
        fullName: "موظف اختبار للعدّ",
        phone: "07701110006",
        email: "counted@itest.local",
        employmentType: "INTERNAL",
        departmentId: deptId,
      },
      admin,
    );
    if (!r.ok) throw new Error(r.error.message);
    createdUsers.push(r.data.userId);

    const after = await listDepartments({ includeInactive: false }, admin);
    if (!after.ok) return;
    const d1 = after.data.find((d) => d.id === deptId);
    expect(d1!._count.staff).toBe(count0 + 1);

    // ولا عمود «عدد الأشخاص» في المخطّط أصلاً — تحقّق مباشر
    const { rows } = await client.query<{ n: string }>(
      `select count(*)::text n from information_schema.columns
       where table_name = 'Department' and column_name ilike '%count%'`,
    );
    expect(Number(rows[0]!.n), "ظهر عمود عدّاد على Department").toBe(0);
  });

  it("قسم مكرّر الاسم مرفوض برسالة عربية", async () => {
    const r = await createDepartment({ name: "قسم اختبار الصيانة" }, admin);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toContain("موجود بالفعل");
  });

  it("مهمة القسم قائمة مرجعية — والمكرّرة داخل القسم مرفوضة", async () => {
    const a = await createDepartmentTask(
      { departmentId: deptId, name: "تسريب ماء" },
      admin,
    );
    expect(a.ok).toBe(true);

    const b = await createDepartmentTask(
      { departmentId: deptId, name: "تسريب ماء" },
      admin,
    );
    expect(b.ok).toBe(false);
    if (b.ok) return;
    expect(b.error.message).toContain("قسم اختبار الصيانة");
  });

  it("مهمة لقسم غير موجود مرفوضة", async () => {
    const r = await createDepartmentTask(
      { departmentId: "itest_stf_no_dept", name: "أي شيء" },
      admin,
    );
    expect(r.ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════

describe("المهارات — ملصقات بمستويات، لا وحدة تدريب", () => {
  it("تُحفظ بمستوياتها وحقولها المعلوماتية", async () => {
    const userId = createdUsers[createdUsers.length - 1]!;
    const r = await setStaffSkills(
      {
        userId,
        skills: [
          { skillId: skillIds[0]!, level: "EXPERT", needsTraining: false, hasTrained: true },
          {
            skillId: skillIds[1]!,
            level: "BEGINNER",
            needsTraining: true,
            hasTrained: false,
            trainingNote: "يحتاج دورة أساسيات",
          },
        ],
      },
      admin,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.count).toBe(2);

    const saved = await prisma.staffSkill.findMany({
      where: { staffProfileId: userId },
      orderBy: { level: "asc" },
    });
    expect(saved).toHaveLength(2);
    const expert = saved.find((s) => s.skillId === skillIds[0]);
    expect(expert?.level).toBe("EXPERT");
    expect(expert?.hasTrained).toBe(true);
    const beginner = saved.find((s) => s.skillId === skillIds[1]);
    expect(beginner?.needsTraining).toBe(true);
    expect(beginner?.trainingNote).toBe("يحتاج دورة أساسيات");
  });

  it("**استبدال كامل** — المهارة المحذوفة تختفي", async () => {
    const userId = createdUsers[createdUsers.length - 1]!;
    const r = await setStaffSkills(
      { userId, skills: [{ skillId: skillIds[0]!, level: "ADVANCED" }] },
      admin,
    );
    expect(r.ok).toBe(true);

    const saved = await prisma.staffSkill.findMany({ where: { staffProfileId: userId } });
    expect(saved).toHaveLength(1);
    expect(saved[0]!.level).toBe("ADVANCED");
  });

  /**
   * ── 🔴 حارس على ما يقرؤه محرّر الواجهة ─────────────────────────────
   * `setStaffSkills` **يستبدل** المجموعة كلّها، ومحرّر المهارات في
   * `/admin/staff` يرسل ما قرأه من `listStaff`. فأي حقل لا يُخرجه
   * `listStaff` يُمحى في كل حفظ — **صامتاً، ولا شيء يُنبّه**.
   *
   * وقع ذلك على `trainingNote` فعلاً: كان خارج `select`. وهذا الاختبار
   * يجعل حذفه من `select` فشلاً بدل أن يكون فقداناً للبيانات عند العميل.
   */
  it("‏listStaff يُخرج كل ما يحتاجه محرّر المهارات لإعادة إرساله", async () => {
    const userId = createdUsers[createdUsers.length - 1]!;
    const r = await setStaffSkills(
      {
        userId,
        skills: [
          {
            skillId: skillIds[0]!,
            level: "ADVANCED",
            needsTraining: true,
            hasTrained: false,
            trainingNote: "يحتاج دورة سلامة كهربائية",
          },
        ],
      },
      admin,
    );
    expect(r.ok, r.ok ? "" : r.error.message).toBe(true);

    const listed = await listStaff({}, admin);
    if (!listed.ok) throw new Error(listed.error.message);

    const row = listed.data.rows.find((x) => x.userId === userId);
    const held = row?.skills.find((k) => k.skill.id === skillIds[0]);
    expect(held, "المهارة لم تظهر في القائمة").toBeDefined();

    /* كل حقل يرسله المحرّر يجب أن يعود من القائمة */
    expect(held?.level).toBe("ADVANCED");
    expect(held?.needsTraining).toBe(true);
    expect(held?.hasTrained).toBe(false);
    expect(
      held?.trainingNote,
      "trainingNote خارج select — المحرّر سيمحوه في أول حفظ",
    ).toBe("يحتاج دورة سلامة كهربائية");
  });

  it("قائمة فارغة تمسح كل المهارات ولا تفشل", async () => {
    const userId = createdUsers[createdUsers.length - 1]!;
    const r = await setStaffSkills({ userId, skills: [] }, admin);
    expect(r.ok).toBe(true);
    expect(await prisma.staffSkill.count({ where: { staffProfileId: userId } })).toBe(0);
  });

  it("المهارة الواحدة بمستويين مرفوضة", async () => {
    const userId = createdUsers[createdUsers.length - 1]!;
    const r = await setStaffSkills(
      {
        userId,
        skills: [
          { skillId: skillIds[0]!, level: "BEGINNER" },
          { skillId: skillIds[0]!, level: "EXPERT" },
        ],
      },
      admin,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toContain("لا تتكرّر");
  });

  it("مهارة غير موجودة مرفوضة", async () => {
    const userId = createdUsers[createdUsers.length - 1]!;
    const r = await setStaffSkills(
      { userId, skills: [{ skillId: "itest_stf_no_skill", level: "EXPERT" }] },
      admin,
    );
    expect(r.ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════

describe("التواجد — علم حضور بسيط", () => {
  it("يُضبط ويُقرأ، ولا يمنع شيئاً", async () => {
    const userId = createdUsers[createdUsers.length - 1]!;
    const off = await setStaffAvailability({ userId, isAvailable: false }, admin);
    expect(off.ok).toBe(true);
    if (!off.ok) return;
    expect(off.data.isAvailable).toBe(false);

    // ⚠️ الترشيح **اختياري**: الموظف غير المتواجد يبقى قابلاً للتكليف،
    // فقد يكون الوحيد المؤهَّل — والقرار للأدمن لا للنظام.
    const all = await listStaff({ departmentId: deptId }, admin);
    const onlyFree = await listStaff({ departmentId: deptId, onlyAvailable: true }, admin);
    if (!all.ok || !onlyFree.ok) return;
    expect(all.data.rows.some((s) => s.userId === userId)).toBe(true);
    expect(onlyFree.data.rows.some((s) => s.userId === userId)).toBe(false);
  });

  it("ملف وظيفي غير موجود مرفوض", async () => {
    const r = await setStaffAvailability(
      { userId: "itest_stf_nobody", isAvailable: true },
      admin,
    );
    expect(r.ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════

describe("🔴 B4 — قبض النقد", () => {
  it("لا أحد يقبض نقداً افتراضياً", async () => {
    const all = await listStaff({ departmentId: deptId }, admin);
    if (!all.ok) return;
    expect(all.data.rows.length).toBeGreaterThan(0);
    expect(all.data.rows.every((s) => s.canReceiveCash === false)).toBe(true);
  });

  /**
   * ⚠️ **كان اسم هذا الاختبار «والمنح موقوف حتى تُحسم سياسة الصندوق»**،
   * ويتحقّق أن `setStaffCashPermission` يرمي `PendingDecisionError("B4")`.
   *
   * **حُسم `B4` في 2026-09-01**: موظفون مُصرَّح لهم بالعلم · إقفال صندوق
   * يومي إلزامي · لا تأريخ في الماضي. فالحجب زال، وأُعيد كتابة الاختبار
   * ليفحص السلوك الجديد لا حُذف — «المنح فعلٌ صريح بسبب إلزامي» ادّعاءٌ
   * يحتاج حرساً كما احتاجه الرفض من قبل.
   *
   * وتفاصيل الصندوق والإقفال في `tests/integration/cash.test.ts`.
   */
  it("**المنح فعلٌ صريح بسبب إلزامي**", async () => {
    const userId = createdUsers[createdUsers.length - 1]!;

    // بلا سبب يُرفض — السبب يُكتب في التدقيق
    const noReason = await setStaffCashPermission(
      { userId, canReceiveCash: true, reason: "" },
      admin,
    );
    expect(noReason.ok, "قُبل منح بلا سبب").toBe(false);
    expect(
      (await prisma.staffProfile.findUnique({ where: { userId } }))?.canReceiveCash,
    ).toBe(false);

    // ومع سبب يمضي
    const granted = await setStaffCashPermission(
      { userId, canReceiveCash: true, reason: "أمين صندوق مركز الخدمة" },
      admin,
    );
    expect(granted.ok, granted.ok ? "" : granted.error.message).toBe(true);
    expect(
      (await prisma.staffProfile.findUnique({ where: { userId } }))?.canReceiveCash,
    ).toBe(true);

    // ⚠️ يُعاد إلى الافتراضي الآمن: الاختبار التالي يفحص «لا أحد يقبض»
    const revoked = await setStaffCashPermission(
      { userId, canReceiveCash: false, reason: "إعادة إلى الافتراضي بعد الاختبار" },
      admin,
    );
    expect(revoked.ok).toBe(true);
  });

  it("ولا سبيل لتمريره عبر نموذج الإنشاء", async () => {
    /**
     * ⚠️ `createStaff` **لا يقبل الحقل إطلاقاً**. حقلٌ في نموذج الإنشاء
     * يُملأ سهواً؛ فعلٌ صريح مستقلّ لا يُملأ سهواً.
     */
    const r = await createStaff(
      {
        fullName: "موظف اختبار نقد",
        phone: "07701110007",
        email: "cash@itest.local",
        employmentType: "INTERNAL",
        // الحقل غير موجود في مخطّط zod، فيُسقَط بلا خطأ — وهذا المقصود:
        // `defineAction` يستقبل `unknown` ويتحقّق بـzod، فما ليس في
        // المخطّط لا يصل إلى المعالج أصلاً.
        canReceiveCash: true,
      },
      admin,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    createdUsers.push(r.data.userId);
    expect(r.data.canReceiveCash).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════

describe("القوائم والترخيص", () => {
  it("قائمة الموظفين تُرشَّح بالمهارة — تلميح لا فرض", async () => {
    const withSkill = await listStaff({ skillId: skillIds[0]! }, admin);
    expect(withSkill.ok).toBe(true);
  });

  it("قائمة الشركات تعرض عدد موظفيها محسوباً", async () => {
    const r = await listVendors({ includeInactive: false }, admin);
    if (!r.ok) throw new Error(r.error.message);
    const v = r.data.find((x) => x.id === vendorId);
    expect(v?._count.staff).toBeGreaterThanOrEqual(1);
  });

  it("الساكن لا يصل إلى البيانات التنظيمية", async () => {
    const resident: ActorContext = { userId: f.roleUsers.RESIDENT, role: "RESIDENT" };
    const r = await listDepartments({ includeInactive: false }, resident);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).not.toMatch(/DEPARTMENTS_SKILLS_STAFF/);
  });

  it("المالك يقرأ ولا يكتب", async () => {
    const owner: ActorContext = { userId: f.roleUsers.OWNER, role: "OWNER" };
    const read = await listDepartments({ includeInactive: false }, owner);
    expect(read.ok).toBe(true);

    const write = await createDepartment({ name: "قسم اختبار يحاوله المالك" }, owner);
    expect(write.ok).toBe(false);
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  ترشيح · بحث · تصفيح — شاشة `/admin/staff`.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── 🔴 لماذا يوجد هذا الوصف ─────────────────────────────────────────
 * كان في الشاشة **مربّع بحث لا يعمل**: الحقل مُصيَّر، والقيمة لا تُمرَّر،
 * والإجراء لا يعرف `search` أصلاً. أي مستخدم يكتب فيه فلا يتغيّر شيء.
 *
 * وهذا أسوأ من غياب البحث: الغياب يُفهَم، والصمت يُقرأ **«لا نتائج»** —
 * فيستنتج الأدمن أن الموظف غير موجود ويُنشئه من جديد.
 */
describe("listStaff — ترشيح وبحث وتصفيح", () => {
  /** ⚠️ أكثر من صفحة: التصفيح لا يُختبَر ببيانات تسع في صفحة واحدة. */
  const EXTRA = 6;
  const pageSize = 5;

  beforeAll(async () => {
    for (let i = 0; i < EXTRA; i += 1) {
      const r = await createStaff(
        {
          fullName: `موظّف قائمة ${i}`,
          phone: `+9647515000${String(10 + i).padStart(3, "0")}`,
          email: `list${i}@example.com`,
          employmentType: "INTERNAL",
          departmentId: deptId,
          jobTitle: i === 0 ? "كهربائي أوّل" : "عامل",
        },
        admin,
      );
      if (!r.ok) throw new Error(r.error.message);
      createdUsers.push(r.data.userId);
    }
  }, 120_000);

  it("يصفّح بلا تكرار ولا نقص", async () => {
    const first = await listStaff({ page: 1, pageSize }, admin);
    const second = await listStaff({ page: 2, pageSize }, admin);
    if (!first.ok || !second.ok) throw new Error("فشل الجلب");

    expect(first.data.rows).toHaveLength(pageSize);
    expect(second.data.rows.length).toBeGreaterThan(0);

    /*
     * ⚠️ **التداخل هو العيب الذي يمرّ صامتاً.** ترتيبٌ غير حاسم مع
     * `skip/take` يُعيد نفس الصفّ في صفحتين ويُسقط آخر تماماً — والعدّاد
     * يبقى صحيحاً، فلا شيء يبدو معطوباً.
     */
    const ids = new Set(first.data.rows.map((r) => r.userId));
    const overlap = second.data.rows.filter((r) => ids.has(r.userId));
    expect(overlap, "صفّ ظهر في صفحتين").toEqual([]);
  });

  it("🔴 يبحث بالاسم — وكان الحقل زخرفة", async () => {
    const r = await listStaff({ search: "موظّف قائمة 0" }, admin);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.data.total).toBe(1);
    expect(r.data.rows[0]?.user.fullName).toBe("موظّف قائمة 0");
  });

  it("يبحث بالمسمّى الوظيفي", async () => {
    const r = await listStaff({ search: "كهربائي" }, admin);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.data.total).toBe(1);
  });

  it("🔴 يبحث بالهاتف **بصيغته المحلّية** لا بالمخزَّنة", async () => {
    /*
     * المخزَّن `+9647515000010`، ومن يبحث يكتب `0751 500 0010`. فبحثٌ
     * نصّي حرفيّ لا يجد شيئاً أبداً — والمستخدم يستنتج أن الموظف غير
     * موجود. تُنزَع غير الأرقام ويُسقَط الصفر البادئ.
     */
    const r = await listStaff({ search: "0751 500 0010" }, admin);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.data.total).toBe(1);
  });

  /**
   * ── 🔴 المعطَّل لا يُكلَّف ─────────────────────────────────────────
   * كان `onlyAvailable` يرشّح بعلم التواجد وحده. وموظّفٌ ترك العمل —
   * حسابه معطَّل — يبقى علمُه كما تركه، فيظهر في **قائمة من يُكلَّف**.
   * ثم يُسنَد إليه عمل ولا يصله شيء، ولا أحد يعرف لماذا تأخّر.
   */
  it("«المتواجدون فقط» يستثني من عُطِّل حسابه", async () => {
    const target = createdUsers[createdUsers.length - 1]!;

    const before = await listStaff({ onlyAvailable: true }, admin);
    if (!before.ok) throw new Error(before.error.message);
    const wasListed = before.data.rows.some((r) => r.userId === target);
    expect(wasListed, "الموظّف لم يكن متواجداً أصلاً — الاختبار لا يفحص شيئاً").toBe(true);

    const off = await setUserActive({ userId: target, isActive: false, reason: "انتهاء الخدمة" }, admin);
    expect(off.ok, off.ok ? "" : off.error.message).toBe(true);

    const after = await listStaff({ onlyAvailable: true }, admin);
    if (!after.ok) throw new Error(after.error.message);
    expect(
      after.data.rows.some((r) => r.userId === target),
      "معطَّل ظهر في قائمة من يُكلَّف",
    ).toBe(false);

    /* ⚠️ ويبقى في القائمة الكاملة معلَّماً — الحذف يقتل مراجع التدقيق */
    const all = await listStaff({}, admin);
    if (!all.ok) throw new Error(all.error.message);
    const row = all.data.rows.find((r) => r.userId === target);
    expect(row, "المعطَّل اختفى من القائمة الكاملة").toBeDefined();
    expect(row?.user.isActive).toBe(false);

    await setUserActive({ userId: target, isActive: true }, admin);
  });

  it("بحثٌ بلا نتيجة يُرجع صفراً لا خطأً", async () => {
    const r = await listStaff({ search: "لا_يوجد_هذا_الاسم_إطلاقاً" }, admin);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.data.total).toBe(0);
    expect(r.data.rows).toEqual([]);
  });

  it("يجمع البحث مع الترشيح بالقسم", async () => {
    /* ⚠️ المرشّحان **يتقاطعان** لا يتنافسان: بحثٌ يُلغي القسم يُرجع من ليس فيه */
    const r = await listStaff({ search: "موظّف قائمة", departmentId: deptId }, admin);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.data.total).toBe(EXTRA);

    const other = await listStaff(
      { search: "موظّف قائمة", departmentId: "does_not_exist" },
      admin,
    );
    if (!other.ok) throw new Error(other.error.message);
    expect(other.data.total).toBe(0);
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  تعديل الملفّ الوظيفي — وصفحة الموظّف الواحد.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── 🔴 الثغرة التي وُجدت من أجلها ───────────────────────────────────
 * لم يكن في النظام سبيلٌ إلى تعديل موظّف بعد إنشائه. وموظّفٌ يُنقَل من
 * الصيانة إلى الأمن كان يُنشَأ من جديد: يبقى الأوّل في القوائم، ويتفرّق
 * تدقيقه على ملفّين، وتُحسب أقدميّته من تاريخ خاطئ.
 */
describe("updateStaff — التعديل بعد الإنشاء", () => {
  it("ينقل الموظّف بين الأقسام ويُبقي ملفّه واحداً", async () => {
    const userId = createdUsers[0]!;

    const second = await createDepartment({ name: "قسم ثانٍ للاختبار" }, admin);
    if (!second.ok) throw new Error(second.error.message);

    const r = await updateStaff(
      { userId, employmentType: "INTERNAL", departmentId: second.data.id, jobTitle: "مشرف" },
      admin,
    );
    expect(r.ok, r.ok ? "" : r.error.message).toBe(true);

    const after = await prisma.staffProfile.findUnique({
      where: { userId },
      select: { departmentId: true, jobTitle: true },
    });
    expect(after?.departmentId).toBe(second.data.id);
    expect(after?.jobTitle).toBe("مشرف");

    /* ⚠️ ملفٌّ واحد لا اثنان — وهو جوهر المشكلة التي حُلَّت */
    const profiles = await prisma.staffProfile.count({ where: { userId } });
    expect(profiles).toBe(1);
  });

  it("🔴 النقل من VENDOR إلى INTERNAL يمسح الشركة", async () => {
    /*
     * بقاء `vendorId` على موظّف داخلي بيانٌ يناقض حالته، ويضلّل كل تقرير
     * يجمع حسب الشركة. والقيد `staff_vendor_requires_vendor` يمنع العكس
     * لا هذا — فالمسح قرار كود.
     */
    const vendor = await createVendor(
      { name: "شركة نقل للاختبار", phone: "+9647087000011" },
      admin,
    );
    if (!vendor.ok) throw new Error(vendor.error.message);

    const staff = await createStaff(
      {
        fullName: "موظّف بائع للنقل",
        phone: "+9647087000012",
        email: "vendormove@example.com",
        employmentType: "VENDOR",
        vendorId: vendor.data.id,
        departmentId: deptId,
      },
      admin,
    );
    if (!staff.ok) throw new Error(staff.error.message);
    createdUsers.push(staff.data.userId);

    const moved = await updateStaff(
      { userId: staff.data.userId, employmentType: "INTERNAL", departmentId: deptId },
      admin,
    );
    expect(moved.ok, moved.ok ? "" : moved.error.message).toBe(true);

    const after = await prisma.staffProfile.findUnique({
      where: { userId: staff.data.userId },
      select: { employmentType: true, vendorId: true },
    });
    expect(after?.employmentType).toBe("INTERNAL");
    expect(after?.vendorId, "بقيت الشركة على موظّف داخلي").toBeNull();
  });

  it("⚠️ VENDOR بلا شركة مرفوض — نفس شرط الإنشاء", async () => {
    const r = await updateStaff(
      { userId: createdUsers[0]!, employmentType: "VENDOR", departmentId: deptId },
      admin,
    );
    expect(r.ok, "مرّ بائع بلا شركة").toBe(false);
  });

  it("الفراغ يفكّ الإسناد إلى القسم", async () => {
    const userId = createdUsers[0]!;
    const r = await updateStaff(
      { userId, employmentType: "INTERNAL", departmentId: null },
      admin,
    );
    expect(r.ok, r.ok ? "" : r.error.message).toBe(true);

    const after = await prisma.staffProfile.findUnique({
      where: { userId },
      select: { departmentId: true },
    });
    expect(after?.departmentId).toBeNull();
  });

  it("قسم غير موجود مرفوض برسالة عربية", async () => {
    const r = await updateStaff(
      { userId: createdUsers[0]!, employmentType: "INTERNAL", departmentId: "no_such_dept" },
      admin,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("القسم غير موجود");
  });
});

describe("getStaff — ملفّ الموظّف الواحد", () => {
  it("يُرجع الملفّ والمهارات وجلسات الصندوق", async () => {
    const userId = createdUsers[0]!;
    const r = await getStaff({ userId }, admin);
    expect(r.ok, r.ok ? "" : r.error.message).toBe(true);
    if (!r.ok || r.data === null) throw new Error("لا ملفّ");

    expect(r.data.user.fullName).toBeTruthy();
    expect(Array.isArray(r.data.skills)).toBe(true);
    expect(Array.isArray(r.data.drawers)).toBe(true);
  });

  it("🔴 لا يُخفي المعطَّل", async () => {
    /*
     * من ترك العمل يبقى ملفّه مقروءاً: تدقيقه وجلسات صندوقه وقيوده تشير
     * إليه. وصفحةٌ تقول «غير موجود» تقطع الخيط على من يراجع بعد سنة.
     */
    const userId = createdUsers[0]!;
    await setUserActive({ userId, isActive: false, reason: "اختبار" }, admin);

    const r = await getStaff({ userId }, admin);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.data, "المعطَّل اختفى").not.toBeNull();
    expect(r.data?.user.isActive).toBe(false);

    await setUserActive({ userId, isActive: true }, admin);
  });

  it("معرّف غير موجود يُرجع null لا خطأً", async () => {
    const r = await getStaff({ userId: "no_such_user" }, admin);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toBeNull();
  });
});
