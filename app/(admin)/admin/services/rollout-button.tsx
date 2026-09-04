"use client";

import { useState, useTransition } from "react";
import { Users2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { applyRolloutAction, previewRolloutAction } from "./actions";
import type { RolloutPreview } from "./actions";

/**
 * تعميم خدمة إلزامية على الشقق المسكونة — الخطوة 2.6.
 *
 * ── ⚠️ لماذا معاينة قبل التنفيذ ─────────────────────────────────────
 * هذا **أخطر زرّ في النظام**: يُقيّد مالاً على مئات الحسابات بنقرة. أدمن
 * يضيف خدمة بـ50 ألفاً ظنّاً أنها تُطبَّق على الجديد وحده، فيكتشف بعد ساعة
 * أنه قيّد 15 مليوناً على 300 شقة.
 *
 * تعريف إنجاز 2.6 ينصّ عليه حرفياً: «يعرض **عدد الشقق والمبلغ الإجمالي
 * قبل التأكيد**».
 *
 * ── والمعاينة تُطلَب عند الفتح لا عند التحميل ────────────────────────
 * ⚠️ جلبُها لكل صفّ في الجدول يعني استعلاماً لكل خدمة إلزامية عند كل
 * تحميل للشاشة — وهي تُفتح كثيراً. الحوار يطلبها عند فتحه وحده.
 *
 * ── وزرّ التنفيذ يحمل العدد الذي رآه الأدمن ──────────────────────────
 * بين المعاينة والتأكيد قد تُسكن شقة أو تُخلى. الخادم يُقارن ويرفض إن
 * اختلف، ويطلب معاينة جديدة بدل أن يمضي على رقم لم يره أحد.
 */

export function RolloutButton({
  serviceId,
  serviceName,
}: {
  serviceId: string;
  serviceName: string;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<RolloutPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function load(next: boolean) {
    setOpen(next);
    if (!next) return;

    setPreview(null);
    setError(null);
    setDone(null);
    start(async () => {
      const r = await previewRolloutAction(serviceId);
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      /* المبلغ وصل منسَّقاً من الخادم — لا تنسيق للمال هنا (انظر `actions.ts`) */
      setPreview(r.data);
    });
  }

  function apply() {
    if (!preview) return;
    setError(null);
    start(async () => {
      const r = await applyRolloutAction(serviceId, preview.apartments);
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      setDone(
        `عُمّمت على ${r.data.apartments} شقة، وقُيّد ${r.data.chargedLabel}.`,
      );
      setPreview(null);
    });
  }

  return (
    <Dialog open={open} onOpenChange={load}>
      <DialogTrigger asChild>
        <Button variant="outline" size="xs" className="gap-1">
          <Users2 className="size-3" />
          تعميم
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>تعميم «{serviceName}» على الشقق المسكونة</DialogTitle>
          <DialogDescription>
            الفارغة لا تُفوتَر خدماتها الدورية، فلا تُعمَّم عليها. والشقق التي
            عليها هذه الخدمة سلفاً تُتخطّى.
          </DialogDescription>
        </DialogHeader>

        {pending && !preview ? (
          <p className="text-theme-sm text-muted-foreground">جارٍ حساب الأثر…</p>
        ) : null}

        {preview ? (
          <div className="flex flex-col gap-3 rounded-xl border bg-surface-muted/50 p-4">
            <p className="text-theme-sm">
              ستُنشأ على{" "}
              <span className="tabular font-semibold">{preview.apartments}</span> شقة.
            </p>
            <p className="text-theme-sm">
              وسيُقيَّد إجمالاً{" "}
              <span className="tabular font-semibold">{preview.totalLabel}</span>
            </p>
            <p className="text-theme-xs text-muted-foreground">{preview.note}</p>
          </div>
        ) : null}

        {done ? (
          <p role="status" className="text-theme-sm text-occupancy-owner">
            {done}
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="text-theme-sm text-destructive">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={() => load(false)}>
            إغلاق
          </Button>
          <Button
            /*
             * ⚠️ يُعطَّل حين لا شقّة هدفاً: زرٌّ ينفّذ على صفر يُقرأ نجاحاً
             * وهو لا شيء، فيظنّ الأدمن أن الخدمة عُمّمت.
             */
            disabled={pending || !preview || preview.apartments === 0}
            onClick={apply}
          >
            {pending ? "…" : "تأكيد التعميم"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
