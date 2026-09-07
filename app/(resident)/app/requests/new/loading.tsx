import { Skeleton } from "@/components/ui/skeleton";

/**
 * ⚠️ الهيكل يطابق **شكل النموذج** لا شكل جدول: صفّان من حقلين ثم منطقة
 * نصّ. وهيكلٌ لا يشبه ما سيحلّ محلّه يُنتج قفزةً في التخطيط عند وصوله.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-9 w-40" />
      <div className="grid gap-4 rounded-2xl border bg-card p-5 md:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16" />
        ))}
        <Skeleton className="h-16 md:col-span-2" />
        <Skeleton className="h-32 md:col-span-2" />
      </div>
      <Skeleton className="h-10 w-32" />
    </div>
  );
}
