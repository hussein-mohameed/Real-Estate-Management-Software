import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { formatPercentage, safePercentage } from "@/lib/domain/statistics";

/**
 * بطاقة مقياس.
 *
 * ── التخطيط: عمودي لا أفقي ──────────────────────────────────────────
 * ⚠️ **كانت أفقية — أيقونة إلى جانب النصّ — وهو ما جعلها تبدو ضيّقة.**
 * الصفّ الأفقي يقتسم العرض بين الأيقونة والرقم، فيبقى للرقم نصف البطاقة
 * ويُجبَر على حجم أصغر. والعمودي يعطي الأيقونة سطرها ثم يُخلي العرض كلّه
 * للرقم — فيكبر الرقم وهو **الشيء الذي تُفتَح البطاقة من أجله**.
 *
 * ── وأربعة أشياء ليست زينة ──────────────────────────────────────────
 *   1. **أيقونة في مربّع ملوّن** — العين تمسح الأيقونات أسرع من النصّ.
 *      لوحةٌ بأربعة صناديق متطابقة تُقرأ سطراً سطراً؛ وبأربع أيقونات
 *      متمايزة تُقرأ بلمحة.
 *   2. **وهجٌ خفيف بلون المحور** في زاوية البدء — يميّز البطاقات عن بعضها
 *      قبل قراءة أي حرف، ويربط البطاقة بلغة لون §11.2.
 *   3. **رقم بخطّ جدولي وتتبّع ضيّق** — الأرقام الكبيرة بتباعد افتراضي
 *      تبدو مفكّكة، والجدولي يمنع رقصها عند التحديث.
 *   4. **شريط نسبة** حين تكون القيمة **جزءاً من كلّ** — «مسكونة: 42»
 *      رقمٌ بلا معنى حتى يُعرف من كم. والشريط يعطي النسبة قبل القسمة
 *      الذهنية.
 *
 * ── ولماذا الأيقونة لا تُقلب في RTL ─────────────────────────────────
 * أيقونات الأشياء (بناية · باب · ملفّ) ليست اتجاهية. الاتجاهية وحدها
 * تُقلب — والسهم هنا `ArrowLeft` لأن «التالي» في العربية يسار.
 */

export type StatTone = "brand" | "success" | "info" | "warning" | "danger" | "neutral";

const TONE: Record<StatTone, { chip: string; icon: string; glow: string; bar: string }> = {
  brand: {
    chip: "bg-accent-brand-soft",
    icon: "text-accent-brand",
    glow: "bg-accent-brand/15",
    bar: "bg-accent-brand",
  },
  success: {
    chip: "bg-occupancy-owner/10",
    icon: "text-occupancy-owner",
    glow: "bg-occupancy-owner/15",
    bar: "bg-occupancy-owner",
  },
  info: {
    chip: "bg-occupancy-tenant/10",
    icon: "text-occupancy-tenant",
    glow: "bg-occupancy-tenant/15",
    bar: "bg-occupancy-tenant",
  },
  warning: {
    chip: "bg-money-pending/12",
    icon: "text-money-pending",
    glow: "bg-money-pending/15",
    bar: "bg-money-pending",
  },
  danger: {
    chip: "bg-money-overdue/10",
    icon: "text-money-overdue",
    glow: "bg-money-overdue/15",
    bar: "bg-money-overdue",
  },
  neutral: {
    chip: "bg-muted",
    icon: "text-muted-foreground",
    glow: "bg-occupancy-vacant/15",
    bar: "bg-occupancy-vacant",
  },
};

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "neutral",
  href,
  share,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon: LucideIcon;
  tone?: StatTone;
  href?: string;
  /**
   * القيمة كجزء من كلّ — يرسم شريط نسبة ويُظهر النسبة المئوية.
   *
   * ⚠️ يُمرَّر **فقط** حين تكون النسبة ذات معنى. «إجمالي الشقق» هو الكلّ
   * نفسه، وشريطٌ ممتلئ بجانبه يقول «100٪ من نفسه» — ضجيج لا معلومة.
   */
  share?: { value: number; total: number };
  className?: string;
}) {
  const t = TONE[tone];

  /** ⚠️ `safePercentage` لا القسمة المباشرة: مجمّع بلا شقق يعطي `null` لا `0٪` (‏§4.20). */
  const pct = share ? safePercentage(share.value, share.total) : null;

  const body = (
    <CardContent className="relative flex flex-col gap-4 p-5">
      {/*
       * الوهج — `overflow-hidden` على البطاقة يقصّه، والحجم السالب يُخرجه
       * جزئياً فيبدو ضوءاً آتياً من خارج الإطار لا دائرةً مرسومة.
       */}
      <span
        className={cn(
          "pointer-events-none absolute -top-16 -end-12 size-36 rounded-full blur-3xl",
          t.glow,
        )}
        aria-hidden
      />

      <div className="relative flex items-start justify-between gap-3">
        <span
          className={cn("grid size-11 shrink-0 place-items-center rounded-xl", t.chip)}
          aria-hidden
        >
          <Icon className={cn("size-5", t.icon)} />
        </span>

        {href ? (
          <ArrowLeft
            className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
            aria-hidden
          />
        ) : null}
      </div>

      <div className="relative min-w-0">
        <span className="block text-theme-sm font-medium text-muted-foreground">
          {label}
        </span>

        <div className="mt-1 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span className="tabular text-title-lg font-bold tracking-tight">{value}</span>
          {pct !== null ? (
            <span className={cn("tabular text-theme-sm font-medium", t.icon)}>
              {formatPercentage(pct)}
            </span>
          ) : null}
        </div>

        {share ? (
          <div
            className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted"
            role="img"
            aria-label={`${label}: ${formatPercentage(pct)}`}
          >
            <span
              className={cn("block h-full rounded-full transition-all", t.bar)}
              style={{ width: `${pct ?? 0}%` }}
            />
          </div>
        ) : null}

        {hint ? (
          <span className="mt-2 block text-theme-xs text-muted-foreground">{hint}</span>
        ) : null}
      </div>
    </CardContent>
  );

  const card = (
    <Card
      className={cn(
        "group relative h-full gap-0 overflow-hidden py-0 transition-all duration-200",
        /*
         * الارتفاع عند التحويم **يقول إن البطاقة قابلة للنقر** — أكثر
         * مما يقوله السهم وحده. ومحصور في البطاقة الرابطة: بطاقةٌ ترتفع
         * ولا تذهب إلى شيء وعدٌ كاذب.
         */
        href && "hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-theme-lg",
        className,
      )}
    >
      {body}
    </Card>
  );

  if (!href) return card;

  return (
    <Link
      href={href}
      className="block rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {card}
    </Link>
  );
}
