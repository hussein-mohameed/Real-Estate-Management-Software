import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * صفحة «غير موجود».
 *
 * ⚠️ **بلا هذا الملف يعرض Next صفحته الافتراضية: «404 — This page could not
 * be found»، بالإنكليزية ومن اليسار إلى اليمين**، داخل نظام عربي بالكامل.
 * لا يفشل بناء ولا اختبار ولا فحص أنواع — الصفحة موجودة، لكنها ليست من
 * هذا النظام. يراها المستخدم عند أول رابط قديم أو معرّف محذوف.
 *
 * والرسالة تقترح فعلاً بدل أن تعتذر: المستخدم وصل إلى هنا وهو يبحث عن شيء.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 p-6 text-center">
      <div className="space-y-2">
        <p className="tabular text-5xl font-semibold text-muted-foreground">404</p>
        <h1 className="text-lg font-semibold">الصفحة غير موجودة</h1>
        <p className="text-sm text-muted-foreground">
          الرابط قد يكون قديماً، أو أن العنصر حُذف أو لم يعد لك صلاحية عليه.
        </p>
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        <Button asChild>
          <Link href="/">العودة إلى البداية</Link>
        </Button>
      </div>
    </main>
  );
}
