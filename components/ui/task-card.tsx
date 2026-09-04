import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/**
 * بطاقة «ما ينتظر فعله».
 *
 * ── لماذا كل بطاقة تحمل **سبباً** ───────────────────────────────────
 * رقمٌ بلا سبب لا يُحرّك أحداً. «شقق مسكونة بلا عقد نشط: 3» تُقرأ
 * وتُنسى؛ ومعها «خلل تحصيل: الوحدة مشغولة وتستهلك الخدمات ولا حساب
 * يُقيَّد عليه» تُفتَح.
 *
 * ── وحالة الصفر ليست فراغاً ────────────────────────────────────────
 * ⚠️ لوحةٌ تُخفي البند حين يكون صفراً تُفقد المستخدم الثقة: لا يعرف
 * أفُحص البند ولم يوجد شيء، أم لم يُفحص أصلاً. البطاقة تبقى، وتقول
 * **«لا شيء ينتظر»** بعلامة صحّ خضراء — وهي معلومة لا فراغ.
 */

export type TaskTone = "danger" | "warning" | "info" | "neutral";

const TONE: Record<TaskTone, { edge: string; chip: string; icon: string; badge: "danger" | "warning" | "info" | "neutral" }> = {
  danger: {
    edge: "before:bg-money-overdue",
    chip: "bg-money-overdue/10",
    icon: "text-money-overdue",
    badge: "danger",
  },
  warning: {
    edge: "before:bg-money-pending",
    chip: "bg-money-pending/12",
    icon: "text-money-pending",
    badge: "warning",
  },
  info: {
    edge: "before:bg-occupancy-tenant",
    chip: "bg-occupancy-tenant/10",
    icon: "text-occupancy-tenant",
    badge: "info",
  },
  neutral: {
    edge: "before:bg-border",
    chip: "bg-muted",
    icon: "text-muted-foreground",
    badge: "neutral",
  },
};

export function TaskCard({
  title,
  count,
  why,
  icon: Icon,
  tone,
  href,
  emptyAr,
  children,
}: {
  title: string;
  count: number;
  /** لماذا يهمّ هذا البند — رقمٌ بلا سبب لا يُحرّك أحداً. */
  why: string;
  icon: LucideIcon;
  tone: TaskTone;
  href: string;
  emptyAr: string;
  children?: React.ReactNode;
}) {
  const clear = count === 0;
  const t = clear ? TONE.neutral : TONE[tone];

  return (
    <Card
      className={cn(
        "relative gap-0 overflow-hidden py-0",
        // حافّة لونية على جهة **البدء** — تُقرأ الخطورة قبل النصّ
        "before:absolute before:inset-y-0 before:start-0 before:w-1",
        clear ? "before:bg-occupancy-owner/40" : t.edge,
      )}
    >
      <CardHeader className="gap-0 p-5 pb-3">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "grid size-9 shrink-0 place-items-center rounded-lg",
              clear ? "bg-occupancy-owner/10" : t.chip,
            )}
            aria-hidden
          >
            {clear ? (
              <CheckCircle2 className="size-4.5 text-occupancy-owner" />
            ) : (
              <Icon className={cn("size-4.5", t.icon)} />
            )}
          </span>

          <div className="min-w-0 flex-1">
            <CardTitle className="text-sm font-semibold">{title}</CardTitle>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{why}</p>
          </div>

          <Badge variant={clear ? "success" : t.badge} className="shrink-0">
            <span className="tabular">{count}</span>
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="p-5 pt-0">
        {clear ? (
          <p className="text-sm text-occupancy-owner">{emptyAr}</p>
        ) : (
          <>
            <ul className="divide-y text-sm">{children}</ul>
            {count > 5 ? (
              <Button asChild variant="outline" size="sm" className="mt-4">
                <Link href={href}>
                  عرض الكل (<span className="tabular">{count}</span>)
                </Link>
              </Button>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
