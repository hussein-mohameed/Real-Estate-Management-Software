"use client";

import { useState, useTransition } from "react";
import { setConstructionAction, setOccupancyAction } from "./actions";
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
import { CONSTRUCTION_STATUS_AR, OCCUPANCY_STATUS_AR } from "@/lib/labels";

/**
 * تغيير محاور الشقة.
 *
 * ── لماذا حوار يذكر الأثر المالي ────────────────────────────────────
 * ⚠️ تغيير حالة السكن **ليس تعديل حقل**: هو الفعل الذي يبدأ تدفّق المال
 * ويوقفه (‏§7.3). «هل أنت متأكد؟» لا تكفي — الأدمن يجب أن يقرأ قبل
 * الضغط أن الإخلاء **يوقف الاشتراكات الدورية** وأن **الرصيد يبقى
 * مستحقاً**، وأن الإشغال يُنشئ الخدمات الإلزامية.
 *
 * ── ولماذا المحوران منفصلان ─────────────────────────────────────────
 * الإنشاء والسكن محوران مستقلّان (‏§11.2)، ودمجهما في مبدّل واحد يُخفي
 * أن الشقة قد تكون «منجَزة وفارغة» — وهي حالة لها معنى مالي.
 */

const OCCUPANCY_EFFECT: Record<string, string> = {
  VACANT:
    "ستُوقَف كل الاشتراكات الدورية على هذه الشقة، ويُصفَّر موعد فوترتها. " +
    "الرصيد القائم يبقى مستحقاً — الإخلاء لا يُلغي ديناً — والحساب يبقى مفتوحاً.",
  OCCUPIED_BY_OWNER:
    "ستُنشأ اشتراكات الخدمات الإلزامية التي تنطبق على الشقق، وتبدأ فوترتها. " +
    "الاشتراكات التي أُوقفت سابقاً لا تُستأنف تلقائياً — استأنفها بنفسك إن أردت.",
  OCCUPIED_BY_TENANT:
    "ستُنشأ اشتراكات الخدمات الإلزامية التي تنطبق على الشقق، وتبدأ فوترتها. " +
    "الاشتراكات التي أُوقفت سابقاً لا تُستأنف تلقائياً — استأنفها بنفسك إن أردت.",
};

export function StatusControls({
  apartmentId,
  occupancyStatus,
  constructionStatus,
}: {
  apartmentId: string;
  occupancyStatus: string;
  constructionStatus: string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <OccupancyDialog apartmentId={apartmentId} current={occupancyStatus} />
      <ConstructionDialog apartmentId={apartmentId} current={constructionStatus} />
    </div>
  );
}

function OccupancyDialog({
  apartmentId,
  current,
}: {
  apartmentId: string;
  current: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState(current);

  /**
   * ── ⚠️ يُصفَّر عند الإغلاق ──────────────────────────────────────
   * `useState(current)` يقرأ الـprop مرّة. و`changed = target !== current`
   * تُقارن **حالةً قديمة بـprop جديد** بعد `revalidatePath` — فتقول
   * «تغيّر» على اختيارٍ صار هو الواقع، أو تُخفي تغيّراً حقيقياً.
   */
  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setTarget(current);
      setError(null);
    }
  };

  const changed = target !== current;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="outline">
          تغيير حالة السكن
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>حالة السكن — مفتاح الفوترة</AlertDialogTitle>
          <AlertDialogDescription>
            هذا التغيير يبدأ المال أو يوقفه. اقرأ الأثر قبل التأكيد.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex flex-col gap-3">
          <Field label="الحالة الجديدة" htmlFor="occ">
            <NativeSelect id="occ" value={target} onChange={(e) => setTarget(e.target.value)}>
              {Object.entries(OCCUPANCY_STATUS_AR).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                  {v === current ? " (الحالية)" : ""}
                </option>
              ))}
            </NativeSelect>
          </Field>

          {changed ? (
            <p
              className={
                target === "VACANT"
                  ? "rounded-md bg-money-pending/10 p-3 text-sm text-money-pending"
                  : "rounded-md bg-muted p-3 text-sm text-muted-foreground"
              }
            >
              {OCCUPANCY_EFFECT[target]}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">اختر حالة مختلفة عن الحالية.</p>
          )}

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>إلغاء</AlertDialogCancel>
          <AlertDialogAction
            disabled={!changed || pending}
            onClick={(e) => {
              e.preventDefault();
              setError(null);
              start(async () => {
                const r = await setOccupancyAction(apartmentId, target);
                if (r.ok) setOpen(false);
                else setError(r.error.message);
              });
            }}
          >
            {pending ? "جارٍ التطبيق…" : "تأكيد التغيير"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ConstructionDialog({
  apartmentId,
  current,
}: {
  apartmentId: string;
  current: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState(current);

  /**
   * ── ⚠️ يُصفَّر عند الإغلاق ──────────────────────────────────────
   * `useState(current)` يقرأ الـprop مرّة. و`changed = target !== current`
   * تُقارن **حالةً قديمة بـprop جديد** بعد `revalidatePath` — فتقول
   * «تغيّر» على اختيارٍ صار هو الواقع، أو تُخفي تغيّراً حقيقياً.
   */
  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setTarget(current);
      setError(null);
    }
  };

  const changed = target !== current;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="outline">
          تغيير حالة الإنشاء
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>حالة الإنشاء</AlertDialogTitle>
          <AlertDialogDescription>
            محور مستقلّ عن السكن. شقة تحت الإنشاء لا يمكن إشغالها (‏R10)،
            والعكس: شقة مسكونة لا تعود «تحت الإنشاء».
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex flex-col gap-3">
          <Field label="الحالة الجديدة" htmlFor="cons">
            <NativeSelect id="cons" value={target} onChange={(e) => setTarget(e.target.value)}>
              {Object.entries(CONSTRUCTION_STATUS_AR).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                  {v === current ? " (الحالية)" : ""}
                </option>
              ))}
            </NativeSelect>
          </Field>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>إلغاء</AlertDialogCancel>
          <AlertDialogAction
            disabled={!changed || pending}
            onClick={(e) => {
              e.preventDefault();
              setError(null);
              start(async () => {
                const r = await setConstructionAction(apartmentId, target);
                if (r.ok) setOpen(false);
                else setError(r.error.message);
              });
            }}
          >
            {pending ? "جارٍ التطبيق…" : "تأكيد التغيير"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
