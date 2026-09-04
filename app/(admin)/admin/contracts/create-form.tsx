"use client";

import { useActionState, useState } from "react";
import { createContractAction } from "./actions";
import type { ActionResult } from "@/lib/result";
import { Button } from "@/components/ui/button";
import { FormCard } from "@/components/ui/page";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Field, fieldA11y } from "@/components/ui/field";
import { BILLING_CYCLE_AR, PAYMENT_TYPE_AR } from "@/lib/labels";

/**
 * نموذج إنشاء عقد — يُنشئ **مسوّدة** لا عقداً نشطاً.
 *
 * ── لماذا تتبدّل الحقول بنوع العقد ───────────────────────────────────
 * §4.11 يجعل الحقول المطلوبة مختلفة جوهرياً: التمليك يحتاج قيمةً وطريقة
 * دفع، والإيجار يحتاج مبلغاً ودورةً و**تاريخ نهاية إلزامياً**. عرضُ
 * الثمانية معاً يجعل نصفها بلا معنى في كل حالة، ويدفع لملء ما لا يلزم.
 *
 * ⚠️ الإخفاء تحسين عرض لا تحقّق: `superRefine` في الخادم هو ما يرفض
 * فعلاً، والنموذج يعرض أخطاءه حقلاً حقلاً.
 */
export function CreateContractForm({
  apartments,
  holders,
}: {
  apartments: Array<{ id: string; displayNumber: string }>;
  holders: Array<{ id: string; fullName: string }>;
}) {
  const [state, action, pending] = useActionState<
    ActionResult<unknown> | null,
    FormData
  >(createContractAction, null);
  const [type, setType] = useState<"SALE" | "RENTAL">("SALE");

  const err = (name: string): string | undefined =>
    state && !state.ok ? state.error.fieldErrors?.[name]?.[0] : undefined;

  if (apartments.length === 0 || holders.length === 0) {
    return (
      <p className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">
        {apartments.length === 0
          ? "لا شقق بعد — أنشئ بناية أولاً."
          : "لا مستخدمين يصلحون أصحابَ عقد — أنشئ ساكناً أولاً."}
      </p>
    );
  }

  return (
    <FormCard title="عقد جديد (مسوّدة)" description="المسوّدة لا حساب لها — التفعيل هو ما يفتح الحساب المالي.">
      <form action={action}>

      <div className="grid gap-4 md:grid-cols-4">
        <Field label="نوع العقد" htmlFor="type" required>
          <NativeSelect
            id="type"
            name="type"
            value={type}
            onChange={(e) => setType(e.target.value as typeof type)}
          >
            <option value="SALE">تمليك</option>
            <option value="RENTAL">إيجار</option>
          </NativeSelect>
        </Field>

        <Field label="الشقة" htmlFor="apartmentId" required error={err("apartmentId")}>
          <NativeSelect id="apartmentId" name="apartmentId">
            {apartments.map((a) => (
              <option key={a.id} value={a.id}>
                {a.displayNumber}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field label="صاحب العقد" htmlFor="holderUserId" required error={err("holderUserId")}>
          <NativeSelect id="holderUserId" name="holderUserId">
            {holders.map((h) => (
              <option key={h.id} value={h.id}>
                {h.fullName}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field label="تاريخ البداية" htmlFor="startDate" required error={err("startDate")}>
          <Input
            name="startDate"
            type="date"
            dir="ltr"
            className="tabular"
            {...fieldA11y("startDate", { error: !!err("startDate") })}
          />
        </Field>

        {type === "RENTAL" ? (
          <>
            <Field
              label="تاريخ النهاية"
              htmlFor="endDate"
              required
              hint="إلزامي لعقد الإيجار (§4.11)"
              error={err("endDate")}
            >
              <Input
                name="endDate"
                type="date"
                dir="ltr"
                className="tabular"
                {...fieldA11y("endDate", { hint: true, error: !!err("endDate") })}
              />
            </Field>

            <Field label="مبلغ الإيجار (د.ع)" htmlFor="rentAmountIqd" required error={err("rentAmountIqd")}>
              <Input
                name="rentAmountIqd"
                inputMode="numeric"
                dir="ltr"
                className="tabular"
                {...fieldA11y("rentAmountIqd", { error: !!err("rentAmountIqd") })}
              />
            </Field>

            <Field label="دورة الإيجار" htmlFor="rentCycle" required error={err("rentCycle")}>
              <NativeSelect id="rentCycle" name="rentCycle" defaultValue="MONTHLY">
                {Object.entries(BILLING_CYCLE_AR).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </>
        ) : (
          <>
            <Field label="قيمة البيع (د.ع)" htmlFor="totalAmountIqd" required error={err("totalAmountIqd")}>
              <Input
                name="totalAmountIqd"
                inputMode="numeric"
                dir="ltr"
                className="tabular"
                {...fieldA11y("totalAmountIqd", { error: !!err("totalAmountIqd") })}
              />
            </Field>

            <Field
              label="طريقة الدفع"
              htmlFor="paymentType"
              required
              hint="الأقساط موقوفة حتى يُحسم القرار B1"
              error={err("paymentType")}
            >
              <NativeSelect
                id="paymentType"
                name="paymentType"
                defaultValue="FULL"
                aria-describedby="paymentType-hint"
              >
                {Object.entries(PAYMENT_TYPE_AR).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </>
        )}

        <Field label="ملاحظات" htmlFor="notes" className="md:col-span-2">
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
          أُنشئت المسوّدة. فعّلها لفتح حسابها المالي.
        </p>
      ) : null}

      <Button type="submit" disabled={pending} className="mt-4">
        {pending ? "جارٍ الحفظ…" : "إنشاء المسوّدة"}
      </Button>
    </form>
    </FormCard>
  );
}
