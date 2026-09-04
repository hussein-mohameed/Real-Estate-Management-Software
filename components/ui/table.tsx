"use client"

import * as React from "react"

import { cn } from "@/lib/cn"

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div
      data-slot="table-container"
      /*
       * ⚠️ `min-w-0`: هذه الحاوية قد تكون عنصر flex، وافتراض عنصر الـflex
       * `min-width: auto` يجعله يرفض الانكماش دون عرض محتواه — فلا ينزلق
       * الجدول بل تنزلق الصفحة. انظر `tests/unit/overflow.test.ts`.
       */
      className="relative w-full min-w-0 overflow-x-auto"
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b border-line-soft transition-colors hover:bg-gray-50 dark:hover:bg-white/[0.03] has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        /*
         * ⚠️ رأس الجدول **نصّ لا شريط ملوّن**.
         * التعبئة الرمادية خلف الرأس تصنع كتلة تنافس المحتوى على النظر؛
         * والنصّ الصغير الرمادي يقول «هذا عنوان عمود» ثم يختفي — وهو
         * المطلوب: العين تنزل إلى البيانات لا تتوقّف عند الرأس.
         */
        "px-5 py-3 text-start align-middle text-theme-xs font-medium whitespace-nowrap text-gray-500 dark:text-gray-400 [&:has([role=checkbox])]:pe-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        /* حشوة `py-4` لا `p-2`: الصفوف المتلاصقة تُقرأ ككتلة واحدة */
        "px-5 py-4 align-middle text-theme-sm whitespace-nowrap [&:has([role=checkbox])]:pe-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
