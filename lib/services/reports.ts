import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { now } from "@/lib/dates";
import type { ReportRange } from "@/lib/domain/report-range";
import type { LedgerEntryType, LedgerSource, PaymentMethod } from "@/lib/domain/enums";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  تقارير المال — التجميعات.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── 🔴 ثلاثة أرقام لا رقم واحد اسمه «الإيراد» ───────────────────────
 *   • **متوقَّع** ← `Subscription.periodAmountIqd` — ما *سيُقيَّد* كل دورة
 *   • **مُقيَّد** ← `LedgerEntry` نوع `CHARGE` — ما صار دَيناً فعلاً
 *   • **محصَّل** ← `Payment` — ما دخل الصندوق
 *
 * وجمعُها تحت عنوان واحد هو أكثر خطأ يقع في تقارير هذا الصنف: الإدارة
 * تقرأ «الإيراد» فتظنّه نقداً، وهو التزامٌ لم يُدفع بعد. فكل دالّة هنا
 * تسمّي مصدرها في اسمها، ولا تخلط اثنين في عمود.
 *
 * ── ⚠️ والرصيد يُقرأ من `Account.balanceIqd` لا يُعاد جمعه ───────────
 * الرصيد استثناءٌ مُتعمَّد يُحسب داخل معاملة القيد، ومهمّةٌ ليلية تكشف
 * انحرافه ولا تصحّحه. فتقريرٌ يجمع القيود بنفسه يُنتج رقماً قد يخالف
 * الحساب — **والاختلاف هو بالضبط ما وُجدت تلك المهمّة لكشفه**. تقرير
 * المستحقّات يقرأ العمود، ولا يفتح مساراً ثالثاً للحساب.
 *
 * ── والحدّ الأعلى مفتوح في كل استعلام ──────────────────────────────
 * `gte: from` و`lt: to` — راجع `lib/domain/report-range.ts`.
 */

type Db = Prisma.TransactionClient | typeof prisma;

// ═══════════════════════════════════════════════════════════════════════
//  ١) التحصيل — ما قُبض فعلاً
// ═══════════════════════════════════════════════════════════════════════

export interface CollectionsReport {
  totalIqd: bigint;
  count: number;
  byMethod: { method: PaymentMethod; totalIqd: bigint; count: number }[];
  byDay: { day: string; totalIqd: bigint; count: number }[];
  byCollector: { userId: string; name: string; totalIqd: bigint; count: number }[];
}

export async function collectionsReport(
  range: ReportRange,
  db: Db = prisma,
): Promise<CollectionsReport> {
  /*
   * ⚠️ `status: "PAID"` وحدها. الدفعة `PENDING` رابطُ دفعٍ أُنشئ ولم
   * يُسدَّد، و`FAILED` محاولةٌ سقطت — وعدُّهما تحصيلاً يُنتج رقماً أكبر
   * من النقد في الصندوق، وهو أسوأ خطأ يمكن أن يحمله تقرير تحصيل.
   */
  const where = {
    status: "PAID" as const,
    paidAt: { gte: range.from, lt: range.to },
  };

  const rows = await db.payment.findMany({
    where,
    select: {
      amountIqd: true,
      method: true,
      paidAt: true,
      receivedByUserId: true,
      receivedBy: { select: { fullName: true } },
    },
    orderBy: { paidAt: "asc" },
  });

  let totalIqd = 0n;
  const methods = new Map<PaymentMethod, { totalIqd: bigint; count: number }>();
  const days = new Map<string, { totalIqd: bigint; count: number }>();
  const collectors = new Map<string, { name: string; totalIqd: bigint; count: number }>();

  for (const r of rows) {
    /*
     * ⚠️ `paidAt` قابل للفراغ في المخطّط، ومرشّح `gte/lt` يستبعد الفارغة
     * في القاعدة — فالحارس هنا للأنواع لا للحالة. وتخطّي الصفّ أصدق من
     * `!` : لو ظهرت دفعةٌ `PAID` بلا تاريخ يوماً فهي عيبُ بيانات، ولا
     * يجوز أن تُنسَب إلى يومٍ يخترعه التقرير.
     */
    if (!r.paidAt) continue;
    totalIqd += r.amountIqd;

    const m = methods.get(r.method) ?? { totalIqd: 0n, count: 0 };
    methods.set(r.method, { totalIqd: m.totalIqd + r.amountIqd, count: m.count + 1 });

    /*
     * ⚠️ التجميع باليوم **في الكود لا في SQL**: `date_trunc` يقطع بتوقيت
     * الخادم، وهو UTC. فدفعةٌ بعد التاسعة مساءً بغداد تقع في اليوم التالي
     * — ويختلف الجدول عن إقفال الصندوق الذي يقفله المحصِّل بيده.
     */
    const day = dayKeyBaghdad(r.paidAt);
    const d = days.get(day) ?? { totalIqd: 0n, count: 0 };
    days.set(day, { totalIqd: d.totalIqd + r.amountIqd, count: d.count + 1 });

    const uid = r.receivedByUserId ?? "—";
    const c = collectors.get(uid) ?? {
      name: r.receivedBy?.fullName ?? "غير مسجَّل",
      totalIqd: 0n,
      count: 0,
    };
    collectors.set(uid, { ...c, totalIqd: c.totalIqd + r.amountIqd, count: c.count + 1 });
  }

  return {
    totalIqd,
    count: [...days.values()].reduce((n, d) => n + d.count, 0),
    byMethod: [...methods.entries()].map(([method, v]) => ({ method, ...v })),
    byDay: [...days.entries()]
      .map(([day, v]) => ({ day, ...v }))
      .sort((a, b) => a.day.localeCompare(b.day)),
    byCollector: [...collectors.entries()]
      .map(([userId, v]) => ({ userId, ...v }))
      .sort((a, b) => (b.totalIqd > a.totalIqd ? 1 : -1)),
  };
}

/** `YYYY-MM-DD` بتقويم بغداد — مفتاح التجميع اليومي. */
function dayKeyBaghdad(instant: Date): string {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Baghdad",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return f.format(instant);
}

// ═══════════════════════════════════════════════════════════════════════
//  ٢) المستحقّات — من عليه، وكم
// ═══════════════════════════════════════════════════════════════════════

export interface OutstandingRow {
  accountId: string;
  balanceIqd: bigint;
  apartmentNumber: string;
  buildingCode: string;
  holderName: string;
  holderPhone: string;
  /** أقدم قيدٍ لم يُغطَّ — يقرّب «منذ متى». */
  oldestChargeAt: Date | null;
}

export interface OutstandingReport {
  rows: OutstandingRow[];
  totalIqd: bigint;
  debtorCount: number;
}

/**
 * ⚠️ **لا مدّة له.** المستحقّ رصيدٌ **الآن** لا حركةٌ في فترة. ومرشّح
 * مدّة عليه يُنتج «مستحقّات آذار» — وهي عبارة بلا معنى: الدَين إمّا قائم
 * اليوم أو لا.
 */
export async function outstandingReport(db: Db = prisma): Promise<OutstandingReport> {
  const accounts = await db.account.findMany({
    where: { status: "OPEN", balanceIqd: { gt: 0 } },
    select: {
      id: true,
      balanceIqd: true,
      apartment: { select: { displayNumber: true, building: { select: { code: true } } } },
      holder: { select: { fullName: true, phone: true } },
      entries: {
        where: { type: "CHARGE" },
        select: { createdAt: true },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
    orderBy: { balanceIqd: "desc" },
  });

  let totalIqd = 0n;
  const rows: OutstandingRow[] = accounts.map((a) => {
    totalIqd += a.balanceIqd;
    return {
      accountId: a.id,
      balanceIqd: a.balanceIqd,
      apartmentNumber: a.apartment.displayNumber,
      buildingCode: a.apartment.building.code,
      holderName: a.holder.fullName,
      holderPhone: a.holder.phone,
      oldestChargeAt: a.entries[0]?.createdAt ?? null,
    };
  });

  return { rows, totalIqd, debtorCount: rows.length };
}

// ═══════════════════════════════════════════════════════════════════════
//  ٣) تقادُم الأقساط
// ═══════════════════════════════════════════════════════════════════════

/** الشرائح بالأيام — الحدّ الأعلى مفتوح في كلٍّ منها. */
export const AGEING_BUCKETS = [
  { key: "d30", labelAr: "1 – 30 يوماً", maxDays: 30 },
  { key: "d60", labelAr: "31 – 60 يوماً", maxDays: 60 },
  { key: "d90", labelAr: "61 – 90 يوماً", maxDays: 90 },
  { key: "d90plus", labelAr: "أكثر من 90 يوماً", maxDays: Number.POSITIVE_INFINITY },
] as const;

export interface AgeingBucket {
  key: string;
  labelAr: string;
  count: number;
  totalIqd: bigint;
}

export interface AgeingRow {
  installmentId: string;
  sequence: number;
  dueDate: Date;
  daysLate: number;
  amountIqd: bigint;
  contractNumber: string;
  apartmentNumber: string;
  holderName: string;
  holderPhone: string;
}

export interface AgeingReport {
  buckets: AgeingBucket[];
  rows: AgeingRow[];
  totalIqd: bigint;
}

/**
 * ⚠️ **التأخّر يُحسب من `dueDate` لا من `status`.**
 * `OVERDUE` تكتبها مهمّة ليلية؛ فقسطٌ استحقّ صباح اليوم يبقى `PENDING`
 * حتى الليل. وتقريرٌ يقرأ الحالة وحدها يُسقط يوماً كاملاً من المتأخّرات
 * — والفرق يظهر في أوّل يوم من كل شهر، وهو أكثر يوم يُقرأ فيه التقرير.
 */
export async function installmentAgeingReport(db: Db = prisma): Promise<AgeingReport> {
  const today = now();

  const rows = await db.installment.findMany({
    where: {
      status: { in: ["PENDING", "OVERDUE"] },
      dueDate: { lt: today },
    },
    select: {
      id: true,
      sequence: true,
      dueDate: true,
      amountIqd: true,
      plan: {
        select: {
          contract: {
            select: {
              contractNumber: true,
              apartment: { select: { displayNumber: true } },
              holder: { select: { fullName: true, phone: true } },
            },
          },
        },
      },
    },
    orderBy: { dueDate: "asc" },
  });

  const DAY_MS = 86_400_000;
  const buckets = AGEING_BUCKETS.map((b) => ({
    key: b.key,
    labelAr: b.labelAr,
    count: 0,
    totalIqd: 0n,
  }));

  let totalIqd = 0n;
  const out: AgeingRow[] = rows.map((r) => {
    const daysLate = Math.max(
      1,
      Math.floor((today.getTime() - r.dueDate.getTime()) / DAY_MS),
    );
    totalIqd += r.amountIqd;

    const index = AGEING_BUCKETS.findIndex((b) => daysLate <= b.maxDays);
    const bucket = buckets[index === -1 ? buckets.length - 1 : index]!;
    bucket.count += 1;
    bucket.totalIqd += r.amountIqd;

    return {
      installmentId: r.id,
      sequence: r.sequence,
      dueDate: r.dueDate,
      daysLate,
      amountIqd: r.amountIqd,
      contractNumber: r.plan.contract.contractNumber,
      apartmentNumber: r.plan.contract.apartment?.displayNumber ?? "—",
      holderName: r.plan.contract.holder.fullName,
      holderPhone: r.plan.contract.holder.phone,
    };
  });

  return { buckets, rows: out, totalIqd };
}

// ═══════════════════════════════════════════════════════════════════════
//  ٤) إيراد الخدمات — مقيَّد ومحصَّل، منفصلين
// ═══════════════════════════════════════════════════════════════════════

export interface ServiceRevenueRow {
  serviceId: string;
  serviceName: string;
  isMandatory: boolean;
  /** ما قُيّد على الحسابات في المدّة — دَينٌ نشأ. */
  chargedIqd: bigint;
  chargeCount: number;
  /** عدد الاشتراكات النشطة الآن — لا في المدّة. */
  activeSubscriptions: number;
}

export interface ServiceRevenueReport {
  rows: ServiceRevenueRow[];
  chargedTotalIqd: bigint;
  /**
   * ⚠️ **المحصَّل لا يُنسَب إلى خدمة.** الدفعة تُسدَّد على **الحساب** لا
   * على قيدٍ بعينه — فلا سبيل لقول «كم حُصّل من خدمة المولّدة» بلا اختراع
   * قاعدة توزيع (الأقدم أوّلاً؟ بالتناسب؟). وذلك قرارٌ محاسبيّ لم يُتّخذ.
   *
   * فالتقرير يعرض **المقيَّد لكل خدمة** ومجموع المحصَّل على حِدَة، ويقول
   * إنهما لا يُقسَّمان — بدل أن يخترع رقماً يبدو دقيقاً.
   */
  collectedTotalIqd: bigint;
}

export async function serviceRevenueReport(
  range: ReportRange,
  db: Db = prisma,
): Promise<ServiceRevenueReport> {
  const entries = await db.ledgerEntry.findMany({
    where: {
      type: "CHARGE",
      source: { in: ["SUBSCRIPTION", "ONE_TIME_SERVICE"] },
      createdAt: { gte: range.from, lt: range.to },
      subscriptionId: { not: null },
    },
    select: {
      amountIqd: true,
      subscription: {
        select: { service: { select: { id: true, name: true, isMandatory: true } } },
      },
    },
  });

  const byService = new Map<
    string,
    { name: string; isMandatory: boolean; chargedIqd: bigint; chargeCount: number }
  >();
  let chargedTotalIqd = 0n;

  for (const e of entries) {
    const svc = e.subscription?.service;
    if (!svc) continue;
    chargedTotalIqd += e.amountIqd;
    const cur = byService.get(svc.id) ?? {
      name: svc.name,
      isMandatory: svc.isMandatory,
      chargedIqd: 0n,
      chargeCount: 0,
    };
    byService.set(svc.id, {
      ...cur,
      chargedIqd: cur.chargedIqd + e.amountIqd,
      chargeCount: cur.chargeCount + 1,
    });
  }

  const activeCounts = await db.subscription.groupBy({
    by: ["serviceId"],
    where: { status: "ACTIVE", deletedAt: null },
    _count: { _all: true },
  });
  const activeByService = new Map(activeCounts.map((c) => [c.serviceId, c._count._all]));

  /* المحصَّل في المدّة — مجموعاً لا موزَّعاً، راجع تعليق الحقل */
  const collected = await db.payment.aggregate({
    where: { status: "PAID", paidAt: { gte: range.from, lt: range.to } },
    _sum: { amountIqd: true },
  });

  return {
    rows: [...byService.entries()]
      .map(([serviceId, v]) => ({
        serviceId,
        serviceName: v.name,
        isMandatory: v.isMandatory,
        chargedIqd: v.chargedIqd,
        chargeCount: v.chargeCount,
        activeSubscriptions: activeByService.get(serviceId) ?? 0,
      }))
      .sort((a, b) => (b.chargedIqd > a.chargedIqd ? 1 : -1)),
    chargedTotalIqd,
    collectedTotalIqd: collected._sum.amountIqd ?? 0n,
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  ٥) دفتر الحركة — يفسّر أي رقم أعلاه
// ═══════════════════════════════════════════════════════════════════════

export interface LedgerMovementRow {
  id: string;
  createdAt: Date;
  type: LedgerEntryType;
  source: LedgerSource;
  amountIqd: bigint;
  descriptionAr: string;
  apartmentNumber: string;
  holderName: string;
}

export interface LedgerMovementReport {
  rows: LedgerMovementRow[];
  total: number;
  chargedIqd: bigint;
  paidIqd: bigint;
  adjustedIqd: bigint;
}

export async function ledgerMovementReport(
  range: ReportRange,
  input: { page: number; pageSize: number; type?: LedgerEntryType; source?: LedgerSource },
  db: Db = prisma,
): Promise<LedgerMovementReport> {
  const where = {
    createdAt: { gte: range.from, lt: range.to },
    ...(input.type ? { type: input.type } : {}),
    ...(input.source ? { source: input.source } : {}),
  };

  const [rows, total, sums] = await Promise.all([
    db.ledgerEntry.findMany({
      where,
      select: {
        id: true,
        createdAt: true,
        type: true,
        source: true,
        amountIqd: true,
        descriptionAr: true,
        account: {
          select: {
            apartment: { select: { displayNumber: true } },
            holder: { select: { fullName: true } },
          },
        },
      },
      /* ⚠️ ترتيب مستقرّ: قيدان في نفس الثانية يتبادلان بين الصفحات بلا `id` */
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
    db.ledgerEntry.count({ where }),
    /*
     * ⚠️ المجاميع على **المدّة كلّها** لا على الصفحة — مجموعٌ يتغيّر
     * بالتصفيح ليس مجموعاً. والترشيح يُطبَّق عليها كما على الصفوف.
     */
    db.ledgerEntry.groupBy({
      by: ["type"],
      where: { createdAt: { gte: range.from, lt: range.to } },
      _sum: { amountIqd: true },
    }),
  ]);

  const sumOf = (t: LedgerEntryType): bigint =>
    sums.find((s) => s.type === t)?._sum.amountIqd ?? 0n;

  return {
    rows: rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      type: r.type,
      source: r.source,
      amountIqd: r.amountIqd,
      descriptionAr: r.descriptionAr,
      apartmentNumber: r.account.apartment.displayNumber,
      holderName: r.account.holder.fullName,
    })),
    total,
    chargedIqd: sumOf("CHARGE"),
    paidIqd: sumOf("PAYMENT"),
    adjustedIqd: sumOf("ADJUSTMENT"),
  };
}
