"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { linkResidentAction, unlinkResidentAction } from "./actions";
import { Button } from "@/components/ui/button";
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
import { RESIDENT_RELATION_AR } from "@/lib/labels";

/** ربط ساكن بشقة — R11 يسمح بأكثر من شقة للشخص الواحد. */
export function LinkDialog({
  userId,
  fullName,
  apartments,
}: {
  userId: string;
  fullName: string;
  apartments: Array<{ id: string; displayNumber: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [apartmentId, setApartmentId] = useState(apartments[0]?.id ?? "");
  const [relationType, setRelationType] = useState<"FAMILY_MEMBER" | "OTHER">("OTHER");
  const [isContractHolder, setHolder] = useState(false);

  if (apartments.length === 0) return null;

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="xs">
          ربط بشقة
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>ربط «{fullName}» بشقة</AlertDialogTitle>
          <AlertDialogDescription>
            الشخص الواحد قد يُربط بأكثر من شقة (‏R11) — مالك يسكن واحدة ويؤجّر أخرى.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex flex-col gap-3">
          <Field label="الشقة" htmlFor="link-apartment">
            <NativeSelect
              id="link-apartment"
              value={apartmentId}
              onChange={(e) => setApartmentId(e.target.value)}
            >
              {apartments.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.displayNumber}
                </option>
              ))}
            </NativeSelect>
          </Field>

          <Field label="صفة الإقامة" htmlFor="link-relation">
            <NativeSelect
              id="link-relation"
              value={relationType}
              onChange={(e) => setRelationType(e.target.value as typeof relationType)}
            >
              {Object.entries(RESIDENT_RELATION_AR).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </Field>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={isContractHolder}
              onChange={(e) => setHolder(e.target.checked)}
              className="mt-1 size-4 accent-primary"
            />
            <span>
              صاحب العقد
              <span className="block text-xs text-muted-foreground">
                واحد فقط لكل شقة — يرفض النظام الثاني.
              </span>
            </span>
          </label>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>إلغاء</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(e) => {
              e.preventDefault();
              setError(null);
              start(async () => {
                const r = await linkResidentAction({
                  apartmentId,
                  userId,
                  relationType,
                  isContractHolder,
                });
                if (r.ok) setOpen(false);
                else setError(r.error.message);
              });
            }}
          >
            {pending ? "جارٍ الربط…" : "ربط"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * إخراج ساكن.
 *
 * ⚠️ **`R13` تنبيه لا إجراء تلقائي.** إخراج آخر ساكن نشط يُطالب الأدمن
 * بضبط الشقة `VACANT` — ولا يفعلها النظام، لأن الإخلاء قرار إداري له أثر
 * مالي مباشر: يوقف كل الاشتراكات الدورية.
 *
 * والمطالبة تُعرض في **حوار يبقى** لا في تنبيه عابر: الرسالة التي تختفي
 * بعد ثوانٍ هي بالضبط الرسالة التي لا يقرأها أحد، والنتيجة شقة فارغة
 * تُفوتَر شهوراً.
 */
export function UnlinkButton({
  apartmentResidentId,
  fullName,
  apartmentNumber,
}: {
  apartmentResidentId: string;
  fullName: string;
  apartmentNumber: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState(false);

  return (
    <>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="ghost" size="xs" disabled={pending}>
            {pending ? "…" : "إخراج"}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>إخراج ساكن</AlertDialogTitle>
            <AlertDialogDescription>
              سيُسجَّل خروج «{fullName}» من الشقة «{apartmentNumber}» بتاريخ اليوم.
              سجلّه وتاريخه يبقيان، ويمكن ربطه من جديد لاحقاً.
              <strong className="mt-2 block">
                حالة سكن الشقة لا تتغيّر تلقائياً — الإخلاء قرارك أنت.
              </strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setError(null);
                start(async () => {
                  const r = await unlinkResidentAction(apartmentResidentId);
                  if (!r.ok) {
                    setError(r.error.message);
                    return;
                  }
                  if (r.data.promptSetVacant) setPrompt(true);
                });
              }}
            >
              إخراج
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* R13: المطالبة بعد نجاح إخراج آخر ساكن */}
      <AlertDialog open={prompt} onOpenChange={setPrompt}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>لم يبق ساكن في «{apartmentNumber}»</AlertDialogTitle>
            <AlertDialogDescription>
              خرج آخر ساكن نشط. حالة السكن ما زالت كما هي، و<strong>الاشتراكات
              الدورية ما زالت تُفوتَر</strong>. إن كانت الشقة أُخليت فعلاً فاضبطها
              «فارغة» من شاشة الشقق لإيقاف الفوترة.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>لاحقاً</AlertDialogCancel>
            <AlertDialogAction asChild>
              <Link href="/admin/apartments">الذهاب إلى الشقق</Link>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </>
  );
}
