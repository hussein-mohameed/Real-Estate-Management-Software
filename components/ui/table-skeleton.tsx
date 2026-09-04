import { Skeleton } from "@/components/ui/skeleton";

/**
 * هيكل انتظار لصفحة قائمة.
 *
 * ── لماذا هيكل لا دوّارة ─────────────────────────────────────────────
 * الدوّارة تقول «انتظر» ولا تقول شيئاً آخر. الهيكل يرسم **الشكل الذي
 * سيأتي**، فلا تقفز الصفحة عند وصول البيانات ولا يفقد المستخدم موضع نظره.
 *
 * والأهمّ في نظامنا: الشاشات تقرأ من قاعدة بيانات **بعيدة** (‏Supabase)،
 * فزمن أول بايت ليس فورياً. بلا مؤشّر تبدو الصفحة معطوبة لا بطيئة —
 * فيضغط المستخدم الرابط مرّتين، ويُنشئ ما أنشأه.
 */
export function TableSkeleton({
  rows = 6,
  columns = 5,
  withFilters = true,
}: {
  rows?: number;
  columns?: number;
  withFilters?: boolean;
}) {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">جارٍ التحميل…</span>

      <header className="flex flex-col gap-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-24" />
      </header>

      {withFilters ? (
        <div className="grid gap-3 rounded-lg border p-4 md:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </div>
      ) : null}

      <div className="rounded-lg border">
        <div className="flex gap-4 border-b bg-muted p-3">
          {Array.from({ length: columns }, (_, i) => (
            <Skeleton key={i} className="h-4 flex-1" />
          ))}
        </div>
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="flex gap-4 border-b p-3 last:border-b-0">
            {Array.from({ length: columns }, (_, c) => (
              <Skeleton key={c} className="h-4 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
