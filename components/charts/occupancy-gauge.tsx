"use client";

import { PolarAngleAxis, RadialBar, RadialBarChart } from "recharts";
import { ChartContainer } from "@/components/ui/chart";

/**
 * مقياس الإشغال النصف دائري.
 *
 * ── لماذا مقياس لا رقم ─────────────────────────────────────────────
 * «68٪» رقمٌ يحتاج مرجعاً ليُفهم: أهو جيّد أم سيّئ؟ المقياس يعطي
 * **الموضع من المدى** فوراً — الممتلئ يُقرأ ممتلئاً بلا حساب.
 *
 * ── والقوس مقصود ──────────────────────────────────────────────────
 * نصف دائرة لا دائرة كاملة: الدائرة الكاملة تُقرأ كنسبة من كلٍّ (كالكعكة)،
 * والقوس يُقرأ كعدّاد له بداية ونهاية — وهو المعنى الصحيح لنسبة الإشغال.
 *
 * ── القسمة على صفر ────────────────────────────────────────────────
 * ⚠️ مجمّع بلا شقق يعطي `null` لا `0٪` (‏§4.20). القوس الفارغ يقول «لا
 * شيء مسكون» — وهو **كذب** حين لا توجد شقق أصلاً. لذلك حالة صريحة.
 */
export function OccupancyGauge({
  percentage,
  occupied,
  total,
}: {
  /** `null` حين لا مقام — تُعرَض حالة فراغ لا قوس بصفر. */
  percentage: number | null;
  occupied: number;
  total: number;
}) {
  if (percentage === null) {
    return (
      <div className="flex h-[220px] flex-col items-center justify-center gap-1 text-center">
        <p className="text-theme-sm text-muted-foreground">لا شقق بعد</p>
        <p className="text-theme-xs text-muted-foreground/80">
          أنشئ بناية لتظهر نسبة الإشغال.
        </p>
      </div>
    );
  }

  const value = Math.max(0, Math.min(100, percentage));

  return (
    <div className="relative">
      <ChartContainer
        config={{ occupancy: { label: "الإشغال", color: "var(--color-brand-500)" } }}
        className="mx-auto aspect-[2/1.15] max-h-[220px] w-full"
      >
        <RadialBarChart
          data={[{ name: "occupancy", value, fill: "var(--color-brand-500)" }]}
          startAngle={180}
          endAngle={0}
          innerRadius="72%"
          outerRadius="100%"
          cy="78%"
        >
          {/* المدى مثبَّت 0–100 كي لا يعيد Recharts قياسه على القيمة نفسها */}
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} axisLine={false} />
          <RadialBar
            dataKey="value"
            cornerRadius={999}
            background={{ fill: "var(--color-gray-100)" }}
          />
        </RadialBarChart>
      </ChartContainer>

      {/* الرقم في قلب القوس — يقرأه من يريد الدقّة بعد أن قرأ الموضع */}
      <div className="pointer-events-none absolute inset-x-0 bottom-6 flex flex-col items-center">
        <span className="text-title-md font-semibold tracking-tight tabular">
          {Math.round(value)}%
        </span>
        <span className="text-theme-xs text-muted-foreground">
          <span className="tabular">{occupied}</span> مسكونة من{" "}
          <span className="tabular">{total}</span>
        </span>
      </div>
    </div>
  );
}
