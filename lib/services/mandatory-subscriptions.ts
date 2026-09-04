import type { Prisma } from "@/lib/generated/prisma/client";
import { activateSubscription } from "@/lib/services/subscription-activation";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  مولّد الاشتراكات الإلزامية — `R27` · §7.3.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * «الخدمات الإلزامية تلقائية مع السكن، موقوفة مع الإخلاء.» هذا ما يجعل
 * `setApartmentOccupancy` **مفتاح الفوترة**: الإشغال لا يغيّر حقلاً، بل
 * يبدأ تدفّق مال.
 *
 * ── ما كان محجوباً وفُتح ────────────────────────────────────────────
 * كانت هذه الدالّة **ترفض** بـ`PendingDecisionError("B2")`: إنشاء الاشتراك
 * يوجب تحديد بداية فترته الأولى، والفرق يصل إلى 60 مليون د.ع في السنة
 * الأولى على 300 شقة — قرار تسعير لا هندسة.
 *
 * **حُسم في 2026-08-28: التقسيط بالتناسب.** والتنفيذ في
 * `lib/services/subscription-activation.ts`، لا مكرَّراً هنا: مبلغٌ يُحسب
 * في موضعين يصير مبلغين مختلفين لنفس الخدمة حسب الباب الذي دخلت منه.
 *
 * ── ⚠️ ولا موافقة على الإلزامي ──────────────────────────────────────
 * الخدمة الإلزامية **تلقائية مع السكن** (‏§7.3)، فالموافقة عليها بلا معنى:
 * لا أحد يملك رفضها. تُنشأ `PENDING_APPROVAL` لحظةً واحدة — لأن قيد
 * `subscription_active_needs_account` يمنع `ACTIVE` بلا حساب — ثم يُفعّلها
 * `activateSubscription` بحسابها وقيدها في نفس المعاملة.
 *
 * ── ولماذا لا يستأنف الموقوف ───────────────────────────────────────
 * الاشتراكات التي أُوقفت بالإخلاء **لا تُستأنف تلقائياً** عند إشغال جديد
 * (‏§7.3 صريح: «باختيار الأدمن»). الساكن الجديد قد لا يريد ما أراده
 * السابق، والاستئناف الصامت يُنتج فاتورة لخدمة لم يطلبها أحد.
 */

export interface MandatoryResult {
  /** عدد الاشتراكات المُنشأة فعلاً. */
  created: number;
  /** أسماء الخدمات الإلزامية التي وُجدت — للعرض والتشخيص. */
  services: string[];
  /** مجموع ما قُيّد فعلاً — مقسَّطاً بالتناسب (‏B2). */
  chargedIqd: bigint;
}

/**
 * يُنشئ اشتراكات الخدمات الإلزامية لشقة صارت مسكونة.
 *
 * ⚠️ يرمي `PendingDecisionError("B2")` إن وُجدت خدمة إلزامية واحدة على
 * الأقل — لأن حساب فترتها الأولى غير محسوم. ولا خدمات إلزامية اليوم
 * (الكتالوج لم يُبنَ بعد)، فالمسار يمرّ نظيفاً حتى تُضاف أولى الخدمات.
 */
export async function generateMandatorySubscriptions(
  db: Prisma.TransactionClient,
  apartmentId: string,
  /**
   * لحظة الإشغال — تُمرَّر من `setApartmentOccupancy` لا تُقرأ هنا.
   *
   * ⚠️ التقسيط يُحسب عليها، فقراءةُ `now()` داخلياً كانت ستُنتج تقسيماً
   * مخالفاً لتاريخ الإشغال المسجَّل على الشقة بفارق أجزاء الثانية — أو
   * بيوم كامل لو جرى الانتقال عند منتصف الليل.
   */
  at: Date,
): Promise<MandatoryResult> {
  const services = await db.service.findMany({
    where: {
      isMandatory: true,
      isAvailable: true,
      // خدمة إلزامية على **الشقة**. تلك التي `appliesTo = RESIDENT` لا
      // يُنشئها الإشغال: موضوعها شخص لا وحدة (‏V11).
      appliesTo: { in: ["APARTMENT", "BOTH"] },
    },
    select: { id: true, name: true, billingCycle: true, payerType: true },
  });

  if (services.length === 0) {
    return { created: 0, services: [], chargedIqd: 0n };
  }

  /**
   * ⚠️ ما يحمله الاشتراك فعلاً يُطرَح من المطلوب.
   *
   * بلا هذا الطرح كانت الدالّة تفحص **الكتالوج وحده**، فتحجب كل انتقال
   * إلى الإشغال ما دامت في النظام خدمة إلزامية واحدة — حتى لو كانت
   * اشتراكات الشقة قائمة سلفاً ولا شيء يُنشَأ. وهو أثر جانبي واسع:
   * وحدة أُخليت ثم أُعيد إشغالها لا يُنشئ لها الإشغال شيئاً جديداً.
   *
   * `PAUSED` يُحتسب موجوداً عمداً: هو اشتراك قائم ينتظر استئنافاً بقرار
   * الأدمن (‏§7.3)، لا فراغاً يُملأ باشتراك ثانٍ يزدوج مع الأول.
   */
  const existing = await db.subscription.findMany({
    where: {
      apartmentId,
      serviceId: { in: services.map((s) => s.id) },
      status: { in: ["ACTIVE", "PAUSED", "PENDING_APPROVAL"] },
      deletedAt: null,
    },
    select: { serviceId: true },
  });
  const covered = new Set(existing.map((e) => e.serviceId));
  const missing = services.filter((s) => !covered.has(s.id));

  if (missing.length === 0) {
    // كل الإلزامية مغطّاة — لا شيء يُنشأ
    return { created: 0, services: services.map((s) => s.name), chargedIqd: 0n };
  }

  let chargedIqd = 0n;
  const createdNames: string[] = [];

  for (const service of missing) {
    /*
     * ⚠️ `PENDING_APPROVAL` لحظةً واحدة لا لأنها تنتظر أحداً، بل لأن
     * `subscription_active_needs_account` يمنع `ACTIVE` بلا حساب —
     * والحساب يُحلّ داخل `activateSubscription`. الصفّ لا يبقى معلّقاً:
     * التفعيل يجري في نفس المعاملة، فإن فشل تراجع الاثنان معاً.
     */
    const row = await db.subscription.create({
      data: {
        serviceId: service.id,
        subjectType: "APARTMENT",
        apartmentId,
        accountId: null,
        payerType: service.payerType,
        quantity: 1,
        unitPriceSnapshotIqd: 0n,
        periodAmountIqd: 0n,
        billingCycle: service.billingCycle,
        status: "PENDING_APPROVAL",
        startDate: at,
        notes: "أُنشئ تلقائياً مع الإشغال — خدمة إلزامية (‏R27).",
      },
      select: { id: true },
    });

    /*
     * ⚠️ `actorUserId: null` — النظام هو الفاعل. الإشغال قرار إنسان،
     * وإنشاء الإلزامية أثرٌ آليّ له، ونسبتُه إلى الأدمن تجعل التدقيق يقول
     * إنه «وافق» على ما لا موافقة فيه.
     */
    const activated = await activateSubscription(db, row.id, {
      actorUserId: null,
      at,
    });

    chargedIqd += activated.amountIqd;
    createdNames.push(service.name);
  }

  return { created: createdNames.length, services: createdNames, chargedIqd };
}

/**
 * يوقف الاشتراكات الدورية عند الإخلاء.
 *
 * ── `PAUSED` لا `CANCELLED` ─────────────────────────────────────────
 * الفرق ليس تسمية: الإخلاء **مؤقّت** والوحدة ستُسكن ثانيةً، أما انتهاء
 * العقد فنهائي ولذلك يُلغي (`endContract`). الإلغاء هنا كان سيُفقد تاريخ
 * الاشتراك وسعره المُثبَّت، فيُعاد إنشاؤه لاحقاً بسعر كتالوج جديد بلا أن
 * يطلب أحد تغيير السعر.
 *
 * ── والرصيد لا يُمسّ ────────────────────────────────────────────────
 * **الإخلاء لا يُلغي ديناً.** ما تراكم قبل الإخلاء يبقى مستحقاً على
 * الحساب، ويبقى الحساب مفتوحاً — يُغلق بانتهاء العقد لا بخروج الساكن.
 */
export async function pauseRecurringOnVacancy(
  db: Prisma.TransactionClient,
  apartmentId: string,
  at: Date,
): Promise<{ paused: number }> {
  const result = await db.subscription.updateMany({
    where: {
      apartmentId,
      status: "ACTIVE",
      deletedAt: null,
      // الدورية وحدها. الخدمة لمرّة واحدة قُيّدت وانتهت، وإيقافها بلا معنى.
      billingCycle: { not: null },
    },
    data: {
      status: "PAUSED",
      // ⚠️ التصفير ضروري لا تجميلي: مهمة الفوترة تقرأ `nextChargeDate`،
      // وتركُه على تاريخ ماضٍ يجعلها تُفوتِر شقة فارغة عند أول تشغيل.
      nextChargeDate: null,
      updatedAt: at,
    },
  });

  return { paused: result.count };
}
