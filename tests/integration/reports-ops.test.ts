import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { cleanupTestData, connection, createFixture, testId, type Fixture } from "./helpers";
import { requestsReport, vehiclesReport } from "@/lib/services/reports-ops";
import { residentsReport, staffReport } from "@/lib/services/reports-people";
import { resolveRange } from "@/lib/domain/report-range";
import { now } from "@/lib/dates";
import { prisma } from "@/lib/prisma";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  تقارير الناس والتشغيل.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ⚠️ ما يحرسه هذا الملفّ ──────────────────────────────────────────
 *   • **متوسّط الإنجاز للمغلق وحده** — إدخالُ المفتوح فيه يُنتج رقماً
 *     **يتحسّن كلّما تراكم العمل**، وهو نقيض ما يُقاس.
 *   • **`closedAt` لا `updatedAt`** — الأخير يتغيّر بأي تعليق، فيدخل في
 *     «المنجَز» طلبٌ عُلّق عليه ولم يُغلق.
 *   • **حالة الباج مشتقّة** — `EXPIRED` تكتبها مهمّة ليلية، فباجٌ انتهى
 *     صباح اليوم يبقى `ISSUED` في العمود.
 *   • **الساكن بلا شقة يُعدّ** — لا جدول آخر يُظهره لأن كلّها تبدأ من الشقة.
 */

let client: Client;
let f: Fixture;

const DAY_MS = 86_400_000;
/* ⚠️ نصّاً بـUTC: `node-postgres` يُسلسِل `Date` بإزاحة الجهاز — راجع reports.test.ts */
const at = (d: Date): string => d.toISOString();

beforeAll(async () => {
  client = connection();
  await client.connect();
}, 120_000);

beforeEach(async () => {
  await cleanupTestData(client);
  f = await createFixture(client, "ops");

  /*
   * ⚠️ `ServiceRequest.assignedStaffId` يشير إلى **`StaffProfile`** لا إلى
   * `User`. فالإسناد إلى مستخدمٍ بلا ملفّ وظيفي يسقط على المفتاح الأجنبي
   * — وهو صحيح: الإسناد إلى «موظّف» لا إلى أي حساب.
   */
  await client.query(
    `insert into "StaffProfile" ("userId","employmentType","isAvailable","updatedAt")
     values ($1,'INTERNAL',true,now())
     on conflict ("userId") do nothing`,
    [f.roleUsers.STAFF],
  );
}, 120_000);

afterAll(async () => {
  await cleanupTestData(client);
  await client.end();
  await prisma.$disconnect();
});

let seq = 0;
async function seedRequest(opts: {
  createdDaysAgo: number;
  closedDaysAgo?: number;
  status: string;
  assigned?: boolean;
}): Promise<void> {
  seq += 1;
  const created = new Date(now().getTime() - opts.createdDaysAgo * DAY_MS);
  const closed =
    opts.closedDaysAgo === undefined
      ? null
      : new Date(now().getTime() - opts.closedDaysAgo * DAY_MS);

  await client.query(
    /*
     * ⚠️ `request_done_needs_resolution`: المنجَز يوجب وصف الإغلاق **في
     * القاعدة**. فبذرٌ خام يتخطّى الإجراء لا يتخطّى القيد — وهذا هو
     * المقصود منه: «منجَز» بلا وصف لا يخبر الساكن بما جرى.
     */
    `insert into "ServiceRequest"
       (id,number,type,scope,"apartmentId","createdByUserId",title,description,
        priority,status,"createdAt","closedAt","assignedStaffId","resolutionNote","updatedAt")
     values ($1,$2,'SERVICE_REQUEST','APARTMENT',$3,$4,'طلب اختبار','وصف',
             'NORMAL',$5,$6,$7,$8,$9,now())`,
    [
      testId(`req_ops_${seq}`),
      `IT-REQ-${seq}`,
      f.apartmentId,
      f.holderId,
      opts.status,
      at(created),
      closed === null ? null : at(closed),
      opts.assigned ? f.roleUsers.STAFF : null,
      opts.status === "DONE" ? "أُصلح وجُرّب." : null,
    ],
  );
}

describe("🔴 تقرير الطلبات — المتوسّط للمغلق وحده", () => {
  it("طلبٌ مفتوح منذ شهر لا يدخل في متوسّط الإنجاز", async () => {
    /*
     * ── العيب الذي وُجد هذا الفحص من أجله ───────────────────────────
     * متوسّطٌ يشمل المفتوح يقيس «كم مضى» لا «كم استغرق» — فيتحسّن كلّما
     * أُغلقت طلباتٌ قديمة وتُركت الجديدة، ويسوء كلّما تراكم العمل. وهو
     * رقمٌ يُقرأ أداءً وهو مقياسُ تراكم.
     */
    await seedRequest({ createdDaysAgo: 30, status: "NEW" });
    await seedRequest({ createdDaysAgo: 4, closedDaysAgo: 2, status: "DONE" });

    const range = resolveRange({ preset: "month" }, now());
    const r = await requestsReport(range);

    expect(r.closedInRange).toBe(1);
    /* أُغلق بعد يومين من إنشائه — لا ثلاثين */
    expect(r.avgDaysToClose, "دخل المفتوح في المتوسّط").toBe(2);
    expect(r.openTotal).toBe(1);
  });

  it("⚠️ و«لا بيانات» تُرجع `null` لا صفراً", async () => {
    await seedRequest({ createdDaysAgo: 3, status: "NEW" });
    const r = await requestsReport(resolveRange({ preset: "month" }, now()));
    expect(r.closedInRange).toBe(0);
    /* صفرٌ يُقرأ «أُنجزت فوراً» — وهو عكس الحقيقة */
    expect(r.avgDaysToClose).toBeNull();
  });

  it("🔴 والمغلق خارج المدّة لا يُحتسب", async () => {
    /* أُغلق قبل 60 يوماً — خارج «آخر 7 أيام» */
    await seedRequest({ createdDaysAgo: 70, closedDaysAgo: 60, status: "DONE" });
    const r = await requestsReport(resolveRange({ preset: "week" }, now()));
    expect(r.closedInRange).toBe(0);
  });

  it("والمفتوح بلا مُكلَّف يُعدّ — لا أحد يعمل عليه", async () => {
    await seedRequest({ createdDaysAgo: 5, status: "NEW" });
    await seedRequest({ createdDaysAgo: 5, status: "ASSIGNED", assigned: true });

    const r = await requestsReport(resolveRange({ preset: "month" }, now()));
    expect(r.openTotal).toBe(2);
    expect(r.openUnassigned).toBe(1);
  });

  it("وأقدم ما ينتظر يتصدّر", async () => {
    await seedRequest({ createdDaysAgo: 2, status: "NEW" });
    await seedRequest({ createdDaysAgo: 40, status: "NEW" });

    const r = await requestsReport(resolveRange({ preset: "month" }, now()));
    expect(r.oldestOpen[0]?.daysOpen).toBe(40);
    expect(r.oldestOpen.length).toBeLessThanOrEqual(10);
  });
});

describe("🔴 تقرير المركبات — حالة الباج مشتقّة", () => {
  async function seedVehicleWithBadge(opts: {
    id: string;
    vehicleStatus: string;
    badge?: { status: string; expiresInDays: number };
  }): Promise<void> {
    const vid = testId(opts.id);
    await client.query(
      `insert into "Vehicle"
         (id,"apartmentId","plateNumber","plateProvince",status,"updatedAt")
       values ($1,$2,$3,'بغداد',$4,now())`,
      [vid, f.apartmentId, `IT ${opts.id}`, opts.vehicleStatus],
    );
    if (!opts.badge) return;
    await client.query(
      `insert into "Badge"
         (id,"vehicleId",code,status,"issuedAt","expiresAt","issuedByUserId","updatedAt")
       values ($1,$2,$3,$4,now(),$5,$6,now())`,
      [
        testId(`bdg_${opts.id}`),
        vid,
        `IT-B-${opts.id}`,
        opts.badge.status,
        at(new Date(now().getTime() + opts.badge.expiresInDays * DAY_MS)),
        f.roleUsers.ADMIN,
      ],
    );
  }

  it("باجٌ عمودُه ISSUED وتاريخه مضى يُعدّ منتهياً — ويُعلَّم", async () => {
    /*
     * ⚠️ هذا هو الفارق الذي لا تُظهره أي شاشة أخرى: مقياس تأخّر المهمّة
     * الليلية. وبلا عدّه يبدو النظام سليماً وفيه باجات تفتح البوّابة.
     */
    await seedVehicleWithBadge({
      id: "v_stale",
      vehicleStatus: "APPROVED",
      badge: { status: "ISSUED", expiresInDays: -5 },
    });

    const r = await vehiclesReport();
    const issued = r.badgesByEffectiveStatus.find((b) => b.status === "ISSUED")?.count ?? 0;
    const expired = r.badgesByEffectiveStatus.find((b) => b.status === "EXPIRED")?.count ?? 0;

    expect(issued, "عُدّ باجٌ منتهٍ سارياً").toBe(0);
    expect(expired).toBe(1);
    expect(r.staleIssuedBadges, "لم يُعلَّم تأخّر المهمّة الليلية").toBe(1);
  });

  it("والباج الساري يُعدّ سارياً بلا تعليم", async () => {
    await seedVehicleWithBadge({
      id: "v_ok",
      vehicleStatus: "APPROVED",
      badge: { status: "ISSUED", expiresInDays: 30 },
    });

    const r = await vehiclesReport();
    expect(r.badgesByEffectiveStatus.find((b) => b.status === "ISSUED")?.count).toBe(1);
    expect(r.staleIssuedBadges).toBe(0);
    expect(r.approvedWithoutValidBadge).toBe(0);
  });

  it("ومعتمَدةٌ بلا باج تُعدّ — تقف عند البوّابة ولا تدخل", async () => {
    await seedVehicleWithBadge({ id: "v_nobadge", vehicleStatus: "APPROVED" });
    const r = await vehiclesReport();
    expect(r.approvedWithoutValidBadge).toBe(1);
  });
});

describe("تقرير السكان", () => {
  it("🔴 الساكن النشط بلا شقة يُعدّ", async () => {
    /*
     * ⚠️ لا جدول آخر يُظهره: كلّها تبدأ من الشقة. وهو حسابٌ لا يرى بوّابته
     * ولا يُفوتَر — أي مالٌ لا يُطالَب به.
     */
    const orphan = testId("u_ops_orphan");
    await client.query(
      `insert into "User" (id,"fullName",phone,role,"isActive","updatedAt")
       values ($1,'ساكن بلا شقة','+9647085000001','RESIDENT',true,now())`,
      [orphan],
    );

    const r = await residentsReport();
    expect(r.unlinkedActive).toBeGreaterThanOrEqual(1);
  });

  it("والرابط المُنهى لا يُحتسب ساكناً", async () => {
    const gone = testId("u_ops_gone");
    await client.query(
      `insert into "User" (id,"fullName",phone,role,"isActive","updatedAt")
       values ($1,'ساكن سابق','+9647085000002','RESIDENT',true,now())`,
      [gone],
    );
    await client.query(
      `insert into "ApartmentResident"
         (id,"apartmentId","userId","relationType","isContractHolder","isActive","movedInAt","updatedAt")
       values ($1,$2,$3,'OTHER',false,false,now(),now())`,
      [testId("ar_ops_gone"), f.apartmentId, gone],
    );

    const r = await residentsReport();
    const mine = r.byBuilding.find((b) => b.buildingId === f.buildingId);
    /* ⚠️ `isActive` على الرابط: عدُّ المنتهية يُضخّم البيوت */
    expect(mine?.residents ?? 0).toBe(0);
  });
});

describe("تقرير الموظفين", () => {
  it("عبء العمل يُحسب من الطلبات المفتوحة المُسنَدة", async () => {
    await seedRequest({ createdDaysAgo: 3, status: "ASSIGNED", assigned: true });
    /* ⚠️ المغلق لا يُعدّ عبئاً — العبء ما ينتظر */
    await seedRequest({ createdDaysAgo: 9, closedDaysAgo: 1, status: "DONE", assigned: true });

    const r = await staffReport();
    const row = r.rows.find((x) => x.userId === f.roleUsers.STAFF);
    expect(row?.openRequests, "عُدّ طلبٌ مغلق عبئاً").toBe(1);
  });

  it("🔴 ولا مبالغ في هذا التقرير", async () => {
    /*
     * تحصيل الموظف يعيش تحت `FINANCIAL_REPORTS` بعد أن كُشف أنه كان
     * مقروءاً بقدرة إدارة الموظفين. وهذا الفحص يمنع عودته من باب التقارير.
     */
    const r = await staffReport();
    const keys = Object.keys(r.rows[0] ?? {});
    for (const k of keys) {
      expect(
        /iqd|amount|collect|cash(?!Permitted)/iu.test(k),
        `حقلٌ ماليّ تسرّب إلى تقرير الموظفين: «${k}»`,
      ).toBe(false);
    }
  });
});
