import type { Prisma } from "@/lib/generated/prisma/client";
import { postEntry } from "@/lib/ledger/post-entry";
import { resolveAccountForApartment } from "@/lib/services/resolve-account";
import { residentsInApartment } from "@/lib/services/statistics";
import { computePeriodAmount, prorateFirstPeriod } from "@/lib/domain/pricing";
import { alignedCycleWindow, now } from "@/lib/dates";
import { BusinessRuleError, NotFoundError } from "@/lib/errors";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  تفعيل الاشتراك — الموضع الواحد الذي يُقيَّد فيه أول مبلغ.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── لماذا مستخرَجة ─────────────────────────────────────────────────
 * مسارَان يُفعّلان اشتراكاً: موافقة الأدمن على طلب (‏2.4)، وإشغال الشقة
 * الذي يُنشئ الإلزامية تلقائياً (‏2.6 · R27). ونسخُ «حلّ الحساب ثم التسعير
 * ثم التقسيط ثم القيد» في الاثنين كان سيُنتج **مبلغين مختلفين لنفس
 * الخدمة** حسب الباب الذي دخلت منه — وهو خطأ لا يفشل فيه شيء ولا يشتكي
 * منه أحد إلا المحاسب بعد أشهر.
 *
 * ── ⚠️ والقرار `B2` مُنفَّذ هنا وحده ────────────────────────────────
 * التقسيط بالتناسب (‏2026-08-28). أي تغيير في سياسة الفترة الأولى يُعدَّل
 * في `prorateFirstPeriod` وهذه الدالّة، ولا يُبحَث عنه في مواضع متفرّقة.
 */

type Db = Prisma.TransactionClient;

export interface ActivationResult {
  subscriptionId: string;
  /** `null` حين كان المبلغ صفراً — `PER_PERSON` بلا سكان (‏Q5). */
  entryId: string | null;
  /** المبلغ المقيَّد فعلاً: مقسَّط للدورية، وكامل لمرّة واحدة. */
  amountIqd: bigint;
  /** مبلغ الدورة الكاملة — ما تقرأه مهمة الفوترة لكل دورة تالية. */
  periodAmountIqd: bigint;
  nextChargeDate: Date | null;
  prorated: boolean;
}

/**
 * يُفعّل اشتراكاً معلّقاً: يحلّ حسابه، ويسعّره، ويُقيّد فترته الأولى.
 *
 * ⚠️ **يفترض أن الحالة انتُقلت إلى `ACTIVE` قبل استدعائه** — المستدعي هو
 * من يحرس الانتقال بـ`updateMany` بشرط الحالة. فصلُ الحراسة عن التفعيل
 * مقصود: مسار الموافقة يحرس `PENDING_APPROVAL`، ومسار الإشغال يُنشئ الصفّ
 * `ACTIVE` من أوّله ولا حالة سابقة يحرسها.
 */
export async function activateSubscription(
  db: Db,
  subscriptionId: string,
  options: { actorUserId: string | null; at?: Date },
): Promise<ActivationResult> {
  const sub = await db.subscription.findFirst({
    where: { id: subscriptionId, deletedAt: null },
    select: {
      id: true,
      apartmentId: true,
      payerType: true,
      quantity: true,
      billingCycle: true,
      startDate: true,
      accountId: true,
      service: {
        select: {
          name: true,
          billingType: true,
          pricingModel: true,
          basePriceIqd: true,
          unitPriceIqd: true,
          minUnits: true,
          maxUnits: true,
        },
      },
    },
  });
  if (!sub) throw new NotFoundError("الاشتراك");
  if (!sub.apartmentId) throw new BusinessRuleError("اشتراك بلا شقة لا يُقيَّد.");

  // ── الحساب من `payerType` (‏R28 · الخطوة 2.3) ─────────────────────
  const accountId =
    sub.accountId ??
    (await (async () => {
      const resolved = await resolveAccountForApartment(sub.apartmentId!, sub.payerType, db);
      if (!resolved.ok) throw new BusinessRuleError(resolved.messageAr, "R28");
      return resolved.accountId;
    })());

  // ── السعر لحظة التفعيل ───────────────────────────────────────────
  const personsCount =
    sub.service.pricingModel === "PER_PERSON"
      ? await residentsInApartment(sub.apartmentId, db)
      : undefined;

  const pricing = computePeriodAmount(sub.service, {
    quantity: sub.quantity,
    ...(personsCount === undefined ? {} : { personsCount }),
  });

  const activeFrom = options.at ?? now();
  const isOneTime = sub.service.billingType === "ONE_TIME";

  let amountIqd = pricing.periodAmountIqd;
  /**
   * ⚠️ `ONE_TIME` تأخذ `startDate` لا لحظة التفعيل — نصّ `Q39`.
   * `startDate` **ثابت** منذ إنشاء الصفّ، فالفهرس الفريد على
   * `(subscriptionId, periodStart)` يرى التكرار. ولحظةُ التفعيل تختلف بين
   * استدعاءين فيمرّ التكرار من تحت الفهرس.
   */
  const periodStart = isOneTime ? sub.startDate : activeFrom;
  let periodEnd: Date | null = null;
  let nextChargeDate: Date | null = null;
  let prorated = false;
  let note = "";

  if (!isOneTime) {
    const cycle = sub.billingCycle ?? "MONTHLY";
    const settings = await db.compoundSettings.findFirst({
      select: { billingDayOfMonth: true },
    });
    const window = alignedCycleWindow(activeFrom, settings?.billingDayOfMonth ?? 1, cycle);

    const split = prorateFirstPeriod({
      periodAmountIqd: pricing.periodAmountIqd,
      alignedStart: window.start,
      alignedNextStart: window.nextStart,
      activeFrom,
    });

    amountIqd = split.amountIqd;
    prorated = split.prorated;
    periodEnd = new Date(window.nextStart.getTime() - 1);
    nextChargeDate = window.nextStart;
    if (split.prorated) note = ` (${split.chargedDays} من ${split.cycleDays} يوماً)`;
  }

  await db.subscription.update({
    where: { id: sub.id },
    data: {
      status: "ACTIVE",
      accountId,
      startDate: activeFrom,
      unitPriceSnapshotIqd: pricing.unitPriceSnapshotIqd,
      /*
       * ⚠️ **مبلغ الدورة الكاملة** لا المقسَّط. القيد الأول وحده مقسَّط،
       * ومهمة الفوترة تقرأ هذا الحقل لكل دورة تالية — فكتابةُ المقسَّط فيه
       * تُبقي الاشتراك يُفوتَر بأقلّ من سعره إلى الأبد.
       */
      periodAmountIqd: pricing.periodAmountIqd,
      quantity: pricing.quantity,
      nextChargeDate,
      ...(options.actorUserId ? { approvedByUserId: options.actorUserId } : {}),
    },
  });

  /**
   * ⚠️ **صفر لا يُقيَّد.** `PER_PERSON` في وحدة بلا سكان (‏Q5) يعطي صفراً،
   * وقيدٌ بصفر يخالف `ledger_amount_positive` في القاعدة. الاشتراك يصير
   * نشطاً بلا قيد، وتُقيَّد أول دورة فيها سكان.
   */
  if (amountIqd === 0n) {
    return {
      subscriptionId: sub.id,
      entryId: null,
      amountIqd: 0n,
      periodAmountIqd: pricing.periodAmountIqd,
      nextChargeDate,
      prorated,
    };
  }

  const entry = await postEntry(
    {
      accountId,
      type: "CHARGE",
      source: "SUBSCRIPTION",
      amountIqd,
      descriptionAr: `${sub.service.name}${note}`,
      periodStart,
      periodEnd,
      subscriptionId: sub.id,
      createdByUserId: options.actorUserId,
    },
    db,
  );

  return {
    subscriptionId: sub.id,
    entryId: entry.entryId,
    amountIqd,
    periodAmountIqd: pricing.periodAmountIqd,
    nextChargeDate,
    prorated,
  };
}
