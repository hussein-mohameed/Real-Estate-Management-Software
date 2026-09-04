import type { Prisma } from "@/lib/generated/prisma/client";
import { computePeriodAmount } from "@/lib/domain/pricing";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  إعادة حساب اشتراكات `PER_PERSON` عند تغيّر أفراد الأسرة.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── لماذا هذا الملف موجود أصلاً ─────────────────────────────────────
 * ⚠️ **شرط لازم لقرار `Q5`، وبدونه يكسر `Q5` إصلاحَ `Q45`.**
 *
 * ‏`Q5` يقرّر أن عدد الأشخاص **مشتقّ** من السكان النشطين وقت القيد، وأن
 * `quantity` لقطة توثيقية. لكن `periodAmountIqd` **مخزَّن** على الاشتراك،
 * وهو ما يقرأه مؤشّر «الإيراد الشهري المتوقّع» (‏`Q45` — بنيتُه في 1.7).
 *
 * فلو أُعيد الحساب **عند الفوترة فقط**، لصار المؤشّر بين دورتين يقرأ
 * قيمةً قديمة: أسرة كبرت من ثلاثة إلى ستة، والمالك يرى إيراداً بنصف
 * الحقيقة لأسابيع — ولا شيء يشير إلى ذلك.
 *
 * ── ولماذا **في نفس المعاملة** ─────────────────────────────────────
 * ربط ساكن وإعادة الحساب عمليتان لحظةَ نجاح الأولى وفشل الثانية تتركان
 * اشتراكاً بمبلغ لا يطابق سكّانه. المعاملة الواحدة تجعلهما حدثاً واحداً.
 *
 * ── ما لا يُعاد حسابه ──────────────────────────────────────────────
 * `FLAT` و`PER_UNIT` لا علاقة لهما بعدد السكان. لمسُهما هنا كان
 * سيُعيد كتابة لقطة سعر بلا سبب — وهو ما يمنعه `R23`.
 */

/** الحالات التي تُعاد حسابها. الملغى تاريخٌ لا يُمسّ. */
const LIVE_STATUSES = ["ACTIVE", "PAUSED", "PENDING_APPROVAL"] as const;

export interface RecomputeResult {
  /** عدد الاشتراكات التي تغيّر مبلغها فعلاً. */
  updated: number;
  /** عدد السكان النشطين المستعمَل في الحساب. */
  personsCount: number;
}

/**
 * يعيد حساب مبالغ اشتراكات `PER_PERSON` على شقة واحدة.
 *
 * ⚠️ **يُستدعى داخل معاملة الربط/الإخراج نفسها.** ويُمرَّر `tx` دائماً.
 */
export async function recomputePerPersonForApartment(
  db: Prisma.TransactionClient,
  apartmentId: string,
): Promise<RecomputeResult> {
  // العدد **مشتقّ** — يُقرأ الآن لا يُمرَّر
  const personsCount = await db.apartmentResident.count({
    where: { apartmentId, isActive: true },
  });

  const subscriptions = await db.subscription.findMany({
    where: {
      apartmentId,
      status: { in: [...LIVE_STATUSES] },
      deletedAt: null,
      service: { pricingModel: "PER_PERSON" },
    },
    select: {
      id: true,
      quantity: true,
      periodAmountIqd: true,
      service: {
        select: {
          pricingModel: true,
          basePriceIqd: true,
          unitPriceIqd: true,
          minUnits: true,
          maxUnits: true,
        },
      },
    },
  });

  let updated = 0;

  for (const sub of subscriptions) {
    const priced = computePeriodAmount(sub.service, { personsCount });

    // لا كتابة بلا تغيّر: تحديثٌ فارغ يلوّث `updatedAt` وسجلّ التدقيق
    if (sub.periodAmountIqd === priced.periodAmountIqd && sub.quantity === priced.quantity) {
      continue;
    }

    await db.subscription.update({
      where: { id: sub.id },
      data: {
        periodAmountIqd: priced.periodAmountIqd,
        // اللقطة التوثيقية للعدد — لا مصدر حقيقة (‏Q5)
        quantity: priced.quantity,
        /**
         * ⚠️ `unitPriceSnapshotIqd` **لا يُمسّ**: سعر الفرد لم يتغيّر،
         * تغيّر عددهم وحده. إعادة كتابته هنا كانت ستُخفي تغييرَ سعر
         * حقيقياً وقع بينهما، وهو ما يحرسه `R23`.
         */
      },
    });
    updated += 1;
  }

  return { updated, personsCount };
}
