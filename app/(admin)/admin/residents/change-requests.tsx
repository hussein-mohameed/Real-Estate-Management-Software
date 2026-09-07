"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Ltr } from "@/components/ui/ltr";
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
import { approveChangeAction, rejectChangeAction } from "./actions";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  طلبات تعديل البيانات — بطاقة المراجعة.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ⚠️ **القديم والجديد معاً** لا الجديد وحده ──────────────────────
 * الحمولة تحفظ `from` و`to` لكل حقل. وعرضُ الجديد وحده يجعل الأدمن يوافق
 * بلا أن يرى ما يُستبدَل — وأخطرُه الهاتف: رقمٌ يُقارَب رقمَه القديم بخانة
 * لا يُميَّز إلا بوضعهما جنباً إلى جنب.
 *
 * ── والموافقة **تُطبّق** ────────────────────────────────────────────
 * لا تُعلّم الطلب مقبولاً وتترك الإدخال للأدمن — راجع
 * `approveResidentRequest`: التطبيق والقرار في معاملة واحدة.
 */

interface ChangeRow {
  id: string;
  createdAt: string;
  requesterName: string;
  requesterPhone: string;
  changes: { label: string; from: string; to: string }[];
  note: string | null;
}

export function ChangeRequestsCard({ rows }: { rows: readonly ChangeRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  if (rows.length === 0) return null;

  function run(fn: () => Promise<{ ok: boolean; error?: { message: string } }>): void {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        setError(r.error?.message ?? "تعذّر إكمال الفعل.");
        return;
      }
      setOpenId(null);
      setReason("");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-warning-200 bg-warning-25 p-5 dark:border-warning-500/30 dark:bg-warning-500/5">
      <div className="flex items-center gap-2">
        <h2 className="text-theme-sm font-semibold">طلبات تعديل بيانات</h2>
        <Badge variant="warning">
          <span className="tabular">{rows.length}</span> بانتظار القرار
        </Badge>
      </div>

      <ul className="flex flex-col divide-y">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-start gap-4 py-3 first:pt-0">
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{r.requesterName}</span>
              <span className="tabular block text-theme-xs text-muted-foreground">
                <Ltr>{r.requesterPhone}</Ltr> · <Ltr>{r.createdAt}</Ltr>
              </span>

              <ul className="mt-2 flex flex-col gap-1">
                {r.changes.map((c) => (
                  <li key={c.label} className="text-theme-sm">
                    <span className="text-muted-foreground">{c.label}:</span>{" "}
                    {/* ⚠️ القديم مشطوب والجديد بعده — الفرق يُرى لا يُقرأ */}
                    <span className="text-muted-foreground line-through">
                      <Ltr>{c.from}</Ltr>
                    </span>{" "}
                    <span className="font-medium">
                      <Ltr>{c.to}</Ltr>
                    </span>
                  </li>
                ))}
              </ul>

              {r.note ? (
                <span className="mt-1 block text-theme-xs text-muted-foreground">
                  السبب: {r.note}
                </span>
              ) : null}
            </span>

            <span className="flex items-center gap-2">
              <Button
                size="xs"
                disabled={pending}
                className="gap-1"
                onClick={() => run(() => approveChangeAction(r.id))}
              >
                <Check className="size-3" />
                تطبيق
              </Button>

              <AlertDialog
                open={openId === r.id}
                onOpenChange={(next) => {
                  setOpenId(next ? r.id : null);
                  if (!next) setReason("");
                }}
              >
                <AlertDialogTrigger asChild>
                  <Button size="xs" variant="outline" disabled={pending} className="gap-1">
                    <X className="size-3" />
                    رفض
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>رفض طلب «{r.requesterName}»</AlertDialogTitle>
                    <AlertDialogDescription>
                      {/* ⚠️ السبب إلزاميّ في المخطّط: بلاه يعيد الساكن الطلب نفسه */}
                      يظهر السبب للساكن في صفحة ملفّه — بلاه يعيد الطلب نفسه.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <div className="space-y-1.5">
                    <Label htmlFor={`rej-${r.id}`}>السبب</Label>
                    <Textarea
                      id={`rej-${r.id}`}
                      rows={2}
                      maxLength={500}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="الرقم الجديد يخصّ شخصاً آخر — راجعنا بهويّتك."
                    />
                  </div>
                  <AlertDialogFooter>
                    <AlertDialogCancel>تراجع</AlertDialogCancel>
                    <Button
                      disabled={reason.trim().length < 3}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={() => run(() => rejectChangeAction(r.id, reason))}
                    >
                      رفض الطلب
                    </Button>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </span>
          </li>
        ))}
      </ul>

      {error ? (
        <p role="alert" className="text-theme-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
