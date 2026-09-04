/**
 * التواريخ — تخزين UTC، عرض وحساب بتوقيت `Asia/Baghdad` (‏A10 · §12.6).
 *
 * **لماذا وحدة مستقلة ولماذا `new Date()` محظورة في كود المجال:**
 * حدود الفترات المالية (`periodStart` · `periodEnd` · `dueDate` · `nextChargeDate`)
 * لو حُسبت بمنطقة الخادم الزمنية لأنتجت قيوداً **في الشهر الخطأ** عند حدّي الشهر.
 * خادم على UTC في الساعة 22:00 يوم 31/8 هو أصلاً 01:00 يوم 1/9 في بغداد.
 *
 * **لا نثبّت الإزاحة على ‎+3.** العراق ألغى التوقيت الصيفي، لكن تثبيت الرقم يجعل
 * النظام خاطئاً بصمت لو تغيّرت القاعدة. نستخدم `Intl` فيأتي التوقيت من قاعدة
 * بيانات المناطق الزمنية في بيئة التشغيل.
 *
 * **بلا اعتماد إضافي:** `Intl.DateTimeFormat` مدمج في بيئة التشغيل، فلا حاجة
 * إلى `date-fns-tz` — وهي ليست ضمن حزمة §2.1 على أي حال.
 */

export const BAGHDAD_TZ = "Asia/Baghdad";

const PARTS_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: BAGHDAD_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export interface BaghdadParts {
  year: number;
  month: number; // 1–12، وليس 0-based
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** لحظة UTC ← أجزاء ساعة الحائط في بغداد. */
export function toBaghdadParts(instant: Date): BaghdadParts {
  const parts = PARTS_FMT.formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((p) => p.type === type);
    if (!found) throw new Error(`جزء تاريخ مفقود: ${type}`);
    return Number(found.value);
  };
  // ‏hour12:false قد يعطي 24 عند منتصف الليل في بعض بيئات التشغيل
  const hour = get("hour") % 24;
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour,
    minute: get("minute"),
    second: get("second"),
  };
}

/** إزاحة بغداد بالمللي ثانية عند لحظة معيّنة (موجبة شرق غرينتش). */
function baghdadOffsetMs(instant: Date): number {
  const p = toBaghdadParts(instant);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // نُهمل المللي ثانية في المقارنة لأن formatToParts لا يعيدها
  const instantSeconds = Math.floor(instant.getTime() / 1000) * 1000;
  return asIfUtc - instantSeconds;
}

/**
 * ساعة حائط بغداد ← لحظة UTC.
 * تمريرتان: التخمين الأول قد يقع على الجانب الخطأ من أي تغيّر إزاحة،
 * والتمريرة الثانية تصحّحه. هذا هو الحلّ القياسي الصحيح لا تحسيناً.
 */
export function fromBaghdadWallClock(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstGuess = new Date(wall - baghdadOffsetMs(new Date(wall)));
  return new Date(wall - baghdadOffsetMs(firstGuess));
}

/** بداية اليوم في بغداد (‏00:00:00) كلحظة UTC. */
export function startOfDayBaghdad(instant: Date): Date {
  const p = toBaghdadParts(instant);
  return fromBaghdadWallClock(p.year, p.month, p.day);
}

/** بداية الشهر في بغداد كلحظة UTC. */
export function startOfMonthBaghdad(instant: Date): Date {
  const p = toBaghdadParts(instant);
  return fromBaghdadWallClock(p.year, p.month, 1);
}

/** عدد أيام شهر ميلادي — يتعامل مع فبراير والسنة الكبيسة. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * تاريخ الفوترة لشهر معيّن، **مع تثبيت اليوم على آخر يوم في الشهر عند التجاوز**.
 *
 * القرار الحرج في الخطوة 0.7: `billingDayOfMonth = 31` في شهر من 30 يوماً
 * يجب أن يُثبَّت على 30 — لا أن يتدحرج إلى الشهر التالي. لو تدحرج **لتخطّت
 * الفوترة شهراً كاملاً بصمت**، وهو خطأ إيراد لا يُكتشف إلا بعد أشهر.
 * فبراير أخطر حالة: 31 ← 28 أو 29.
 */
export function billingDateForMonth(
  year: number,
  month: number,
  billingDayOfMonth: number,
): Date {
  if (!Number.isInteger(billingDayOfMonth) || billingDayOfMonth < 1 || billingDayOfMonth > 31) {
    throw new RangeError(`يوم الفوترة يجب أن يكون بين 1 و31، وصل: ${billingDayOfMonth}`);
  }
  const clamped = Math.min(billingDayOfMonth, daysInMonth(year, month));
  return fromBaghdadWallClock(year, month, clamped);
}

/** إضافة أشهر بتقويم بغداد مع تثبيت اليوم (‏31 يناير + شهر = 28/29 فبراير). */
export function addMonthsBaghdad(instant: Date, months: number): Date {
  const p = toBaghdadParts(instant);
  const totalMonths = (p.year * 12 + (p.month - 1)) + months;
  const year = Math.floor(totalMonths / 12);
  const month = (totalMonths % 12) + 1;
  const day = Math.min(p.day, daysInMonth(year, month));
  return fromBaghdadWallClock(year, month, day, p.hour, p.minute, p.second);
}

/** دورات الفوترة كما في `BillingCycle`. */
export type CycleMonths = 1 | 3 | 12;

export const CYCLE_MONTHS: Record<"MONTHLY" | "QUARTERLY" | "YEARLY", CycleMonths> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  YEARLY: 12,
};

/** نهاية الفترة = بداية الفترة التالية ناقص مللي ثانية — بلا تداخل ولا فجوة. */
export function periodEndFor(periodStart: Date, cycle: keyof typeof CYCLE_MONTHS): Date {
  const next = addMonthsBaghdad(periodStart, CYCLE_MONTHS[cycle]);
  return new Date(next.getTime() - 1);
}

/** هل اللحظتان في نفس اليوم بتوقيت بغداد؟ */
export function isSameBaghdadDay(a: Date, b: Date): boolean {
  const pa = toBaghdadParts(a);
  const pb = toBaghdadParts(b);
  return pa.year === pb.year && pa.month === pb.month && pa.day === pb.day;
}

/** «dd/MM/yyyy» بأرقام غربية — الشكل المعتمد في §11.1. */
export function formatBaghdadDate(instant: Date): string {
  const p = toBaghdadParts(instant);
  const dd = String(p.day).padStart(2, "0");
  const mm = String(p.month).padStart(2, "0");
  return `${dd}/${mm}/${p.year}`;
}

/** «dd/MM/yyyy HH:mm» — للتدقيق وسجل الإخطارات. */
export function formatBaghdadDateTime(instant: Date): string {
  const p = toBaghdadParts(instant);
  const hh = String(p.hour).padStart(2, "0");
  const mi = String(p.minute).padStart(2, "0");
  return `${formatBaghdadDate(instant)} ${hh}:${mi}`;
}

/** «8/2026» — للوصف العربي في الدفتر: «اشتراك المولدة - 5 أمبير - شهر 8/2026». */
export function formatBaghdadMonth(instant: Date): string {
  const p = toBaghdadParts(instant);
  return `${p.month}/${p.year}`;
}

/**
 * اللحظة الآن.
 * ⚠️ نقطة الحقن الوحيدة للوقت في النظام. كل كود مجال يستقبل الوقت وسيطاً أو
 * يناديها من هنا، فتصبح الاختبارات الزمنية ممكنة أصلاً.
 */
export function now(): Date {
  return new Date();
}

/**
 * عدد الأيام التقويمية بين لحظتين **بتقويم بغداد**.
 *
 * ⚠️ **بالتقويم لا بقسمة المللي ثانية.** الطرح ثم القسمة على 86,400,000
 * يعطي أيّاماً «كاملة» فيهمل الساعات: من 2 الساعة 23:00 إلى 3 الساعة
 * 01:00 يومان تقويمياً وساعتان زمنياً. والتناسب يُحسب بالأيام لا بالساعات،
 * فساكن اشترك ليلاً يجب ألّا يخسر يوماً.
 *
 * والنتيجة موجبة حين `b` بعد `a`، وصفر في نفس اليوم.
 */
export function daysBetweenBaghdad(a: Date, b: Date): number {
  const pa = toBaghdadParts(a);
  const pb = toBaghdadParts(b);
  const dayA = Date.UTC(pa.year, pa.month - 1, pa.day);
  const dayB = Date.UTC(pb.year, pb.month - 1, pb.day);
  return Math.round((dayB - dayA) / 86_400_000);
}

export interface CycleWindow {
  /** بداية الدورة المحاذية التي تقع فيها اللحظة. */
  start: Date;
  /** بداية الدورة التالية — أي نهاية الحالية حصراً. */
  nextStart: Date;
}

/**
 * نافذة الدورة المحاذية التي تقع فيها لحظة معيّنة.
 *
 * المرساة هي `billingDayOfMonth` من إعدادات المجمّع، فتُفوتَر كل
 * الاشتراكات الشهرية في يوم واحد بدل أن يكون لكل اشتراك يومه.
 *
 * ── ⚠️ قرار تنفيذي للربعي والسنوي ──────────────────────────────────
 * `B2` يعالج **الشهري** بمثاله، ولا يقول أين تبدأ دورة ربعية. الخيار
 * المتَّخذ هنا: المرساة شهرُ الموافقة نفسه — ربعيٌّ يُوافَق عليه في فبراير
 * يتكرّر فبراير/مايو/أغسطس/نوفمبر.
 *
 * والبديل — محاذاة الأرباع بالتقويم (يناير/أبريل/…) — يجعل اشتراكاً
 * سنوياً يُوافَق عليه في فبراير يُقيَّد عليه أحد عشر شهراً دفعةً واحدة ثم
 * يتجدّد في يناير. مبلغٌ كبير مفاجئ مقابل «انتظام» لا يطلبه أحد.
 *
 * ⚠️ **يُراجَع إن أردتَ أرباعاً تقويمية.** التغيير محصور في هذه الدالّة.
 */
export function alignedCycleWindow(
  at: Date,
  billingDayOfMonth: number,
  cycle: keyof typeof CYCLE_MONTHS,
): CycleWindow {
  const p = toBaghdadParts(at);
  const thisMonth = billingDateForMonth(p.year, p.month, billingDayOfMonth);

  /*
   * ⚠️ الرجوع شهراً يُحسب على السنة والشهر لا بـ`addMonthsBaghdad`.
   * الأخيرة تثبّت اليوم على طول الشهر، فيوم فوترة 31 يصير 30 في نوفمبر
   * ثم يبقى 30 عند الرجوع — فتنزلق المرساة شهراً بعد شهر.
   */
  const start =
    thisMonth.getTime() <= at.getTime()
      ? thisMonth
      : billingDateForMonth(
          p.month === 1 ? p.year - 1 : p.year,
          p.month === 1 ? 12 : p.month - 1,
          billingDayOfMonth,
        );

  const startParts = toBaghdadParts(start);
  const monthsAhead = startParts.month - 1 + CYCLE_MONTHS[cycle];
  const nextStart = billingDateForMonth(
    startParts.year + Math.floor(monthsAhead / 12),
    (monthsAhead % 12) + 1,
    billingDayOfMonth,
  );

  return { start, nextStart };
}
