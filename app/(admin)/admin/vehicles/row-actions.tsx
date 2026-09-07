"use client";

import { useState, useTransition } from "react";
import { Check, Trash2, X } from "lucide-react";
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
import type { VehicleStatus } from "@/lib/domain/enums";
import { approveVehicleAction, rejectVehicleAction, removeVehicleAction } from "./actions";

/**
 * أفعال صفّ المركبة.
 *
 * ── ⚠️ الأزرار مبنيّة على الحالة لا معطَّلة ─────────────────────────
 * المعلّقة تُعتمَد أو تُرفض. والمعتمَدة تُرفَع. والمرفوضة تُرفَع أيضاً —
 * **وهذا هو ما يُحرّر اللوحة** لتسجيلٍ جديد (‏S7)، فبلا زرٍّ عليها تبقى
 * اللوحة محجوزةً بقرار رفضٍ قديم بلا مخرج.
 *
 * ── والرفض يوجب سبباً ──────────────────────────────────────────────
 * ⚠️ إلزاميّ في المخطّط (`min(3)`) لا في الشاشة وحدها: رفضٌ بلا سبب لا
 * يُخبر الساكن بما يُصلحه، فيعيد التسجيل نفسه ويُرفض ثانيةً.
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

export function VehicleActions({
  vehicleId,
  plateNumber,
  status,
  apartmentNumber,
}: {
  vehicleId: string;
  plateNumber: string;
  status: VehicleStatus;
  apartmentNumber: string;
}) {
  const { pending, error, run } = useAct();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [reason, setReason] = useState("");

  /**
   * ⚠️ الحالة تُصفَّر عند الإغلاق: سببُ رفضٍ فشل يبقى مكتوباً في الحوار،
   * فيبدو محفوظاً وهو لم يُرسَل — ثم يُرسَل بالخطأ مع فعلٍ آخر.
   */
  const openReject = (next: boolean): void => {
    setRejectOpen(next);
    if (!next) setReason("");
  };
  const openRemove = (next: boolean): void => {
    setRemoveOpen(next);
    if (!next) setReason("");
  };

  if (status === "REMOVED") {
    /* ⚠️ لا زرّ: زرٌّ معطَّل يُقرأ «معطوب»، وغيابُه يُقرأ «لا ينطبق» */
    return <span className="text-theme-xs text-muted-foreground">—</span>;
  }

  return (
    <span className="flex flex-col items-start gap-1.5">
      <span className="flex flex-wrap items-center gap-2">
        {status === "PENDING_APPROVAL" ? (
          <>
            <Button
              size="xs"
              disabled={pending}
              className="gap-1"
              onClick={() => run(() => approveVehicleAction(vehicleId))}
            >
              <Check className="size-3" />
              اعتماد
            </Button>

            <AlertDialog open={rejectOpen} onOpenChange={openReject}>
              <AlertDialogTrigger asChild>
                <Button size="xs" variant="outline" disabled={pending} className="gap-1">
                  <X className="size-3" />
                  رفض
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>رفض اللوحة «{plateNumber}»</AlertDialogTitle>
                  <AlertDialogDescription>
                    {/*
                      ⚠️ تُقال العاقبة: اللوحة تبقى محجوزة بعد الرفض، ولا
                      تُحرَّر إلا بالرفع. وأدمنٌ يظنّ الرفض يُحرّرها يرفض
                      ثم يحتار لماذا يفشل التسجيل الجديد.
                    */}
                    يصل السبب إلى الساكن. واللوحة تبقى محجوزة بعد الرفض —
                    ارفعها إن أردت إتاحتها لتسجيل جديد.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="space-y-1.5">
                  <Label htmlFor={`reject-${vehicleId}`}>السبب</Label>
                  <Textarea
                    id={`reject-${vehicleId}`}
                    rows={2}
                    maxLength={500}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="اللوحة لا تطابق هوية المركبة."
                  />
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel>تراجع</AlertDialogCancel>
                  <Button
                    disabled={reason.trim().length < 3}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => run(() => rejectVehicleAction(vehicleId, reason))}
                  >
                    رفض
                  </Button>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        ) : null}

        <AlertDialog open={removeOpen} onOpenChange={openRemove}>
          <AlertDialogTrigger asChild>
            <Button size="xs" variant="outline" disabled={pending} className="gap-1">
              <Trash2 className="size-3" />
              رفع
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>رفع اللوحة «{plateNumber}»</AlertDialogTitle>
              <AlertDialogDescription>
                تُنهى علاقة المركبة بالشقة «{apartmentNumber}»، وتُتاح اللوحة
                لتسجيل جديد. والباج الساري يمنع الرفع حتى يُلغى.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor={`remove-${vehicleId}`}>السبب (اختياري)</Label>
              <Textarea
                id={`remove-${vehicleId}`}
                rows={2}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="بيعت السيارة."
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>تراجع</AlertDialogCancel>
              <Button
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => run(() => removeVehicleAction(vehicleId, reason))}
              >
                رفع المركبة
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </span>

      {error ? (
        <p role="alert" className="text-theme-xs text-destructive">
          {error}
        </p>
      ) : null}
    </span>
  );
}
