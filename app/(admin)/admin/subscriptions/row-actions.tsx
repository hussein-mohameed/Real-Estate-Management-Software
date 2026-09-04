"use client";

import { useState, useTransition } from "react";
import { Check, Hash, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { approveAction, cancelAction, rejectAction, setQuantityAction } from "./actions";

/**
 * أفعال صفّ الاشتراك.
 *
 * ── ⚠️ الأثر بالضبط لا سؤال عام (‏§11.2) ────────────────────────────
 * «هل أنت متأكد؟» لا تكفي. الموافقة **تُقيّد مالاً فوراً**، والأدمن يجب
 * أن يقرأ المبلغ والحساب قبل أن يضغط. ولهذا يمرّ المبلغ إلى هنا.
 *
 * ── ولماذا الأزرار مبنيّة على الحالة لا معطَّلة ─────────────────────
 * المعلّق يُوافَق أو يُرفض. النشط يُلغى أو تُغيَّر كميته. والملغى **لا زرّ
 * له**: زرٌّ معطَّل يُقرأ «معطوب»، وغيابُه يُقرأ «لا ينطبق».
 */

function useAct() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error?.message ?? "تعذّر إكمال الفعل.");
    });
  };
  return { pending, error, run };
}

function ErrorLine({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-theme-xs text-destructive">
      {message}
    </p>
  );
}

export function PendingActions({
  subscriptionId,
  serviceName,
  apartmentNumber,
  amountLabel,
}: {
  subscriptionId: string;
  serviceName: string;
  apartmentNumber: string;
  /** المبلغ منسَّقاً — يُبنى في الخادم كي لا يُنسَّق المال في مكانين. */
  amountLabel: string;
}) {
  const { pending, error, run } = useAct();
  const [reason, setReason] = useState("");

  return (
    <span className="flex flex-col items-start gap-1.5">
      <span className="flex flex-wrap items-center gap-2">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="xs" disabled={pending} className="gap-1">
              <Check className="size-3" />
              موافقة
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>الموافقة على اشتراك</AlertDialogTitle>
              <AlertDialogDescription>
                {/*
                  ⚠️ الأثر المالي **بالرقم**. الموافقة تُقيّد الفترة الأولى
                  مقسَّطةً بالتناسب (‏B2) على حساب العقد في نفس اللحظة، ولا
                  تُلغى إلا بقيد معاكس.
                */}
                ستُقيَّد «{serviceName}» على حساب الشقة {apartmentNumber} فوراً.
                مبلغ الدورة الكاملة {amountLabel}، والفترة الأولى تُقسَّم
                بالتناسب حتى نهاية الدورة الحالية. القيد لا يُحذف بعدها.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>إلغاء</AlertDialogCancel>
              <Button onClick={() => run(() => approveAction(subscriptionId))}>
                موافقة وقيد
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="xs" variant="outline" disabled={pending} className="gap-1">
              <X className="size-3" />
              رفض
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>رفض الاشتراك</AlertDialogTitle>
              <AlertDialogDescription>
                لا يُقيَّد شيء، ويُسجَّل السبب في الطلب وفي التدقيق. السبب إلزامي.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor={`reject-${subscriptionId}`}>سبب الرفض</Label>
              <Textarea
                id={`reject-${subscriptionId}`}
                rows={2}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>إلغاء</AlertDialogCancel>
              <Button
                variant="outline"
                disabled={reason.trim().length < 3}
                onClick={() => run(() => rejectAction(subscriptionId, reason))}
              >
                رفض
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </span>
      <ErrorLine message={error} />
    </span>
  );
}

export function ActiveActions({
  subscriptionId,
  serviceName,
  isPerUnit,
  quantity,
}: {
  subscriptionId: string;
  serviceName: string;
  /** الكمية تُغيَّر لـ`PER_UNIT` وحدها — عدد الأفراد مشتقّ (‏Q5). */
  isPerUnit: boolean;
  quantity: number;
}) {
  const { pending, error, run } = useAct();
  const [qtyOpen, setQtyOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [qty, setQty] = useState(String(quantity));
  const [reason, setReason] = useState("");

  /**
   * ── ⚠️ الحوار مضبوط كي **تُصفَّر الحالة عند الإغلاق** ──────────────
   * `useState(String(quantity))` يقرأ الـprop **مرّة واحدة**. فبعد
   * `revalidatePath` يصل رقمٌ جديد من الخادم ولا تتحدّث الحالة: أدمنٌ
   * آخر يغيّر الكمية، ويُعاد فتح الحوار فيعرض القديمة — ويُحفظ عليها.
   *
   * وسببُ إلغاءٍ فشل يبقى مكتوباً في الحوار، فيبدو محفوظاً وهو لم يُرسَل.
   */
  const openQty = (next: boolean) => {
    setQtyOpen(next);
    if (!next) setQty(String(quantity));
  };
  const openCancel = (next: boolean) => {
    setCancelOpen(next);
    if (!next) setReason("");
  };

  const parsedQty = /^[0-9]+$/.test(qty) ? Number(qty) : null;

  return (
    <span className="flex flex-col items-start gap-1.5">
      <span className="flex flex-wrap items-center gap-2">
        {isPerUnit ? (
          <AlertDialog open={qtyOpen} onOpenChange={openQty}>
            <AlertDialogTrigger asChild>
              <Button size="xs" variant="outline" disabled={pending} className="gap-1">
                <Hash className="size-3" />
                الكمية
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>تغيير كمية «{serviceName}»</AlertDialogTitle>
                <AlertDialogDescription>
                  {/*
                    ⚠️ `R23`: القيود السابقة **لا تُمسّ**. التغيير يسري من
                    الدورة القادمة، وتعديل قيدٍ ماضٍ ممنوع في القاعدة أصلاً.
                  */}
                  تُكتب لقطة سعر جديدة ويسري المبلغ الجديد من الدورة
                  القادمة. القيود السابقة لا تتغيّر.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="space-y-1.5">
                <Label htmlFor={`qty-${subscriptionId}`}>الكمية</Label>
                <Input
                  id={`qty-${subscriptionId}`}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  className="tabular"
                />
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel>إلغاء</AlertDialogCancel>
                <Button
                  disabled={parsedQty === null || parsedQty < 1}
                  onClick={() =>
                    parsedQty !== null && run(() => setQuantityAction(subscriptionId, parsedQty))
                  }
                >
                  حفظ
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}

        <AlertDialog open={cancelOpen} onOpenChange={openCancel}>
          <AlertDialogTrigger asChild>
            <Button size="xs" variant="ghost" disabled={pending}>
              إلغاء
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>إلغاء «{serviceName}»</AlertDialogTitle>
              <AlertDialogDescription>
                {/*
                  ⚠️ ما استُهلك يُدفع. الإلغاء يوقف الفوترة القادمة ولا يمسّ
                  قيداً سابقاً — والرصيد يبقى مستحقاً.
                */}
                تتوقّف الفوترة القادمة. القيود السابقة تبقى، والرصيد المستحقّ
                لا يُلغى بالإلغاء.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor={`cancel-${subscriptionId}`}>السبب (اختياري)</Label>
              <Textarea
                id={`cancel-${subscriptionId}`}
                rows={2}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>تراجع</AlertDialogCancel>
              <Button
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => run(() => cancelAction(subscriptionId, reason))}
              >
                إلغاء الاشتراك
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </span>
      <ErrorLine message={error} />
    </span>
  );
}
