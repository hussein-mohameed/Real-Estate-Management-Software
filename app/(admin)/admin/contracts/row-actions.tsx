"use client";

import { useState, useTransition } from "react";
import { activateContractAction, endContractAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Field } from "@/components/ui/field";
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
 * أفعال صفّ العقد: التفعيل والإنهاء.
 *
 * §11.2: كل فعل مؤثّر يفتح حواراً **يذكر الأثر بالضبط بالعربية**.
 */

export function ActivateButton({
  contractId,
  contractNumber,
  apartment,
}: {
  contractId: string;
  contractNumber: string;
  apartment: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="flex flex-col gap-1">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="xs" disabled={pending}>
            {pending ? "…" : "تفعيل"}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>تفعيل العقد</AlertDialogTitle>
            <AlertDialogDescription>
              سيصبح العقد «{contractNumber}» نشطاً على الشقة «{apartment}»،
              و<strong>يُفتح له حساب مالي جديد برصيد صفر</strong> في العملية نفسها.
              الإشغال لا يتغيّر — لبدء الفوترة عيّن حالة السكن من شاشة الشقق.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setError(null);
                start(async () => {
                  const r = await activateContractAction(contractId);
                  if (!r.ok) setError(r.error.message);
                });
              }}
            >
              تفعيل وفتح الحساب
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

export function EndButton({
  contractId,
  contractNumber,
  apartment,
}: {
  contractId: string;
  contractNumber: string;
  apartment: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<"EXPIRED" | "TERMINATED">("EXPIRED");
  const [reason, setReason] = useState("");
  /**
   * §7.11/3: الرصيد غير الصفري **يحذّر ويطلب تأكيداً — ولا يمنع**.
   * الخادم هو من يقرّر: أول محاولة بلا تأكيد ترجع برسالة تذكر المبلغ،
   * فنعرضها ونُظهر خانة التأكيد. لا نحسب الرصيد هنا ولا نخمّنه — الرقم
   * الذي يراه الأدمن هو رقم الخادم لحظةَ الإغلاق لا نسخة قديمة منه.
   */
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [open, setOpen] = useState(false);

  const run = (confirmNonZeroBalance: boolean) => {
    setError(null);
    start(async () => {
      const r = await endContractAction(contractId, outcome, reason, confirmNonZeroBalance);
      if (r.ok) {
        setOpen(false);
        setNeedsConfirm(false);
        return;
      }
      setError(r.error.message);
      // الرسالة التي تطلب التأكيد تذكر التجميد صراحةً
      if (r.error.message.includes("أكّد الإغلاق")) setNeedsConfirm(true);
    });
  };

  return (
    <span className="flex flex-col gap-1">
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <Button variant="outline" size="xs" disabled={pending}>
            {pending ? "…" : "إنهاء"}
          </Button>
        </AlertDialogTrigger>

        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>إنهاء العقد «{contractNumber}»</AlertDialogTitle>
            <AlertDialogDescription>
              على الشقة «{apartment}»: تُلغى اشتراكات <strong>هذا الحساب وحده</strong>،
              ويُغلق الحساب و<strong>يُجمَّد رصيده ولا يُنقَل</strong>، ويخرج السكان،
              وتُلغى باجات سيارات الشقة، وتصبح الشقة فارغة.
              الحساب ودفتره يبقيان مقروءَين في تاريخ الشقة للأبد.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="flex flex-col gap-3">
            <Field label="سبب الإنهاء" htmlFor="outcome">
              <NativeSelect
                id="outcome"
                value={outcome}
                onChange={(e) => setOutcome(e.target.value as typeof outcome)}
              >
                <option value="EXPIRED">انتهاء طبيعي بانقضاء المدّة</option>
                <option value="TERMINATED">إنهاء مبكر بقرار</option>
              </NativeSelect>
            </Field>

            <Field label="ملاحظة" htmlFor="reason" hint="تُسجَّل في العقد وسجلّ التدقيق">
              <Input
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                aria-describedby="reason-hint"
              />
            </Field>

            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            {/* ⚠️ `onSelect` ممنوع من الإغلاق التلقائي: الحوار يجب أن يبقى
                مفتوحاً ليعرض رسالة الرصيد ثم يطلب التأكيد. */}
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                run(needsConfirm);
              }}
              disabled={pending}
            >
              {needsConfirm ? "تأكيد الإغلاق مع الرصيد" : "إنهاء العقد"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </span>
  );
}
