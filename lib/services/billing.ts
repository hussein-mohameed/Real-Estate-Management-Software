import { prisma } from "@/lib/prisma";
import { postEntry } from "@/lib/ledger/post-entry";
import { ConflictError } from "@/lib/errors";
import { CYCLE_MONTHS, addMonthsBaghdad, formatBaghdadMonth, now } from "@/lib/dates";
import { formatIqd } from "@/lib/money";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  الفوترة الدورية — الخطوة 2.7 · `/api/cron/billing`.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * تُقيّد ما استُحقّ: اشتراكات الخدمات **وإيجارات العقود** معاً في تشغيل
 * واحد. وهي الموضع الذي يتحوّل فيه النظام من سجلٍّ إلى مصدر إيراد.
 *
 * ── ⚠️ **التكرار يمنعه الفهرس لا الكود** ────────────────────────────
 * تشغيلان متتاليان — أو تشغيلان متوازيان لأن المُشغّل أعاد المحاولة —
 * يجب أن يُنتجا **نفس عدد القيود بالضبط**. والحماية فهرسان فريدان
 * جزئيان في القاعدة:
 *   • `uniq_subscription_charge_per_period` على `(subscriptionId, periodStart)`
 *   • `uniq_rent_charge_per_period` على `(accountId, 'RENT', periodStart)`
 *
 * فالمهمّة **تحاول القيد وتتوقّع الرفض**: `ConflictError` تعني «مُقيَّد
 * سلفاً» لا «خطأ»، فتُحتسب ولا توقف التشغيل. وشرطٌ في الكود بدلاً من ذلك
 * («هل يوجد قيد؟» ثم «أنشئ») ينكسر بين القراءة والكتابة.
 *
 * ── ⚠️ والشقة الفارغة **تُوقَف وتُتخطّى** ──────────────────────────
 * §7.3: الفارغة لا تُفوتَر خدماتها الدورية. والاشتراك الذي بقي `ACTIVE`
 * على شقة أُخليت خارج المسار المعتاد يُوقَف هنا بدل أن يُفوتَر — والتخطّي
 * وحده كان سيُعيد المحاولة كل ليلة إلى الأبد.
 *
 * ── ⚠️ ورسالة **واحدة لكل حساب** لا لكل اشتراك ─────────────────────
 * ساكن عليه أربع خدمات يستلم أربع رسائل في دقيقة واحدة، فيتعلّم تجاهلها.
 * الملخّص الواحد يُقرأ.
 *
 * ── ما لا تفعله هذه المهمّة ────────────────────────────────────────
 * **لا تُرسل شيئاً.** تُنشئ صفوف `Notification` معلّقة، والإرسال مهمّة
 * أخرى محجوبة بـ`B7` (خطة الاستضافة: §12.3 يطلب مهمّة كل دقيقة).
 * والأقساط ليست هنا: `/api/cron/installments` محجوبة بـ`B1`.
 */

/**
 * سقف الفترات المتأخّرة لكل عقد في التشغيل الواحد.
 *
 * ⚠️ عقد إيجار بدأ قبل ثلاث سنوات ولم يُفوتَر يُنتج 36 قيداً في تشغيل
 * واحد. ذلك **صحيح حسابياً وخطر تشغيلياً**: مبلغ ضخم يظهر على الحساب بلا
 * أن يقرّره أحد. السقف يجعل التراكم مرئياً في التقرير بدل أن يُقيَّد صامتاً،
 * وترحيلُ وضع قائم شأن `N3` لا شأن مهمّة ليلية.
 */
const MAX_BACKFILL_PERIODS = 3;

export interface BillingLineReport {
  charged: number;
  /** قيود وُجدت سلفاً — تشغيل ثانٍ أو إعادة محاولة. */
  alreadyCharged: number;
  totalIqd: bigint;
}

export interface BillingRunReport {
  ranAt: Date;
  subscriptions: BillingLineReport & { pausedVacant: number };
  rents: BillingLineReport & { cappedContracts: string[] };
  /** عدد الحسابات التي أُنشئ لها ملخّص — **حساب واحد رسالة واحدة**. */
  accountsNotified: number;
  errors: Array<{ scope: string; id: string; message: string }>;
}

/** ما تراكم على حساب واحد في هذا التشغيل — لبناء الملخّص. */
interface AccountTally {
  accountId: string;
  holderUserId: string;
  lines: string[];
  totalIqd: bigint;
}

export async function runPeriodicBilling(at: Date = now()): Promise<BillingRunReport> {
  const errors: BillingRunReport["errors"] = [];
  const tallies = new Map<string, AccountTally>();

  const subscriptions = await billSubscriptions(at, tallies, errors);
  const rents = await billRents(at, tallies, errors);
  const accountsNotified = await notifyAccounts(tallies, at, errors);

  return { ranAt: at, subscriptions, rents, accountsNotified, errors };
}

/** يجمع سطراً على حساب — الملخّص يُبنى من هذه لا من استعلام ثانٍ. */
function tally(
  map: Map<string, AccountTally>,
  accountId: string,
  holderUserId: string,
  line: string,
  amountIqd: bigint,
): void {
  const existing = map.get(accountId);
  if (existing) {
    existing.lines.push(line);
    existing.totalIqd += amountIqd;
    return;
  }
  map.set(accountId, { accountId, holderUserId, lines: [line], totalIqd: amountIqd });
}

// ═══════════════════════════════════════════════════════════════════════
//  الاشتراكات
// ═══════════════════════════════════════════════════════════════════════

async function billSubscriptions(
  at: Date,
  tallies: Map<string, AccountTally>,
  errors: BillingRunReport["errors"],
): Promise<BillingLineReport & { pausedVacant: number }> {
  const due = await prisma.subscription.findMany({
    where: {
      status: "ACTIVE",
      deletedAt: null,
      nextChargeDate: { not: null, lte: at },
      // الدورية وحدها. `ONE_TIME` قُيّدت عند التفعيل وانتهت.
      billingCycle: { not: null },
    },
    select: {
      id: true,
      accountId: true,
      periodAmountIqd: true,
      billingCycle: true,
      nextChargeDate: true,
      service: { select: { name: true } },
      apartment: { select: { id: true, displayNumber: true, occupancyStatus: true } },
      account: { select: { id: true, status: true, holderUserId: true } },
    },
  });

  let charged = 0;
  let alreadyCharged = 0;
  let pausedVacant = 0;
  let totalIqd = 0n;

  for (const sub of due) {
    try {
      /**
       * ⚠️ الفارغة تُوقَف **ثم** تُتخطّى. التخطّي وحده يُبقي
       * `nextChargeDate` في الماضي، فتُعاد المحاولة كل ليلة إلى الأبد
       * وتتضخّم قائمة «المستحقّ» بصفوف لا تُقيَّد أبداً.
       */
      if (sub.apartment?.occupancyStatus === "VACANT") {
        await prisma.subscription.update({
          where: { id: sub.id },
          data: { status: "PAUSED", nextChargeDate: null },
        });
        pausedVacant += 1;
        continue;
      }

      if (!sub.accountId || !sub.account || sub.account.status !== "OPEN") {
        errors.push({
          scope: "subscription",
          id: sub.id,
          message: "لا حساب مفتوح على الاشتراك — لم يُقيَّد.",
        });
        continue;
      }

      const periodStart = sub.nextChargeDate!;
      const cycle = sub.billingCycle!;
      const nextStart = addMonthsBaghdad(periodStart, CYCLE_MONTHS[cycle]);

      /**
       * ⚠️ **يُحاوَل القيد ويُتوقَّع الرفض.** الفهرس هو الحماية، والشرط في
       * الكود ينكسر بين القراءة والكتابة. و`nextChargeDate` يتقدّم في
       * الحالتين: لو تقدّم في حالة النجاح وحدها، لبقي تشغيلٌ انقطع بعد
       * القيد وقبل التحديث يُعيد المحاولة أبداً.
       */
      let conflicted = false;
      try {
        await postEntry({
          accountId: sub.accountId,
          type: "CHARGE",
          source: "SUBSCRIPTION",
          amountIqd: sub.periodAmountIqd,
          descriptionAr: `${sub.service.name} — ${formatBaghdadMonth(periodStart)}`,
          periodStart,
          periodEnd: new Date(nextStart.getTime() - 1),
          subscriptionId: sub.id,
          createdByUserId: null,
        });
      } catch (error) {
        if (!(error instanceof ConflictError)) throw error;
        conflicted = true;
      }

      await prisma.subscription.update({
        where: { id: sub.id },
        data: { nextChargeDate: nextStart, lastChargedPeriodStart: periodStart },
      });

      if (conflicted) {
        alreadyCharged += 1;
      } else {
        charged += 1;
        totalIqd += sub.periodAmountIqd;
        tally(
          tallies,
          sub.accountId,
          sub.account.holderUserId,
          `${sub.service.name}: ${formatIqd(sub.periodAmountIqd)}`,
          sub.periodAmountIqd,
        );
      }
    } catch (error) {
      errors.push({
        scope: "subscription",
        id: sub.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { charged, alreadyCharged, pausedVacant, totalIqd };
}

// ═══════════════════════════════════════════════════════════════════════
//  الإيجارات
// ═══════════════════════════════════════════════════════════════════════

/**
 * ⚠️ **لا حقل `nextRentChargeDate` على العقد.** الفترات تُشتقّ من
 * `startDate` بدورة `rentCycle`، والفهرس `uniq_rent_charge_per_period`
 * يمنع التكرار. وهذا أمتن من عمود يتقادم: عمودٌ خاطئ يُفوّت شهراً بصمت،
 * والاشتقاق يُعيد نفس الإجابة في كل تشغيل.
 */
async function billRents(
  at: Date,
  tallies: Map<string, AccountTally>,
  errors: BillingRunReport["errors"],
): Promise<BillingLineReport & { cappedContracts: string[] }> {
  const contracts = await prisma.contract.findMany({
    where: {
      status: "ACTIVE",
      deletedAt: null,
      type: "RENTAL",
      rentAmountIqd: { not: null },
      rentCycle: { not: null },
      startDate: { lte: at },
    },
    select: {
      id: true,
      contractNumber: true,
      startDate: true,
      endDate: true,
      rentAmountIqd: true,
      rentCycle: true,
      account: { select: { id: true, status: true, holderUserId: true } },
    },
  });

  let charged = 0;
  let alreadyCharged = 0;
  let totalIqd = 0n;
  const cappedContracts: string[] = [];

  for (const contract of contracts) {
    if (!contract.account || contract.account.status !== "OPEN") {
      errors.push({
        scope: "rent",
        id: contract.id,
        message: `العقد «${contract.contractNumber}» بلا حساب مفتوح — لم يُقيَّد إيجاره.`,
      });
      continue;
    }

    const cycle = contract.rentCycle!;
    const amount = contract.rentAmountIqd!;
    let periodStart = contract.startDate;
    let posted = 0;

    while (periodStart.getTime() <= at.getTime()) {
      if (posted >= MAX_BACKFILL_PERIODS) {
        cappedContracts.push(contract.contractNumber);
        break;
      }

      // العقد المنتهي لا يُفوتَر عن فترات بعد انتهائه
      if (contract.endDate && periodStart.getTime() > contract.endDate.getTime()) break;

      const nextStart = addMonthsBaghdad(periodStart, CYCLE_MONTHS[cycle]);

      try {
        await postEntry({
          accountId: contract.account.id,
          type: "CHARGE",
          source: "RENT",
          amountIqd: amount,
          descriptionAr: `إيجار ${formatBaghdadMonth(periodStart)} — عقد ${contract.contractNumber}`,
          periodStart,
          periodEnd: new Date(nextStart.getTime() - 1),
          createdByUserId: null,
        });
        charged += 1;
        posted += 1;
        totalIqd += amount;
        tally(
          tallies,
          contract.account.id,
          contract.account.holderUserId,
          `إيجار ${formatBaghdadMonth(periodStart)}: ${formatIqd(amount)}`,
          amount,
        );
      } catch (error) {
        if (error instanceof ConflictError) {
          // مُقيَّد سلفاً — تشغيل ثانٍ، لا خطأ
          alreadyCharged += 1;
        } else {
          errors.push({
            scope: "rent",
            id: contract.id,
            message: error instanceof Error ? error.message : String(error),
          });
          break;
        }
      }

      periodStart = nextStart;
    }
  }

  return { charged, alreadyCharged, totalIqd, cappedContracts };
}

// ═══════════════════════════════════════════════════════════════════════
//  الملخّص — رسالة واحدة لكل حساب
// ═══════════════════════════════════════════════════════════════════════

async function notifyAccounts(
  tallies: Map<string, AccountTally>,
  at: Date,
  errors: BillingRunReport["errors"],
): Promise<number> {
  let created = 0;

  for (const tallyRow of tallies.values()) {
    try {
      /**
       * ⚠️ `status: PENDING` و**لا إرسال هنا**. الإرسال مهمّة أخرى
       * محجوبة بـ`B7`. والصفّ يظهر في جرس الساكن فوراً لأن الجرس يقرأ
       * القناة و`readAt` لا حالة الإرسال (‏Q44).
       */
      await prisma.notification.create({
        data: {
          userId: tallyRow.holderUserId,
          channel: "IN_APP",
          templateKey: "billing.summary",
          payload: {
            accountId: tallyRow.accountId,
            lines: tallyRow.lines,
            totalIqd: tallyRow.totalIqd.toString(),
            ranAt: at.toISOString(),
          },
          body:
            `قُيّد على حسابك ${formatIqd(tallyRow.totalIqd)}: ` +
            tallyRow.lines.join(" · "),
          status: "PENDING",
        },
      });
      created += 1;
    } catch (error) {
      errors.push({
        scope: "notification",
        id: tallyRow.accountId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return created;
}
