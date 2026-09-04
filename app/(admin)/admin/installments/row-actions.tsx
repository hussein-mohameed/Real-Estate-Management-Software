"use client";

import { useState, useTransition } from "react";
import { BadgeCheck, PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { followUpAction, markPaidAction } from "./actions";

/**
 * أفعال صفّ القسط.
 *
 * ── ⚠️ السداد والمتابعة **فعلان لا فعل** ────────────────────────────
 * «كلّمتُه وسيدفع غداً» ليست سداداً. وزرٌّ واحد يفعل الاثنين كان يجعل
 * المتابعة **تُسقط الدَين** — وهو أخطر خلط ممكن في شاشة تحصيل.
 *
 * ── والسداد يذكر المبلغ ويقول إنه لا يُلغى ──────────────────────────
 * §11.2: الأثر بالضبط لا سؤال عام. تعليم القسط مدفوعاً يُنشئ **دفعة
 * وقيداً وفاتورة** في نفس اللحظة، والقيد لا يُحذف (‏R29) — يُصحَّح بقيد
 * معاكس بسبب مكتوب.
 */

function useAct() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (
    fn: () => Promise<{ ok: boolean; error?: { message: string } }>,
    onDone: () => void,
  ) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        setError(r.error?.message ?? "تعذّر إكمال الفعل.");
        return;
      }
      onDone();
    });
  };
  return { pending, error, setError, run };
}

export function InstallmentActions({
  installmentId,
  sequence,
  amountLabel,
  holderName,
}: {
  installmentId: string;
  sequence: number;
  /** المبلغ منسَّقاً — يُبنى في الخادم كي لا يُنسَّق المال في مكانين. */
  amountLabel: string;
  holderName: string;
}) {
  const { pending, error, setError, run } = useAct();
  const [payOpen, setPayOpen] = useState(false);
  const [followOpen, setFollowOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [note, setNote] = useState("");

  /*
   * ⚠️ تُصفَّر الحالة عند الإغلاق: نصٌّ كُتب ولم يُرسَل يبقى ظاهراً في
   * الفتحة التالية فيبدو محفوظاً — وهو لم يصل إلى الخادم قطّ.
   */
  const openPay = (next: boolean) => {
    setPayOpen(next);
    if (!next) {
      setNotes("");
      setError(null);
    }
  };
  const openFollow = (next: boolean) => {
    setFollowOpen(next);
    if (!next) {
      setNote("");
      setError(null);
    }
  };

  return (
    <span className="flex flex-col items-start gap-1.5">
      <span className="flex flex-wrap items-center gap-2">
        <AlertDialog open={payOpen} onOpenChange={openPay}>
          <AlertDialogTrigger asChild>
            <Button size="xs" disabled={pending} className="gap-1">
              <BadgeCheck className="size-3" />
              سداد
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>تعليم القسط {sequence} مدفوعاً</AlertDialogTitle>
              <AlertDialogDescription>
                ستُسجَّل دفعة بـ{amountLabel} على حساب {holderName}، ويُقيَّد
                السداد وتُصدَر فاتورة — كلّها الآن. والقيد لا يُحذف بعدها؛
                يُصحَّح بقيد معاكس بسبب مكتوب.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="space-y-1.5">
              <Label htmlFor={`pay-${installmentId}`}>ملاحظة (اختيارية)</Label>
              <Textarea
                id={`pay-${installmentId}`}
                rows={2}
                maxLength={300}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="استُلم نقداً في المركز"
              />
            </div>

            <AlertDialogFooter>
              <AlertDialogCancel>إلغاء</AlertDialogCancel>
              <Button
                disabled={pending}
                onClick={() =>
                  run(() => markPaidAction(installmentId, notes), () => openPay(false))
                }
              >
                {pending ? "…" : "تسجيل السداد"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={followOpen} onOpenChange={openFollow}>
          <AlertDialogTrigger asChild>
            <Button size="xs" variant="outline" disabled={pending} className="gap-1">
              <PhoneCall className="size-3" />
              متابعة
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>تسجيل متابعة على القسط {sequence}</AlertDialogTitle>
              <AlertDialogDescription>
                {/*
                  ⚠️ يُقال صراحةً إنه **لا أثر مالي**: من يفتح هذا الحوار
                  بعد مكالمة قد يظنّ أنه سجّل سداداً.
                */}
                تُسجَّل الملاحظة باسمك وتاريخها. <strong>لا</strong> تُقيَّد دفعة ولا
                يتغيّر الرصيد — هذه متابعة تحصيل لا سداد.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="space-y-1.5">
              <Label htmlFor={`follow-${installmentId}`}>ما جرى</Label>
              <Textarea
                id={`follow-${installmentId}`}
                rows={2}
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="اتُّصل به ووعد بالدفع نهاية الأسبوع"
              />
            </div>

            <AlertDialogFooter>
              <AlertDialogCancel>إلغاء</AlertDialogCancel>
              <Button
                variant="outline"
                disabled={pending || note.trim().length < 3}
                onClick={() =>
                  run(() => followUpAction(installmentId, note), () => openFollow(false))
                }
              >
                {pending ? "…" : "حفظ المتابعة"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </span>

      {error ? (
        <span role="alert" className="text-theme-xs text-destructive">
          {error}
        </span>
      ) : null}
    </span>
  );
}
