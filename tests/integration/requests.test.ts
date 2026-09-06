import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { cleanupTestData, connection, createFixture, testId, type Fixture } from "./helpers";
import {
  addRequestComment,
  assignServiceRequest,
  createServiceRequest,
  getServiceRequest,
  listServiceRequests,
  setRequestStatus,
} from "@/lib/actions/requests";
import { createDepartment, createDepartmentTask } from "@/lib/actions/staff";
import { setDepartmentTaskActive } from "@/lib/actions/departments";
import { setUserActive } from "@/lib/actions/users";
import { linkResidentToApartment } from "@/lib/actions/residents";
import { addCommentFor, createRequestFor } from "@/lib/services/resident-requests";
import type { ActorContext } from "@/lib/actions/define-action";
import { prisma } from "@/lib/prisma";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  الخطوة 4.4 — الطلبات والشكاوى.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * تعريف الإنجاز حرفياً، وكل بند اختبارٌ صريح هنا:
 *   • «`DONE` بلا `resolutionNote` مرفوض **في الخادم**»
 *   • «الساكن لا يستلم تعليقاً داخلياً **في حمولة الاستجابة**
 *      (اختبار على الحمولة لا على الواجهة)»
 *   • «شكوى منطقة مشتركة بلا شقة تعمل — **ولا تمنح أي وصول لأي شقة**»
 */

let client: Client;
let f: Fixture;
let admin: ActorContext;
let staff: ActorContext;
let resident: ActorContext;
let deptId = "";
let taskId = "";

const STAFF = testId("u_req_staff");

async function resetWorld() {
  await cleanupTestData(client);
  f = await createFixture(client, "req");
  admin = { userId: f.roleUsers.ADMIN, role: "ADMIN", ip: "10.0.0.80", userAgent: "vitest" };

  await client.query(
    `insert into "User" (id,"fullName",phone,role,"isActive","updatedAt")
     values ($1,'فنّي الطلبات','+9647089000001','STAFF',true,now())`,
    [STAFF],
  );
  await client.query(
    `insert into "StaffProfile" ("userId","employmentType","isAvailable","updatedAt")
     values ($1,'INTERNAL',true,now())`,
    [STAFF],
  );
  staff = { userId: STAFF, role: "STAFF", ip: "10.0.0.81", userAgent: "vitest" };

  /* الساكن صاحب العقد في الفكسچر — يُربَط بشقته كي يُنشئ عليها */
  resident = {
    userId: f.holderId,
    role: "RESIDENT",
    ip: "10.0.0.82",
    userAgent: "vitest",
  };
  await linkResidentToApartment(
    {
      apartmentId: f.apartmentId,
      userId: f.holderId,
      relationType: "OTHER",
      isContractHolder: true,
    },
    admin,
  );

  const dept = await createDepartment({ name: "قسم الطلبات للاختبار" }, admin);
  if (!dept.ok) throw new Error(dept.error.message);
  deptId = dept.data.id;

  const task = await createDepartmentTask(
    { departmentId: deptId, name: "إصلاح تسرّب" },
    admin,
  );
  if (!task.ok) throw new Error(task.error.message);
  taskId = task.data.id;
}

beforeAll(async () => {
  client = connection();
  await client.connect();
  await resetWorld();
}, 180_000);

beforeEach(async () => {
  await resetWorld();
}, 120_000);

afterAll(async () => {
  await cleanupTestData(client);
  await client.end();
  await prisma.$disconnect();
}, 120_000);

const base = {
  type: "SERVICE_REQUEST" as const,
  title: "تسرّب ماء في الحمّام",
  description: "الماء يتسرّب من أسفل المغسلة منذ يومين.",
};

async function makeRequest(actor: ActorContext = admin) {
  const r = await createServiceRequest(
    { ...base, scope: "APARTMENT", apartmentId: f.apartmentId, departmentTaskId: taskId },
    actor,
  );
  if (!r.ok) throw new Error(r.error.message);
  return r.data;
}

/**
 * ⚠️ **مسار الساكن مختلف عمداً.**
 * `LEVEL_ACTIONS.OWN` يمنح القراءة وحدها، فالإنشاء والتعليق يمرّان بنطاق
 * بنيويّ في `lib/services/resident-requests.ts` — المعرّف من الجلسة لا من
 * المُدخل. واستدعاء `createServiceRequest` بدور ساكن يُردّ بحقّ.
 */
async function makeResidentRequest(userId: string = f.holderId) {
  return createRequestFor(userId, {
    ...base,
    scope: "APARTMENT",
    apartmentId: f.apartmentId,
    departmentTaskId: taskId,
  });
}

describe("🔴 البند الأول — DONE بلا وصف مرفوض في الخادم", () => {
  it("يُردّ الإغلاق بلا `resolutionNote`", async () => {
    /*
     * ⚠️ **في الخادم لا في الواجهة.** الإجراء نقطة نهاية HTTP قابلة
     * للاستدعاء مباشرةً (‏§10.3): حقلٌ مطلوب في نموذج وحده يُتجاوَز بطلب
     * واحد. وطلبٌ يُغلَق بلا سبب مكتوب يجعل «ماذا فُعل؟» بلا جواب.
     */
    const req = await makeRequest();

    const r = await setRequestStatus({ requestId: req.id, status: "DONE" }, admin);
    expect(r.ok, "أُغلق الطلب بلا وصف").toBe(false);
    if (!r.ok) {
      /*
       * ⚠️ الرسالة في `fieldErrors` لا في النصّ العام: هي خطأ **حقل**،
       * فتظهر تحت الحقل في النموذج لا فوقه. والنصّ العام يقول «راجع
       * البيانات» — وهو الصحيح للمستخدم.
       */
      expect(r.error.fieldErrors?.["resolutionNote"]?.[0]).toContain(
        "الإغلاق يحتاج وصفاً",
      );
    }

    const after = await prisma.serviceRequest.findUnique({
      where: { id: req.id },
      select: { status: true, closedAt: true },
    });
    expect(after?.status, "تغيّرت الحالة رغم الرفض").not.toBe("DONE");
    expect(after?.closedAt).toBeNull();
  });

  it("والوصف يُقبَل ويُغلق ويُسجَّل وقت الإغلاق", async () => {
    const req = await makeRequest();
    const r = await setRequestStatus(
      {
        requestId: req.id,
        status: "DONE",
        resolutionNote: "استُبدل صمّام الماء البارد وجُرّب لعشر دقائق.",
      },
      admin,
    );
    expect(r.ok, r.ok ? "" : r.error.message).toBe(true);

    const after = await prisma.serviceRequest.findUnique({
      where: { id: req.id },
      select: { status: true, closedAt: true, resolutionNote: true },
    });
    expect(after?.status).toBe("DONE");
    expect(after?.closedAt).not.toBeNull();
    expect(after?.resolutionNote).toContain("صمّام");
  });

  it("⚠️ المغلق لا يُعاد فتحه", async () => {
    /* إعادة الفتح تُبطل `closedAt` وتُربك كل قياس زمني للإنجاز */
    const req = await makeRequest();
    await setRequestStatus(
      { requestId: req.id, status: "DONE", resolutionNote: "أُنجز." },
      admin,
    );

    const again = await setRequestStatus(
      { requestId: req.id, status: "IN_PROGRESS" },
      admin,
    );
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.message).toContain("أنشئ طلباً جديداً");
  });
});

describe("🔴 البند الثاني — التعليق الداخلي لا يصل إلى الساكن", () => {
  it("مُرشَّح من **الحمولة** لا من الشاشة", async () => {
    /*
     * ⚠️ الاختبار على الحمولة كما ينصّ تعريف الإنجاز. ترشيحٌ في العميل
     * يعني أن التعليق **أُرسل فعلاً** إلى المتصفّح ويُقرأ بأدوات المطوّر.
     */
    const req = await makeResidentRequest();

    const internal = await addRequestComment(
      { requestId: req.id, body: "الساكن متأخّر بالدفع — لا تُعطه أولوية.", isInternal: true },
      admin,
    );
    expect(internal.ok, internal.ok ? "" : internal.error.message).toBe(true);

    const publicNote = await addRequestComment(
      { requestId: req.id, body: "سيصل الفنّي غداً صباحاً.", isInternal: false },
      admin,
    );
    expect(publicNote.ok).toBe(true);

    const asResident = await getServiceRequest({ requestId: req.id }, resident);
    if (!asResident.ok || asResident.data === null) throw new Error("لا طلب");

    const bodies = asResident.data.comments.map((c) => c.body);
    expect(bodies, "تعليق داخلي وصل إلى الساكن").not.toContain(
      "الساكن متأخّر بالدفع — لا تُعطه أولوية.",
    );
    expect(bodies).toContain("سيصل الفنّي غداً صباحاً.");
    expect(asResident.data.comments).toHaveLength(1);

    /* والأدمن يراهما معاً — وإلا لم يكن الترشيح بالدور بل حذفاً */
    const asAdmin = await getServiceRequest({ requestId: req.id }, admin);
    if (!asAdmin.ok || asAdmin.data === null) throw new Error("لا طلب");
    expect(asAdmin.data.comments).toHaveLength(2);
  });

  it("⚠️ الساكن لا يكتب تعليقاً داخلياً مهما أرسل", async () => {
    /* لو قُبل لكتب «داخلياً» يراه الموظفون ويظنّونه منهم */
    const req = await makeResidentRequest();

    /*
     * ⚠️ `isInternal` **غير موجود في التوقيع أصلاً**: لا يُقبَل ثم يُتجاهَل.
     * حقلٌ يُقبل ويُهمَل يجعل من يقرأ الواجهة يظنّ أن للساكن خياراً ليس له.
     */
    const c = await addCommentFor(f.holderId, req.id, "ملاحظة");
    const stored = await prisma.requestComment.findUnique({
      where: { id: c.id },
      select: { isInternal: true },
    });
    expect(stored?.isInternal, "تعليق الساكن دخل داخلياً").toBe(false);
  });

  it("الساكن لا يقرأ طلب غيره — و«غير موجود» لا «ممنوع»", async () => {
    const other = await makeRequest(admin);

    const stranger = testId("u_req_other");
    await client.query(
      `insert into "User" (id,"fullName",phone,role,"isActive","updatedAt")
       values ($1,'ساكن آخر','+9647089000002','RESIDENT',true,now())`,
      [stranger],
    );

    const r = await getServiceRequest(
      { requestId: other.id },
      { userId: stranger, role: "RESIDENT", ip: "10.0.0.83", userAgent: "vitest" },
    );
    /* ⚠️ `null` لا خطأ ترخيص: الفرق بينهما وسيلةُ استكشاف لما هو موجود */
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toBeNull();
  });
});

describe("🔴 البند الثالث — المنطقة المشتركة", () => {
  it("شكوى بلا شقة تعمل، ولا تمنح وصولاً لأي شقة", async () => {
    const r = await createServiceRequest(
      {
        type: "COMPLAINT",
        scope: "COMMON_AREA",
        title: "المصعد متوقّف",
        description: "المصعد الأيمن متوقّف منذ الصباح.",
      },
      admin,
    );
    expect(r.ok, r.ok ? "" : r.error.message).toBe(true);
    if (!r.ok) return;

    const row = await prisma.serviceRequest.findUnique({
      where: { id: r.data.id },
      select: { apartmentId: true, scope: true },
    });
    expect(row?.apartmentId, "أُلحقت الشكوى بشقة").toBeNull();
    expect(row?.scope).toBe("COMMON_AREA");

    /*
     * ⚠️ **نصّ ملزم من `Q35`**: طلب COMMON_AREA لا يمنح أي وصول لأي شقة.
     * والعلم يُعاد من الإجراء كي لا تُعيد الطبقات الأعلى الاستنتاج.
     */
    const detail = await getServiceRequest({ requestId: r.data.id }, admin);
    if (!detail.ok || detail.data === null) throw new Error("لا طلب");
    expect(detail.data.grantsApartmentAccess, "منحت الشكوى وصولاً لشقة").toBe(false);

    /* والطلب على شقة يمنح — وإلا لم يكن الفحص يفحص شيئاً */
    const apartmentReq = await makeRequest();
    const other = await getServiceRequest({ requestId: apartmentReq.id }, admin);
    if (!other.ok || other.data === null) throw new Error("لا طلب");
    expect(other.data.grantsApartmentAccess).toBe(true);
  });

  it("⚠️ شكوى مشتركة تحمل شقة مرفوضة", async () => {
    /* لو قُبلت لتلوّثت التقارير: «الشقة A-1-2 لها 30 شكوى مصعد» */
    const r = await createServiceRequest(
      {
        type: "COMPLAINT",
        scope: "COMMON_AREA",
        apartmentId: f.apartmentId,
        title: "شكوى",
        description: "وصف الشكوى.",
      },
      admin,
    );
    expect(r.ok, "قُبلت شكوى مشتركة بشقة").toBe(false);
  });

  it("⚠️ وطلب على وحدة بلا شقة مرفوض", async () => {
    const r = await createServiceRequest(
      { ...base, scope: "APARTMENT", title: "طلب", description: "وصف الطلب." },
      admin,
    );
    expect(r.ok, "قُبل طلب وحدة بلا شقة").toBe(false);
  });
});

describe("نطاق الساكن والموظّف", () => {
  it("🔴 الساكن لا يُنشئ طلباً على شقة ليست له", async () => {
    /*
     * ⚠️ وطلبٌ مُكلَّف به يمنح الموظّف وصولاً إلى تلك الشقة (‏D4) — فهذه
     * ليست مضايقةً بل باب وصول.
     */
    const stranger = testId("u_req_stranger");
    await client.query(
      `insert into "User" (id,"fullName",phone,role,"isActive","updatedAt")
       values ($1,'ساكن غريب','+9647089000003','RESIDENT',true,now())`,
      [stranger],
    );

    await expect(
      createRequestFor(stranger, {
        ...base,
        scope: "APARTMENT",
        apartmentId: f.apartmentId,
      }),
      "أنشأ ساكن طلباً على شقة غيره",
    ).rejects.toThrow(/ليست لك/);
  });

  it("الساكن يرى طلباته وحدها في القائمة", async () => {
    await makeRequest(admin);
    const mine = await makeResidentRequest();

    const listed = await listServiceRequests({}, resident);
    if (!listed.ok) throw new Error(listed.error.message);

    /* ⚠️ النطاق في `where` لا في العرض: قائمةٌ تُرجع ثم تُرشّح أرسلتها فعلاً */
    expect(listed.data.rows.every((x) => x.id === mine.id)).toBe(true);
    expect(listed.data.total).toBe(1);
  });

  it("🔴 `mine` يقصر «طلباتي» على صاحبها مهما كان دوره", async () => {
    /*
     * صفحة `/app/requests` عنوانها «طلباتي وشكاواي»، ويفتحها الساكن
     * **والموظّف والأدمن والمالك** (‏Q41: موظّفٌ يسكن المجمَّع). والنطاق
     * كان مشروطاً بـ`role === "RESIDENT"` وحده — فمن ليس ساكناً كان يقرأ
     * تحت ذلك العنوان قائمةَ طلبات المجمَّع كلّه.
     */
    const theirs = await makeRequest(admin);
    const mine = await makeResidentRequest();

    /* بلا العَلَم: الأدمن يرى الاثنين — وهذا صحيح في `/admin/requests` */
    const wide = await listServiceRequests({}, admin);
    if (!wide.ok) throw new Error(wide.error.message);
    expect(wide.data.rows.some((x) => x.id === theirs.id)).toBe(true);
    expect(wide.data.rows.some((x) => x.id === mine.id)).toBe(true);

    /* ومعه: ما أنشأه هو وحده */
    const narrow = await listServiceRequests({ mine: true }, admin);
    if (!narrow.ok) throw new Error(narrow.error.message);
    expect(
      narrow.data.rows.some((x) => x.id === mine.id),
      "سرّب `mine` طلب ساكن آخر إلى صفحة «طلباتي»",
    ).toBe(false);
    expect(narrow.data.rows.every((x) => x.id === theirs.id)).toBe(true);

    /* ⚠️ ويضيّق ولا يوسّع: الساكن يبقى محصوراً بدوره حين يغيب العَلَم */
    const asResident = await listServiceRequests({}, resident);
    if (!asResident.ok) throw new Error(asResident.error.message);
    expect(asResident.data.rows.every((x) => x.id === mine.id)).toBe(true);
  });

  it("`openTotal` يُعدّ من القاعدة لا من الصفحة المعروضة", async () => {
    /*
     * ⚠️ كانت الشاشة تحسبه بـ`rows.filter(...)` — أي الصفحة وحدها. فرقمٌ
     * يتغيّر عند الضغط على «التالي» ليس عدّاً بل صدفة.
     */
    const a = await makeResidentRequest();
    await makeResidentRequest();
    await makeResidentRequest();

    await setRequestStatus(
      { requestId: a.id, status: "DONE", resolutionNote: "أُنجز." },
      admin,
    );

    const firstPage = await listServiceRequests({ page: 1, pageSize: 1 }, resident);
    if (!firstPage.ok) throw new Error(firstPage.error.message);

    expect(firstPage.data.rows.length, "الصفحة صفٌّ واحد").toBe(1);
    expect(firstPage.data.total).toBe(3);
    /* مفتوحان من ثلاثة — ولا يتغيّر بتغيّر الصفحة */
    expect(firstPage.data.openTotal).toBe(2);

    const secondPage = await listServiceRequests({ page: 2, pageSize: 1 }, resident);
    if (!secondPage.ok) throw new Error(secondPage.error.message);
    expect(secondPage.data.openTotal).toBe(2);
  });

  it("🔴 الموظّف يُحرّك ما أُسنِد إليه وحده", async () => {
    const req = await makeRequest();

    const before = await setRequestStatus(
      { requestId: req.id, status: "IN_PROGRESS" },
      staff,
    );
    expect(before.ok, "حرّك موظّف طلباً غير مُسنَد إليه").toBe(false);

    const assigned = await assignServiceRequest(
      { requestId: req.id, staffUserId: STAFF },
      admin,
    );
    expect(assigned.ok, assigned.ok ? "" : assigned.error.message).toBe(true);

    const after = await setRequestStatus(
      { requestId: req.id, status: "IN_PROGRESS" },
      staff,
    );
    expect(after.ok, after.ok ? "" : after.error.message).toBe(true);
  });
});

describe("الإسناد", () => {
  it("‏NEW تتقدّم إلى ASSIGNED، والمتقدّمة لا ترتدّ", async () => {
    const req = await makeRequest();
    const first = await assignServiceRequest(
      { requestId: req.id, staffUserId: STAFF },
      admin,
    );
    if (!first.ok) throw new Error(first.error.message);
    expect(first.data.status).toBe("ASSIGNED");

    await setRequestStatus({ requestId: req.id, status: "IN_PROGRESS" }, admin);

    /* ⚠️ إعادة الإسناد لا تُرجع الطلب من «قيد التنفيذ» إلى «مُسنَد» */
    const second = await assignServiceRequest(
      { requestId: req.id, staffUserId: STAFF },
      admin,
    );
    if (!second.ok) throw new Error(second.error.message);
    expect(second.data.status).toBe("IN_PROGRESS");
  });

  it("⚠️ المعطَّل لا يُكلَّف", async () => {
    /* طلبٌ بلا منفّذ يبدو مُسنَداً أسوأ من طلبٍ بلا إسناد */
    await setUserActive({ userId: STAFF, isActive: false, reason: "اختبار" }, admin);

    const req = await makeRequest();
    const r = await assignServiceRequest({ requestId: req.id, staffUserId: STAFF }, admin);
    expect(r.ok, "أُسنِد إلى معطَّل").toBe(false);

    await setUserActive({ userId: STAFF, isActive: true }, admin);
  });

  it("المغلق لا يُسنَد", async () => {
    const req = await makeRequest();
    await setRequestStatus(
      { requestId: req.id, status: "DONE", resolutionNote: "أُنجز." },
      admin,
    );

    const r = await assignServiceRequest({ requestId: req.id, staffUserId: STAFF }, admin);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("مُغلق");
  });
});

describe("المهمّة الموقوفة", () => {
  it("🔴 لا تُسنَد إليها طلبات جديدة", async () => {
    /* هذا هو سبب وجود الإيقاف أصلاً — وإلا كان الإيقاف زينة */
    const off = await setDepartmentTaskActive({ taskId, isActive: false }, admin);
    expect(off.ok, off.ok ? "" : off.error.message).toBe(true);

    const r = await createServiceRequest(
      { ...base, scope: "APARTMENT", apartmentId: f.apartmentId, departmentTaskId: taskId },
      admin,
    );
    expect(r.ok, "أُنشئ طلب على مهمّة موقوفة").toBe(false);
    if (!r.ok) expect(r.error.message).toContain("موقوفة");
  });

  it("والقسم يُشتقّ من المهمّة لا يُقبَل من المتصل", async () => {
    /* اختيار الاثنين يفتح احتمال تناقضهما بلا جواب في البيانات */
    const req = await makeRequest();
    const row = await prisma.serviceRequest.findUnique({
      where: { id: req.id },
      select: { departmentId: true, departmentTaskId: true },
    });
    expect(row?.departmentTaskId).toBe(taskId);
    expect(row?.departmentId, "القسم لم يُشتقّ من المهمّة").toBe(deptId);
  });
});

describe("القائمة — ترشيح وبحث وتصفيح", () => {
  it("ترتيب بالأولوية ثم الأقدم", async () => {
    /*
     * ⚠️ ترتيبٌ بالتاريخ وحده يدفن طلباً عاجلاً وصل اليوم تحت ثلاثين
     * طلباً عادياً وصلت أمس.
     */
    await makeRequest();
    const urgent = await createServiceRequest(
      {
        ...base,
        scope: "APARTMENT",
        apartmentId: f.apartmentId,
        priority: "HIGH",
        title: "انفجار ماسورة",
      },
      admin,
    );
    if (!urgent.ok) throw new Error(urgent.error.message);

    const listed = await listServiceRequests({}, admin);
    if (!listed.ok) throw new Error(listed.error.message);
    expect(listed.data.rows[0]?.id, "العاجل لم يتصدّر").toBe(urgent.data.id);
  });

  it("يرشّح بالحالة والنوع، ويبحث بثلاثة محاور", async () => {
    const req = await makeRequest();

    const byStatus = await listServiceRequests({ status: "NEW" }, admin);
    const done = await listServiceRequests({ status: "DONE" }, admin);
    if (!byStatus.ok || !done.ok) throw new Error("فشل الترشيح");
    expect(byStatus.data.total).toBeGreaterThan(0);
    expect(done.data.total).toBe(0);

    const byType = await listServiceRequests({ type: "COMPLAINT" }, admin);
    if (!byType.ok) throw new Error(byType.error.message);
    expect(byType.data.total).toBe(0);

    const byNumber = await listServiceRequests({ search: req.number }, admin);
    if (!byNumber.ok) throw new Error(byNumber.error.message);
    expect(byNumber.data.total, "البحث برقم الطلب لا يجد").toBe(1);

    const byTitle = await listServiceRequests({ search: "تسرّب" }, admin);
    if (!byTitle.ok) throw new Error(byTitle.error.message);
    expect(byTitle.data.total).toBeGreaterThan(0);

    const none = await listServiceRequests({ search: "لا_يوجد_هذا_الطلب" }, admin);
    if (!none.ok) throw new Error(none.error.message);
    expect(none.data.total).toBe(0);
  });

  it("يصفّح بلا تداخل", async () => {
    for (let i = 0; i < 4; i += 1) await makeRequest();

    const first = await listServiceRequests({ page: 1, pageSize: 2 }, admin);
    const second = await listServiceRequests({ page: 2, pageSize: 2 }, admin);
    if (!first.ok || !second.ok) throw new Error("فشل الجلب");

    expect(first.data.rows).toHaveLength(2);
    const ids = new Set(first.data.rows.map((r) => r.id));
    expect(second.data.rows.filter((r) => ids.has(r.id)), "صفّ في صفحتين").toEqual([]);
  });
});
