"use client";

import { useActionState, useState, useTransition } from "react";
import { createServiceAction, setAvailabilityAction } from "./actions";
import type { ActionResult } from "@/lib/result";
import { Button } from "@/components/ui/button";
import { FormCard } from "@/components/ui/page";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Field, fieldA11y } from "@/components/ui/field";
import {
  BILLING_CYCLE_AR,
  PAYER_TYPE_AR,
  PRICING_MODEL_AR,
  SERVICE_APPLIES_TO_AR,
  SERVICE_BILLING_TYPE_AR,
} from "@/lib/labels";

/**
 * نموذج إنشاء خدمة.
 *
 * ── الحقول تتبع نموذج التسعير ونوع الفوترة ──────────────────────────
 * كلٌّ من `basePriceIqd` و`unitPriceIqd` و`billingCycle` يلزم في حالة
 * دون غيرها. عرضُها كلّها معاً يجعل نصفها بلا معنى ويدفع لملء ما لا
 * يلزم — ثم يرفضه الخادم.
 *
 * ⚠️ الإخفاء تحسين عرض لا تحقّق: `refineService` في الخادم هو ما يرفض
 * فعلاً، والقيد `service_mandatory_not_resident_only` تحته.
 */
export function CreateServiceForm() {
  const [state, action, pending] = useActionState<
    ActionResult<unknown> | null,
    FormData
  >(createServiceAction, null);

  const [billingType, setBillingType] = useState<"RECURRING" | "ONE_TIME">("RECURRING");
  const [pricingModel, setPricing] = useState<"FLAT" | "PER_UNIT" | "PER_PERSON">("FLAT");
  const [appliesTo, setAppliesTo] = useState<"APARTMENT" | "RESIDENT" | "BOTH">("APARTMENT");
  const [isMandatory, setMandatory] = useState(false);

  const err = (n: string) =>
    state && !state.ok ? state.error.fieldErrors?.[n]?.[0] : undefined;

  /** V11: تركيبة لا يُنشئها أي تدفق — تُمنع في الواجهة أيضاً بشرح. */
  const mandatoryOnResident = isMandatory && appliesTo === "RESIDENT";

  return (
    <FormCard title="خدمة جديدة" description="الحقول تتبع نموذج التسعير ونوع الفوترة.">
      <form action={action}>

      <div className="grid gap-4 md:grid-cols-3">
        <Field label="اسم الخدمة" htmlFor="name" required error={err("name")}>
          <Input name="name" {...fieldA11y("name", { error: !!err("name") })} />
        </Field>

        <Field label="نوع الفوترة" htmlFor="billingType" required>
          <NativeSelect
            id="billingType"
            name="billingType"
            value={billingType}
            onChange={(e) => setBillingType(e.target.value as typeof billingType)}
          >
            {Object.entries(SERVICE_BILLING_TYPE_AR).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </Field>

        {billingType === "RECURRING" ? (
          <Field label="دورة الفوترة" htmlFor="billingCycle" required error={err("billingCycle")}>
            <NativeSelect id="billingCycle" name="billingCycle" defaultValue="MONTHLY">
              {Object.entries(BILLING_CYCLE_AR).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : null}

        <Field label="نموذج التسعير" htmlFor="pricingModel" required>
          <NativeSelect
            id="pricingModel"
            name="pricingModel"
            value={pricingModel}
            onChange={(e) => setPricing(e.target.value as typeof pricingModel)}
          >
            {Object.entries(PRICING_MODEL_AR).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </Field>

        {pricingModel === "PER_UNIT" ? (
          <>
            <Field label="سعر الوحدة (د.ع)" htmlFor="unitPriceIqd" required error={err("unitPriceIqd")}>
              <Input
                name="unitPriceIqd"
                inputMode="numeric"
                dir="ltr"
                className="tabular"
                {...fieldA11y("unitPriceIqd", { error: !!err("unitPriceIqd") })}
              />
            </Field>
            <Field
              label="اسم الوحدة"
              htmlFor="unitLabel"
              required
              hint="مثل: أمبير · م³ — بلا اسم يقرأ المستخدم «الكمية: 5» بلا معنى"
              error={err("unitLabel")}
            >
              <Input
                name="unitLabel"
                {...fieldA11y("unitLabel", { hint: true, error: !!err("unitLabel") })}
              />
            </Field>
            <Field label="أقلّ كمية" htmlFor="minUnits">
              <Input id="minUnits" name="minUnits" type="number" min={1} dir="ltr" className="tabular" />
            </Field>
            <Field label="أكثر كمية" htmlFor="maxUnits" error={err("maxUnits")}>
              <Input id="maxUnits" name="maxUnits" type="number" min={1} dir="ltr" className="tabular" />
            </Field>
          </>
        ) : (
          <Field
            label={pricingModel === "PER_PERSON" ? "سعر الفرد (د.ع)" : "سعر الخدمة (د.ع)"}
            htmlFor="basePriceIqd"
            required
            hint={
              pricingModel === "PER_PERSON"
                ? "يُضرب في عدد السكان النشطين وقت القيد"
                : undefined
            }
            error={err("basePriceIqd")}
          >
            <Input
              name="basePriceIqd"
              inputMode="numeric"
              dir="ltr"
              className="tabular"
              {...fieldA11y("basePriceIqd", {
                hint: pricingModel === "PER_PERSON",
                error: !!err("basePriceIqd"),
              })}
            />
          </Field>
        )}

        <Field label="من يدفع" htmlFor="payerType" required>
          <NativeSelect id="payerType" name="payerType" defaultValue="OCCUPANT">
            {Object.entries(PAYER_TYPE_AR).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field label="تنطبق على" htmlFor="appliesTo" required error={err("appliesTo")}>
          <NativeSelect
            id="appliesTo"
            name="appliesTo"
            value={appliesTo}
            onChange={(e) => setAppliesTo(e.target.value as typeof appliesTo)}
          >
            {Object.entries(SERVICE_APPLIES_TO_AR).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <div className="flex flex-col justify-end gap-1.5">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="isMandatory"
              checked={isMandatory}
              onChange={(e) => setMandatory(e.target.checked)}
              className="mt-1 size-4 accent-primary"
            />
            <span>
              إلزامية
              <span className="block text-xs text-muted-foreground">
                تُنشأ تلقائياً مع كل إشغال شقة
              </span>
            </span>
          </label>
        </div>

        <Field label="وصف" htmlFor="description" className="md:col-span-2">
          <Input id="description" name="description" />
        </Field>
      </div>

      {/* V11 — الشرح قبل الرفض */}
      {mandatoryOnResident ? (
        <p className="mt-3 rounded-md bg-money-pending/10 p-3 text-sm text-money-pending">
          خدمة إلزامية تنطبق على <strong>الساكن</strong> لا يُنشئها أي تدفق:
          الإنشاء التلقائي مقصور على ما ينطبق على الشقق. ستبقى «إلزامية» في
          الكتالوج وبلا أثر في الواقع. اختر «الشقق» أو «الاثنين».
        </p>
      ) : null}

      <div className="mt-4">
        <Field
          label="الحقول المخصّصة (JSON)"
          htmlFor="customFieldsSchema"
          hint='مثال: [{"key":"amperes","labelAr":"عدد الأمبيرات","type":"number","required":true,"min":1,"max":30}]'
          error={err("customFieldsSchema")}
        >
          {/* ⚠️ dir="ltr": JSON لاتيني الشكل ويُعرض مقلوباً في حقل عربي */}
          <Textarea
            id="customFieldsSchema"
            name="customFieldsSchema"
            dir="ltr"
            rows={4}
            className="font-mono text-xs"
            placeholder="[]"
            aria-describedby="customFieldsSchema-hint"
          />
        </Field>
      </div>

      {state && !state.ok && !state.error.fieldErrors ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {state.error.message}
        </p>
      ) : null}
      {state?.ok ? (
        <p role="status" className="mt-3 text-sm text-occupancy-owner">
          أُنشئت الخدمة.
        </p>
      ) : null}

      <Button type="submit" disabled={pending || mandatoryOnResident} className="mt-4">
        {pending ? "جارٍ الحفظ…" : "إنشاء الخدمة"}
      </Button>
    </form>
    </FormCard>
  );
}

/** إتاحة/إيقاف — R24: البديل الوحيد عن الحذف. */
export function AvailabilityToggle({
  serviceId,
  serviceName,
  isAvailable,
  isMandatory,
  activeSubscriptions,
}: {
  serviceId: string;
  serviceName: string;
  isAvailable: boolean;
  isMandatory: boolean;
  activeSubscriptions: number;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // الإلزامية لا تُوقَف — تناقض مع R27
  if (isMandatory) {
    return <span className="text-xs text-muted-foreground">إلزامية</span>;
  }

  return (
    <span className="flex flex-col gap-1">
      <Button
        variant="ghost"
        size="xs"
        disabled={pending}
        title={
          isAvailable && activeSubscriptions > 0
            ? `الإيقاف يمنع الاشتراكات الجديدة فقط — ${activeSubscriptions} اشتراكاً قائماً يستمرّ`
            : undefined
        }
        onClick={() => {
          setError(null);
          start(async () => {
            const r = await setAvailabilityAction(serviceId, !isAvailable);
            if (!r.ok) setError(r.error.message);
          });
        }}
      >
        {pending ? "…" : isAvailable ? "إيقاف" : "إتاحة"}
      </Button>
      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      ) : null}
      <span className="sr-only">{serviceName}</span>
    </span>
  );
}
