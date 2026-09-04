"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

/**
 * الإنجاز حسب البناية — أعمدة.
 *
 * ── لماذا أعمدة لا جدول ────────────────────────────────────────────
 * الجدول يجيب «كم أنجزت البناية س؟»؛ والأعمدة تجيب **«أيّ البنايات
 * متأخّرة؟»** — وهو السؤال الذي يُفتح من أجله التقرير.
 *
 * ── الاتجاه ───────────────────────────────────────────────────────
 * ⚠️ `reversed` على المحور السيني: Recharts يرسم من اليسار، والقراءة
 * العربية من اليمين. بلا هذا تُقرأ البناية الأولى آخراً — والترتيب
 * الزمني أو الأبجدي يبدو معكوساً بلا سبب ظاهر.
 */
export interface BuildingProgressDatum {
  code: string;
  completed: number;
  total: number;
  percentage: number | null;
}

export function BuildingsProgressChart({
  data,
}: {
  data: readonly BuildingProgressDatum[];
}) {
  if (data.length === 0) {
    return (
      <div className="flex h-[260px] items-center justify-center">
        <p className="text-theme-sm text-muted-foreground">
          لا بنايات بعد — أضف أولاها لتظهر هنا.
        </p>
      </div>
    );
  }

  const rows = data.map((d) => ({
    code: d.code,
    /* بناية بلا شقق تعطي `null` — تُرسَم صفراً هنا مع تسمية صريحة في
       التلميح، لأن العمود لا يستطيع تمثيل «غير محدَّد» بصرياً */
    نسبة: d.percentage ?? 0,
    منجَزة: d.completed,
    إجمالي: d.total,
  }));

  return (
    <ChartContainer
      config={{ نسبة: { label: "نسبة الإنجاز", color: "var(--color-brand-500)" } }}
      className="h-[260px] w-full"
    >
      <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <CartesianGrid vertical={false} stroke="var(--color-gray-200)" strokeDasharray="3 3" />
        <XAxis
          dataKey="code"
          reversed
          tickLine={false}
          axisLine={false}
          tickMargin={10}
          className="text-theme-xs"
        />
        <YAxis
          orientation="right"
          domain={[0, 100]}
          ticks={[0, 25, 50, 75, 100]}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={40}
          tickFormatter={(v: number) => `${v}%`}
          className="text-theme-xs"
        />
        <ChartTooltip
          cursor={{ fill: "var(--color-gray-100)" }}
          content={<ChartTooltipContent indicator="line" />}
        />
        <Bar dataKey="نسبة" fill="var(--color-brand-500)" radius={[6, 6, 0, 0]} maxBarSize={44} />
      </BarChart>
    </ChartContainer>
  );
}
