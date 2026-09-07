"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  requestMyCancellation,
  withdrawMyCancellation,
} from "@/lib/actions/resident-subscriptions";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  «طلب إلغاء» — زرّ الساكن على صفّ اشتراكه.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ⚠️ حوارٌ لا ضغطة واحدة ──────────────────────────────────────────
 * الإلغاء يوقف خدمةً قد تكون مرتبطة بالتزام. وزرٌّ يُرسل بضغطةٍ في صفّ
 * جدولٍ يُضغَط بالخطأ عند القصد إلى الصفّ المجاور — والتراجع يحتاج مراجعة
 * الإدارة.
 *
 * ── والنصّ يقول **ما لا يحدث** ──────────────────────────────────────
 * ⚠️ «طلب إلغاء» لا «إلغاء»: الاشتراك يبقى نشطاً ويُفوتَر حتى يقرّر
 * الأدمن. وزرٌّ اسمه «إلغاء» يجعل الساكن يظنّ أن الفوترة توقّفت اليوم، ثم
 * يرى قيداً جديداً في كشفه فيشتكي — والشكوى محقّة، فالشاشة وعدته.
 */

export function RequestCancelButton({
  subscriptionId,
  serviceName,
}: {
  subscriptionId: string;
  serviceName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(): void {
    setError(null);
    start(async () => {
      const result = await requestMyCancellation({
        subscriptionId,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });

      if (!result.ok) {
        setError(result.message);
        return;
      }

      setOpen(false);
      setReason("");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          طلب إلغاء
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>طلب إلغاء «{serviceName}»</DialogTitle>
          <DialogDescription>
            {/*
              ⚠️ الجملة الثانية هي الأهمّ: بلا قولها يظنّ الساكن أن
              الفوترة توقّفت اليوم.
            */}
            يصل الطلب إلى الإدارة لتقرّره. والاشتراك يبقى فعّالاً وتستمرّ
            فوترته حتى تُقبل.
          </DialogDescription>
        </DialogHeader>

        <Field label="السبب" htmlFor="cancel-reason" hint="اختياريّ">
          <Textarea
            id="cancel-reason"
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-describedby="cancel-reason-hint"
            placeholder="مثلاً: لم أعد بحاجة إليها."
          />
        </Field>

        {error ? (
          <p role="alert" className="text-theme-sm text-destructive">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            تراجع
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? "…" : "إرسال الطلب"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * «سحب الطلب» — لصاحب الطلب وحده.
 *
 * ── ⚠️ بلا حوار تأكيد — بخلاف «طلب إلغاء» ───────────────────────────
 * التأكيد يُوضَع أمام ما **يصعب التراجع عنه**. والسحب هو التراجع نفسه:
 * يُعيد الحال إلى ما كان، وإعادةُ الطلب ضغطة. وحوارٌ فوق فعلٍ آمن يُعلّم
 * المستخدم أن يضغط «تأكيد» بلا قراءة — فيضعف التأكيد حيث يلزم فعلاً.
 */
export function WithdrawCancelButton({ subscriptionId }: { subscriptionId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <span className="flex flex-col items-end gap-1">
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const result = await withdrawMyCancellation(subscriptionId);
            if (!result.ok) {
              setError(result.message);
              return;
            }
            router.refresh();
          })
        }
      >
        {pending ? "…" : "سحب الطلب"}
      </Button>
      {error ? (
        <span role="alert" className="text-theme-xs text-destructive">
          {error}
        </span>
      ) : null}
    </span>
  );
}
