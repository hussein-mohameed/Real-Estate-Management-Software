import { mulIqd } from "@/lib/money";
import { daysBetweenBaghdad } from "@/lib/dates";
import type { PricingModel } from "@/lib/domain/enums";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  محرّك التسعير — دالّة نقيّة. الخطوة 2.2.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * **هذه الدالّة تحدّد كل دينار في النظام.** كل قيد دوري وكل فاتورة تمرّ
 * من هنا، فهي مُختبَرة بالكامل قبل أي استعمال — لا بعده.
 *
 * ── نقيّة بلا استثناء ──────────────────────────────────────────────
 * لا قاعدة بيانات، ولا وقت، ولا عشوائية. تُعطى ما تحتاجه وتُعيد رقماً.
 * وهذا ما يجعل اختبارها ممكناً على مئات التركيبات في أجزاء الثانية،
 * ويجعل خطأً فيها **قابلاً لإعادة الإنتاج** بدل أن يكون «حدث مرّة».
 *
 * ── `BigInt` في كل خطوة ────────────────────────────────────────────
 * ⚠️ **لا تحويل إلى `Number` في أي موضع وسيط.** تحويل واحد فوق 2^53
 * يفقد الدقّة ويُنتج فرقاً بالدينار — لا يظهر في اختبار بأرقام صغيرة،
 * ويظهر في عقد بمليارات. الكميات `number` لأنها **عدّ لا مال**، وتُحوَّل
 * إلى `BigInt` قبل أي ضرب (‏`mulIqd`).
 *
 * ── `Q5` — عدد الأشخاص **مشتقّ لا مُدخَل** ──────────────────────────
 * §4.14 يقول `quantity` = «عدد الوحدات أو عدد الأشخاص» (مُدخَل)، و§7.4
 * يقول `PER_PERSON` = `base × عدد السكان النشطين` (محسوب). التناقض
 * حُسم في خطة الجسر: **المشتقّ هو الحقيقة**، و`quantity` لقطة توثيقية
 * للفترة المفوترة لا مصدر حقيقة.
 *
 * ولهذا يقبل `personsCount` من السياق ولا يقرأ `quantity` في هذا
 * النموذج: تمريرُ كمية يدوية هنا كان سيسمح بفوترة أسرة من ثلاثة على
 * أنها عشرة، بلا أن يخالف أي قيد.
 */

export interface PricingInput {
  pricingModel: PricingModel;
  basePriceIqd: bigint | null;
  unitPriceIqd: bigint | null;
  minUnits: number | null;
  maxUnits: number | null;
}

export interface PricingContext {
  /** لـ`PER_UNIT` وحده: عدد الوحدات (أمبيرات · م³). */
  quantity?: number;
  /** لـ`PER_PERSON` وحده: **السكان النشطون وقت القيد** (‏Q5). */
  personsCount?: number;
}

export interface PricingResult {
  /** المبلغ المستحقّ عن الفترة الواحدة. */
  periodAmountIqd: bigint;
  /**
   * السعر المُثبَّت على الاشتراك (‏`unitPriceSnapshotIqd`).
   *
   * ⚠️ **إلزامي حتى لـ`FLAT`** — الحقل غير قابل لـnull في المخطّط.
   * يساوي `basePriceIqd` عندها، وهو ما يبدو غريباً في القراءة: «سعر
   * الوحدة» لخدمة بلا وحدات. التسمية إرث المخطّط، والمعنى: **السعر
   * الذي حُسب به هذا الاشتراك يوم أُنشئ** — وهو ما يحمي `R23`.
   */
  unitPriceSnapshotIqd: bigint;
  /** الكمية كما تُحفَظ لقطةً على الاشتراك. `FLAT` ← 1. */
  quantity: number;
}

/** خطأ تسعير — رسالته عربية لأنها تصل المستخدم عبر `ActionResult`. */
export class PricingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PricingError";
  }
}

/**
 * يحسب مبلغ الفترة الواحدة.
 *
 * ⚠️ **الحدود تُفحَص هنا لا في الواجهة.** الواجهة تمنع الإدخال الخاطئ،
 * لكن الإجراء نقطة نهاية HTTP: كمية 999 أمبير على خدمة حدّها 30 تصل
 * الخادم مباشرةً إن لم تُفحَص هنا، وتُنتج قيداً بمليون ونصف بلا مخالفة
 * أي قيد في قاعدة البيانات.
 */
export function computePeriodAmount(
  service: PricingInput,
  context: PricingContext = {},
): PricingResult {
  switch (service.pricingModel) {
    case "FLAT": {
      const base = requirePrice(service.basePriceIqd, "سعر الخدمة");
      return {
        periodAmountIqd: base,
        // إلزامي في المخطّط ← يساوي السعر الأساسي
        unitPriceSnapshotIqd: base,
        quantity: 1,
      };
    }

    case "PER_UNIT": {
      const unit = requirePrice(service.unitPriceIqd, "سعر الوحدة");
      const quantity = requireCount(context.quantity, "عدد الوحدات");
      assertWithinBounds(quantity, service.minUnits, service.maxUnits, "الكمية");

      return {
        periodAmountIqd: mulIqd(unit, quantity),
        unitPriceSnapshotIqd: unit,
        quantity,
      };
    }

    case "PER_PERSON": {
      const base = requirePrice(service.basePriceIqd, "سعر الفرد");
      /**
       * ⚠️ `personsCount` **مشتقّ من السكان النشطين** (‏Q5) — لا يُقرأ من
       * `quantity` ولو مُرِّرت. تمرير كمية يدوية هنا كان يسمح بفوترة
       * أسرة من ثلاثة على أنها عشرة.
       */
      const persons = requireCount(context.personsCount, "عدد الأشخاص");

      /**
       * ⚠️ شقة **بلا سكان نشطين** ← صفر لا خطأ.
       * الحالة واقعية: تُخلى الوحدة ويبقى الاشتراك موقوفاً حتى قرار
       * الأدمن. الرمي هنا كان سيُفشل مسار الإخلاء نفسه.
       */
      if (persons === 0) {
        return { periodAmountIqd: 0n, unitPriceSnapshotIqd: base, quantity: 0 };
      }

      return {
        periodAmountIqd: mulIqd(base, persons),
        unitPriceSnapshotIqd: base,
        quantity: persons,
      };
    }

    default: {
      // فحص شمول: نموذج تسعير جديد بلا فرع يُوقف الترجمة لا وقت التشغيل
      const exhaustive: never = service.pricingModel;
      throw new PricingError(`نموذج تسعير غير معروف: ${String(exhaustive)}`);
    }
  }
}

function requirePrice(value: bigint | null, label: string): bigint {
  if (value === null) {
    throw new PricingError(`${label} غير محدَّد على الخدمة، فلا يمكن حساب المبلغ.`);
  }
  if (value <= 0n) {
    throw new PricingError(`${label} يجب أن يكون أكبر من صفر.`);
  }
  return value;
}

function requireCount(value: number | undefined, label: string): number {
  if (value === undefined || value === null) {
    throw new PricingError(`${label} مطلوب لهذا النموذج من التسعير.`);
  }
  if (!Number.isInteger(value)) {
    throw new PricingError(`${label} يجب أن يكون عدداً صحيحاً.`);
  }
  if (value < 0) {
    throw new PricingError(`${label} لا يجوز أن يكون سالباً.`);
  }
  return value;
}

function assertWithinBounds(
  value: number,
  min: number | null,
  max: number | null,
  label: string,
): void {
  if (value === 0) {
    throw new PricingError(`${label} يجب أن تكون واحدة على الأقل.`);
  }
  if (min !== null && value < min) {
    throw new PricingError(`${label} لا تقلّ عن ${min}.`);
  }
  if (max !== null && value > max) {
    throw new PricingError(`${label} لا تزيد عن ${max}.`);
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  التقسيط بالتناسب — الفترة الأولى (‏B2)
// ═══════════════════════════════════════════════════════════════════════

export interface ProrationInput {
  /** مبلغ الفترة الكاملة كما حسبه `computePeriodAmount`. */
  periodAmountIqd: bigint;
  /** بداية الدورة المحاذية التي وقعت فيها الموافقة. */
  alignedStart: Date;
  /** بداية الدورة المحاذية **التالية** — أي نهاية الحالية حصراً. */
  alignedNextStart: Date;
  /** يوم الموافقة: بداية الفترة الأولى فعلاً. */
  activeFrom: Date;
}

export interface ProrationResult {
  amountIqd: bigint;
  /** الأيام المحتسَبة من الفترة الأولى. */
  chargedDays: number;
  /** أيام الدورة الكاملة — المقام. */
  cycleDays: number;
  /** `false` حين وقعت الموافقة على بداية الدورة تماماً. */
  prorated: boolean;
}

/**
 * يحسب مبلغ **الفترة الأولى** بالتناسب مع أيامها.
 *
 * ── القرار `B2` (‏2026-08-28) ───────────────────────────────────────
 * الفترة الأولى تبدأ يوم الموافقة وتنتهي مع الدورة المحاذية، ويُقيَّد عليها
 * ما يقابل أيامها وحدها. ثم تنتظم الفترات على `billingDayOfMonth`.
 *
 * البدائل المرفوضة ولماذا: (ب) «شهر مجاني» = خسارة تصل 60 مليون د.ع في
 * السنة الأولى، (ج) «دورة لكل اشتراك» تحوّل الفوترة إلى مهمّة يومية
 * وتفكّك التسوية الشهرية، (أ) «الكامل فوراً» يُحمّل المشترك يوم 28 شهراً
 * كاملاً مقابل ثلاثة أيام.
 *
 * ── ⚠️ ثلاث مصائد حسابية ───────────────────────────────────────────
 *   1. **القسمة قبل الضرب تُصفّر النتيجة.** `(29n / 30n) * 50000n = 0`
 *      لأن `BigInt` يقطع. الضرب أولاً دائماً.
 *   2. **الموافقة على بداية الدورة لا تمرّ بالقسمة إطلاقاً.** حسابياً
 *      `30 ÷ 30` يعطي الكامل، لكن المرور بالقسمة يخاطر بقطعٍ في حالة لا
 *      تحتاج قسمة أصلاً.
 *   3. **القطع لا التقريب.** يميل لصالح الساكن بأقلّ من دينار على
 *      الاشتراك الواحد، ولا يُنتج قرشاً زائداً يشرحه أحد.
 */
export function prorateFirstPeriod(input: ProrationInput): ProrationResult {
  const { periodAmountIqd, alignedStart, alignedNextStart, activeFrom } = input;

  const cycleDays = daysBetweenBaghdad(alignedStart, alignedNextStart);
  if (cycleDays <= 0) {
    throw new PricingError("دورة بلا أيام — بداية الدورة التالية ليست بعد الحالية.");
  }

  const elapsed = daysBetweenBaghdad(alignedStart, activeFrom);
  if (elapsed < 0 || elapsed >= cycleDays) {
    throw new PricingError("تاريخ التفعيل خارج الدورة المحاذية.");
  }

  const chargedDays = cycleDays - elapsed;

  // المصيدة 2: بداية الدورة تماماً ← الكامل بلا قسمة
  if (elapsed === 0) {
    return { amountIqd: periodAmountIqd, chargedDays, cycleDays, prorated: false };
  }

  /*
   * ⚠️ صفر يبقى صفراً: `PER_PERSON` في وحدة بلا سكان (‏Q5). القسمة تعطي
   * صفراً على أي حال، لكن الخروج المبكر يجعل النيّة مقروءة.
   */
  if (periodAmountIqd === 0n) {
    return { amountIqd: 0n, chargedDays, cycleDays, prorated: true };
  }

  // المصيدة 1: الضرب قبل القسمة · المصيدة 3: القطع لا التقريب
  const amountIqd = (periodAmountIqd * BigInt(chargedDays)) / BigInt(cycleDays);

  return { amountIqd, chargedDays, cycleDays, prorated: true };
}
