import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { PendingDecisionError } from "@/lib/errors";
import { safePercentage, type Percentage } from "@/lib/domain/statistics";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  الإحصاءات المحسوبة — الاثنا عشر تعريفاً في §4.20، مرّة واحدة.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── لماذا ملف واحد ─────────────────────────────────────────────────
 * إعادة كتابة «نسبة الإنجاز» في ثلاث شاشات تُنتج **ثلاثة أرقام مختلفة**،
 * وهو أسوأ عيب ممكن في نظام يقرأه المالك: لا يفشل شيء، ولا يعرف أحد
 * أيّ الأرقام الصحيح. التعريفات هنا، والشاشات تستهلك ولا تحسب.
 *
 * ── تجميعات SQL لا حلقات JS ────────────────────────────────────────
 * `groupBy` و`aggregate` و`count` — لا جلب صفوف ثم عدّها في الذاكرة.
 * الفرق ليس أناقة: 500 شقة × اشتراكاتها تعني عشرات آلاف الصفوف تعبر
 * الشبكة لتُعَدّ، ولوحة المالك تُفتح كل صباح.
 *
 * ── القسمة على صفر تعيد `null` ─────────────────────────────────────
 * بناية بلا شقق، ومجمّع بلا شقق مسكونة. المواصفة لا تحدّد الناتج.
 * `null` تعرضها الواجهة «—»، بينما `0%` **كذبة**: تقول إن الإنجاز صفر
 * بينما لا يوجد ما يُنجَز. و`NaN` عيب يظهر للمستخدم.
 *
 * ── حالة الإنشاء ───────────────────────────────────────────────────
 * `DELIVERED` تُحتسب **مكتملة** في كل الإحصاءات: التسليم يقع بعد الإنجاز
 * لا بدلاً منه. حصرُها في `COMPLETED` كان سينقص نسبةَ الإنجاز كلما
 * سُلّمت شقة — أي كلما تقدّم المشروع.
 */

/**
 * ⚠️ **مُصدَّر عمداً.** «ما هي الشقة المكتملة؟» تعريف واحد يقرأه كلُّ من
 * يعدّها. كتابته مرّتين تُنتج رقمين مختلفين عند أول تعديل — وهو أسوأ عيب
 * ممكن في نظام يقرأه المالك، لأنه لا يفشل ولا يُكتشف.
 */
export const COMPLETED_STATUSES = ["COMPLETED", "DELIVERED"] as const;

type Db = Prisma.TransactionClient | typeof prisma;

// ═══════════════════════════════════════════════════════════════════════
//  نطاق البناية
// ═══════════════════════════════════════════════════════════════════════

export interface BuildingStats {
  apartmentsInBuilding: number;
  completedApartments: number;
  completionPercentage: Percentage;
}

/**
 * إحصاءات بناية واحدة — **استعلامان مجمَّعان لا أكثر**.
 *
 * ⚠️ لا نجلب الشقق لنعدّها: `count` يعمل في المحرّك. بناية بـ200 شقة
 * تُعيد رقمين لا 200 صفّ.
 */
export async function buildingStats(
  buildingId: string,
  db: Db = prisma,
): Promise<BuildingStats> {
  const base = { buildingId, deletedAt: null };

  const [total, completed] = await Promise.all([
    db.apartment.count({ where: base }),
    db.apartment.count({
      where: { ...base, constructionStatus: { in: [...COMPLETED_STATUSES] } },
    }),
  ]);

  return {
    apartmentsInBuilding: total,
    completedApartments: completed,
    completionPercentage: safePercentage(completed, total),
  };
}

/**
 * إحصاءات **كل** البنايات دفعةً واحدة.
 *
 * ⚠️ هذا هو الفرق بين لوحة تفتح في جزء من ثانية وأخرى تفتح في عشر ثوانٍ.
 * استدعاء `buildingStats` في حلقة على 20 بناية = **40 استعلاماً**
 * (‏N+1). هنا استعلامان مهما بلغ عدد البنايات.
 */
export async function allBuildingsStats(
  db: Db = prisma,
): Promise<Map<string, BuildingStats>> {
  const [totals, completes] = await Promise.all([
    db.apartment.groupBy({
      by: ["buildingId"],
      where: { deletedAt: null },
      _count: { _all: true },
    }),
    db.apartment.groupBy({
      by: ["buildingId"],
      where: { deletedAt: null, constructionStatus: { in: [...COMPLETED_STATUSES] } },
      _count: { _all: true },
    }),
  ]);

  const completedBy = new Map(completes.map((r) => [r.buildingId, r._count._all]));
  const out = new Map<string, BuildingStats>();

  for (const row of totals) {
    const total = row._count._all;
    const completed = completedBy.get(row.buildingId) ?? 0;
    out.set(row.buildingId, {
      apartmentsInBuilding: total,
      completedApartments: completed,
      completionPercentage: safePercentage(completed, total),
    });
  }

  return out;
}

/** «منو الشقق المكتملة» — أرقام العرض مرتَّبة كما تُقرأ في الواقع. */
export async function completedApartmentNumbers(
  buildingId: string,
  db: Db = prisma,
): Promise<string[]> {
  const rows = await db.apartment.findMany({
    where: {
      buildingId,
      deletedAt: null,
      constructionStatus: { in: [...COMPLETED_STATUSES] },
    },
    select: { displayNumber: true },
    orderBy: [{ floorNumber: "asc" }, { unitNumber: "asc" }],
  });
  return rows.map((r) => r.displayNumber);
}

// ═══════════════════════════════════════════════════════════════════════
//  نطاق الشقة
// ═══════════════════════════════════════════════════════════════════════

/**
 * عدد الأفراد في الشقة — **محسوب لا مخزَّن** (‏R9).
 *
 * حقلٌ مخزَّن كان سيتقادم عند أول ربط أو إخراج يجري خارج المسار المتوقَّع،
 * ولا يكشفه شيء لأنه يبدو رقماً معقولاً دائماً.
 */
export async function residentsInApartment(
  apartmentId: string,
  db: Db = prisma,
): Promise<number> {
  return db.apartmentResident.count({ where: { apartmentId, isActive: true } });
}

/** عدد الأفراد لكل شقة دفعةً واحدة — لجداول القوائم. */
export async function residentsCountByApartment(
  apartmentIds: string[],
  db: Db = prisma,
): Promise<Map<string, number>> {
  const rows = await db.apartmentResident.groupBy({
    by: ["apartmentId"],
    where: { apartmentId: { in: apartmentIds }, isActive: true },
    _count: { _all: true },
  });
  const out = new Map(rows.map((r) => [r.apartmentId, r._count._all]));
  // الشقق بلا سكان لا تظهر في `groupBy` — تُملأ بصفر لا تُترك مفقودة
  for (const id of apartmentIds) if (!out.has(id)) out.set(id, 0);
  return out;
}

/**
 * ⚠️ **محجوب بالقرار `B3`.**
 *
 * تعريف §4.20 يقول «الحساب `OPEN` للشقة» **بالمفرد**، و`D1` جعلهما
 * اثنين: حساب البيع وحساب الإيجار. والخيارات ثلاثة ولكلٍّ معنى مختلف:
 * مجموعهما · عمودان منفصلان · حساب الساكن الفعلي وحده.
 *
 * **جمع حسابَي مالك ومستأجر يخلط ذمّتين ماليتين لشخصين** — رقمٌ يُنسب
 * إلى شقة بينما لا يدين به أحد بعينه، ويظهر في تقرير المستحقات فيُطالَب
 * به من ليس عليه.
 *
 * البديل ليس التخمين بل الرفض. و`compoundTotalOutstanding` أدناه **غير
 * متأثّر**: هو إجمالي لا فردي، فجمع كل الحسابات المفتوحة سليم.
 */
export async function apartmentCurrentBalance(apartmentId: string): Promise<never> {
  void apartmentId;
  throw new PendingDecisionError(
    "B3",
    "«رصيد الشقة الحالي» — للشقة حسابان مفتوحان بعد D1 (بيع وإيجار)، " +
      "وجمعهما يخلط ذمّتَي شخصين",
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  نطاق الخدمة
// ═══════════════════════════════════════════════════════════════════════

export interface ServiceStats {
  apartmentsSubscribed: number;
  residentsSubscribed: number;
  subscriptionPercentage: Percentage;
  expectedMonthlyRevenueIqd: bigint;
}

/**
 * إحصاءات خدمة واحدة.
 *
 * ── «نسبة الاشتراك» مقامها الشقق **المسكونة** لا كل الشقق ──────────
 * شقة فارغة لا تشترك ولا يُتوقَّع منها، فإدخالها في المقام يُنتج نسبةً
 * منخفضة أبداً لا تعني شيئاً. ومجمّع بلا شقق مسكونة ← `null`.
 */
export async function serviceStats(
  serviceId: string,
  db: Db = prisma,
): Promise<ServiceStats> {
  const active = { serviceId, status: "ACTIVE" as const, deletedAt: null };

  const [apartmentGroups, residentGroups, occupiedCount, revenue] = await Promise.all([
    db.subscription.groupBy({
      by: ["apartmentId"],
      where: { ...active, apartmentId: { not: null } },
    }),
    db.subscription.groupBy({
      by: ["residentUserId"],
      where: { ...active, subjectType: "RESIDENT", residentUserId: { not: null } },
    }),
    db.apartment.count({
      where: { deletedAt: null, occupancyStatus: { not: "VACANT" } },
    }),
    expectedMonthlyRevenue(serviceId, db),
  ]);

  const apartmentsSubscribed = apartmentGroups.length;

  return {
    apartmentsSubscribed,
    residentsSubscribed: residentGroups.length,
    subscriptionPercentage: safePercentage(apartmentsSubscribed, occupiedCount),
    expectedMonthlyRevenueIqd: revenue,
  };
}

/**
 * الإيراد الشهري المتوقّع — **مُطبَّعاً شهرياً**.
 *
 * ⚠️ **تصحيح `Q45` مقصود ومُعلَن.** تعريف §4.20 يرشّح
 * `billingCycle = MONTHLY` وحده، فتسقط الاشتراكات الربعية والسنوية
 * ويرى المالك رقماً **أقل من الحقيقة** — وهو يقرأه ليقرّر.
 *
 * التطبيع: ربعي ÷ 3 · سنوي ÷ 12. والقسمة على `BigInt` تقتطع الكسر،
 * وهذا مقبول هنا: الرقم **تقدير للعرض** لا قيد في دفتر. أي كسر يضيع
 * أقلّ من دينار على الاشتراك الواحد.
 */
export async function expectedMonthlyRevenue(
  serviceId: string,
  db: Db = prisma,
): Promise<bigint> {
  return normalizedMonthlyRevenue({ serviceId }, db);
}

/**
 * تطبيع الدورات إلى شهر — **موضع واحد**.
 *
 * ⚠️ كان هذا المنطق داخل `expectedMonthlyRevenue` وحدها. ولمّا احتاجت لوحة
 * المالك المجموعَ على الخدمات كلها، كان الخيار بين نسخِه ونقلِه. والنسخ هو
 * بالضبط ما يحذّر منه رأس هذا الملف: «ربعي ÷ 3» في موضعين تصير عند أول
 * تعديل رقمين مختلفين لنفس السؤال، بلا فشل ولا تحذير.
 *
 * والمرشِّح وسيطٌ: خدمةٌ واحدة أو المجمّع كلّه، بنفس القاعدة حرفياً.
 */
async function normalizedMonthlyRevenue(
  scope: { serviceId?: string },
  db: Db = prisma,
): Promise<bigint> {
  const groups = await db.subscription.groupBy({
    by: ["billingCycle"],
    where: {
      ...(scope.serviceId ? { serviceId: scope.serviceId } : {}),
      status: "ACTIVE",
      deletedAt: null,
      billingCycle: { not: null },
    },
    _sum: { periodAmountIqd: true },
  });

  let total = 0n;
  for (const g of groups) {
    const sum = g._sum.periodAmountIqd ?? 0n;
    switch (g.billingCycle) {
      case "MONTHLY":
        total += sum;
        break;
      case "QUARTERLY":
        total += sum / 3n;
        break;
      case "YEARLY":
        total += sum / 12n;
        break;
      default:
        break;
    }
  }
  return total;
}

// ═══════════════════════════════════════════════════════════════════════
//  نطاق المجمّع
// ═══════════════════════════════════════════════════════════════════════

export interface CompoundStats {
  totalApartments: number;
  occupancy: Record<"VACANT" | "OCCUPIED_BY_OWNER" | "OCCUPIED_BY_TENANT", number>;
  occupiedTotal: number;
  occupancyPercentage: Percentage;
  totalOutstandingIqd: bigint;
}

/**
 * إحصاءات المجمّع — استعلامان مجمَّعان.
 *
 * ── «إجمالي المستحقات» غير متأثّر بـ`B3` ───────────────────────────
 * جمع كل الحسابات المفتوحة سليم لأنه **إجمالي لا فردي**: لا يُنسب رقمٌ
 * إلى شقة ولا إلى شخص. الخلط المحرَّم هو جمع حسابَي شخصين في سطر واحد.
 *
 * ⚠️ والشرط `balanceIqd > 0` مقصود: الرصيد الدائن (سلفة دفعها ساكن) ليس
 * مستحقاً على أحد، وطرحُه من الإجمالي كان سيُظهر مستحقاتٍ **أقلّ** من
 * الواقع فيبدو التحصيل أفضل مما هو.
 */
export async function compoundStats(db: Db = prisma): Promise<CompoundStats> {
  const [byOccupancy, outstanding] = await Promise.all([
    db.apartment.groupBy({
      by: ["occupancyStatus"],
      where: { deletedAt: null },
      _count: { _all: true },
    }),
    db.account.aggregate({
      where: { status: "OPEN", balanceIqd: { gt: 0 } },
      _sum: { balanceIqd: true },
    }),
  ]);

  const occupancy = {
    VACANT: 0,
    OCCUPIED_BY_OWNER: 0,
    OCCUPIED_BY_TENANT: 0,
  };
  for (const row of byOccupancy) {
    occupancy[row.occupancyStatus] = row._count._all;
  }

  const totalApartments =
    occupancy.VACANT + occupancy.OCCUPIED_BY_OWNER + occupancy.OCCUPIED_BY_TENANT;
  const occupiedTotal = occupancy.OCCUPIED_BY_OWNER + occupancy.OCCUPIED_BY_TENANT;

  return {
    totalApartments,
    occupancy,
    occupiedTotal,
    occupancyPercentage: safePercentage(occupiedTotal, totalApartments),
    totalOutstandingIqd: outstanding._sum.balanceIqd ?? 0n,
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  محفظة المجمّع — أرقام لوحة المالك
// ═══════════════════════════════════════════════════════════════════════

export interface CompoundPortfolioStats {
  buildingsCount: number;
  construction: Record<"UNDER_CONSTRUCTION" | "COMPLETED" | "DELIVERED", number>;
  completedApartments: number;
  completionPercentage: Percentage;
  ownership: Record<"UNSOLD" | "SOLD" | "RENTED_BY_COMPANY", number>;
  activeContracts: Record<"SALE" | "RENTAL", number>;
  activeContractsTotal: number;
  activeResidents: number;
  debtorAccounts: number;
  expectedMonthlyServiceRevenueIqd: bigint;
}

/**
 * أرقام محفظة المجمّع — **ستّة استعلامات مجمَّعة، مهما بلغ الحجم**.
 *
 * ── ما هي ولماذا هي هنا ────────────────────────────────────────────
 * تعريف كلٍّ منها مُعلَن في `DERIVED_STATISTICS` (‏`lib/domain/statistics.ts`).
 * ولا واحد منها يحتاج قراراً محجوباً: ما يحتاجه — رصيد الشقة (‏B3) وقيمة
 * المبيعات (‏Q30) — ليس هنا وليس في اللوحة.
 *
 * ── ولماذا استدعاء واحد لا ستّة ────────────────────────────────────
 * ⚠️ الأرقام تُقرأ معاً في لوحة واحدة، فجمعها في `Promise.all` يجعل زمنها
 * زمنَ أبطأ استعلام لا مجموعَ الستّة. وتفريقها إلى دوالّ يستدعيها المكوّن
 * بالتوالي كان يضاعف زمن فتح اللوحة ستّ مرّات.
 *
 * ── ⚠️ والسكّان **أشخاص لا ارتباطات** ──────────────────────────────
 * `apartmentResident.count` كان سيحتسب من له ارتباطان مرّتين. العدّ على
 * `User` بشرط وجود ارتباط نشط يعطي أشخاصاً. ولا ترشيح بالدور: الحارس
 * المقيم ساكنٌ فعلاً ويبقى `STAFF` بحكم `Q41`.
 */
export async function compoundPortfolioStats(
  db: Db = prisma,
): Promise<CompoundPortfolioStats> {
  const live = { deletedAt: null };

  const [buildingsCount, byConstruction, byOwnership, byContractType, activeResidents, debtorAccounts, revenue] =
    await Promise.all([
      // ⚠️ لا `deletedAt` على Building في المخطّط — لا يُرشَّح بما لا يوجد
      db.building.count(),
      db.apartment.groupBy({ by: ["constructionStatus"], where: live, _count: { _all: true } }),
      db.apartment.groupBy({ by: ["ownershipStatus"], where: live, _count: { _all: true } }),
      db.contract.groupBy({
        by: ["type"],
        where: { status: "ACTIVE", deletedAt: null },
        _count: { _all: true },
      }),
      db.user.count({ where: { apartmentLinks: { some: { isActive: true } } } }),
      db.account.count({ where: { status: "OPEN", balanceIqd: { gt: 0 } } }),
      normalizedMonthlyRevenue({}, db),
    ]);

  const construction = { UNDER_CONSTRUCTION: 0, COMPLETED: 0, DELIVERED: 0 };
  for (const row of byConstruction) construction[row.constructionStatus] = row._count._all;

  const ownership = { UNSOLD: 0, SOLD: 0, RENTED_BY_COMPANY: 0 };
  for (const row of byOwnership) ownership[row.ownershipStatus] = row._count._all;

  const activeContracts = { SALE: 0, RENTAL: 0 };
  for (const row of byContractType) activeContracts[row.type] = row._count._all;

  /**
   * ⚠️ المجموع من التوزيع نفسه لا باستعلام سابع.
   * استعلامُ عدٍّ منفصل قد يقع في لحظة أخرى فيعطي مجموعاً لا يساوي أجزاءه —
   * فيرى المالك «٪‎٦٠ من ١٠٠» وتحته أجزاءٌ تجمع ٩٩.
   */
  const totalApartments =
    construction.UNDER_CONSTRUCTION + construction.COMPLETED + construction.DELIVERED;
  const completedApartments = construction.COMPLETED + construction.DELIVERED;

  return {
    buildingsCount,
    construction,
    completedApartments,
    completionPercentage: safePercentage(completedApartments, totalApartments),
    ownership,
    activeContracts,
    activeContractsTotal: activeContracts.SALE + activeContracts.RENTAL,
    activeResidents,
    debtorAccounts,
    expectedMonthlyServiceRevenueIqd: revenue,
  };
}
