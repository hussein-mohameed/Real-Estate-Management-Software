import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { ResidentRelation } from "@/lib/domain/enums";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  تقارير الناس — السكان والموظفون.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── 🔴 ولا مال في هذا الملفّ ────────────────────────────────────────
 * تحصيل الموظف يعيش في `collectionsReport` تحت `FINANCIAL_REPORTS`، وقد
 * نُقل إليها بعد أن كُشف أنه كان مقروءاً بقدرة إدارة الموظفين — أي أن
 * **كل موظّف كان يقرأ نقد زملائه**.
 *
 * ⚠️ فإضافةُ عمود «حصّل كذا» هنا تُعيد الثغرة نفسها من باب التقارير:
 * `DEPARTMENTS_SKILLS_STAFF` قدرةُ تنظيم لا قدرةُ مال. وما يُعرَض هنا
 * **عبء عمل** لا مبالغ.
 *
 * ── وكلاهما «الحال الآن» لا حركة مدّة ──────────────────────────────
 * «كم ساكناً» و«كم موظفاً متواجداً» أسئلةٌ عن اللحظة. ومرشّح مدّة عليها
 * يُنتج «سكّان آذار» — عبارةٌ بلا معنى.
 */

type Db = Prisma.TransactionClient | typeof prisma;

// ═══════════════════════════════════════════════════════════════════════
//  السكان
// ═══════════════════════════════════════════════════════════════════════

export interface ResidentsByBuilding {
  buildingId: string;
  buildingCode: string;
  buildingName: string | null;
  apartmentsWithResidents: number;
  residents: number;
}

export interface ResidentsReport {
  activeResidents: number;
  inactiveResidents: number;
  /** ⚠️ حسابٌ نشط بلا شقة: لا يرى شيئاً في بوّابته ولا يُفوتَر. */
  unlinkedActive: number;
  byBuilding: ResidentsByBuilding[];
  byRelation: { relation: ResidentRelation; count: number }[];
  /** أكبر البيوت — يُقرأ منه تسعير «بالفرد» (‏Q5). */
  largestHouseholds: {
    apartmentId: string;
    displayNumber: string;
    buildingCode: string;
    residents: number;
  }[];
}

export async function residentsReport(db: Db = prisma): Promise<ResidentsReport> {
  const [activeResidents, inactiveResidents, links, buildings] = await Promise.all([
    db.user.count({ where: { role: "RESIDENT", isActive: true } }),
    db.user.count({ where: { role: "RESIDENT", isActive: false } }),
    db.apartmentResident.findMany({
      /*
       * ⚠️ `isActive` على **الرابط** لا على المستخدم: ساكنٌ انتقل يبقى
       * حسابه نشطاً ورابطُه مُنهىً. وعدُّ الروابط المنتهية يُضخّم البيوت.
       */
      where: { isActive: true },
      select: {
        relationType: true,
        userId: true,
        apartment: {
          select: {
            id: true,
            displayNumber: true,
            buildingId: true,
            building: { select: { code: true, name: true } },
          },
        },
      },
    }),
    db.building.findMany({ select: { id: true, code: true, name: true } }),
  ]);

  const perApartment = new Map<
    string,
    { displayNumber: string; buildingCode: string; buildingId: string; residents: number }
  >();
  const relations = new Map<ResidentRelation, number>();
  const linkedUsers = new Set<string>();

  for (const l of links) {
    linkedUsers.add(l.userId);
    relations.set(l.relationType, (relations.get(l.relationType) ?? 0) + 1);

    const cur = perApartment.get(l.apartment.id) ?? {
      displayNumber: l.apartment.displayNumber,
      buildingCode: l.apartment.building.code,
      buildingId: l.apartment.buildingId,
      residents: 0,
    };
    perApartment.set(l.apartment.id, { ...cur, residents: cur.residents + 1 });
  }

  const byBuilding: ResidentsByBuilding[] = buildings.map((b) => {
    const apts = [...perApartment.values()].filter((a) => a.buildingId === b.id);
    return {
      buildingId: b.id,
      buildingCode: b.code,
      buildingName: b.name,
      apartmentsWithResidents: apts.length,
      residents: apts.reduce((n, a) => n + a.residents, 0),
    };
  });

  /*
   * ⚠️ **غير المرتبطين يُعدّون من المستخدمين لا من الروابط.** حسابٌ نشط
   * بلا رابط لا يظهر في أي جدول أعلاه — وهو بالضبط ما يجب أن يُرى: ساكنٌ
   * أُنشئ حسابه ونُسي ربطه، فبوّابته فارغة ولا يُفوتَر.
   */
  const activeResidentIds = await db.user.findMany({
    where: { role: "RESIDENT", isActive: true },
    select: { id: true },
  });
  const unlinkedActive = activeResidentIds.filter((u) => !linkedUsers.has(u.id)).length;

  return {
    activeResidents,
    inactiveResidents,
    unlinkedActive,
    byBuilding: byBuilding.sort((a, b) => b.residents - a.residents),
    byRelation: [...relations.entries()].map(([relation, count]) => ({ relation, count })),
    largestHouseholds: [...perApartment.entries()]
      .map(([apartmentId, v]) => ({
        apartmentId,
        displayNumber: v.displayNumber,
        buildingCode: v.buildingCode,
        residents: v.residents,
      }))
      .sort((a, b) => b.residents - a.residents)
      .slice(0, 10),
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  الموظفون — عبء عمل لا مبالغ
// ═══════════════════════════════════════════════════════════════════════

export interface StaffByDepartment {
  departmentId: string | null;
  departmentName: string;
  total: number;
  available: number;
  openRequests: number;
}

export interface StaffRow {
  userId: string;
  name: string;
  departmentName: string;
  jobTitle: string | null;
  employmentType: string;
  isAvailable: boolean;
  skills: number;
  openRequests: number;
}

export interface StaffReport {
  total: number;
  available: number;
  /** ⚠️ صلاحية القبض استثناء لا قاعدة (‏B4) — يُعرَض عددها لا مبالغها. */
  cashPermitted: number;
  unassignedDepartment: number;
  byDepartment: StaffByDepartment[];
  rows: StaffRow[];
}

export async function staffReport(db: Db = prisma): Promise<StaffReport> {
  const profiles = await db.staffProfile.findMany({
    where: { user: { isActive: true } },
    select: {
      userId: true,
      jobTitle: true,
      employmentType: true,
      isAvailable: true,
      canReceiveCash: true,
      user: { select: { fullName: true } },
      department: { select: { id: true, name: true } },
      _count: { select: { skills: true } },
    },
  });

  /*
   * ⚠️ **عبء العمل يُحسب باستعلام مجمَّع واحد** لا بواحدٍ لكل موظّف.
   * أربعون موظفاً = أربعون رحلة، والصفحة تُفتَح يومياً.
   */
  const openByStaff = await db.serviceRequest.groupBy({
    by: ["assignedStaffId"],
    where: { status: { notIn: ["DONE", "CANCELLED"] }, assignedStaffId: { not: null } },
    _count: { _all: true },
  });
  const load = new Map(
    openByStaff.map((r) => [r.assignedStaffId ?? "", r._count._all] as const),
  );

  const rows: StaffRow[] = profiles.map((p) => ({
    userId: p.userId,
    name: p.user.fullName,
    departmentName: p.department?.name ?? "بلا قسم",
    jobTitle: p.jobTitle,
    employmentType: p.employmentType,
    isAvailable: p.isAvailable,
    skills: p._count.skills,
    openRequests: load.get(p.userId) ?? 0,
  }));

  const byDept = new Map<string, StaffByDepartment>();
  for (const p of profiles) {
    const key = p.department?.id ?? "—";
    const cur = byDept.get(key) ?? {
      departmentId: p.department?.id ?? null,
      departmentName: p.department?.name ?? "بلا قسم",
      total: 0,
      available: 0,
      openRequests: 0,
    };
    byDept.set(key, {
      ...cur,
      total: cur.total + 1,
      available: cur.available + (p.isAvailable ? 1 : 0),
      openRequests: cur.openRequests + (load.get(p.userId) ?? 0),
    });
  }

  return {
    total: profiles.length,
    available: profiles.filter((p) => p.isAvailable).length,
    cashPermitted: profiles.filter((p) => p.canReceiveCash).length,
    unassignedDepartment: profiles.filter((p) => p.department === null).length,
    byDepartment: [...byDept.values()].sort((a, b) => b.total - a.total),
    rows: rows.sort((a, b) => b.openRequests - a.openRequests),
  };
}
