import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { cleanupTestData, connection, createFixture, type Fixture } from "./helpers";
import { requestProfileChangeFor } from "@/lib/services/resident-profile-requests";
import {
  approveResidentRequest,
  listResidentRequests,
  rejectResidentRequest,
} from "@/lib/actions/resident-requests-review";
import type { ActorContext } from "@/lib/actions/define-action";
import { prisma } from "@/lib/prisma";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  طلب تعديل بيانات الساكن — §3.2 «‏read + request change» · Q37.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ⚠️ ما يحرسه هذا الملفّ ──────────────────────────────────────────
 *   • **الطلب لا يغيّر شيئاً** — البيانات تبقى كما هي حتى الموافقة.
 *   • **والموافقة تُطبّق** — لا تعلّم الطلب مقبولاً وتترك الإدخال يدوياً.
 *   • **والهاتف يُفحَص تفرّده عند القرار** لا عند الطلب وحده: بينهما
 *     ساعاتٌ قد يُسجَّل الرقم فيها لغيره.
 */

let client: Client;
let f: Fixture;
let admin: ActorContext;
let residentId = "";

beforeAll(async () => {
  /* ⚠️ `connection()` متزامنة — يجب `connect()` بعدها */
  client = connection();
  await client.connect();
}, 120_000);

beforeEach(async () => {
  await cleanupTestData(client);
  f = await createFixture(client, "pcr");
  admin = { userId: f.roleUsers.ADMIN, role: "ADMIN", ip: "10.0.0.95", userAgent: "vitest" };
  residentId = f.holderId;
}, 120_000);

afterAll(async () => {
  await cleanupTestData(client);
  await client.end();
  await prisma.$disconnect();
});

async function currentUser() {
  return prisma.user.findUnique({
    where: { id: residentId },
    select: {
      fullName: true,
      phone: true,
      residentProfile: { select: { emergencyPhone: true } },
    },
  });
}

describe("إنشاء الطلب", () => {
  it("🔴 الطلب **لا يغيّر البيانات** — يبقى معلّقاً", async () => {
    const before = await currentUser();

    const created = await requestProfileChangeFor(residentId, {
      fullName: "اسمٌ جديد للاختبار",
      note: "تصحيح إملائي",
    });

    const after = await currentUser();
    /* ⚠️ جوهر «request change»: لا شيء يسري قبل القرار */
    expect(after?.fullName, "سرى التغيير قبل الموافقة").toBe(before?.fullName);

    const row = await prisma.residentRequest.findUnique({
      where: { id: created.id },
      select: { status: true, kind: true },
    });
    expect(row?.status).toBe("PENDING");
    expect(row?.kind).toBe("PROFILE_CHANGE");
  });

  it("⚠️ والحمولة تحفظ القديم والجديد معاً", async () => {
    const before = await currentUser();
    const created = await requestProfileChangeFor(residentId, {
      fullName: "اسمٌ ثانٍ للاختبار",
    });

    const row = await prisma.residentRequest.findUnique({
      where: { id: created.id },
      select: { payload: true },
    });
    const payload = row?.payload as { fullName?: { from: string; to: string } };
    /* بلا `from` يوافق الأدمن بلا أن يرى ما يُستبدَل */
    expect(payload.fullName?.from).toBe(before?.fullName);
    expect(payload.fullName?.to).toBe("اسمٌ ثانٍ للاختبار");
  });

  it("🔴 ولا طلب بلا تغيير فعليّ", async () => {
    const before = await currentUser();
    await expect(
      requestProfileChangeFor(residentId, { fullName: before?.fullName ?? "" }),
      "قُبل طلبٌ بلا تغيير — صفٌّ ينتظر قراراً على لا شيء",
    ).rejects.toThrow(/لا تغيير/);
  });

  it("🔴 وطلبٌ ثانٍ معلّق مرفوض", async () => {
    /*
     * ⚠️ طلبان على نفس الحقل يُوافَق عليهما بالترتيب، فتسري النتيجة التي
     * لا يعرفها الساكن ولا الأدمن.
     */
    await requestProfileChangeFor(residentId, { fullName: "اسم أوّل للاختبار" });
    await expect(
      requestProfileChangeFor(residentId, { fullName: "اسم ثانٍ للاختبار" }),
    ).rejects.toThrow(/معلّق/);
  });

  it("والهاتف يُطبَّع — والرقم غير الصالح يُردّ", async () => {
    await expect(
      requestProfileChangeFor(residentId, { phone: "123" }),
    ).rejects.toThrow();

    const created = await requestProfileChangeFor(residentId, {
      phone: "٠٧٧٠ ١٢٣ ٤٥٦٧",
    });
    const row = await prisma.residentRequest.findUnique({
      where: { id: created.id },
      select: { payload: true },
    });
    const payload = row?.payload as { phone?: { to: string } };
    /* ⚠️ أرقام هندية وفراغات ← E.164 */
    expect(payload.phone?.to).toBe("+9647701234567");
  });
});

describe("قرار الإدارة", () => {
  it("🔴 الموافقة **تُطبّق** التغيير لا تعلّمه فقط", async () => {
    const created = await requestProfileChangeFor(residentId, {
      fullName: "الاسم المعتمَد للاختبار",
      emergencyPhone: "٠٧٧٠٩٩٩٨٨٨٨",
    });

    const approved = await approveResidentRequest({ requestId: created.id }, admin);
    expect(approved.ok, approved.ok ? "" : approved.error.message).toBe(true);

    const after = await currentUser();
    expect(after?.fullName, "قُبل الطلب ولم يتغيّر الاسم").toBe("الاسم المعتمَد للاختبار");
    /* ⚠️ `upsert`: ساكنٌ بلا ملفّ ممكن — والملفّ يُنشأ عند أوّل قيمة */
    expect(after?.residentProfile?.emergencyPhone).toBe("+9647709998888");

    const row = await prisma.residentRequest.findUnique({
      where: { id: created.id },
      select: { status: true, reviewedByUserId: true, reviewedAt: true },
    });
    expect(row?.status).toBe("APPROVED");
    expect(row?.reviewedByUserId).toBe(admin.userId);
    expect(row?.reviewedAt).not.toBeNull();
  });

  it("والرفض لا يُطبّق شيئاً ويوجب سبباً", async () => {
    const before = await currentUser();
    const created = await requestProfileChangeFor(residentId, {
      fullName: "اسمٌ مرفوض للاختبار",
    });

    const bare = await rejectResidentRequest({ requestId: created.id, note: "" }, admin);
    expect(bare.ok, "قُبل رفضٌ بلا سبب").toBe(false);

    const done = await rejectResidentRequest(
      { requestId: created.id, note: "الاسم لا يطابق الهوية." },
      admin,
    );
    expect(done.ok, done.ok ? "" : done.error.message).toBe(true);

    const after = await currentUser();
    expect(after?.fullName).toBe(before?.fullName);

    const row = await prisma.residentRequest.findUnique({
      where: { id: created.id },
      select: { status: true, reviewNote: true },
    });
    expect(row?.status).toBe("REJECTED");
    expect(row?.reviewNote).toContain("الهوية");
  });

  it("ولا يُقرَّر طلبٌ قُرِّر", async () => {
    const created = await requestProfileChangeFor(residentId, {
      fullName: "اسمٌ مكرَّر القرار",
    });
    const first = await approveResidentRequest({ requestId: created.id }, admin);
    expect(first.ok).toBe(true);

    const again = await approveResidentRequest({ requestId: created.id }, admin);
    expect(again.ok, "قُرِّر طلبٌ مقرَّر").toBe(false);
  });

  it("🔴 وهاتفٌ سُجّل لغيره **بين الطلب والقرار** يُردّ عند القرار", async () => {
    /*
     * ── العيب الذي وُجد هذا الفحص من أجله ───────────────────────────
     * الفحص عند الطلب يعطي رسالةً مفهومة، ولا يحرس شيئاً: بين الطلب
     * والقرار ساعاتٌ أو أيام. والحارس الحقيقي هو تفرّد العمود — وبلا
     * التقاطه تسقط الموافقة بخطأ قاعدةٍ خام يقرؤه الأدمن كعطل.
     */
    const created = await requestProfileChangeFor(residentId, {
      phone: "+9647701230000",
    });

    /* ثم يُسجَّل نفس الرقم لمستخدم آخر */
    const rival = `${f.roleUsers.STAFF}`;
    await client.query(`update "User" set phone = $1 where id = $2`, [
      "+9647701230000",
      rival,
    ]);

    const approved = await approveResidentRequest({ requestId: created.id }, admin);
    expect(approved.ok, "طُبّق هاتفٌ مسجَّل لغيره").toBe(false);
    if (!approved.ok) {
      expect(approved.error.message).toMatch(/مستخدم آخر|سُجّل/u);
    }

    /* والطلب يبقى معلّقاً — لم يُقرَّر شيء */
    const row = await prisma.residentRequest.findUnique({
      where: { id: created.id },
      select: { status: true },
    });
    expect(row?.status, "عُلّم الطلب مقرَّراً رغم فشل التطبيق").toBe("PENDING");
  });
});

describe("القائمة", () => {
  it("المعلّق يتصدّر وله عدّاد مستقلّ", async () => {
    await requestProfileChangeFor(residentId, { fullName: "اسمٌ في القائمة" });

    const listed = await listResidentRequests({ status: "PENDING", page: 1 }, admin);
    if (!listed.ok) throw new Error(listed.error.message);

    expect(listed.data.rows.length).toBeGreaterThanOrEqual(1);
    expect(listed.data.pendingCount).toBeGreaterThanOrEqual(1);
    expect(listed.data.rows[0]?.createdBy.fullName).toBeTruthy();
  });
});
