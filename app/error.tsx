"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * حدود الخطأ للتطبيق.
 *
 * ── ما لا يُعرض هنا عمداً ────────────────────────────────────────────
 * ⚠️ **`error.message` لا يُعرض للمستخدم.** رسائل الأخطاء غير المتوقّعة
 * تأتي من المحرّك وقاعدة البيانات، وقد تحمل أسماء جداول وأعمدة وقيماً من
 * صفوف أخرى — أي **تسريب بيانات عبر نصّ خطأ**. أخطاء المجال المتوقّعة لها
 * مسارها الخاص: `ActionResult` برسالة عربية مكتوبة عمداً.
 *
 * ما يُعرض هو `digest` وحده: مُعرِّف يربط ما رآه المستخدم بما في سجلّ
 * الخادم، فيستطيع أن يقوله لمسؤول النظام بلا أن يحمل أي معلومة بذاته.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // السجلّ على الخادم يحمل التفصيل كاملاً؛ هنا نضمن ظهوره في المتصفّح
    // أثناء التطوير فقط.
    if (process.env.NODE_ENV !== "production") console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 p-6 text-center">
      <div className="space-y-2">
        <h1 className="text-lg font-semibold">حدث خطأ غير متوقَّع</h1>
        <p className="text-sm text-muted-foreground">
          لم تكتمل العملية. لم يُحفظ شيء ناقص — العمليات المالية كلها تجري في
          معاملة واحدة، فإما أن تتمّ كاملة أو تتراجع كاملة.
        </p>
      </div>

      {error.digest ? (
        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          رمز الحادثة: <span dir="ltr" className="tabular font-medium">{error.digest}</span>
          <span className="mt-1 block">اذكره لمسؤول النظام ليجده في السجلّ.</span>
        </p>
      ) : null}

      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={reset}>إعادة المحاولة</Button>
        <Button asChild variant="outline">
          {/*
            رابط صلب مقصود لا `Link`: نحن داخل حدود خطأ، وحالة العميل قد
            تكون هي المعطوبة. التنقّل من جهة العميل يحملها معه، وإعادة
            التحميل الكاملة تُنظّفها — وهذه هي وظيفة الزرّ هنا.
          */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/">العودة إلى البداية</a>
        </Button>
      </div>
    </main>
  );
}
