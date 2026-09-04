import * as React from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/cn";

/**
 * حقل نموذج: تسمية + عنصر إدخال + تلميح + خطأ.
 *
 * ── لماذا مكوّن لا نسخ ولصق ─────────────────────────────────────────
 * تكرّر في الشاشات الأولى نمطُ `<label><span>…</span><input/></label>`
 * بنفس الأصناف منسوخة. النسخ يعني أن أي تصحيح — كإضافة `aria-invalid`
 * أو ربط رسالة الخطأ بالحقل — يجب أن يُطبَّق في كل موضع، ويُنسى في واحد.
 *
 * ── الاتجاه ─────────────────────────────────────────────────────────
 * `dir="ltr"` ليس تفصيلاً تجميلياً: حقلٌ يُدخَل فيه رقم هاتف أو قالب
 * مثل `{building}-{floor}-{unit}` يُعرَض معكوساً داخل سياق عربي، فيقرأه
 * المستخدم خطأً ويصحّح ما ليس خطأً. حدث هذا فعلاً مرّتين. الوسم هنا
 * يجعل الاتجاه **قراراً واعياً عند كل حقل** لا سهواً.
 */
function Field({
  label,
  hint,
  error,
  htmlFor,
  required,
  className,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: string;
  htmlFor?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const hintId = htmlFor ? `${htmlFor}-hint` : undefined;
  const errorId = htmlFor ? `${htmlFor}-error` : undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? (
          <span aria-hidden className="text-destructive">
            *
          </span>
        ) : null}
      </Label>

      {children}

      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}

      {error ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** يُمرَّر إلى عنصر الإدخال داخل `Field` لربط الوصف والخطأ به. */
function fieldA11y(htmlFor: string, opts: { hint?: boolean; error?: boolean }) {
  const described = [
    opts.hint ? `${htmlFor}-hint` : null,
    opts.error ? `${htmlFor}-error` : null,
  ].filter(Boolean);

  return {
    id: htmlFor,
    "aria-describedby": described.length ? described.join(" ") : undefined,
    "aria-invalid": opts.error ? (true as const) : undefined,
  };
}

export { Field, fieldA11y };
