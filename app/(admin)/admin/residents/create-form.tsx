"use client";

import { useActionState } from "react";
import { createResidentAction } from "./actions";
import type { ActionResult } from "@/lib/result";
import { Button } from "@/components/ui/button";
import { FormCard } from "@/components/ui/page";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Field, fieldA11y } from "@/components/ui/field";

/**
 * نموذج إنشاء ساكن.
 *
 * ⚠️ الساكن يُنشأ **بلا كلمة مرور**: يدخل برمز على واتساب، أو بـGoogle إن
 * أُعطي بريداً. لا تسجيل عام ولا دعوة — الأدمن يُنشئ كل حساب (‏§10.1).
 * لهذا لا يوجد حقل كلمة مرور هنا، ولن يوجد.
 */
export function CreateResidentForm() {
  const [state, action, pending] = useActionState<
    ActionResult<unknown> | null,
    FormData
  >(createResidentAction, null);

  const err = (name: string): string | undefined =>
    state && !state.ok ? state.error.fieldErrors?.[name]?.[0] : undefined;

  return (
    <FormCard title="إضافة ساكن" description="بلا كلمة مرور: الدخول برمز واتساب أو بـGoogle إن أُعطي بريداً.">
      <form action={action}>

      <div className="grid gap-4 md:grid-cols-3">
        <Field label="الاسم الكامل" htmlFor="fullName" required error={err("fullName")}>
          <Input name="fullName" {...fieldA11y("fullName", { error: !!err("fullName") })} />
        </Field>

        <Field
          label="رقم الهاتف"
          htmlFor="phone"
          required
          hint="عليه يصل رمز الدخول"
          error={err("phone")}
        >
          {/* الهاتف أرقام لاتينية: بلا dir="ltr" يُعرض مقلوباً في سياق عربي */}
          <Input
            name="phone"
            dir="ltr"
            inputMode="tel"
            placeholder="07701234567"
            className="tabular"
            {...fieldA11y("phone", { hint: true, error: !!err("phone") })}
          />
        </Field>

        <Field label="الجنس" htmlFor="gender">
          <NativeSelect id="gender" name="gender" defaultValue="">
            <option value="">غير محدَّد</option>
            <option value="MALE">ذكر</option>
            <option value="FEMALE">أنثى</option>
          </NativeSelect>
        </Field>

        <Field
          label="البريد الإلكتروني"
          htmlFor="email"
          hint="إلزامي لمن يدخل بـGoogle"
          error={err("email")}
        >
          <Input
            name="email"
            type="email"
            dir="ltr"
            {...fieldA11y("email", { hint: true, error: !!err("email") })}
          />
        </Field>

        <Field label="هاتف الطوارئ" htmlFor="emergencyPhone" error={err("emergencyPhone")}>
          <Input
            name="emergencyPhone"
            dir="ltr"
            inputMode="tel"
            className="tabular"
            {...fieldA11y("emergencyPhone", { error: !!err("emergencyPhone") })}
          />
        </Field>

        <Field label="ملاحظات" htmlFor="notes">
          <Input id="notes" name="notes" />
        </Field>
      </div>

      {state && !state.ok && !state.error.fieldErrors ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {state.error.message}
        </p>
      ) : null}
      {state?.ok ? (
        <p role="status" className="mt-3 text-sm text-occupancy-owner">
          أُنشئ الساكن. اربطه بشقة من عمود «الشقق».
        </p>
      ) : null}

      <Button type="submit" disabled={pending} className="mt-4">
        {pending ? "جارٍ الحفظ…" : "إضافة"}
      </Button>
    </form>
    </FormCard>
  );
}
