import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { cleanupTestData, connection, createFixture, testId } from "./helpers";
import { setMyAvailability, staffWorkspace } from "@/lib/services/staff-self";
import { prisma } from "@/lib/prisma";

/**
 * مساحة الموظف — النطاق والتدقيق.
 *
 * ⚠️ **ثلاثة ادّعاءات، كلٌّ منها أمنيّ أو تشغيليّ:**
 *   • الموظف يعدّل **تواجده هو** ولا شيء غيره — ولا `defineAction` يحرسه،
 *     لأن القدرة في §3.2 لا تفرّق بين «ملفّي» و«كل الموظفين». فالنطاق
 *     بنيويّ، وهذا الملف هو ما يحرسه.
 *   • التغيير **مُدقَّق**: «لماذا لم يُسنَد إليه الطلب؟» سؤال تشغيلي، وبلا
 *     سجلّ يصير كلمةً ضدّ كلمة.
 *   • «زملاء القسم» **لا تتسرّب** إلى أقسام أخرى — ولا يظهر فيها هو.
 */

let client: Client;

const DEPT_A = testId("dept_ss_a");
const DEPT_B = testId("dept_ss_b");
const ME = testId("u_ss_me");
const PEER = testId("u_ss_peer");
const OTHER_DEPT_USER = testId("u_ss_other");
const INACTIVE_PEER = testId("u_ss_gone");
const NO_PROFILE = testId("u_ss_bare");
const TASKS = [testId("dt_ss_1"), testId("dt_ss_2"), testId("dt_ss_off")];
const SKILL = testId("sk_ss");

async function addUser(id: string, name: string, phone: string, active = true) {
  await client.query(
    `insert into "User" (id,"fullName",phone,role,"isActive","updatedAt")
     values ($1,$2,$3,'STAFF',$4,now())`,
    [id, name, phone, active],
  );
}

async function addProfile(userId: string, deptId: string | null, title: string, available: boolean) {
  await client.query(
    `insert into "StaffProfile" ("userId","employmentType","departmentId","isAvailable","jobTitle","updatedAt")
     values ($1,'INTERNAL',$2,$3,$4,now())`,
    [userId, deptId, available, title],
  );
}

beforeAll(async () => {
  client = connection();
  await client.connect();
  await cleanupTestData(client);
  // الفكسچر يُنشأ **لأثره** (مستخدمو الأدوار الأربعة) لا لقيمته
  await createFixture(client, "ssf");

  for (const [id, name] of [[DEPT_A, "قسم اختبار الذات أ"], [DEPT_B, "قسم اختبار الذات ب"]]) {
    await client.query(
      `insert into "Department" (id,name,"isActive","updatedAt") values ($1,$2,true,now())`,
      [id, name],
    );
  }

  await addUser(ME, "موظف الاختبار نفسه", "+9647081000001");
  await addUser(PEER, "زميل في نفس القسم", "+9647081000002");
  await addUser(OTHER_DEPT_USER, "موظف قسم آخر", "+9647081000003");
  await addUser(INACTIVE_PEER, "زميل معطَّل", "+9647081000004", false);
  await addUser(NO_PROFILE, "موظف بلا ملفّ", "+9647081000005");

  await addProfile(ME, DEPT_A, "فنّي كهرباء", true);
  await addProfile(PEER, DEPT_A, "فنّي سباكة", false);
  await addProfile(OTHER_DEPT_USER, DEPT_B, "حارس", true);
  await addProfile(INACTIVE_PEER, DEPT_A, "فنّي سابق", true);
  // `NO_PROFILE` بلا `StaffProfile` عمداً — حالة حقيقية وقائمة

  // مهمّتان نشطتان وواحدة معطَّلة، ومهمّة في القسم الآخر
  await client.query(
    `insert into "DepartmentTask" (id,"departmentId",name,"isActive","updatedAt")
     values ($1,$2,'صيانة المصاعد',true,now()),
            ($3,$2,'صيانة المضخّات',true,now()),
            ($4,$2,'مهمّة موقوفة',false,now())`,
    [TASKS[0], DEPT_A, TASKS[1], TASKS[2]],
  );
  await client.query(
    `insert into "DepartmentTask" (id,"departmentId",name,"isActive","updatedAt")
     values ($1,$2,'مهمّة قسم آخر',true,now())`,
    [testId("dt_ss_bdept"), DEPT_B],
  );

  // مهارتان: واحدة تحتاج تدريباً وأخرى تدرَّب — لإثبات الترتيب والحالات الثلاث
  await client.query(
    `insert into "Skill" (id,name,"isActive","updatedAt") values ($1,'مهارة اختبار الذات',true,now())`,
    [SKILL],
  );
  await client.query(
    `insert into "StaffSkill" (id,"staffProfileId","skillId",level,"needsTraining","hasTrained","updatedAt")
     values ($1,$2,$3,'INTERMEDIATE',true,false,now())`,
    [testId("ssk_ss_1"), ME, SKILL],
  );
}, 180_000);

afterAll(async () => {
  await client.query(`delete from "StaffSkill" where id like $1`, [`${testId("ssk_ss")}%`]);
  await client.query(`delete from "Skill" where id = $1`, [SKILL]);
  await client.query(`delete from "DepartmentTask" where id like $1`, [`${testId("dt_ss")}%`]);
  await client.query(`delete from "AuditLog" where "entityId" like $1`, [`${testId("u_ss")}%`]);
  await client.query(`delete from "StaffProfile" where "userId" like $1`, [`${testId("u_ss")}%`]);
  await client.query(`delete from "User" where id like $1`, [`${testId("u_ss")}%`]);
  await client.query(`delete from "Department" where id like $1`, [`${testId("dept_ss")}%`]);
  await cleanupTestData(client);
  await client.end();
  await prisma.$disconnect();
});

describe("مساحة العمل", () => {
  it("تُرجع الملفّ والقسم", async () => {
    const ws = await staffWorkspace(ME);
    expect(ws.profile).not.toBeNull();
    expect(ws.profile!.departmentName).toBe("قسم اختبار الذات أ");
    expect(ws.profile!.jobTitle).toBe("فنّي كهرباء");
  });

  it("⚠️ مستخدم بلا ملفّ وظيفي: فراغ لا انفجار", async () => {
    const ws = await staffWorkspace(NO_PROFILE);
    expect(ws.profile).toBeNull();
    expect(ws.skills).toEqual([]);
    expect(ws.departmentTasks).toEqual([]);
    expect(ws.colleagues).toEqual([]);
  });

  it("⚠️ زملاء القسم: من قسمي وحده، وبلا أنا", async () => {
    const ws = await staffWorkspace(ME);
    const ids = ws.colleagues.map((c) => c.userId);
    expect(ids, "ظهر الموظف في قائمة «زملائه»").not.toContain(ME);
    expect(ids, "تسرّب موظف من قسم آخر").not.toContain(OTHER_DEPT_USER);
    expect(ids).toContain(PEER);
  });

  it("⚠️ الزميل المعطَّل ليس زميلاً حاضراً (‏§10.1)", async () => {
    const ws = await staffWorkspace(ME);
    expect(ws.colleagues.map((c) => c.userId)).not.toContain(INACTIVE_PEER);
  });

  it("مهام القسم: النشطة من قسمي وحدها", async () => {
    const ws = await staffWorkspace(ME);
    const names = ws.departmentTasks.map((t) => t.name);
    /**
     * ⚠️ **مجموعة لا قائمة مرتَّبة.** الترتيب `name: "asc"` يُنفّذه Postgres
     * بترتيب المحارف (‏collation) الخاص بالقاعدة، ويختلف بين البيئات. وثابتٌ
     * مكتوب بيدي هنا يفشل على خادم آخر بلا أن يكون في الكود عيب — وهو ما
     * وقع فعلاً: توقّعتُ ترتيباً عربياً فأعطت القاعدة غيره.
     *
     * وما يهمّ حقاً هو **أيّ** المهام تظهر: النشطة من قسمي وحدها.
     */
    expect(new Set(names)).toEqual(new Set(["صيانة المصاعد", "صيانة المضخّات"]));
    expect(names).toHaveLength(2);
    expect(names, "ظهرت مهمّة معطَّلة").not.toContain("مهمّة موقوفة");
    expect(names, "تسرّبت مهمّة قسم آخر").not.toContain("مهمّة قسم آخر");
  });

  it("⚠️ بلا قسم: لا زملاء ولا مهام — ولا استعلام على departmentId = null", async () => {
    /**
     * لو أُطلق الاستعلام على `departmentId: null` لعاد **كل من لا قسم له**
     * في المجمّع كزملاء. `NO_PROFILE` بلا ملفّ، فنستعمل موظفاً بملفّ بلا قسم.
     */
    const bareId = testId("u_ss_nodept");
    await addUser(bareId, "موظف بلا قسم", "+9647081000006");
    await addProfile(bareId, null, "غير مُسنَد", true);
    try {
      const ws = await staffWorkspace(bareId);
      expect(ws.profile).not.toBeNull();
      expect(ws.profile!.departmentId).toBeNull();
      expect(ws.colleagues).toEqual([]);
      expect(ws.departmentTasks).toEqual([]);
    } finally {
      await client.query(`delete from "StaffProfile" where "userId" = $1`, [bareId]);
      await client.query(`delete from "User" where id = $1`, [bareId]);
    }
  });

  it("المهارة التي تحتاج تدريباً تأتي أولاً", async () => {
    const second = testId("ssk_ss_2");
    const skill2 = testId("sk_ss2");
    await client.query(
      `insert into "Skill" (id,name,"isActive","updatedAt") values ($1,'مهارة ثانية للاختبار',true,now())`,
      [skill2],
    );
    await client.query(
      `insert into "StaffSkill" (id,"staffProfileId","skillId",level,"needsTraining","hasTrained","updatedAt")
       values ($1,$2,$3,'EXPERT',false,true,now())`,
      [second, ME, skill2],
    );
    try {
      const ws = await staffWorkspace(ME);
      expect(ws.skills).toHaveLength(2);
      expect(ws.skills[0]!.needsTraining, "ما يحتاج تدريباً لم يأتِ أولاً").toBe(true);
      expect(ws.skills[1]!.hasTrained).toBe(true);
    } finally {
      await client.query(`delete from "StaffSkill" where id = $1`, [second]);
      await client.query(`delete from "Skill" where id = $1`, [skill2]);
    }
  });
});

describe("تبديل التواجد", () => {
  it("⚠️ يمسّ ملفّي وحده", async () => {
    const peerBefore = await prisma.staffProfile.findUnique({
      where: { userId: PEER },
      select: { isAvailable: true },
    });

    const out = await setMyAvailability(ME, false);
    expect(out.ok).toBe(true);
    expect(out.isAvailable).toBe(false);

    const mine = await prisma.staffProfile.findUnique({
      where: { userId: ME },
      select: { isAvailable: true },
    });
    expect(mine!.isAvailable).toBe(false);

    const peerAfter = await prisma.staffProfile.findUnique({
      where: { userId: PEER },
      select: { isAvailable: true },
    });
    expect(peerAfter!.isAvailable, "تسرّب التغيير إلى زميل").toBe(
      peerBefore!.isAvailable,
    );

    await setMyAvailability(ME, true);
  });

  it("⚠️ يُدقَّق: القيمة قبل وبعد ومن فعلها", async () => {
    await client.query(`delete from "AuditLog" where "entityId" = $1`, [ME]);

    await setMyAvailability(ME, false, { ip: "10.0.0.99", userAgent: "vitest" });

    const rows = await prisma.auditLog.findMany({
      where: { entityId: ME, action: "setMyAvailability" },
      select: { actorUserId: true, entityType: true, before: true, after: true, ip: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorUserId).toBe(ME);
    expect(rows[0]!.entityType).toBe("StaffProfile");
    expect(rows[0]!.before).toEqual({ isAvailable: true });
    expect(rows[0]!.after).toEqual({ isAvailable: false });
    expect(rows[0]!.ip).toBe("10.0.0.99");

    await setMyAvailability(ME, true);
  });

  it("⚠️ نفس القيمة: لا كتابة ولا صفّ تدقيق", async () => {
    await client.query(`delete from "AuditLog" where "entityId" = $1`, [ME]);
    const current = await prisma.staffProfile.findUnique({
      where: { userId: ME },
      select: { isAvailable: true },
    });

    const out = await setMyAvailability(ME, current!.isAvailable);
    expect(out.ok).toBe(true);

    const rows = await prisma.auditLog.count({ where: { entityId: ME } });
    expect(rows, "نقرة بلا تغيير أنتجت صفّ تدقيق — يُغرق السجلّ").toBe(0);
  });

  it("⚠️ بلا ملفّ وظيفي: رفض برسالة عربية، ولا ملفّ يُنشأ", async () => {
    const out = await setMyAvailability(NO_PROFILE, false);
    expect(out.ok).toBe(false);
    expect(out.message).toBeTruthy();
    // §11.4: لا رموز خام في رسالة مستخدم
    expect(out.message).not.toMatch(/[A-Za-z]{3,}/);

    const created = await prisma.staffProfile.findUnique({ where: { userId: NO_PROFILE } });
    expect(created, "أُنشئ ملفّ وظيفي بلا قرار إدارة").toBeNull();
  });
});
