"use client"

import * as React from "react"
import { Progress as ProgressPrimitive } from "radix-ui"

import { cn } from "@/lib/cn"

function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-full bg-primary/20",
        className
      )}
      {...props}
    >
      {/*
        ⚠️ **`width` لا `transform: translateX`.**

        الأصل المستورد يكتب `translateX(-${100 - value}%)`: مؤشّرٌ بعرض
        كامل يُدفَع خارج الحاوية. و`translateX` **فيزيائي**: السالب يدفع
        يساراً في الاتجاهين. فيمتلئ الشريط في RTL من الحافّة **اليسرى** —
        أي عكس جهة البدء.

        قِيس في المتصفّح داخل حاوية `dir="rtl"`: بقيمة 25 لمس التعبئةُ
        الحافّة اليسرى ولم تلمس اليمنى. ولم يكشفه شيء لأن المكوّن لم
        يُستعمل بعد، ولأن `translateX` ليس صنفاً اتجاهياً يرصده فحص RTL.

        و`width` لا اتجاه له: العنصر يبدأ من جهة البدء في الاتجاهين.
      */}
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="h-full bg-primary transition-all"
        style={{ width: `${Math.min(100, Math.max(0, value ?? 0))}%` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
