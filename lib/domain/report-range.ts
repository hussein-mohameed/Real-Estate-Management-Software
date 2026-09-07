import {
  addMonthsBaghdad,
  fromBaghdadWallClock,
  startOfDayBaghdad,
  startOfMonthBaghdad,
  toBaghdadParts,
} from "@/lib/dates";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  مدّة التقرير — نافذة زمنية بحدود بغداد.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── 🔴 الحدّ الأعلى **مفتوح** لا مغلق ───────────────────────────────
 * `to` هو **بداية اليوم التالي**، والمقارنة `< to` لا `<= to`.
 *
 * والبديل الشائع — `lte: نهاية اليوم` — يُنتج أحد خطأين حتماً: إمّا
 * `23:59:59` فتسقط الدفعات في الثانية الأخيرة، أو `23:59:59.999` فتسقط ما
 * دونها بميكروثانية في Postgres (‏دقّته أعلى من JS). والنصف المفتوح لا
 * يُسقط شيئاً ولا يعدّ يوماً مرّتين.
 *
 * ── ⚠️ والحدود **بتوقيت بغداد** لا UTC ──────────────────────────────
 * دفعةٌ قُبضت الساعة الواحدة ظهراً في بغداد هي `10:00Z`. وحدٌّ يوميٌّ
 * بـUTC يضع دفعات ما بعد التاسعة مساءً بغداد في اليوم **التالي** —
 * فيختلف «تحصيل اليوم» عن إقفال الصندوق، وهما يجب أن يتطابقا.
 *
 * ── ولماذا في `domain` لا في الإجراء ───────────────────────────────
 * تُختبَر بلا قاعدة ولا شبكة، ويقرؤها كل تقرير — فالمنطق واحد لا يتفرّق
 * بين خمس شاشات.
 */

export const RANGE_PRESET = [
  "today",
  "yesterday",
  "week",
  "month",
  "prevMonth",
  "quarter",
  "year",
  "custom",
] as const;

export type RangePreset = (typeof RANGE_PRESET)[number];

export const RANGE_PRESET_AR: Record<RangePreset, string> = {
  today: "اليوم",
  yesterday: "أمس",
  week: "آخر 7 أيام",
  month: "هذا الشهر",
  prevMonth: "الشهر الماضي",
  quarter: "آخر 3 أشهر",
  year: "هذه السنة",
  custom: "مدّة مخصّصة",
};

export interface ReportRange {
  /** شامل — بداية اليوم في بغداد. */
  from: Date;
  /** **غير شامل** — بداية اليوم التالي. راجع أعلاه. */
  to: Date;
  preset: RangePreset;
}

/** يوم واحد بالمللي — تُستعمل للإزاحة داخل هذا الملفّ وحده. */
const DAY_MS = 86_400_000;

/** بداية اليوم التالي في بغداد — الحدّ الأعلى المفتوح. */
function nextDayStart(instant: Date): Date {
  /*
   * ⚠️ إضافة 24 ساعة ثم تصفير اليوم — لا `day + 1` مباشرةً: الأخير يكسر
   * عند آخر يوم في الشهر. والتصفير يعيد الحساب بحدود بغداد فيصحّ حتى لو
   * تغيّرت الإزاحة في تلك الليلة.
   */
  return startOfDayBaghdad(new Date(startOfDayBaghdad(instant).getTime() + DAY_MS + DAY_MS / 2));
}

/** `YYYY-MM-DD` ← بداية ذلك اليوم في بغداد، أو `null` إن لم يكن تاريخاً. */
export function parseDayParam(value: string | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value.trim());
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const built = fromBaghdadWallClock(year, month, day);
  /*
   * ⚠️ `2026-02-31` يُبنى بلا خطأ ويصير 3 آذار. والفحص بإعادة القراءة
   * يكشفه — وبلاه يعرض التقرير مدّةً لم يطلبها أحد ويبدو صحيحاً.
   */
  const back = toBaghdadParts(built);
  if (back.year !== year || back.month !== month || back.day !== day) return null;
  return built;
}

/** `Date` ← `YYYY-MM-DD` بتقويم بغداد — لملء حقول النموذج والروابط. */
export function toDayParam(instant: Date): string {
  const p = toBaghdadParts(instant);
  return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/**
 * يبني المدّة من مُدخلات العنوان.
 *
 * ⚠️ **الافتراضي «هذا الشهر»** لا «كل الوقت»: تقريرٌ بلا مدّة يمسح الدفتر
 * كلّه في كل فتح — وهو أبطأ ما يمكن، وأقلّ ما يُقرأ.
 */
export function resolveRange(
  input: { preset?: string | undefined; from?: string | undefined; to?: string | undefined },
  reference: Date,
): ReportRange {
  const customFrom = parseDayParam(input.from);
  const customTo = parseDayParam(input.to);

  /* مدّة مخصّصة صالحة تسبق أي `preset` — هي الأصرح */
  if (customFrom && customTo) {
    /* ⚠️ المقلوبة تُصحَّح لا تُردّ: من كتب التاريخين معكوسين يقصد ما بينهما */
    const [a, b] = customFrom <= customTo ? [customFrom, customTo] : [customTo, customFrom];
    return { from: a, to: nextDayStart(b), preset: "custom" };
  }

  const preset = RANGE_PRESET.find((p) => p === input.preset) ?? "month";
  const todayStart = startOfDayBaghdad(reference);
  const tomorrow = nextDayStart(reference);

  switch (preset) {
    case "today":
      return { from: todayStart, to: tomorrow, preset };

    case "yesterday": {
      const yStart = startOfDayBaghdad(new Date(todayStart.getTime() - DAY_MS / 2));
      return { from: yStart, to: todayStart, preset };
    }

    case "week": {
      /* ⚠️ «آخر 7 أيام» شاملةً اليوم — لا أسبوعٌ تقويميّ يبدأ بيوم يختلف عليه الناس */
      const start = startOfDayBaghdad(new Date(todayStart.getTime() - 6 * DAY_MS - DAY_MS / 2));
      return { from: start, to: tomorrow, preset };
    }

    case "prevMonth": {
      const thisMonth = startOfMonthBaghdad(reference);
      return { from: addMonthsBaghdad(thisMonth, -1), to: thisMonth, preset };
    }

    case "quarter":
      return { from: addMonthsBaghdad(startOfMonthBaghdad(reference), -2), to: tomorrow, preset };

    case "year": {
      const p = toBaghdadParts(reference);
      return { from: fromBaghdadWallClock(p.year, 1, 1), to: tomorrow, preset };
    }

    case "custom":
    case "month":
    default:
      return { from: startOfMonthBaghdad(reference), to: tomorrow, preset: "month" };
  }
}
