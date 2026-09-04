"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, MessageSquare, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
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
import { REQUEST_STATUS_AR } from "@/lib/labels";
import type { RequestStatus } from "@/lib/domain/enums";
import { assignAction, commentAction, setStatusAction } from "../actions";

/**
 * أفعال صفحة الطلب.
 *
 * ── ⚠️ الإغلاق يوجب وصفاً لما فُعل ──────────────────────────────────
 * الخادم يرفضه بلا `resolutionNote` (‏تعريف إنجاز 4.4). والزرّ يُعطَّل هنا
 * أيضاً — لا ليحلّ محلّ الخادم بل ليقول الشرط قبل الرفض.
 *
 * ── والتعليق الداخلي يُعلَّم في الواجهة بوضوح ────────────────────────
 * ⚠️ من يكتب تعليقاً داخلياً يجب أن يعرف أنه داخلي **قبل** أن يكتب.
 * وخانةٌ صغيرة بلا شرح تجعل الموظف يكتب ما لا يريد أن يقرأه الساكن في
 * الحقل الخطأ.
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

export function AssignButton({
  requestId,
  staff,
  currentId,
}: {
  requestId: string;
  staff: readonly { userId: string; name: string }[];
  currentId: string | null;
}) {
  const { pending, error, setError, run } = useAct();
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState(currentId ?? "");

  return (
    <span className="flex flex-col items-start gap-1">
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setPick(currentId ?? "");
            setError(null);
          }
        }}
      >
        <AlertDialogTrigger asChild>
          <Button size="sm" variant="outline" disabled={pending} className="gap-1.5">
            <UserPlus className="size-3.5" />
            {currentId ? "تغيير المُكلَّف" : "إسناد"}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>إسناد الطلب</AlertDialogTitle>
            <AlertDialogDescription>
              {/*
                ⚠️ الإسناد **قرار ترخيص** لا تنظيم: الموظّف المُكلَّف بطلبٍ
                غير مغلق على شقة يرى تلك الشقة (‏D4). ومن يُسنِد يجب أن
                يعرف ذلك.
              */}
              الموظّف المُكلَّف يرى بيانات الشقة ما دام الطلب مفتوحاً. والمعطَّل
              لا يُكلَّف — لا يدخل النظام أصلاً.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor={`assign-${requestId}`}>الموظّف</Label>
            <NativeSelect
              id={`assign-${requestId}`}
              value={pick}
              onChange={(e) => setPick(e.target.value)}
            >
              <option value="">اختر موظفاً</option>
              {staff.map((s) => (
                <option key={s.userId} value={s.userId}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </div>

          {error ? (
            <p role="alert" className="text-theme-sm text-destructive">
              {error}
            </p>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <Button
              disabled={pending || pick === ""}
              onClick={() => run(() => assignAction(requestId, pick), () => setOpen(false))}
            >
              {pending ? "…" : "إسناد"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {error && !open ? (
        <span role="alert" className="text-theme-xs text-destructive">
          {error}
        </span>
      ) : null}
    </span>
  );
}

export function StatusButton({
  requestId,
  current,
  options,
}: {
  requestId: string;
  current: RequestStatus;
  options: readonly RequestStatus[];
}) {
  const { pending, error, setError, run } = useAct();
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState<RequestStatus>(current);
  const [note, setNote] = useState("");

  /* ⚠️ الوصف إلزامي للإغلاق — الخادم يرفض بدونه، والزرّ يقول ذلك سلفاً */
  const needsNote = next === "DONE";
  const ready = !needsNote || note.trim().length >= 3;

  return (
    <span className="flex flex-col items-start gap-1">
      <AlertDialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) {
            setNext(current);
            setNote("");
            setError(null);
          }
        }}
      >
        <AlertDialogTrigger asChild>
          <Button size="sm" disabled={pending} className="gap-1.5">
            <CheckCircle2 className="size-3.5" />
            تغيير الحالة
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>تغيير حالة الطلب</AlertDialogTitle>
            <AlertDialogDescription>
              المغلق لا يُعاد فتحه — يُنشَأ طلب جديد بدلاً منه. والإغلاق يحتاج
              وصفاً لما فُعل.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor={`st-${requestId}`}>الحالة</Label>
              <NativeSelect
                id={`st-${requestId}`}
                value={next}
                onChange={(e) => setNext(e.target.value as RequestStatus)}
              >
                {options.map((s) => (
                  <option key={s} value={s}>
                    {REQUEST_STATUS_AR[s]}
                  </option>
                ))}
              </NativeSelect>
            </div>

            {needsNote ? (
              <div className="space-y-1.5">
                <Label htmlFor={`note-${requestId}`}>
                  ماذا فُعل؟ — يُقرأ بعد شهر حين يُسأل عن هذا الطلب
                </Label>
                <Textarea
                  id={`note-${requestId}`}
                  rows={3}
                  maxLength={1000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="استُبدل صمّام الماء البارد وجُرّب لعشر دقائق."
                />
              </div>
            ) : null}
          </div>

          {error ? (
            <p role="alert" className="text-theme-sm text-destructive">
              {error}
            </p>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <Button
              disabled={pending || !ready || next === current}
              onClick={() =>
                run(() => setStatusAction(requestId, next, note), () => setOpen(false))
              }
            >
              {pending ? "…" : "حفظ"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {error && !open ? (
        <span role="alert" className="text-theme-xs text-destructive">
          {error}
        </span>
      ) : null}
    </span>
  );
}

export function CommentBox({ requestId }: { requestId: string }) {
  const { pending, error, run } = useAct();
  const [body, setBody] = useState("");
  const [isInternal, setIsInternal] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <div className="space-y-1.5">
        <Label htmlFor={`c-${requestId}`}>تعليق</Label>
        <Textarea
          id={`c-${requestId}`}
          rows={3}
          maxLength={2000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="ما جرى، أو ما يحتاجه الطلب."
        />
      </div>

      <label className="flex items-start gap-2 text-theme-sm">
        <input
          type="checkbox"
          checked={isInternal}
          onChange={(e) => setIsInternal(e.target.checked)}
          className="mt-1 size-4 accent-primary"
        />
        <span>
          داخلي — لا يراه الساكن
          <span className="block text-theme-xs text-muted-foreground">
            {/*
              ⚠️ الشرح قبل الكتابة لا بعدها: خانةٌ صغيرة بلا شرح تجعل
              الموظّف يكتب ما لا يريد أن يقرأه الساكن في الحقل الخطأ.
              والتصفية في الخادم لا في الشاشة — فلا يصل نصّه إلى متصفّحه.
            */}
            يبقى بين الموظفين والإدارة، ولا يُرسَل إلى متصفّح الساكن أصلاً.
          </span>
        </span>
      </label>

      {error ? (
        <p role="alert" className="text-theme-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div>
        <Button
          size="sm"
          disabled={pending || body.trim().length === 0}
          onClick={() =>
            run(() => commentAction(requestId, body, isInternal), () => {
              setBody("");
              setIsInternal(false);
            })
          }
          className="gap-1.5"
        >
          <MessageSquare className="size-3.5" />
          {pending ? "…" : "إضافة تعليق"}
        </Button>
      </div>
    </div>
  );
}
