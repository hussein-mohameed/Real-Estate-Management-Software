"use client";

import { useActionState } from "react";
import { createUserAction } from "./actions";
import { CAN_CREATE_ROLES, ROLE_LABELS_AR, type UserRole } from "@/lib/auth/roles";
import type { ActionResult } from "@/lib/result";
import { Button } from "@/components/ui/button";
import { FormCard } from "@/components/ui/page";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Field, fieldA11y } from "@/components/ui/field";

/**
 * نموذج إنشاء مستخدم.
 *
 * ── الأدوار المعروضة تتبع الدور الفاعل ──────────────────────────────
 * القائمة تُقرأ من `CAN_CREATE_ROLES` — وهو المصدر نفسه الذي يفحصه
 * الخادم. كانت مكتوبة هنا بيدٍ ثانية، فسقط منها أن المالك يستطيع إنشاء
 * مالك، وبقي الخيار محجوباً بلا سبب.
 *
 * ⚠️ إخفاء الخيار تحسينُ تجربة لا حماية — الخادم يرفضه على أي حال،
 * وهذا هو الحدّ الحقيقي.
 */
export function CreateUserForm({ actorRole }: { actorRole: UserRole }) {
  const [state, action, pending] = useActionState<
    ActionResult<unknown> | null,
    FormData
  >(createUserAction, null);

  const roles = CAN_CREATE_ROLES[actorRole];

  const fieldError = (name: string): string | undefined =>
    state && !state.ok ? state.error.fieldErrors?.[name]?.[0] : undefined;

  // دور بلا صلاحية إنشاء لا يرى نموذجاً معطَّلاً — يرى لا شيء.
  if (roles.length === 0) return null;

  return (
    <FormCard title="إضافة مستخدم" description="الحسابات تُنشئها الإدارة — لا تسجيل عام.">
      <form action={action}>

      <div className="grid gap-4 md:grid-cols-4">
        <Field
          label="الاسم الكامل"
          htmlFor="fullName"
          required
          error={fieldError("fullName")}
        >
          <Input
            name="fullName"
            {...fieldA11y("fullName", { error: !!fieldError("fullName") })}
          />
        </Field>

        <Field
          label="رقم الهاتف"
          htmlFor="phone"
          required
          error={fieldError("phone")}
        >
          {/* الهاتف أرقام لاتينية: بلا dir="ltr" يُعرَض مقلوباً في سياق عربي */}
          <Input
            name="phone"
            dir="ltr"
            inputMode="tel"
            placeholder="07701234567"
            className="tabular"
            {...fieldA11y("phone", { error: !!fieldError("phone") })}
          />
        </Field>

        <Field
          label="البريد الإلكتروني"
          htmlFor="email"
          hint="إلزامي لمن يدخل بـGoogle"
          error={fieldError("email")}
        >
          <Input
            name="email"
            type="email"
            dir="ltr"
            {...fieldA11y("email", { hint: true, error: !!fieldError("email") })}
          />
        </Field>

        <Field label="الدور" htmlFor="role">
          <NativeSelect id="role" name="role" defaultValue="RESIDENT">
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS_AR[r]}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>

      {state && !state.ok && !state.error.fieldErrors ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {state.error.message}
        </p>
      ) : null}
      {state?.ok ? (
        <p role="status" className="mt-3 text-sm text-occupancy-owner">
          أُنشئ المستخدم.
        </p>
      ) : null}

      <Button type="submit" disabled={pending} className="mt-4">
        {/* §11.4: مؤشّر انتظار ثم نتيجة الخادم الحقيقية — لا واجهة تفاؤلية */}
        {pending ? "جارٍ الحفظ…" : "إضافة"}
      </Button>
    </form>
    </FormCard>
  );
}
