import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { cleanupTestData, connection, createFixture, testId, type Fixture } from "./helpers";
import { searchFor } from "@/lib/services/search";
import { markAllReadFor, notificationsFor } from "@/lib/services/notifications";
import { prisma } from "@/lib/prisma";
import { now } from "@/lib/dates";

/**
 * أدوات الشريط العلوي: البحث العامّ وجرس الإخطارات.
 *
 * ⚠️ **كلاهما ادّعاء أمني، والادّعاء بلا اختبار ظنّ.**
 *   • البحث يعبر ثلاث قدرات ويقتصر على `ADMIN`/`OWNER` — وتوسيعه سهوًا
 *     يفتح الشقق والسكان والعقود لمن لا نطاق مُثبت له.
 *   • الجرس منطقه أن **لا أحد يرى إخطارات غيره**، ونطاقه بنيويّ لا
 *     صلاحيّ — أي لا `defineAction` يحرسه. فهذا الملف هو ما يحرسه.
 */

let client: Client;
let f: Fixture;

const OTHER_USER = testId("u_bell_other");
const notifIds: string[] = [];

/**
 * طابعة القراءة الأصلية للصفّ المقروء، **مقروءةً من القاعدة قبل أي تعليم**.
 *
 * ⚠️ لا تُقارَن بقيمة حرفية: العمود `timestamp` بلا منطقة، ومُشغّل `pg`
 * يكتب ساعة الحائط المحلّية — فأي ثابت ISO في الاختبار يفشل على خادم
 * بمنطقة أخرى بلا أن يكون في الكود عيب. المقارنة **قبل/بعد** تُثبت
 * «لم يُكتب فوقها» بلا افتراض عن التمثيل.
 */
let originalReadAt: Date | null = null;

beforeAll(async () => {
  client = connection();
  await client.connect();
  await cleanupTestData(client);
  f = await createFixture(client, "tbr");

  // مستخدم ثانٍ — بلا «آخر» لا يمكن إثبات أن النطاق يعزل أصلاً
  await client.query(
    `insert into "User" (id,"fullName",phone,role,"isActive","updatedAt")
     values ($1,'مستخدم جرس آخر','+9647099000111','ADMIN',true,now())`,
    [OTHER_USER],
  );

  /**
   * ثلاثة إخطارات: اثنان لصاحبنا (أحدهما مقروء) وواحد للآخر.
   * والمقروء ضروريّ: بدونه لا يمكن إثبات أن `markAllReadFor` **لا** يكتب
   * فوق طابعة زمنية قائمة.
   */
  const seed = [
    { id: testId("n_mine_unread"), user: f.roleUsers.ADMIN, body: "إخطار غير مقروء", read: null },
    {
      id: testId("n_mine_read"),
      user: f.roleUsers.ADMIN,
      body: "إخطار مقروء سابقاً",
      read: new Date("2026-01-01T10:00:00.000Z"),
    },
    { id: testId("n_other"), user: OTHER_USER, body: "إخطار مستخدم آخر", read: null },
  ];

  for (const n of seed) {
    notifIds.push(n.id);
    await client.query(
      `insert into "Notification" (id,"userId",channel,"templateKey",payload,body,status,"readAt")
       values ($1,$2,'IN_APP','itest.bell','{}'::jsonb,$3,'SENT',$4)`,
      [n.id, n.user, n.body, n.read],
    );
  }

  /**
   * ⚠️ إخطار واتساب لصاحبنا: الجرس يجب أن **يستثنيه**. بلا هذا الصفّ كان
   * ترشيح القناة سيمرّ بلا اختبار — فيُعرض ما أُرسل إلى الهاتف مرّة ثانية.
   */
  const waId = testId("n_mine_whatsapp");
  notifIds.push(waId);
  await client.query(
    `insert into "Notification" (id,"userId",channel,"templateKey",payload,body,status,"readAt")
     values ($1,$2,'WHATSAPP','itest.bell','{}'::jsonb,'رسالة واتساب','SENT',null)`,
    [waId, f.roleUsers.ADMIN],
  );

  const seeded = await prisma.notification.findUnique({
    where: { id: testId("n_mine_read") },
    select: { readAt: true },
  });
  originalReadAt = seeded!.readAt;
  if (originalReadAt === null) throw new Error("لم تُزرع طابعة القراءة — الاختبار سيصير أجوف");
}, 180_000);

afterAll(async () => {
  await client.query(`delete from "Notification" where id = any($1)`, [notifIds]);
  await client.query(`delete from "User" where id = $1`, [OTHER_USER]);
  await cleanupTestData(client);
  await client.end();
  await prisma.$disconnect();
});

describe("البحث العامّ", () => {
  const admin = { userId: "", role: "ADMIN" as const };
  const owner = { userId: "", role: "OWNER" as const };
  const staff = { userId: "", role: "STAFF" as const };
  const resident = { userId: "", role: "RESIDENT" as const };

  beforeAll(() => {
    admin.userId = f.roleUsers.ADMIN;
    owner.userId = f.roleUsers.OWNER;
    staff.userId = f.roleUsers.STAFF;
    resident.userId = f.roleUsers.RESIDENT;
  });

  it("يجد الشقة برقم عرضها", async () => {
    const out = await searchFor("ITtbr-1-1", admin);
    const apt = out.hits.find((h) => h.kind === "apartment" && h.id === f.apartmentId);
    expect(apt, `لم تُوجد الشقة. النتائج: ${JSON.stringify(out.hits)}`).toBeDefined();
    expect(apt!.href).toBe(`/admin/apartments/${f.apartmentId}`);
  });

  it("يجد العقد برقمه", async () => {
    const contract = await prisma.contract.findUnique({
      where: { id: f.contractId },
      select: { contractNumber: true },
    });
    const out = await searchFor(contract!.contractNumber, admin);
    expect(out.hits.some((h) => h.kind === "contract" && h.id === f.contractId)).toBe(true);
  });

  it("يجد العقد **برقم شقّته** أيضاً", async () => {
    // ⚠️ هذا نصف الحالات: المستخدم يعرف رقم الشقة لا رقم العقد
    const out = await searchFor("ITtbr-1-1", admin);
    expect(out.hits.some((h) => h.kind === "contract" && h.id === f.contractId)).toBe(true);
  });

  it("المالك يبحث كالأدمن (‏D3/1)", async () => {
    const out = await searchFor("ITtbr-1-1", owner);
    expect(out.hits.length).toBeGreaterThan(0);
  });

  it("⚠️ الموظف والساكن لا يبحثان — القيد الأمني", async () => {
    for (const actor of [staff, resident]) {
      const out = await searchFor("ITtbr-1-1", actor);
      expect(
        out.hits,
        `الدور ${actor.role} حصل على نتائج. البحث يعبر ثلاث قدرات ولا نطاق مُثبت له.`,
      ).toEqual([]);
    }
  });

  it("حرف واحد لا يبحث — لا يُطابِق كل شيء", async () => {
    const out = await searchFor("I", admin);
    expect(out.hits).toEqual([]);
  });

  it("نصّ لا يطابق شيئاً يُرجع فراغاً لا خطأ", async () => {
    const out = await searchFor("لا-يوجد-هذا-النصّ-إطلاقاً", admin);
    expect(out.hits).toEqual([]);
    expect(out.truncated).toBe(false);
  });
});

describe("جرس الإخطارات", () => {
  it("⚠️ لا يرى المستخدم إخطارات غيره", async () => {
    const mine = await notificationsFor(f.roleUsers.ADMIN);
    const bodies = mine.rows.map((r) => r.body);
    expect(
      bodies,
      "ظهر إخطار مستخدم آخر — النطاق البنيويّ مكسور",
    ).not.toContain("إخطار مستخدم آخر");
    expect(bodies).toContain("إخطار غير مقروء");
  });

  it("⚠️ يستثني قناة واتساب — أُرسلت إلى هاتفه أصلاً", async () => {
    const mine = await notificationsFor(f.roleUsers.ADMIN);
    expect(mine.rows.map((r) => r.body)).not.toContain("رسالة واتساب");
  });

  it("العدّاد يُحسب من readAt لا من status (‏Q44)", async () => {
    const mine = await notificationsFor(f.roleUsers.ADMIN);
    // الصفوف كلها `status = SENT`؛ لو عُدّ منها لصار العدد 2 لا 1
    expect(mine.unread).toBe(1);
    expect(mine.rows.filter((r) => r.isUnread)).toHaveLength(1);
  });

  it("الأحدث أولاً", async () => {
    const mine = await notificationsFor(f.roleUsers.ADMIN);
    const times = mine.rows.map((r) => r.createdAt.getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("⚠️ التعليم مقروءاً لا يمسّ إخطارات الآخرين", async () => {
    const before = await notificationsFor(OTHER_USER);
    expect(before.unread).toBe(1);

    const out = await markAllReadFor(f.roleUsers.ADMIN);
    expect(out.marked).toBe(1);

    const after = await notificationsFor(OTHER_USER);
    expect(after.unread, "تسرّب التعليم إلى مستخدم آخر").toBe(1);
    expect((await notificationsFor(f.roleUsers.ADMIN)).unread).toBe(0);
  });

  it("⚠️ لا يكتب فوق طابعة قراءة قائمة", async () => {
    /**
     * الصفّ `n_mine_read` قُرئ في 2026-01-01، والتعليم جرى بـ`now()` أي
     * اليوم. لو حُدّث لصار «متى قرأتَه» هو «متى نقرتَ آخر مرّة» — ويضيع
     * الحقل الذي أُضيف في Q44 من أجله.
     */
    const row = await prisma.notification.findUnique({
      where: { id: testId("n_mine_read") },
      select: { readAt: true },
    });
    expect(row!.readAt?.getTime()).toBe(originalReadAt!.getTime());
  });

  it("تعليم بلا شيء غير مقروء يُرجع صفراً لا يفشل", async () => {
    const out = await markAllReadFor(f.roleUsers.ADMIN);
    expect(out.marked).toBe(0);
    expect(now()).toBeInstanceOf(Date); // حراسة: وحدة التوقيت مستوردة فعلاً
  });
});
