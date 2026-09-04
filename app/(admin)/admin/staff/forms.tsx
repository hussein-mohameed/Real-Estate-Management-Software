"use client";

import { useActionState, useState } from "react";
import {
  createDepartmentAction,
  createSkillAction,
  createStaffAction,
  createVendorAction,
  setAvailabilityAction,
  setActiveAction,
  setCashPermissionAction,
  setSkillsAction,
} from "./actions";
import type { ActionResult } from "@/lib/result";
import { Banknote, UserX, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Field, fieldA11y } from "@/components/ui/field";
import { EMPLOYMENT_TYPE_AR, SKILL_LEVEL_AR } from "@/lib/labels";
import { SKILL_LEVEL, type SkillLevel } from "@/lib/domain/enums";
import { useTransition } from "react";

/**
 * نماذج البيانات المرجعية التنظيمية.
 *
 * ⚠️ **الشركة تظهر وتختفي بنوع التوظيف.** `vendorId` إلزامي عندما
 * `employmentType = VENDOR` وممنوع فيما عداه — وهو شرط مشروط لا يعبّر
 * عنه المخطّط، فيُفرَض في zod وفي قيد قاعدة البيانات معاً. الإظهار هنا
 * تحسين عرض لا تحقّق.
 */
export function CreateStaffForm({
  departments,
  vendors,
}: {
  departments: Array<{ id: string; name: string }>;
  vendors: Array<{ id: string; name: string }>;
}) {
  const [state, action, pending] = useActionState<
    ActionResult<unknown> | null,
    FormData
  >(createStaffAction, null);
  const [employmentType, setType] = useState<"INTERNAL" | "FREELANCE" | "VENDOR">(
    "INTERNAL",
  );

  const err = (n: string) =>
    state && !state.ok ? state.error.fieldErrors?.[n]?.[0] : undefined;

  return (
    <form action={action} className="rounded-2xl border bg-card p-5">
      <h3 className="mb-4 text-sm font-semibold">إضافة موظف</h3>

      <div className="grid gap-4 md:grid-cols-3">
        <Field label="الاسم الكامل" htmlFor="fullName" required error={err("fullName")}>
          <Input name="fullName" {...fieldA11y("fullName", { error: !!err("fullName") })} />
        </Field>

        <Field label="رقم الهاتف" htmlFor="phone" required error={err("phone")}>
          <Input
            name="phone"
            dir="ltr"
            inputMode="tel"
            placeholder="07701234567"
            className="tabular"
            {...fieldA11y("phone", { error: !!err("phone") })}
          />
        </Field>

        <Field
          label="البريد الإلكتروني"
          htmlFor="email"
          required
          hint="الموظف يدخل بحساب Google، والمطابقة على البريد"
          error={err("email")}
        >
          <Input
            name="email"
            type="email"
            dir="ltr"
            {...fieldA11y("email", { hint: true, error: !!err("email") })}
          />
        </Field>

        <Field label="نوع التوظيف" htmlFor="employmentType" required>
          <NativeSelect
            id="employmentType"
            name="employmentType"
            value={employmentType}
            onChange={(e) => setType(e.target.value as typeof employmentType)}
          >
            {Object.entries(EMPLOYMENT_TYPE_AR).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </Field>

        {employmentType === "VENDOR" ? (
          <Field label="الشركة" htmlFor="vendorId" required error={err("vendorId")}>
            {vendors.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                لا شركات مسجَّلة — أضف شركة أولاً.
              </p>
            ) : (
              <NativeSelect id="vendorId" name="vendorId">
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        ) : null}

        <Field label="القسم" htmlFor="departmentId">
          <NativeSelect id="departmentId" name="departmentId" defaultValue="">
            <option value="">بلا قسم</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field label="المسمّى الوظيفي" htmlFor="jobTitle">
          <Input id="jobTitle" name="jobTitle" />
        </Field>
      </div>

      <Result state={state} okText="أُضيف الموظف." />

      <Button type="submit" disabled={pending} className="mt-4">
        {pending ? "جارٍ الحفظ…" : "إضافة"}
      </Button>
    </form>
  );
}

/** نماذج قصيرة بحقل واحد أو حقول قليلة — قسم · مهارة · شركة. */
export function QuickForm({
  kind,
}: {
  kind: "department" | "skill" | "vendor";
}) {
  const actionFor = {
    department: createDepartmentAction,
    skill: createSkillAction,
    vendor: createVendorAction,
  }[kind];

  const [state, action, pending] = useActionState<
    ActionResult<unknown> | null,
    FormData
  >(actionFor, null);

  const title = { department: "قسم جديد", skill: "مهارة جديدة", vendor: "شركة جديدة" }[kind];
  const label = { department: "اسم القسم", skill: "اسم المهارة", vendor: "اسم الشركة" }[kind];

  return (
    <form action={action} className="rounded-2xl border bg-card p-5">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      <div className="flex flex-col gap-3">
        <Field label={label} htmlFor={`${kind}-name`} required>
          <Input id={`${kind}-name`} name="name" />
        </Field>

        {kind === "vendor" ? (
          <>
            <Field label="التخصّص" htmlFor="specialty">
              <Input id="specialty" name="specialty" />
            </Field>
            <Field label="هاتف التواصل" htmlFor="vendor-phone">
              <Input
                id="vendor-phone"
                name="phone"
                dir="ltr"
                inputMode="tel"
                className="tabular"
              />
            </Field>
          </>
        ) : null}
      </div>

      <Result state={state} okText="أُضيف." />

      <Button type="submit" size="sm" disabled={pending} className="mt-3">
        {pending ? "…" : "إضافة"}
      </Button>
    </form>
  );
}

/** مبدّل التواجد — علم حضور بسيط، لا وردية ولا حضور وانصراف. */
export function AvailabilityToggle({
  userId,
  isAvailable,
}: {
  userId: string;
  isAvailable: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="xs"
        disabled={pending}
        onClick={() => {
          setError(null);
          start(async () => {
            const r = await setAvailabilityAction(userId, !isAvailable);
            if (!r.ok) setError(r.error.message);
          });
        }}
      >
        {pending ? "…" : isAvailable ? "تعليم غير متواجد" : "تعليم متواجد"}
      </Button>
      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </span>
  );
}

function Result({
  state,
  okText,
}: {
  state: ActionResult<unknown> | null;
  okText: string;
}) {
  if (!state) return null;
  if (state.ok) {
    return (
      <p role="status" className="mt-3 text-sm text-occupancy-owner">
        {okText}
      </p>
    );
  }
  if (state.error.fieldErrors) return null; // معروضة على الحقول
  return (
    <p role="alert" className="mt-3 text-sm text-destructive">
      {state.error.message}
    </p>
  );
}

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  صلاحية قبض النقد — القرار `B4`.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ⚠️ لماذا حوارٌ لا مفتاح تبديل ───────────────────────────────────
 * `AvailabilityToggle` مفتاحٌ بنقرة، لأن التواجد يتغيّر كل يوم ويُصحَّح
 * بنقرة أخرى. وهذا مختلف: منحُ قبض النقد يفتح على موظّف طريقاً لإسقاط
 * دَين مقابل سرقة. ونقرةٌ واحدة بلا سؤال — أو بضغطةِ خطأ على الصفّ
 * المجاور — تمنحه بلا أن يقصد أحد.
 *
 * ── ⚠️ والسبب إلزامي ────────────────────────────────────────────────
 * المخطّط يوجبه (3 أحرف على الأقل) ويكتبه في التدقيق. «من منح ومتى» بلا
 * «لماذا» لا يفيد من يراجع بعد سنة — وهو الوقت الذي يُراجَع فيه فعلاً.
 *
 * ── والسحب يُرفض إن كان الصندوق مفتوحاً ─────────────────────────────
 * ذلك في الخادم، والرسالة تصل كما هي. سحبُ الصلاحية وترك الجلسة مفتوحة
 * يُخفي النقد ولا يستعيده.
 */
export function CashPermissionToggle({
  userId,
  staffName,
  canReceiveCash,
}: {
  userId: string;
  staffName: string;
  canReceiveCash: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const granting = !canReceiveCash;

  function submit() {
    setError(null);
    start(async () => {
      const r = await setCashPermissionAction(userId, granting, reason);
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      setReason("");
      setOpen(false);
    });
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setReason("");
          setError(null);
        }
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          size="xs"
          variant={canReceiveCash ? "outline" : "ghost"}
          disabled={pending}
          className="gap-1"
        >
          <Banknote className="size-3" />
          {canReceiveCash ? "سحب" : "منح"}
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {granting ? "منح صلاحية قبض النقد" : "سحب صلاحية قبض النقد"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {granting ? (
              <>
                سيصبح {staffName} قادراً على قبض النقد وتسجيل الدفعات — على أي
                حساب. ويلزمه فتح صندوق قبل كل قبض، وإقفاله بمبلغ مُقرّ في نفس
                اليوم. والفرق بين المتوقَّع والمُقرّ يظهر باسمه.
              </>
            ) : (
              <>
                لن يستطيع {staffName} قبض نقد بعدها. والسحب يُرفض إن كان صندوقه
                مفتوحاً — يُقفله ويُقرّ بما ورّده أولاً.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor={`cash-reason-${userId}`}>
            السبب — يُكتب في سجلّ التدقيق
          </Label>
          <Textarea
            id={`cash-reason-${userId}`}
            rows={2}
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={granting ? "أمين صندوق مركز الخدمة" : "انتقل إلى قسم آخر"}
          />
        </div>

        {error ? (
          <p role="alert" className="text-theme-sm text-destructive">
            {error}
          </p>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel>إلغاء</AlertDialogCancel>
          <Button
            disabled={pending || reason.trim().length < 3}
            variant={granting ? "default" : "outline"}
            onClick={submit}
          >
            {pending ? "…" : granting ? "منح" : "سحب"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  محرّر مهارات الموظّف.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ⚠️ الإجراء **يستبدل** المجموعة لا يضيف إليها ────────────────────
 * `setStaffSkills` يحذف مهارات الموظّف ويكتب ما أُرسل، داخل معاملة واحدة
 * (فلا نافذة يظهر فيها بلا مهارات). ومعنى ذلك أن هذا المحرّر يجب أن يحمل
 * **حالة كل المهارات** ويرسلها كلّها في كل حفظ — وإرسال المتغيّرة وحدها
 * يمحو الباقي بلا رسالة خطأ.
 *
 * ── و«يحتاج تدريباً» معلومة لا منع ──────────────────────────────────
 * تُعلَّم على الموظّف ولا تمنع تكليفه. القرار في التكليف لا في البيانات:
 * منعُ التكليف بحجّة نقص التدريب يترك مهمّةً بلا منفّذ في مجمَّعٍ فيه
 * موظّفان.
 *
 * ── و«تدرَّب» و«يحتاج تدريباً» مستقلّتان عمداً ──────────────────────
 * من تدرَّب وما زال يحتاج مزيداً حالةٌ واقعية. ودمجُهما في حقل واحد
 * يُجبر على الكذب في إحدى الحالتين.
 */

interface SkillRow {
  skillId: string;
  name: string;
  assigned: boolean;
  level: SkillLevel;
  needsTraining: boolean;
  hasTrained: boolean;
  trainingNote: string;
}

export function SkillsEditor({
  userId,
  staffName,
  allSkills,
  current,
}: {
  userId: string;
  staffName: string;
  allSkills: ReadonlyArray<{ id: string; name: string }>;
  current: ReadonlyArray<{
    skill: { id: string };
    level: SkillLevel;
    needsTraining: boolean;
    hasTrained: boolean;
    trainingNote?: string | null;
  }>;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  /** الحالة الابتدائية: كل المهارات المتاحة، والمُسنَدة معلَّمة. */
  function initial(): SkillRow[] {
    const byId = new Map(current.map((c) => [c.skill.id, c]));
    return allSkills.map((s) => {
      const held = byId.get(s.id);
      return {
        skillId: s.id,
        name: s.name,
        assigned: held !== undefined,
        level: held?.level ?? "BEGINNER",
        needsTraining: held?.needsTraining ?? false,
        hasTrained: held?.hasTrained ?? false,
        /*
         * ⚠️ **`trainingNote` يُحمَل ويُعاد كما هو.**
         * الإجراء يستبدل المجموعة، فملاحظةٌ لا تُرسَل تُمحى. والمحرّر لا
         * يعرضها (الجدول ضيّق) — فلو لم تُحمَل هنا لمُحيت في كل حفظ،
         * صامتةً، ولا شيء يُنبّه.
         */
        trainingNote: held?.trainingNote ?? "",
      };
    });
  }

  const [rows, setRows] = useState<SkillRow[]>(initial);

  function patch(skillId: string, change: Partial<SkillRow>) {
    setRows((prev) =>
      prev.map((r) => (r.skillId === skillId ? { ...r, ...change } : r)),
    );
  }

  function submit() {
    setError(null);
    start(async () => {
      const r = await setSkillsAction(
        userId,
        rows
          .filter((row) => row.assigned)
          .map((row) => ({
            skillId: row.skillId,
            level: row.level,
            needsTraining: row.needsTraining,
            hasTrained: row.hasTrained,
            ...(row.trainingNote.trim() !== ""
              ? { trainingNote: row.trainingNote.trim() }
              : {}),
          })),
      );
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      setOpen(false);
    });
  }

  const assignedCount = rows.filter((r) => r.assigned).length;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        /* ⚠️ الإلغاء يُرجع الحالة المحفوظة — وإلا بقيت تعديلاتٌ لم تُحفَظ
           معروضةً في المرّة القادمة فتبدو محفوظة. */
        if (!next) {
          setRows(initial());
          setError(null);
        }
      }}
    >
      <AlertDialogTrigger asChild>
        <Button size="xs" variant="outline" disabled={pending} className="gap-1">
          <Wrench className="size-3" />
          مهارات
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent className="max-w-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>مهارات {staffName}</AlertDialogTitle>
          <AlertDialogDescription>
            «يحتاج تدريباً» معلومة تُعلَّم ولا تمنع التكليف. والحفظ يستبدل
            المجموعة كلّها بما هو معلَّم هنا.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {allSkills.length === 0 ? (
          <p className="text-theme-sm text-muted-foreground">
            لا مهارات في الكتالوج بعد. أنشئ مهارةً أولاً من أعلى الشاشة.
          </p>
        ) : (
          <div className="max-h-[22rem] space-y-2 overflow-y-auto">
            {rows.map((row) => (
              <div
                key={row.skillId}
                className="flex flex-wrap items-center gap-3 rounded-xl border p-3"
              >
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={row.assigned}
                    onCheckedChange={(v) =>
                      patch(row.skillId, { assigned: v === true })
                    }
                  />
                  <span className="text-theme-sm font-medium">{row.name}</span>
                </label>

                {/* ⚠️ المستوى والتدريب يظهران للمُسنَدة وحدها: حقولٌ لمهارة
                    غير مُسنَدة تُملأ ثم تُهمَل، فتبدو محفوظة وهي مُهمَلة. */}
                {row.assigned ? (
                  <>
                    <NativeSelect
                      aria-label={`مستوى ${row.name}`}
                      value={row.level}
                      onChange={(e) =>
                        patch(row.skillId, { level: e.target.value as SkillLevel })
                      }
                      className="w-36"
                    >
                      {SKILL_LEVEL.map((lvl) => (
                        <option key={lvl} value={lvl}>
                          {SKILL_LEVEL_AR[lvl]}
                        </option>
                      ))}
                    </NativeSelect>

                    <label className="flex items-center gap-2 text-theme-xs">
                      <Checkbox
                        checked={row.needsTraining}
                        onCheckedChange={(v) =>
                          patch(row.skillId, { needsTraining: v === true })
                        }
                      />
                      يحتاج تدريباً
                    </label>

                    <label className="flex items-center gap-2 text-theme-xs">
                      <Checkbox
                        checked={row.hasTrained}
                        onCheckedChange={(v) =>
                          patch(row.skillId, { hasTrained: v === true })
                        }
                      />
                      تدرَّب
                    </label>
                  </>
                ) : null}
              </div>
            ))}
          </div>
        )}

        {error ? (
          <p role="alert" className="text-theme-sm text-destructive">
            {error}
          </p>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel>إلغاء</AlertDialogCancel>
          <Button disabled={pending || allSkills.length === 0} onClick={submit}>
            {pending ? "…" : `حفظ ${assignedCount} مهارة`}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  تعطيل موظّف ترك العمل — وتفعيله ثانيةً.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── 🔴 الثغرة التي وُجد من أجلها ────────────────────────────────────
 * لم يكن في هذه الشاشة سبيلٌ إلى تعطيل موظّف. فمن يترك العمل يبقى في
 * القائمة، وعلمُ تواجده كما تركه — أي **في قائمة من يُكلَّف**. ثم يُسنَد
 * إليه عمل ولا يصله شيء، ولا أحد يعرف لماذا تأخّر.
 *
 * ── ⚠️ ولا زرّ حذف ──────────────────────────────────────────────────
 * الموظّف مرتبط بسجلّ تدقيق وجلسات صندوق وقيود. حذفُه يقتل مراجع لا
 * تُستعاد. والتعطيل يمنع الدخول ويُبقي السجلّ — وهو ما يريده من يسأل
 * بعد سنة: «من قبض هذا المبلغ؟».
 *
 * ── والسبب يُكتب ────────────────────────────────────────────────────
 * اختياريّ في المخطّط، ومطلوبٌ هنا عند التعطيل: «عُطِّل» بلا «لماذا» تترك
 * السؤال لمن يأتي بعدك. والتفعيل ثانيةً لا يحتاجه — إعادةُ حقٍّ لا سحبُه.
 */
export function ActiveToggle({
  userId,
  staffName,
  isActive,
}: {
  userId: string;
  staffName: string;
  isActive: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const deactivating = isActive;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setReason("");
          setError(null);
        }
      }}
    >
      <AlertDialogTrigger asChild>
        <Button size="xs" variant="ghost" disabled={pending} className="gap-1">
          <UserX className="size-3" />
          {isActive ? "تعطيل" : "تفعيل"}
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {deactivating ? `تعطيل حساب ${staffName}` : `تفعيل حساب ${staffName}`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {deactivating ? (
              <>
                لن يستطيع {staffName} الدخول، ولن يظهر في قوائم التكليف. وسجلّه
                يبقى كما هو: التدقيق وجلسات الصندوق والقيود لا تُمسّ.
              </>
            ) : (
              <>يعود {staffName} إلى الدخول وإلى قوائم التكليف.</>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {deactivating ? (
          <div className="space-y-1.5">
            <Label htmlFor={`active-reason-${userId}`}>السبب</Label>
            <Textarea
              id={`active-reason-${userId}`}
              rows={2}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="انتهاء الخدمة"
            />
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-theme-sm text-destructive">
            {error}
          </p>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel>إلغاء</AlertDialogCancel>
          <Button
            disabled={pending || (deactivating && reason.trim().length < 3)}
            variant={deactivating ? "outline" : "default"}
            onClick={() => {
              setError(null);
              start(async () => {
                const r = await setActiveAction(userId, !isActive, reason);
                if (!r.ok) {
                  setError(r.error.message);
                  return;
                }
                setOpen(false);
              });
            }}
          >
            {pending ? "…" : deactivating ? "تعطيل" : "تفعيل"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
