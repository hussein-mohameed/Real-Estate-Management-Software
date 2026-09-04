"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus, Power } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Field } from "@/components/ui/field";
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
import {
  createDepartmentAction,
  createTaskAction,
  setDepartmentActiveAction,
  setTaskActiveAction,
  updateTaskAction,
} from "./actions";

/**
 * أفعال شاشة الأقسام.
 *
 * ── ⚠️ لا زرّ حذف في هذه الشاشة إطلاقاً ─────────────────────────────
 * كل `ServiceRequest` يشير إلى مهمّته وإلى قسمه. والحذف يقتل مراجع
 * طلباتٍ مضت ولا تُستعاد. فالإيقاف هو الفعل، ويُقال في الحوار بنصّه: ما
 * مضى يبقى، وما يأتي يُمنع.
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

/** إنشاء قسم — نموذج قصير في رأس الشاشة. */
export function CreateDepartmentForm() {
  const { pending, error, run } = useAct();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="اسم القسم" htmlFor="dept-name">
          <Input
            id="dept-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="الصيانة"
          />
        </Field>
        <Field label="الوصف (اختياري)" htmlFor="dept-desc" className="sm:col-span-2">
          <Input
            id="dept-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="الأعطال الكهربائية والصحّية والتكييف."
          />
        </Field>
      </div>

      {error ? (
        <p role="alert" className="text-theme-xs text-destructive">
          {error}
        </p>
      ) : null}

      <div>
        <Button
          size="sm"
          disabled={pending || name.trim().length < 2}
          onClick={() =>
            run(() => createDepartmentAction(name, description), () => {
              setName("");
              setDescription("");
            })
          }
          className="gap-1.5"
        >
          <Plus className="size-3.5" />
          {pending ? "…" : "إضافة قسم"}
        </Button>
      </div>
    </div>
  );
}

/** إنشاء مهمّة داخل قسم. */
export function CreateTaskForm({
  departments,
}: {
  departments: readonly { id: string; name: string }[];
}) {
  const { pending, error, run } = useAct();
  const [departmentId, setDepartmentId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="القسم" htmlFor="task-dept">
          <NativeSelect
            id="task-dept"
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
          >
            <option value="">اختر قسماً</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field label="اسم المهمّة" htmlFor="task-name">
          <Input
            id="task-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="إصلاح عطل كهربائي"
          />
        </Field>

        <Field label="الوصف (اختياري)" htmlFor="task-desc">
          <Input
            id="task-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
      </div>

      {error ? (
        <p role="alert" className="text-theme-xs text-destructive">
          {error}
        </p>
      ) : null}

      <div>
        <Button
          size="sm"
          disabled={pending || departmentId === "" || name.trim().length < 2}
          onClick={() =>
            run(
              () => createTaskAction(departmentId, name, description),
              () => {
                setName("");
                setDescription("");
              },
            )
          }
          className="gap-1.5"
        >
          <Plus className="size-3.5" />
          {pending ? "…" : "إضافة مهمّة"}
        </Button>
      </div>
    </div>
  );
}

/** تعديل مهمّة وإيقافها. */
export function TaskActions({
  taskId,
  name,
  description,
  isActive,
  requestsCount,
}: {
  taskId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  requestsCount: number;
}) {
  const { pending, error, setError, run } = useAct();
  const [editOpen, setEditOpen] = useState(false);
  const [powerOpen, setPowerOpen] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [draftDesc, setDraftDesc] = useState(description ?? "");

  /*
   * ⚠️ تُصفَّر من الـprops عند الإغلاق: `useState(name)` يقرأ مرّة واحدة،
   * فتعديلٌ لم يُحفَظ يبقى ظاهراً في الفتحة التالية ويبدو محفوظاً.
   */
  const openEdit = (next: boolean) => {
    setEditOpen(next);
    if (!next) {
      setDraftName(name);
      setDraftDesc(description ?? "");
      setError(null);
    }
  };

  return (
    <span className="flex flex-col items-start gap-1.5">
      <span className="flex flex-wrap items-center gap-2">
        <AlertDialog open={editOpen} onOpenChange={openEdit}>
          <AlertDialogTrigger asChild>
            <Button size="xs" variant="outline" disabled={pending} className="gap-1">
              <Pencil className="size-3" />
              تعديل
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>تعديل المهمّة</AlertDialogTitle>
              <AlertDialogDescription>
                الاسم فريد داخل القسم الواحد. والطلبات السابقة تتبع المهمّة
                باسمها الجديد — فالاسم يوصف ما يُفعَل لا متى فُعِل.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor={`n-${taskId}`}>الاسم</Label>
                <Input
                  id={`n-${taskId}`}
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`d-${taskId}`}>الوصف</Label>
                <Textarea
                  id={`d-${taskId}`}
                  rows={2}
                  maxLength={500}
                  value={draftDesc}
                  onChange={(e) => setDraftDesc(e.target.value)}
                />
              </div>
            </div>

            <AlertDialogFooter>
              <AlertDialogCancel>إلغاء</AlertDialogCancel>
              <Button
                disabled={pending || draftName.trim().length < 2}
                onClick={() =>
                  run(
                    () => updateTaskAction(taskId, draftName, draftDesc),
                    () => setEditOpen(false),
                  )
                }
              >
                {pending ? "…" : "حفظ"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={powerOpen} onOpenChange={setPowerOpen}>
          <AlertDialogTrigger asChild>
            <Button size="xs" variant="ghost" disabled={pending} className="gap-1">
              <Power className="size-3" />
              {isActive ? "إيقاف" : "تفعيل"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {isActive ? `إيقاف «${name}»` : `تفعيل «${name}»`}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {isActive ? (
                  <>
                    {/*
                      ⚠️ يُقال إنه **ليس حذفاً**: من يقرأ «إيقاف» قد يظنّ
                      أن الطلبات السابقة تختفي معه.
                    */}
                    لن تظهر للاختيار في طلب جديد. والطلبات المرتبطة بها —
                    وعددها {requestsCount} — تبقى كما هي. ولا حذف: الحذف يقتل
                    مراجع لا تُستعاد.
                  </>
                ) : (
                  <>تعود للاختيار في الطلبات الجديدة.</>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>إلغاء</AlertDialogCancel>
              <Button
                variant={isActive ? "outline" : "default"}
                disabled={pending}
                onClick={() =>
                  run(
                    () => setTaskActiveAction(taskId, !isActive),
                    () => setPowerOpen(false),
                  )
                }
              >
                {pending ? "…" : isActive ? "إيقاف" : "تفعيل"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </span>

      {error ? (
        <span role="alert" className="text-theme-xs text-destructive">
          {error}
        </span>
      ) : null}
    </span>
  );
}

/** إيقاف قسم — يرفضه الخادم إن كان فيه موظفون. */
export function DepartmentPowerButton({
  departmentId,
  name,
  isActive,
  staffCount,
}: {
  departmentId: string;
  name: string;
  isActive: boolean;
  staffCount: number;
}) {
  const { pending, error, run } = useAct();
  const [open, setOpen] = useState(false);

  return (
    <span className="flex flex-col items-start gap-1">
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <Button size="xs" variant="ghost" disabled={pending} className="gap-1">
            <Power className="size-3" />
            {isActive ? "إيقاف" : "تفعيل"}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isActive ? `إيقاف قسم «${name}»` : `تفعيل قسم «${name}»`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isActive ? (
                staffCount > 0 ? (
                  /*
                   * ⚠️ الرفض يُقال **قبل** المحاولة: الخادم يرفض على أي
                   * حال، لكن من يقرأ السبب بعد الضغط يظنّ الشاشة معطوبة.
                   */
                  <>
                    فيه {staffCount} موظفاً. انقلهم إلى قسم آخر أولاً —
                    الإيقاف يُخفي القسم ويترك موظفيه بلا موضع ظاهر.
                  </>
                ) : (
                  <>لن يظهر في قوائم الإسناد. ومهامّه وطلباته السابقة تبقى.</>
                )
              ) : (
                <>يعود إلى قوائم الإسناد.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <Button
              variant={isActive ? "outline" : "default"}
              disabled={pending || (isActive && staffCount > 0)}
              onClick={() =>
                run(
                  () => setDepartmentActiveAction(departmentId, !isActive),
                  () => setOpen(false),
                )
              }
            >
              {pending ? "…" : isActive ? "إيقاف" : "تفعيل"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {error ? (
        <span role="alert" className="text-theme-xs text-destructive">
          {error}
        </span>
      ) : null}
    </span>
  );
}
