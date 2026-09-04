import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { splitEvenlyIqd } from "@/lib/money";
import { addMonthsBaghdad, now, startOfDayBaghdad } from "@/lib/dates";
import { BusinessRuleError } from "@/lib/errors";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  خطط الأقساط — الخطوة 3.5 · القرار `B1` (‏2026-09-02).
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── القرار الذي فتح هذه الخطوة ──────────────────────────────────────
 * **الدفعة المقدّمة مقبوضة عند التوقيع، والأقساط على الباقي.**
 *
 * أي أن `createInstallmentPlan` **إجراء مالي لا إداري**: يُنشئ خطةً وقيداً
 * ودفعةً وفاتورةً في معاملة واحدة. وكان البديل «مستحقّة» يترك ملايين ديناً
 * على من دفعها فعلاً — وهو أوّل ما يشتكي منه الساكن حين يفتح كشفه.
 *
 * ── ⚠️ والمبلغ المُقسَّم هو المتبقّي لا الكامل ────────────────────────
 * `splitEvenlyIqd(total − down, count)`. وتمريرُ `total` كان يُنتج مجموعاً
 * أكبر من قيمة العقد بمقدار المقدّمة — خطأً لا يكشفه شيء إلا جمعُ الأعمدة
 * بيدٍ بعد سنة.
 *
 * ── والباقي في القسط الأخير (‏R18) ──────────────────────────────────
 * `splitEvenlyIqd` مكتوبة ومختبَرة على عشر تركيبات كسرية: `Σ الأقساط`
 * يساوي المبلغ **بالضبط**، والفلس المتبقّي يذهب إلى الأخير. قسمةٌ عائمة
 * كانت ستُنتج فرقاً يظهر في آخر قسط ولا يعرف أحد من أين جاء.
 *
 * ── ⚠️ ولا قيد عند الإنشاء لأقساطٍ لم تستحقّ ────────────────────────
 * الأقساط **صفوفٌ مجدولة** لا قيود. القيد يُنشئه `cron/installments` عند
 * حلول الاستحقاق. وقيدُ الكل مقدّماً كان يجعل الساكن مديناً بخمسين مليوناً
 * في يومه الأول — وهو رقم صحيح محاسبياً وكاذب عملياً.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export interface PlanInput {
  contractId: string;
  totalAmountIqd: bigint;
  downPaymentIqd: bigint;
  installmentsCount: number;
  intervalMonths: number;
  startDate: Date;
}

export interface GeneratedInstallment {
  sequence: number;
  dueDate: Date;
  amountIqd: bigint;
}

/**
 * يبني جدول الأقساط بلا لمس القاعدة — دالّة نقيّة تُختبَر وحدها.
 *
 * ⚠️ **`startDate` هو تاريخ أوّل قسط لا تاريخ العقد.** المقدّمة تُقبض عند
 * التوقيع، وأوّل قسط يأتي بعده بفترة. وخلطُهما يُقدّم كل الجدول شهراً.
 */
export function buildSchedule(input: PlanInput): GeneratedInstallment[] {
  if (input.downPaymentIqd < 0n) {
    throw new BusinessRuleError("الدفعة المقدّمة لا تكون سالبة.");
  }
  if (input.downPaymentIqd > input.totalAmountIqd) {
    throw new BusinessRuleError(
      "الدفعة المقدّمة أكبر من قيمة العقد. راجع المبلغين.",
    );
  }

  const financed = input.totalAmountIqd - input.downPaymentIqd;

  /*
   * ⚠️ **المتبقّي صفراً يعني أن العقد مدفوع كاملاً عند التوقيع.**
   * وخطةُ أقساطٍ بلا مبلغ ليست خطة — تُرفض بدل أن تُنشأ فارغة، فيراها
   * الأدمن في القائمة ويظنّ أن الأقساط تعمل وهي أصفار.
   */
  if (financed === 0n) {
    throw new BusinessRuleError(
      "الدفعة المقدّمة تساوي قيمة العقد — لا متبقّي يُقسَّط. سجّلها دفعةً على الحساب بلا خطة.",
    );
  }

  const parts = splitEvenlyIqd(financed, input.installmentsCount);

  return parts.map((amountIqd, index) => ({
    sequence: index + 1,
    /*
     * ⚠️ التواريخ بتوقيت بغداد لا UTC: قسطٌ يستحقّ في الأول من الشهر
     * يصير الثلاثين من السابق لمن يقرأ من منطقة أخرى، فتُحسب المتأخّرات
     * بيوم زائد.
     */
    dueDate: startOfDayBaghdad(
      addMonthsBaghdad(input.startDate, index * input.intervalMonths),
    ),
    amountIqd,
  }));
}

export interface PlanRow {
  id: string;
  contractId: string;
  contractNumber: string;
  apartmentNumber: string | null;
  holderName: string;
  totalAmountIqd: bigint;
  downPaymentIqd: bigint;
  installmentsCount: number;
  status: "ACTIVE" | "COMPLETED" | "CANCELLED";
  paidCount: number;
  overdueCount: number;
  remainingIqd: bigint;
  nextDueDate: Date | null;
}

/**
 * قائمة الخطط لشاشة المتابعة.
 *
 * ── ⚠️ العدّ من القاعدة لا في الذاكرة ────────────────────────────────
 * `paidCount` و`overdueCount` و`remainingIqd` تُجمَّع بـ`groupBy` واحد لكل
 * الصفحة. وحسابُها بجلب كل أقساط كل خطة ثم `filter` في JS يعني آلاف
 * الصفوف تعبر الشبكة لتُرمى — على شاشة تُفتح يومياً.
 */
export async function listPlans(
  filter: { status?: "ACTIVE" | "COMPLETED" | "CANCELLED"; search?: string },
  page: number,
  pageSize: number,
  db: Db = prisma,
): Promise<{ rows: PlanRow[]; total: number }> {
  const where: Prisma.InstallmentPlanWhereInput = {
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.search
      ? {
          contract: {
            OR: [
              { contractNumber: { contains: filter.search, mode: "insensitive" } },
              { holder: { fullName: { contains: filter.search, mode: "insensitive" } } },
              {
                apartment: {
                  displayNumber: { contains: filter.search, mode: "insensitive" },
                },
              },
            ],
          },
        }
      : {}),
  };

  const [plans, total] = await Promise.all([
    db.installmentPlan.findMany({
      where,
      /* ⚠️ ترتيب حاسم: `createdAt` وحده يتساوى في البذر فتتداخل الصفحات */
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        contractId: true,
        totalAmountIqd: true,
        downPaymentIqd: true,
        installmentsCount: true,
        status: true,
        contract: {
          select: {
            contractNumber: true,
            apartment: { select: { displayNumber: true } },
            holder: { select: { fullName: true } },
          },
        },
      },
    }),
    db.installmentPlan.count({ where }),
  ]);

  if (plans.length === 0) return { rows: [], total };

  const planIds = plans.map((p) => p.id);

  const [grouped, nextDue] = await Promise.all([
    db.installment.groupBy({
      by: ["planId", "status"],
      where: { planId: { in: planIds } },
      _count: { _all: true },
      _sum: { amountIqd: true },
    }),
    db.installment.findMany({
      where: { planId: { in: planIds }, status: { in: ["PENDING", "OVERDUE"] } },
      orderBy: { dueDate: "asc" },
      select: { planId: true, dueDate: true },
    }),
  ]);

  const firstDue = new Map<string, Date>();
  for (const row of nextDue) {
    if (!firstDue.has(row.planId)) firstDue.set(row.planId, row.dueDate);
  }

  return {
    rows: plans.map((p) => {
      const mine = grouped.filter((g) => g.planId === p.id);
      const countOf = (s: string): number =>
        mine.find((g) => g.status === s)?._count._all ?? 0;

      /*
       * ⚠️ **المتبقّي = ما لم يُدفع ولم يُلغَ.** جمعُ `PENDING` وحدها كان
       * يُخفي المتأخّر — وهو أهمّ ما يُتابَع في هذه الشاشة أصلاً.
       */
      const remainingIqd = mine
        .filter((g) => g.status === "PENDING" || g.status === "OVERDUE")
        .reduce((sum, g) => sum + (g._sum.amountIqd ?? 0n), 0n);

      return {
        id: p.id,
        contractId: p.contractId,
        contractNumber: p.contract.contractNumber,
        apartmentNumber: p.contract.apartment?.displayNumber ?? null,
        holderName: p.contract.holder.fullName,
        totalAmountIqd: p.totalAmountIqd,
        downPaymentIqd: p.downPaymentIqd ?? 0n,
        installmentsCount: p.installmentsCount,
        status: p.status,
        paidCount: countOf("PAID"),
        overdueCount: countOf("OVERDUE"),
        remainingIqd,
        nextDueDate: firstDue.get(p.id) ?? null,
      };
    }),
    total,
  };
}

/**
 * يقلب `PENDING` إلى `OVERDUE` لما مضى استحقاقه.
 *
 * ── ⚠️ `updateMany` بشرط الحالة — لا قراءة ثم كتابة ─────────────────
 * الشرط `status: "PENDING"` جزءٌ من جملة التحديث نفسها، فتشغيلان
 * متوازيان لا يقلبان الصفّ مرّتين. وتعريف إنجاز 3.5 ينصّ عليه: «قلب
 * `OVERDUE` مرّة واحدة فقط».
 *
 * ⚠️ و**لا غرامات**: القلب تغيير حالة لا قيد مالي. الغرامة قرارٌ لم
 * يُتّخذ، وإضافتها هنا تُقيّد مالاً لا يعرفه أحد.
 */
export async function markOverdue(
  at: Date = now(),
  db: Db = prisma,
): Promise<{ marked: number }> {
  const result = await db.installment.updateMany({
    where: { status: "PENDING", dueDate: { lt: startOfDayBaghdad(at) } },
    data: { status: "OVERDUE" },
  });
  return { marked: result.count };
}
