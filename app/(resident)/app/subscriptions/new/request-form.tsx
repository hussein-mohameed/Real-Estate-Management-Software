"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Field } from "@/components/ui/field";
import { ActionError } from "@/components/ui/page";
import { Money } from "@/components/ui/money";
import { BILLING_CYCLE_AR } from "@/lib/labels";
import type { BillingCycle, PricingModel, ServiceBillingType } from "@/lib/domain/enums";
import { requestMySubscription } from "@/lib/actions/resident-subscriptions";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  نموذج طلب الاشتراك.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ⚠️ السعر يُعرَض **قبل** الإرسال ────────────────────────────────
 * الاشتراك التزامٌ متكرّر على حساب الساكن. وزرُّ «أرسل» بلا رقم أمامه
 * يجعله يوافق على ما لا يعرف مقداره — ثم يفاجئه القيد الأول.
 *
 * ⚠️ والرقم **تقديريّ ويُقال إنه كذلك**: السعر الحقيقي يُلتقط عند
 * الموافقة (`unitPriceSnapshotIqd`)، والفترة الأولى مقسَّطة بالتناسب
 * (‏B2). فرقمٌ يُعرَض كأنه نهائيّ ثم يختلف في الكشف يُنتج شكوى.
 *
 * ── والمبالغ نصوص لا `BigInt` ──────────────────────────────────────
 * ⚠️ `BigInt` لا يُسلسَل عبر حدّ الخادم/العميل — يرمي
 * «Do not know how to serialize a BigInt». الخادم يحوّلها نصّاً،
 * و`Money` يقبل النصّ.
 */

interface ServiceOption {
  id: string;
  name: string;
  description: string | null;
  billingType: ServiceBillingType;
  billingCycle: BillingCycle | null;
  pricingModel: PricingModel;
  basePriceIqd: string | null;
  unitPriceIqd: string | null;
  unitLabel: string | null;
  minUnits: number | null;
  maxUnits: number | null;
}

interface Apartment {
  id: string;
  label: string;
}

export function RequestSubscriptionForm({
  apartments,
  services,
}: {
  apartments: readonly Apartment[];
  services: readonly ServiceOption[];
}) {
  const router = useRouter();

  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [apartmentId, setApartmentId] = useState(apartments[0]?.id ?? "");
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const service = services.find((s) => s.id === serviceId) ?? null;
  const perUnit = service?.pricingModel === "PER_UNIT";

  const min = service?.minUnits ?? 1;
  const max = service?.maxUnits ?? 99;
  const inRange = !perUnit || (quantity >= min && quantity <= max);

  /**
   * ⚠️ الحساب بـ`BigInt` لا بـ`Number`: مبالغ الدينار تتجاوز الحدّ الآمن
   * للعدد العشري في الجمع التراكمي، والمشروع يخزّنها `BigInt` لهذا السبب.
   * وحسابُها هنا بالعشري يُنتج رقماً يخالف ما يُقيَّد لاحقاً.
   */
  const estimate: bigint | null = !service
    ? null
    : perUnit && service.unitPriceIqd !== null
      ? BigInt(service.unitPriceIqd) * BigInt(inRange ? quantity : min)
      : service.basePriceIqd !== null
        ? BigInt(service.basePriceIqd)
        : null;

  function submit(): void {
    setError(null);
    start(async () => {
      const result = await requestMySubscription({
        serviceId,
        apartmentId,
        ...(perUnit ? { quantity } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });

      if (!result.ok) {
        setError(result.message);
        return;
      }

      /*
       * ⚠️ يُعاد إلى القائمة: الطلب يظهر هناك بحالة «بانتظار الموافقة»،
       * وهي الإيصال. ورسالةٌ خضراء في مكانها تترك «هل وصل؟» بلا جواب.
       */
      router.push("/app/subscriptions");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 rounded-2xl border bg-card p-5 md:grid-cols-2">
        <Field label="الخدمة" htmlFor="service" className="md:col-span-2">
          <NativeSelect
            id="service"
            value={serviceId}
            onChange={(e) => {
              setServiceId(e.target.value);
              /* ⚠️ الكمّية تُعاد إلى حدّ الخدمة الجديدة لا تبقى على السابقة */
              const next = services.find((s) => s.id === e.target.value);
              setQuantity(next?.minUnits ?? 1);
            }}
          >
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </NativeSelect>
        </Field>

        {service?.description ? (
          <p className="text-theme-sm text-muted-foreground md:col-span-2">
            {service.description}
          </p>
        ) : null}

        {apartments.length > 1 ? (
          <Field label="الشقة" htmlFor="apartment">
            <NativeSelect
              id="apartment"
              value={apartmentId}
              onChange={(e) => setApartmentId(e.target.value)}
            >
              {apartments.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : null}

        {perUnit ? (
          <Field
            label={`الكمّية${service?.unitLabel ? ` (${service.unitLabel})` : ""}`}
            htmlFor="quantity"
            hint={`بين ${min} و${max}`}
            error={inRange ? undefined : `الكمّية يجب أن تكون بين ${min} و${max}.`}
          >
            <Input
              id="quantity"
              type="number"
              inputMode="numeric"
              min={min}
              max={max}
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              aria-describedby="quantity-hint"
            />
          </Field>
        ) : null}

        <Field
          label="ملاحظة للإدارة"
          htmlFor="notes"
          hint="اختياريّة"
          className="md:col-span-2"
        >
          <Textarea
            id="notes"
            rows={3}
            maxLength={500}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            aria-describedby="notes-hint"
            placeholder="مثلاً: أحتاجها قبل بداية الشهر القادم."
          />
        </Field>
      </div>

      {/*
        ⚠️ التقدير في بطاقةٍ مستقلّة لا سطراً في النموذج: هو **ما ستدفعه**،
        وهو المعلومة التي يتوقّف عليها القرار — لا حقلاً من حقوله.
      */}
      {estimate === null ? null : (
        <div className="rounded-2xl border bg-muted/40 p-5">
          <p className="text-theme-xs text-muted-foreground">
            المبلغ التقديريّ لكل دورة
          </p>
          <p className="mt-1 text-theme-xl font-semibold">
            <Money value={estimate} />
            {service?.billingCycle ? (
              <span className="ms-2 text-theme-sm font-normal text-muted-foreground">
                / {BILLING_CYCLE_AR[service.billingCycle]}
              </span>
            ) : service?.billingType === "ONE_TIME" ? (
              <span className="ms-2 text-theme-sm font-normal text-muted-foreground">
                مرّة واحدة
              </span>
            ) : null}
          </p>
          <p className="mt-2 text-theme-xs text-muted-foreground">
            تقديريّ — السعر النهائي يُثبَّت عند الموافقة، والفترة الأولى تُحسَب
            بالتناسب مع ما تبقّى منها.
          </p>
        </div>
      )}

      {error ? <ActionError message={error} /> : null}

      <div>
        <Button
          disabled={!serviceId || !apartmentId || !inRange || pending}
          onClick={submit}
          className="gap-2"
        >
          <Send className="size-4" />
          {pending ? "…" : "إرسال الطلب"}
        </Button>
      </div>
    </div>
  );
}
