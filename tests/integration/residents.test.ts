import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { cleanupTestData, connection, createFixture, type Fixture } from "./helpers";
import {
  createResident,
  linkResidentToApartment,
  listResidents,
  unlinkResident,
  updateResident,
} from "@/lib/actions/residents";
import { createBuilding } from "@/lib/actions/buildings";
import type { ActorContext } from "@/lib/actions/define-action";
import { prisma } from "@/lib/prisma";

/**
 * الخطوتان 1.3 و1.4 — تعريف الإنجاز:
 *   «محاولة تعيين صاحب عقد ثانٍ **تُرفض**»
 *   «إخراج آخر ساكن **يُظهر مطالبة الإخلاء**» (‏R13)
 *   «مستخدم مربوط بشقتين يعمل في كل الشاشات» (‏R11)
 */

let client: Client;
let f: Fixture;
let admin: ActorContext;
let buildingId = "";
const aptIds: string[] = [];
const created: string[] = [];

beforeAll(async () => {
  client = connection();
  await client.connect();
  await cleanupTestData(client);
  await client.query(`delete from "User" where "fullName" like 'ساكن اختبار%'`);
  f = await createFixture(client, "res");
  admin = { userId: f.roleUsers.ADMIN, role: "ADMIN", ip: "10.0.0.8", userAgent: "vitest" };

  const b = await createBuilding(
    {
      code: "ITres2",
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
}, 120_000);

afterAll(async () => {
  await client.query(`delete from "ApartmentResident" where "apartmentId" = any($1)`, [aptIds]);
  await client.query(`delete from "Apartment" where "buildingId" = $1`, [buildingId]);
  await client.query(`delete from "Building" where id = $1`, [buildingId]);
  if (created.length > 0) {
    await client.query(`delete from "AuditLog" where "entityId" = any($1)`, [created]);
    await client.query(`delete from "ResidentProfile" where "userId" = any($1)`, [created]);
    await client.query(`delete from "User" where id = any($1)`, [created]);
  }
  await client.query(`delete from "AuditLog" where "actorUserId" like 'itest_%'`);
  await cleanupTestData(client);
  await client.end().catch(() => {});
  await prisma.$disconnect().catch(() => {});
}, 90_000);

let seq = 0;
const phone = (): string => `078${String(++seq).padStart(8, "0")}`;

async function makeResident(name: string) {
  const r = await createResident({ fullName: `ساكن اختبار ${name}`, phone: phone() }, admin);
  if (r.ok) created.push(r.data.id);
  return r;
}

describe("إنشاء ساكن — مستخدم وملف في معاملة واحدة", () => {
  it("يُنشئ الاثنين معاً", async () => {
    const r = await makeResident("أ");
    expect(r.ok, r.ok ? "" : r.error.message).toBe(true);
    if (!r.ok) return;

    const { rows } = await client.query<{ n: string }>(
      `select count(*) n from "ResidentProfile" where "userId" = $1`,
      [r.data.id],
    );
    expect(Number(rows[0]!.n), "لم يُنشأ الملف الشخصي").toBe(1);
  });

  it("الساكن يُنشأ بلا بريد — يدخل بالهاتف", async () => {
    const r = await makeResident("ب");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.email).toBeNull();
  });

  it("R6 — «تمتلك سيارة/باج» مشتقّة لا مخزَّنة", async () => {
    // ⚠️ الفحص على **النوع** لا على مقطع في الاسم: `residenceCardImageUrl`
    // يحوي «card» وفيها «car»، فالفحص النصّي الساذج يُنذر كذباً — وقد
    // أنذر فعلاً في أول تشغيل.
    // ما تقوله R6 حرفياً: لا تُخزَّن **قيمة** تعبّر عن ملكية سيارة أو باج،
    // لأنها تتناقض حتماً مع جدولَي Vehicle و Badge عند أول تغيير.
    const { rows } = await client.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_name = 'ResidentProfile' and data_type = 'boolean'`,
    );
    expect(rows, "ظهر حقل boolean في ملف الساكن — R6 يمنع تخزين المشتقّ").toEqual([]);
  });

  it("هاتف طوارئ غير صالح ← خطأ حقل عربي", async () => {
    const r = await createResident(
      { fullName: "ساكن اختبار ج", phone: phone(), emergencyPhone: "0760000" },
      admin,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION");
  });
});

describe("🔴 V4 — تعديل بيانات ساكن بعد الإنشاء", () => {
  it("**يعدّل الاسم والهاتف** — الإجراء الذي لا وجود له في §9.2", async () => {
    const made = await makeResident("د");
    expect(made.ok).toBe(true);
    if (!made.ok) return;

    const newPhone = phone();
    const r = await updateResident(
      { userId: made.data.id, fullName: "ساكن اختبار د المعدَّل", phone: newPhone },
      admin,
    );
    expect(r.ok, r.ok ? "" : r.error.message).toBe(true);
    if (r.ok) {
      expect(r.data.fullName).toBe("ساكن اختبار د المعدَّل");
      expect(r.data.phone.startsWith("+9647")).toBe(true);
    }
  });

  it("تعديل إلى هاتف مستخدَم ← تعارض برسالة عربية", async () => {
    const a = await makeResident("هـ");
    const b = await makeResident("و");
    if (!a.ok || !b.ok) return;

    const r = await updateResident({ userId: b.data.id, phone: a.data.phone }, admin);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("CONFLICT");
      expect(r.error.message).toContain("الهاتف");
    }
  });

  it("لا يعمل على غير السكان", async () => {
    const r = await updateResident({ userId: f.roleUsers.STAFF, fullName: "محاولة" }, admin);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("للسكان");
  });
});

describe("🔴 صاحب عقد نشط واحد لكل شقة", () => {
  it("الأول يمرّ", async () => {
    const u = await makeResident("صاحب1");
    if (!u.ok) return;
    const r = await linkResidentToApartment(
      { apartmentId: aptIds[0]!, userId: u.data.id, relationType: "OTHER", isContractHolder: true },
      admin,
    );
    expect(r.ok, r.ok ? "" : r.error.message).toBe(true);
  });

  it("**الثاني مرفوض — والقاعدة تمنعه لا التطبيق**", async () => {
    const u = await makeResident("صاحب2");
    if (!u.ok) return;
    const r = await linkResidentToApartment(
      { apartmentId: aptIds[0]!, userId: u.data.id, relationType: "OTHER", isContractHolder: true },
      admin,
    );
    expect(r.ok, "مرّ صاحب عقد ثانٍ!").toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("CONFLICT");
      expect(r.error.message).toContain("صاحب عقد");
    }
  });

  it("فرد أسرة **غير** صاحب عقد يمرّ على نفس الشقة", async () => {
    const u = await makeResident("فرد");
    if (!u.ok) return;
    const r = await linkResidentToApartment(
      {
        apartmentId: aptIds[0]!,
        userId: u.data.id,
        relationType: "FAMILY_MEMBER",
        isContractHolder: false,
      },
      admin,
    );
    expect(r.ok, r.ok ? "" : r.error.message).toBe(true);
  });

  it("ربط مكرَّر لنفس الشخص على نفس الشقة مرفوض", async () => {
    const u = await makeResident("مكرر");
    if (!u.ok) return;
    const first = await linkResidentToApartment(
      { apartmentId: aptIds[1]!, userId: u.data.id, relationType: "OTHER" },
      admin,
    );
    expect(first.ok).toBe(true);
    const second = await linkResidentToApartment(
      { apartmentId: aptIds[1]!, userId: u.data.id, relationType: "OTHER" },
      admin,
    );
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe("CONFLICT");
  });
});

describe("R11 — المستخدم قد يُربط بأكثر من شقة", () => {
  it("**مالك يسكن واحدة ويؤجّر أخرى**", async () => {
    const u = await makeResident("متعدد");
    if (!u.ok) return;

    const a = await linkResidentToApartment(
      { apartmentId: aptIds[1]!, userId: u.data.id, relationType: "OTHER" },
      admin,
    );
    const b = await linkResidentToApartment(
      { apartmentId: aptIds[2]!, userId: u.data.id, relationType: "OTHER" },
      admin,
    );
    expect(a.ok, a.ok ? "" : a.error.message).toBe(true);
    expect(b.ok, b.ok ? "" : b.error.message).toBe(true);

    const list = await listResidents({ search: "متعدد", page: 1 }, admin);
    expect(list.ok).toBe(true);
    if (list.ok) {
      const row = list.data.rows.find((r) => r.id === u.data.id);
      expect(row?.apartmentLinks.length, "لم تظهر الشقتان").toBe(2);
    }
  });
});

describe("🔴 Q41 — الموظف المقيم", () => {
  it("**موظف يُربط بشقة ودوره يبقى STAFF**", async () => {
    const r = await linkResidentToApartment(
      { apartmentId: aptIds[2]!, userId: f.roleUsers.STAFF, relationType: "OTHER" },
      admin,
    );
    expect(r.ok, r.ok ? "" : r.error.message).toBe(true);

    const { rows } = await client.query<{ role: string }>(
      `select role::text from "User" where id = $1`,
      [f.roleUsers.STAFF],
    );
    expect(rows[0]!.role, "تغيّر دور الموظف!").toBe("STAFF");
  });

  it("مستخدم معطَّل لا يُربط بشقة", async () => {
    await client.query(`update "User" set "isActive" = false where id = $1`, [f.roleUsers.RESIDENT]);
    const r = await linkResidentToApartment(
      { apartmentId: aptIds[2]!, userId: f.roleUsers.RESIDENT, relationType: "OTHER" },
      admin,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("معطَّل");
    await client.query(`update "User" set "isActive" = true where id = $1`, [f.roleUsers.RESIDENT]);
  });
});

describe("🔴 R13 — إخراج آخر ساكن يُطالب بالإخلاء", () => {
  it("**المطالبة تظهر ولا يُغيَّر السكن تلقائياً**", async () => {
    // شقة نظيفة بساكن واحد
    const u = await makeResident("وحيد");
    if (!u.ok) return;
    const apt = aptIds[1]!;

    await client.query(`delete from "ApartmentResident" where "apartmentId" = $1`, [apt]);
    await client.query(
      `update "Apartment" set "occupancyStatus" = 'OCCUPIED_BY_OWNER',
       "constructionStatus" = 'COMPLETED' where id = $1`,
      [apt],
    );

    const link = await linkResidentToApartment(
      { apartmentId: apt, userId: u.data.id, relationType: "OTHER" },
      admin,
    );
    expect(link.ok).toBe(true);
    if (!link.ok) return;

    const out = await unlinkResident({ apartmentResidentId: link.data.id }, admin);
    expect(out.ok, out.ok ? "" : out.error.message).toBe(true);
    if (out.ok) {
      expect(out.data.remainingResidents).toBe(0);
      expect(out.data.promptSetVacant, "لم تظهر مطالبة الإخلاء").toBe(true);
    }

    // ⚠️ **لم تُغيَّر حالة السكن تلقائياً** — الإخلاء قرار إداري له أثر مالي
    const { rows } = await client.query<{ status: string }>(
      `select "occupancyStatus"::text status from "Apartment" where id = $1`,
      [apt],
    );
    expect(rows[0]!.status, "غُيّرت حالة السكن تلقائياً!").toBe("OCCUPIED_BY_OWNER");
  });

  it("إخراج ساكن وليس الأخير لا يُطالب", async () => {
    const apt = aptIds[0]!;
    const { rows } = await client.query<{ id: string }>(
      `select id from "ApartmentResident" where "apartmentId" = $1 and "isActive" limit 1`,
      [apt],
    );
    if (!rows[0]) return;
    const out = await unlinkResident({ apartmentResidentId: rows[0].id }, admin);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.data.promptSetVacant).toBe(false);
  });

  it("إخراج ربط منتهٍ مرفوض", async () => {
    const { rows } = await client.query<{ id: string }>(
      `select id from "ApartmentResident" where not "isActive" limit 1`,
    );
    if (!rows[0]) return;
    const r = await unlinkResident({ apartmentResidentId: rows[0].id }, admin);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("منتهٍ");
  });
});

/**
 * ⚠️ **قسم كُتب بعد اكتشاف عطبين حقيقيين، لا استكمالاً للتغطية.**
 *
 * الأول: `linkResidentToApartment` رفع شرط الدور بحكم `Q41` (الحارس
 * المقيم يبقى `STAFF`)، بينما `listResidents` كان يرشّح `role = RESIDENT`
 * دائماً — فالموظف الساكن يُربط بالخلفية **ولا يظهر في أي منتقٍ**.
 *
 * والثاني كشفه إصلاح الأول: شرط الدور وشرط البحث كلاهما `OR`، ووضعهما
 * مفتاحَين في كائن واحد يجعل الثاني **يمحو الأول صامتاً** — فيتجاوز
 * البحثُ ترشيحَ الدور بالكامل ويُرجع الأدمن في «قائمة السكان».
 */
describe("Q41: الموظف الساكن، وتركيب شروط البحث", () => {
  const staffResidentApt = () => aptIds[2]!;

  it("الموظف الساكن لا يظهر في القائمة الافتراضية", async () => {
    await linkResidentToApartment(
      {
        apartmentId: staffResidentApt(),
        userId: f.roleUsers.STAFF,
        relationType: "OTHER",
        isContractHolder: false,
      },
      admin,
    );

    const r = await listResidents({ apartmentId: staffResidentApt() }, admin);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.rows.map((x) => x.id)).not.toContain(f.roleUsers.STAFF);
  });

  it("ويظهر عند طلبه صراحةً — وإلا تعذّر اختياره في أي منتقٍ", async () => {
    const r = await listResidents(
      { apartmentId: staffResidentApt(), includeNonResidentRoles: true },
      admin,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.rows.map((x) => x.id)).toContain(f.roleUsers.STAFF);
  });

  it("**البحث لا يتجاوز ترشيح الدور** — لا يظهر الأدمن في قائمة السكان", async () => {
    // المُثبِّت ينشئ مستخدماً اسمه «مستخدم ADMIN» بدور ADMIN
    const r = await listResidents(
      { search: "مستخدم", includeNonResidentRoles: true },
      admin,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // الأدمن مطابق للبحث بالاسم، وليس ساكناً ولا مرتبطاً بشقة ← يجب ألا يظهر
    expect(r.data.rows.map((x) => x.id)).not.toContain(f.roleUsers.ADMIN);
  });
});
