"use client";

import { useState, useTransition } from "react";
import { Loader2, UserCheck, UserMinus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { toggleMyAvailability } from "@/lib/actions/staff-self";

/**
 * زرّ «متواجد / غير متواجد».
 *
 * ── لماذا زرّ لا شارة ──────────────────────────────────────────────
 * كانت الحالة تُعرض شارةً للقراءة فقط، فيبقى الموظف مُتاحاً للتكليف وهو
 * ليس كذلك — أو ينتظر أدمناً ليضبط علماً عنه. راجع تعليق
 * `lib/services/staff-self.ts`: المواصفة تمنحه هذه الكتابة، والمُنفَّذ كان
 * ينقصها.
 *
 * ── ⚠️ الحالة المتفائلة **مع تراجع عند الفشل** ────────────────────
 * انتظار الشبكة قبل تغيير الشكل يجعل الزرّ يبدو ميّتاً لجزء من ثانية،
 * فيُنقر ثانيةً. والتفاؤل بلا تراجع أسوأ: يقول «غير متواجد» والخادم رفض،
 * فيظنّ الموظف نفسه معفىً وهو مُسنَدٌ إليه العمل. فالقيمة تُقلب فوراً
 * **وتُعاد** إن لم يُقبل التغيير.
 *
 * ── والرسالة عربية من الخادم ───────────────────────────────────────
 * §11.4 يمنع عرض رموز خام. الرفض الوحيد المتوقّع هنا — «لا ملفّ وظيفي» —
 * يأتي بنصّه من الخدمة لا يُصاغ هنا، فلا تتفرّق صياغتان لنفس السبب.
 */
export function AvailabilityToggle({ initial }: { initial: boolean }) {
  const [available, setAvailable] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const flip = () => {
    const next = !available;
    setAvailable(next);
    setError(null);

    startTransition(async () => {
      const out = await toggleMyAvailability(next);
      if (!out.ok) {
        setAvailable(!next); // تراجع
        setError(out.message ?? "تعذّر تغيير حالة التواجد.");
        return;
      }
      // الخادم هو المرجع: لو اختلفت قيمته عن تفاؤلنا فهي التي تبقى
      setAvailable(out.isAvailable);
    });
  };

  const Icon = available ? UserCheck : UserMinus;

  return (
    <div className="flex flex-col items-start gap-1.5">
      <Button
        type="button"
        variant="outline"
        onClick={flip}
        disabled={pending}
        aria-pressed={available}
        className={cn(
          "gap-2 transition-colors",
          available
            ? "border-occupancy-owner/40 bg-occupancy-owner/10 text-occupancy-owner hover:bg-occupancy-owner/15"
            : "text-muted-foreground",
        )}
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <Icon className="size-4" aria-hidden />
        )}
        {available ? "متواجد" : "غير متواجد"}
      </Button>

      {/*
       * ⚠️ نصٌّ يقول **ماذا يعني** الزرّ لا ما يفعله. «غير متواجد» وحدها
       * لا تخبر الموظف أن الأثر هو ألّا يُسنَد إليه عمل جديد — وهو الشيء
       * الذي يقرّر من أجله.
       */}
      <p className="text-theme-xs text-muted-foreground">
        {available
          ? "تظهر في قوائم التكليف."
          : "لا تُسنَد إليك طلبات جديدة حتى تعود."}
      </p>

      {error ? (
        <p role="alert" className="text-theme-xs text-money-overdue">
          {error}
        </p>
      ) : null}
    </div>
  );
}
