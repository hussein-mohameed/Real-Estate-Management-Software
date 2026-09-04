import { cn } from "@/lib/cn";
import { formatPercentage, safePercentage } from "@/lib/domain/statistics";

/**
 * شريط توزيع مقسَّم — بديل جدول التعريفات لعرض نسب فئات.
 *
 * ── لماذا شريط لا جدول ─────────────────────────────────────────────
 * «مسكونة 42 · فارغة 18» رقمان يحتاجان قسمةً ذهنية ليُفهما. الشريط
 * يعطي النسبة **قبل** أن يُقرأ الرقم — وهو ما يفتحه المالك من أجله.
 *
 * ── ما يحرسه هذا المكوّن ───────────────────────────────────────────
 * ⚠️ **القسمة على صفر**: مجمّع بلا شقق يعطي `null` لا `0%` (‏§4.20).
 * الشريط يعرض حالة فراغ صريحة بدل شريط ممتلئ بالصفر — والفرق ليس
 * تجميلياً: شريطٌ فارغ يقول «لا شيء مسكون»، وهو **كذب** حين لا توجد
 * شقق أصلاً.
 *
 * ⚠️ والألوان تأتي من المستدعي لا من هنا: §11.2 يثبّت لغة لون لكل محور،
 * وتوليدها هنا كان سينتج أخضرَين مختلفين لنفس المعنى.
 */

export interface Segment {
  label: string;
  value: number;
  /** صنف خلفية من ترميزات §11.2 — مثل `bg-occupancy-owner`. */
  className: string;
}

export function SegmentedBar({
  segments,
  emptyAr = "لا بيانات لعرضها.",
}: {
  segments: readonly Segment[];
  emptyAr?: string;
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);

  if (total === 0) {
    return (
      <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
        {emptyAr}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* الشريط — نسبٌ متجاورة بلا فجوات، وحوافّ مستديرة من الطرفين */}
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={segments
          .map((s) => `${s.label}: ${formatPercentage(safePercentage(s.value, total))}`)
          .join(" · ")}
      >
        {segments.map((s) =>
          s.value === 0 ? null : (
            <span
              key={s.label}
              className={cn("h-full transition-all", s.className)}
              style={{ width: `${(s.value / total) * 100}%` }}
            />
          ),
        )}
      </div>

      {/* المفتاح — نقطة بلون الشريحة، ثم التسمية، ثم الرقم والنسبة */}
      <ul className="flex flex-col gap-2 text-sm">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2.5">
            <span className={cn("size-2.5 shrink-0 rounded-full", s.className)} aria-hidden />
            <span className="flex-1 text-muted-foreground">{s.label}</span>
            <span className="tabular font-medium">{s.value}</span>
            <span className="tabular w-14 text-end text-xs text-muted-foreground">
              {formatPercentage(safePercentage(s.value, total))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
