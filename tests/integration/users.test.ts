import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { cleanupTestData, connection, createFixture, testId, type Fixture } from "./helpers";
import { createUser, listUsers, setUserActive } from "@/lib/actions/users";
import type { ActorContext } from "@/lib/actions/define-action";
import type { UserRole } from "@/lib/auth/roles";
import { prisma } from "@/lib/prisma";

/**
 * الخطوة 0.14 — تعريف الإنجاز:
 * «قاعدة فارغة + seed ← المالك يدخل ويُنشئ أدمن؛ والأدمن يُنشئ موظفاً وساكناً»
 * **= تعريف إنجاز المرحلة P0 كاملاً.**
 *
 * وهذا الاختبار يُثبت الفراغين `V2` و`V3` مسدودَين فعلاً لا ادّعاءً.
 */

let client: Client;
let f: Fixture;
const created: string[] = [];

const actor = (role: UserRole, userId: string): ActorContext => ({
  userId,
  role,
  ip: "10.0.0.9",
  userAgent: "vitest",
});

/** رقم فريد لكل حالة — التفريد على الهاتف حقيقي. */
let seq = 0;
const phone = (): string => `077${String(++seq).padStart(8, "0")}`;

beforeAll(async () => {
  client = connection();
  await client.connect();
  await cleanupTestData(client);
  await client.query(`delete from "User" where phone like '+96477%' and "fullName" like 'اختبار%'`);
  f = await createFixture(client, "users");
}, 90_000);

afterAll(async () => {
  if (created.length > 0) {
    await client.query(`delete from "AuditLog" where "actorUserId" = any($1)`, [created]);
    await client.query(`delete from "User" where id = any($1)`, [created]);
  }
  await client.query(`delete from "User" where "fullName" like 'اختبار%'`);
  await cleanupTestData(client);
  await client.end().catch(() => {});
  await prisma.$disconnect().catch(() => {});
}, 90_000);

async function makeUser(as: ActorContext, role: UserRole, name: string, email?: string) {
  const r = await createUser(
    {
      fullName: `اختبار ${name}`,
      phone: phone(),
      role,
      ...(email ? { email } : role === "RESIDENT" ? {} : { email: `${name}@test.local` }),
    },
    as,
  );
  if (r.ok) created.push(r.data.id);
  return r;
}

describe("🔴 V2 — مسار الإقلاع: المالك يُنشئ الأدمن", () => {
  it("**المالك يُنشئ أدمن** — الفعل الذي لا وجود له في §9.2", async () => {
    const r = await makeUser(actor("OWNER", f.roleUsers.OWNER), "ADMIN", "admin1");
    expect(r.ok, r.ok ? "" : r.error.message).toBe(true);
    if (r.ok) {
      expect(r.data.role).toBe("ADMIN");
      // R3: الرقم مطبَّع رغم أنه أُدخل بصيغة محلّية
      expect(r.data.phone.startsWith("+9647")).toBe(true);
    }
  });

  it("الأدمن يُنشئ موظفاً وساكناً — بقيّة تعريف إنجاز P0", async () => {
    const admin = actor("ADMIN", f.roleUsers.ADMIN);
    const staff = await makeUser(admin, "STAFF", "staff1");
    const resident = await makeUser(admin, "RESIDENT", "resident1");
    expect(staff.ok, staff.ok ? "" : staff.error.message).toBe(true);
    expect(resident.ok, resident.ok ? "" : resident.error.message).toBe(true);
  });
});

describe("🔴 §3.2 — «الأدمن: F عدا OWNER» مفروضة لا موصوفة", () => {
  it("**الأدمن لا يستطيع إنشاء مالك**", async () => {
    const r = await makeUser(actor("ADMIN", f.roleUsers.ADMIN), "OWNER", "owner2");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("BUSINESS_RULE");
      expect(r.error.message).toContain("مالك");
    }
  });

  it("الموظف والساكن لا يُنشئان أحداً — تُردّ عند بوّابة الصلاحية", async () => {
    for (const role of ["STAFF", "RESIDENT"] as const) {
      const r = await makeUser(actor(role, f.roleUsers[role]), "RESIDENT", `x${role}`);
      expect(r.ok, role).toBe(false);
      if (!r.ok) expect(r.error.code, role).toBe("FORBIDDEN");
    }
  });

  it("**الأدمن لا يستطيع تعطيل المالك** — لا يعزل من يراقبه", async () => {
    const r = await setUserActive(
      { userId: f.roleUsers.OWNER, isActive: false },
      actor("ADMIN", f.roleUsers.ADMIN),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("BUSINESS_RULE");
  });
});

describe("R1 — مالك نشط واحد، مفروضاً من قاعدة البيانات", () => {
  it("**مالك نشط ثانٍ مرفوض** — والقاعدة تمنعه لا التطبيق", async () => {
    /**
     * ── 🔴 الاختبار يُنشئ المالك النشط بنفسه ─────────────────────────
     * كان يقرأ عدد المالكين النشطين ويشترط ‏≥1 — أي أنه كان يستند إلى
     * **مالك البوت‑ستراب الحقيقي في قاعدة التطوير**، وهو بيانٌ لم يُنشئه.
     *
     * فحين عُزلت الاختبارات في مخطّط خاص لم يكن هناك مالك، فسقط الاختبار
     * على شرطه المسبق لا على ما يفحصه. واختبارٌ يستند إلى بيانات لم
     * يُنشئها يفشل حين تختفي، **ويمرّ لأسباب لا يعرفها حين توجد**.
     *
     * ⚠️ والفكسچر يُنشئ المالك **غير نشط** عمداً (‏`role !== "OWNER"`)
     * تفادياً لخرق `uniq_active_owner`. فالنشط يُنشأ هنا وحده.
     */
    const activeOwnerId = testId("u_active_owner");
    await client.query(
      `insert into "User" (id,"fullName",phone,role,"isActive","updatedAt")
       values ($1,'مالك نشط للاختبار','+9647090000099','OWNER',true,now())`,
      [activeOwnerId],
    );

    try {
      const { rows } = await client.query<{ n: number }>(
        `select count(*)::int n from "User" where role = 'OWNER' and "isActive"`,
      );
      expect(Number(rows[0]?.n), "المالك النشط لم يُنشأ").toBe(1);

      const r = await makeUser(actor("OWNER", f.roleUsers.OWNER), "OWNER", "owner_dup");
      expect(r.ok, "مرّ مالك نشط ثانٍ!").toBe(false);
      if (!r.ok) {
        expect(r.error.code).toBe("CONFLICT");
        // ⚠️ رسالة عربية مفهومة لا خطأ Prisma خام — وهذا ما كان يتسرّب
        // قبل توحيد collectErrorText، لأن اسم القيد مدفون في meta.
        expect(r.error.message).toContain("مالك نشط");
      }
    } finally {
      /*
       * ⚠️ **يُعطَّل في `finally` لا يُترك.** بقاؤه نشطاً يمنع أي اختبار
       * لاحق من إنشاء مالك — والفهرس الفريد الجزئي لا يفرّق بين مالكٍ
       * نسيه اختبارٌ ومالكٍ حقيقي.
       */
      await client.query(`update "User" set "isActive" = false where id = $1`, [
        activeOwnerId,
      ]);
    }
  });
});

describe("R3 — تطبيع الهاتف وتفريده", () => {
  it("رقم بصيغة محلّية يُخزَّن E.164", async () => {
    const r = await createUser(
      { fullName: "اختبار تطبيع", phone: "0770 999 8877", role: "RESIDENT" },
      actor("ADMIN", f.roleUsers.ADMIN),
    );
    expect(r.ok, r.ok ? "" : r.error.message).toBe(true);
    if (r.ok) {
      created.push(r.data.id);
      expect(r.data.phone).toBe("+9647709998877");
    }
  });

  it("**نفس الرقم بصيغة أخرى يُرفض** — وإلا صار للشخص حسابان", async () => {
    const r = await createUser(
      { fullName: "اختبار مكرر", phone: "+964 770 999 8877", role: "RESIDENT" },
      actor("ADMIN", f.roleUsers.ADMIN),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("CONFLICT");
      expect(r.error.message).toContain("الهاتف");
    }
  });

  it("رقم غير صالح ← خطأ حقل عربي", async () => {
    const r = await createUser(
      { fullName: "اختبار رقم", phone: "07601234567", role: "RESIDENT" },
      actor("ADMIN", f.roleUsers.ADMIN),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("VALIDATION");
      expect(r.error.fieldErrors?.["phone"]?.[0]).toContain("بادئة");
    }
  });
});

describe("§10.1 — البريد إلزامي لمن يدخل بـGoogle", () => {
  it("أدمن بلا بريد مرفوض — المطابقة تقع على البريد", async () => {
    const r = await createUser(
      { fullName: "اختبار بلا بريد", phone: phone(), role: "ADMIN" },
      actor("OWNER", f.roleUsers.OWNER),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("البريد");
  });

  it("ساكن بلا بريد **مقبول** — يدخل بالهاتف", async () => {
    const r = await createUser(
      { fullName: "اختبار ساكن", phone: phone(), role: "RESIDENT" },
      actor("ADMIN", f.roleUsers.ADMIN),
    );
    expect(r.ok, r.ok ? "" : r.error.message).toBe(true);
    if (r.ok) created.push(r.data.id);
  });
});

describe("🔴 V3 — التعطيل هو آلية منع الدخول الوحيدة (R2)", () => {
  it("الأدمن يُعطّل موظفاً", async () => {
    const staff = await makeUser(actor("ADMIN", f.roleUsers.ADMIN), "STAFF", "staff_off");
    expect(staff.ok).toBe(true);
    if (!staff.ok) return;

    const off = await setUserActive(
      { userId: staff.data.id, isActive: false, reason: "ترك العمل" },
      actor("ADMIN", f.roleUsers.ADMIN),
    );
    expect(off.ok, off.ok ? "" : off.error.message).toBe(true);
    if (off.ok) expect(off.data.isActive).toBe(false);

    const { rows } = await client.query<{ isActive: boolean }>(
      `select "isActive" from "User" where id = $1`,
      [staff.data.id],
    );
    expect(rows[0]!.isActive).toBe(false);
  });

  it("**لا أحد يُعطّل نفسه** — وإلا خرج بلا سبيل للعودة", async () => {
    const r = await setUserActive(
      { userId: f.roleUsers.ADMIN, isActive: false },
      actor("ADMIN", f.roleUsers.ADMIN),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("حسابك");
  });

  it("لا حذف صلب — المستخدم المعطَّل يبقى في الجدول (‏R2)", async () => {
    const { rows } = await client.query<{ n: string }>(
      `select count(*) n from "User" where "isActive" = false and "fullName" like 'اختبار%'`,
    );
    expect(Number(rows[0]!.n)).toBeGreaterThan(0);
  });
});

describe("التدقيق والقائمة", () => {
  it("كل إنشاء وتعطيل يكتب صفّ تدقيق", async () => {
    const { rows } = await client.query<{ action: string; n: string }>(
      `select action, count(*) n from "AuditLog"
       where action in ('user.create','user.set_active') group by action`,
    );
    const byAction = Object.fromEntries(rows.map((r) => [r.action, Number(r.n)]));
    expect(byAction["user.create"], "لا تدقيق للإنشاء").toBeGreaterThan(0);
    expect(byAction["user.set_active"], "لا تدقيق للتعطيل").toBeGreaterThan(0);
  });

  it("القائمة مُصفَّحة من الخادم ولا تعرض المعطَّلين افتراضياً", async () => {
    const r = await listUsers({ page: 1, includeInactive: false }, actor("ADMIN", f.roleUsers.ADMIN));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.pageSize).toBe(25);
      expect(r.data.rows.length).toBeLessThanOrEqual(25);
      expect(r.data.rows.every((u) => u.isActive)).toBe(true);
    }
  });

  it("الساكن لا يرى قائمة المستخدمين إطلاقاً", async () => {
    const r = await listUsers({ page: 1 }, actor("RESIDENT", f.roleUsers.RESIDENT));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });
});
