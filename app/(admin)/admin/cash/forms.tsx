"use client";

import { useActionState, useState, useTransition } from "react";
import { Banknote, LockKeyhole, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Money } from "@/components/ui/money";
import { NativeSelect } from "@/components/ui/native-select";
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
import type { ActionResult } from "@/lib/result";
import { closeDrawerAction, openDrawerAction, recordPaymentAction } from "./actions";

/**
 * نماذج شاشة النقد.
 *
 * ⚠️ **الترتيب على الشاشة يتبع الترتيب الإلزامي:** لا دفعة بلا صندوق
 * مفتوح (‏B4). فالزرّ الوحيد الظاهر قبل الفتح هو «افتح صندوقي»، ولا يُعرض
 * نموذج دفع مُعطَّل — الحقل المُعطَّل يُقرأ «معطوب» لا «غير متاح بعد».
 */

export function OpenDrawerButton() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          start(async () => {
            const r = await openDrawerAction();
            if (!r.ok) setError(r.error.message);
          });
        }}
        className="gap-2"
      >
        <Wallet className="size-4" />
        {pending ? "…" : "افتح صندوقي"}
      </Button>
      {error ? (
        <p role="alert" className="text-theme-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface AccountOption {
  id: string;
  label: string;
  balanceIqd: bigint;
}

export function RecordPaymentForm({ accounts }: { accounts: readonly AccountOption[] }) {
  const [state, action, pending] = useActionState<ActionResult<unknown> | null, FormData>(
    recordPaymentAction,
    null,
  );

  if (accounts.length === 0) {
    return (
      <p className="text-theme-sm text-muted-foreground">
        لا حسابات مفتوحة. الحساب يُفتح بتفعيل عقد.
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="accountId">الحساب</Label>
          <NativeSelect id="accountId" name="accountId" required defaultValue="">
            <option value="" disabled>
              اختر الحساب
            </option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </NativeSelect>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="amountIqd">المبلغ (دينار)</Label>
          {/*
            ⚠️ `inputMode="numeric"` لا `type="number"`: الأخير يسمح
            بالأسّ العلمي وبعجلة الفأرة التي تغيّر مبلغاً بالخطأ، ويُنسّق
            بلغة المتصفّح. والقيمة تُرسل نصّاً وتُقرأ `BigInt` في الخادم.
          */}
          <Input
            id="amountIqd"
            name="amountIqd"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="50000"
            required
            className="tabular"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="paymentNotes">ملاحظة (اختيارية)</Label>
        <Textarea id="paymentNotes" name="notes" rows={2} maxLength={300} />
      </div>

      {state && !state.ok ? (
        <p role="alert" className="text-theme-sm text-destructive">
          {state.error.message}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending} className="gap-2">
          <Banknote className="size-4" />
          {pending ? "…" : "تسجيل الدفعة"}
        </Button>
        <span className="text-theme-xs text-muted-foreground">
          تُصدَر فاتورة برقمها تلقائياً، وتُقيَّد على حساب العقد في نفس اللحظة.
        </span>
      </div>
    </form>
  );
}

const FORM_ID = "close-drawer-form";

export function CloseDrawerForm({
  sessionId,
  expectedIqd,
}: {
  sessionId: string;
  expectedIqd: bigint;
}) {
  const [state, action, pending] = useActionState<ActionResult<unknown> | null, FormData>(
    closeDrawerAction,
    null,
  );
  const [declared, setDeclared] = useState("");

  /**
   * ⚠️ **الفرق يُحسب أمام عين الموظف قبل التأكيد.**
   * رقمٌ يظهر بعد الإقفال لا يُغيّر شيئاً — الورقة صدرت. وظهورُه أثناء
   * الكتابة يجعل الموظف يعدّ مرّةً ثانية قبل أن يُقرّ.
   */
  const parsed = /^[0-9]+$/.test(declared) ? BigInt(declared) : null;
  const variance = parsed === null ? null : parsed - expectedIqd;

  return (
    <form id={FORM_ID} action={action} className="flex flex-col gap-4">
      <input type="hidden" name="sessionId" value={sessionId} />

      <div className="space-y-1.5">
        <Label htmlFor="declaredIqd">المبلغ الذي تُقرّ بتوريده (دينار)</Label>
        <Input
          id="declaredIqd"
          name="declaredIqd"
          inputMode="numeric"
          pattern="[0-9]*"
          required
          value={declared}
          onChange={(e) => setDeclared(e.target.value)}
          className="tabular"
        />
      </div>

      {variance !== null ? (
        <p
          className={
            variance === 0n
              ? "text-theme-sm text-occupancy-owner"
              : "text-theme-sm text-money-overdue"
          }
        >
          {variance === 0n ? (
            "مطابق للمُسجَّل."
          ) : variance < 0n ? (
            <>
              نقص <Money value={-variance} /> عن المُسجَّل.
            </>
          ) : (
            <>
              زيادة <Money value={variance} /> عن المُسجَّل.
            </>
          )}
        </p>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="closeNotes">سبب الفرق إن وُجد</Label>
        <Textarea id="closeNotes" name="notes" rows={2} maxLength={300} />
      </div>

      {state && !state.ok ? (
        <p role="alert" className="text-theme-sm text-destructive">
          {state.error.message}
        </p>
      ) : null}

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button type="button" variant="outline" disabled={pending} className="gap-2">
            <LockKeyhole className="size-4" />
            {pending ? "…" : "إقفال الصندوق"}
          </Button>
        </AlertDialogTrigger>

        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>إقفال الصندوق</AlertDialogTitle>
            {/* §11.2: الأثر بالضبط لا سؤال عام */}
            <AlertDialogDescription>
              {variance === null
                ? "أدخل المبلغ الذي تُقرّ بتوريده أولاً."
                : variance === 0n
                  ? "سيُقفَل الصندوق مطابقاً للمُسجَّل. لا يُفتح بعدها ولا يُعدَّل."
                  : "سيُقفَل الصندوق ويُسجَّل الفرق باسمك. الإقفال لا يُلغى ولا يُعدَّل."}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            {/*
              ⚠️ **`form={FORM_ID}` لا بحثٌ في DOM.** الحوار يُصيَّر في
              بوّابة خارج شجرة النموذج، فزرّ إرسالٍ عاديّ لا يجد نموذجه.
              وسمة `form` في HTML تربط الزرّ بنموذج في أي موضع من المستند
              — قياسيّة ولا تكسرها إعادة هيكلة الشجرة.
            */}
            <AlertDialogAction
              type="submit"
              form={FORM_ID}
              disabled={variance === null}
            >
              إقفال
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
