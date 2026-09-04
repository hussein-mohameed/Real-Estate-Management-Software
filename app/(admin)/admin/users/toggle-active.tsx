"use client";

import { useState, useTransition } from "react";
import { toggleActiveAction } from "./actions";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/**
 * تفعيل/تعطيل مستخدم.
 *
 * §11.2: كل فعل مؤثّر يفتح حوار تأكيد **يذكر الأثر بالضبط بالعربية**.
 * «هل أنت متأكد؟» لا تكفي — المستخدم يجب أن يقرأ ما سيحدث لمن.
 *
 * ⚠️ كان هذا `window.confirm`. المتصفّح يرسم أزراره بلغة **النظام** لا
 * لغة الصفحة، فكان المستخدم العربي يرى «OK / Cancel» ومحاذاةً لاتينية
 * داخل حوار عربي. الحوار هنا من مكوّناتنا، فالنصّ والاتجاه لنا.
 */
export function ToggleActiveButton({
  userId,
  fullName,
  isActive,
  isSelf,
}: {
  userId: string;
  fullName: string;
  isActive: boolean;
  isSelf: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (isSelf) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  const effect = isActive
    ? `سيُعطَّل «${fullName}» ولن يستطيع الدخول إلى النظام. سجلّه وتاريخه يبقيان.`
    : `سيُفعَّل «${fullName}» ويستطيع الدخول من جديد.`;

  return (
    <span className="flex items-center gap-2">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="outline" size="xs" disabled={pending}>
            {pending ? "…" : isActive ? "تعطيل" : "تفعيل"}
          </Button>
        </AlertDialogTrigger>

        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isActive ? "تعطيل مستخدم" : "تفعيل مستخدم"}
            </AlertDialogTitle>
            {/* الأثر بالضبط، لا سؤال عام */}
            <AlertDialogDescription>{effect}</AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              // التعطيل فعل هدم — يأخذ لون الخطر لا لون الإجراء الأساسي
              className={
                isActive
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : undefined
              }
              onClick={() => {
                setError(null);
                start(async () => {
                  const r = await toggleActiveAction(userId, !isActive);
                  if (!r.ok) setError(r.error.message);
                });
              }}
            >
              {isActive ? "تعطيل" : "تفعيل"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </span>
  );
}
