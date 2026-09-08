import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { now } from "@/lib/dates";
import { effectiveBadgeStatus } from "@/lib/services/resident-extras";
import type { ReportRange } from "@/lib/domain/report-range";
import type {
  BadgeStatus,
  RequestStatus,
  RequestType,
  VehicleStatus,
} from "@/lib/domain/enums";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  تقارير التشغيل — الطلبات والمركبات.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ⚠️ والفرق بين تقريرَي الطلبات ───────────────────────────────────
 * **المنجَز في مدّة** يقيس الأداء: كم أُغلق، وفي كم يوم.
 * **المفتوح الآن** يقيس المتراكم: ما ينتظر، ومنذ متى.
 *
 * وخلطُهما في جدول واحد يُنتج «متوسّط إنجاز» يشمل ما لم يُنجَز بعد —
 * رقمٌ يتحسّن كلّما تراكم العمل، وهو نقيض ما يُراد قياسه.
 */

type Db = Prisma.TransactionClient | typeof prisma;

const DAY_MS = 86_400_000;

// ═══════════════════════════════════════════════════════════════════════
//  الطلبات
// ═══════════════════════════════════════════════════════════════════════

export interface RequestsByDepartment {
  departmentId: string | null;
  departmentName: string;
  open: number;
  closedInRange: number;
  /** متوسّط أيام الإنجاز — **للمغلق في المدّة وحده**. */
  avgDaysToClose: number | null;
}

export interface OpenAgeingRow {
  id: string;
  number: string;
  title: string;
  status: RequestStatus;
  departmentName: string;
  assignedTo: string | null;
  daysOpen: number;
}

export interface RequestsReport {
  /** ما أُغلق **في المدّة**. */
  closedInRange: number;
  avgDaysToClose: number | null;
  byType: { type: RequestType; closedInRange: number }[];
  byDepartment: RequestsByDepartment[];
  /** المفتوح **الآن** — لا علاقة له بالمدّة. */
  openTotal: number;
  openByStatus: { status: RequestStatus; count: number }[];
  /** الأقدم فالأقدم — عشرة تكفي لقراءة المتراكم. */
  oldestOpen: OpenAgeingRow[];
  /** ⚠️ مفتوحٌ بلا مُكلَّف: لا أحد يعمل عليه، ولا شيء يقول ذلك في القائمة. */
  openUnassigned: number;
}

export async function requestsReport(
  range: ReportRange,
  db: Db = prisma,
): Promise<RequestsReport> {
  const today = now();

  const [closed, open] = await Promise.all([
    db.serviceRequest.findMany({
      /*
       * ⚠️ `closedAt` لا `updatedAt`: الأخير يتغيّر بأي تعليق، فيدخل في
       * «المنجَز» طلبٌ عُلّق عليه ولم يُغلق.
       */
      where: {
        status: { in: ["DONE", "CANCELLED"] },
        closedAt: { gte: range.from, lt: range.to },
      },
      select: {
        type: true,
        createdAt: true,
        closedAt: true,
        department: { select: { id: true, name: true } },
      },
    }),
    db.serviceRequest.findMany({
      where: { status: { notIn: ["DONE", "CANCELLED"] } },
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        createdAt: true,
        assignedStaffId: true,
        department: { select: { id: true, name: true } },
        assignedStaff: { select: { user: { select: { fullName: true } } } },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const byType = new Map<RequestType, number>();
  const byDept = new Map<
    string,
    { id: string | null; name: string; open: number; closed: number; daysSum: number }
  >();

  const dept = (id: string | null, name: string) => {
    const key = id ?? "—";
    return (
      byDept.get(key) ?? { id, name, open: 0, closed: 0, daysSum: 0 }
    );
  };

  let daysSum = 0;
  for (const r of closed) {
    byType.set(r.type, (byType.get(r.type) ?? 0) + 1);
    /* `closedAt` غير فارغ بحكم المرشّح — والحارس للأنواع */
    const days = r.closedAt
      ? Math.max(0, (r.closedAt.getTime() - r.createdAt.getTime()) / DAY_MS)
      : 0;
    daysSum += days;

    const key = r.department?.id ?? "—";
    const cur = dept(r.department?.id ?? null, r.department?.name ?? "بلا قسم");
    byDept.set(key, { ...cur, closed: cur.closed + 1, daysSum: cur.daysSum + days });
  }

  const openByStatus = new Map<RequestStatus, number>();
  for (const r of open) {
    openByStatus.set(r.status, (openByStatus.get(r.status) ?? 0) + 1);
    const key = r.department?.id ?? "—";
    const cur = dept(r.department?.id ?? null, r.department?.name ?? "بلا قسم");
    byDept.set(key, { ...cur, open: cur.open + 1 });
  }

  const round1 = (n: number): number => Math.round(n * 10) / 10;

  return {
    closedInRange: closed.length,
    /* ⚠️ `null` لا صفر: «لا بيانات» ≠ «أُنجزت في يوم صفر» */
    avgDaysToClose: closed.length > 0 ? round1(daysSum / closed.length) : null,
    byType: [...byType.entries()].map(([type, closedInRange]) => ({ type, closedInRange })),
    byDepartment: [...byDept.values()]
      .map((d) => ({
        departmentId: d.id,
        departmentName: d.name,
        open: d.open,
        closedInRange: d.closed,
        avgDaysToClose: d.closed > 0 ? round1(d.daysSum / d.closed) : null,
      }))
      .sort((a, b) => b.open - a.open),
    openTotal: open.length,
    openByStatus: [...openByStatus.entries()].map(([status, count]) => ({ status, count })),
    oldestOpen: open.slice(0, 10).map((r) => ({
      id: r.id,
      number: r.number,
      title: r.title,
      status: r.status,
      departmentName: r.department?.name ?? "بلا قسم",
      assignedTo: r.assignedStaff?.user.fullName ?? null,
      daysOpen: Math.max(0, Math.floor((today.getTime() - r.createdAt.getTime()) / DAY_MS)),
    })),
    openUnassigned: open.filter((r) => r.assignedStaffId === null).length,
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  المركبات والباجات
// ═══════════════════════════════════════════════════════════════════════

export interface VehiclesByBuilding {
  buildingCode: string;
  vehicles: number;
  approved: number;
}

export interface VehiclesReport {
  total: number;
  byStatus: { status: VehicleStatus; count: number }[];
  byBuilding: VehiclesByBuilding[];
  /** ⚠️ الحالة **المشتقّة** من التاريخ لا العمود — راجع أدناه. */
  badgesByEffectiveStatus: { status: BadgeStatus; count: number }[];
  /** معتمَدةٌ بلا باجٍ ساري — تقف عند البوّابة ولا تدخل. */
  approvedWithoutValidBadge: number;
  /** ⚠️ عمودها `ISSUED` وتاريخها مضى — المهمّة الليلية لم تقلبها بعد. */
  staleIssuedBadges: number;
}

/**
 * ⚠️ **حالة الباج تُشتقّ من التاريخ.**
 * `EXPIRED` تكتبها مهمّة ليلية، فباجٌ انتهى صباح اليوم يبقى `ISSUED` في
 * العمود. وتقريرٌ يعدّ العمود يقول «كذا باجاً سارياً» وفيها منتهية —
 * والحارس عند البوّابة يبني عليها.
 *
 * فالتقرير يعدّ بالمشتقّ، **ويعرض الفارق صراحةً** (`staleIssuedBadges`):
 * هو مقياسُ تأخّر المهمّة الليلية، ولا شاشة أخرى تُظهره.
 */
export async function vehiclesReport(db: Db = prisma): Promise<VehiclesReport> {
  const today = now();

  const vehicles = await db.vehicle.findMany({
    select: {
      status: true,
      apartment: { select: { building: { select: { code: true } } } },
      badges: { select: { status: true, expiresAt: true } },
    },
  });

  const byStatus = new Map<VehicleStatus, number>();
  const byBuilding = new Map<string, { vehicles: number; approved: number }>();
  const badges = new Map<BadgeStatus, number>();
  let approvedWithoutValidBadge = 0;
  let staleIssuedBadges = 0;

  for (const v of vehicles) {
    byStatus.set(v.status, (byStatus.get(v.status) ?? 0) + 1);

    const code = v.apartment.building.code;
    const b = byBuilding.get(code) ?? { vehicles: 0, approved: 0 };
    byBuilding.set(code, {
      vehicles: b.vehicles + 1,
      approved: b.approved + (v.status === "APPROVED" ? 1 : 0),
    });

    let hasValid = false;
    for (const bd of v.badges) {
      const eff = effectiveBadgeStatus(bd.status, bd.expiresAt, today);
      badges.set(eff, (badges.get(eff) ?? 0) + 1);
      if (eff === "ISSUED") hasValid = true;
      if (bd.status === "ISSUED" && eff === "EXPIRED") staleIssuedBadges += 1;
    }

    if (v.status === "APPROVED" && !hasValid) approvedWithoutValidBadge += 1;
  }

  return {
    total: vehicles.length,
    byStatus: [...byStatus.entries()].map(([status, count]) => ({ status, count })),
    byBuilding: [...byBuilding.entries()]
      .map(([buildingCode, v]) => ({ buildingCode, ...v }))
      .sort((a, b) => b.vehicles - a.vehicles),
    badgesByEffectiveStatus: [...badges.entries()].map(([status, count]) => ({
      status,
      count,
    })),
    approvedWithoutValidBadge,
    staleIssuedBadges,
  };
}
