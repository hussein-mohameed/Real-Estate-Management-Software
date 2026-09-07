"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Field } from "@/components/ui/field";
import { ActionError } from "@/components/ui/page";
import { createSubscriptionAction } from "./actions";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  اشتراك جديد — إنشاء الإدارة مباشرةً.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── 🔴 لماذا وُجد هذا النموذج ───────────────────────────────────────
 * `createSubscription` مبنيٌّ منذ الخطوة 2.4 و**بلا مستدعٍ في الواجهة
 * إطلاقاً**. أي أن الأدمن لم يكن يستطيع إنشاء اشتراك: ينتظر أن يطلبه
 * الساكن، أو يبقى بلا سبيل.
 *
 * ⚠️ وذلك يظهر في شاشةٍ تعرض الاشتراكات وتوافق عليها ولا تُنشئها —
 * فيُقرأ النقص «لا صلاحية لي» وهو في الحقيقة «لا زرّ هنا».
 *
 * ── ويُنشأ **معلّقاً** لا نشطاً ─────────────────────────────────────
 * `createPending` يكتب `PENDING_APPROVAL` دائماً، والموافقة خطوةٌ ثانية
 * تُقيّد المال (‏R25/Q26). وذلك مقصود حتى للأدمن: الإنشاء يقول «هذا ما
 * سيُشترك»، والموافقة تقول «قيّده الآن» — وفصلُهما يُبقي على مراجعةٍ
 * أمام كل مبلغ يدخل الدفتر.
 */

interface Option {
  id: string;
  label: string;
}

export function CreateSubscriptionForm({
  services,
  apartments,
}: {
  services: readonly Option[];
  apartments: readonly Option[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [apartmentId, setApartmentId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [notes, setNotes] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const parsedQty = /^[0-9]+$/u.test(quantity) ? Number(quantity) : null;
  const ready = serviceId !== "" && apartmentId !== "" && parsedQty !== null && parsedQty >= 1;

  if (!open) {
    return (
      <div>
        <Button onClick={() => setOpen(true)} className="gap-2">
          <Plus className="size-4" />
          اشتراك جديد
        </Button>
      </div>
    );
  }

  function submit(): void {
    setError(null);
    start(async () => {
      const result = await createSubscriptionAction({
        serviceId,
        apartmentId,
        quantity: parsedQty ?? 1,
        notes,
      });

      if (!result.ok) {
        setError(
          result.error.fieldErrors
            ? `${result.error.message} — ${Object.values(result.error.fieldErrors).flat().join(" · ")}`
            : result.error.message,
        );
        return;
      }

      setOpen(false);
      setApartmentId("");
      setNotes("");
      setQuantity("1");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border bg-card p-5">
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="الخدمة" htmlFor="new-service">
          <NativeSelect
            id="new-service"
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
          >
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field label="الشقة" htmlFor="new-apartment">
          <NativeSelect
            id="new-apartment"
            value={apartmentId}
            onChange={(e) => setApartmentId(e.target.value)}
          >
            <option value="">اختر شقة</option>
            {apartments.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </NativeSelect>
        </Field>

        {/*
          ⚠️ الكمّية تُقبل دائماً ويتجاهلها الخادم لغير `PER_UNIT`.
          وإخفاؤها هنا يلزمه معرفة نموذج تسعير كل خدمة في العميل — ازدواجُ
          قاعدةٍ يتفرّق عند أوّل تعديل على الكتالوج.
        */}
        <Field label="الكمّية" htmlFor="new-qty" hint="للخدمات بالوحدة فقط">
          <Input
            id="new-qty"
            inputMode="numeric"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            aria-describedby="new-qty-hint"
          />
        </Field>

        <div className="md:col-span-3">
          <Field label="ملاحظة" htmlFor="new-notes" hint="اختيارية">
            <Textarea
              id="new-notes"
              rows={2}
              maxLength={500}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              aria-describedby="new-notes-hint"
            />
          </Field>
        </div>
      </div>

      {error ? <ActionError message={error} /> : null}

      <p className="text-theme-xs text-muted-foreground">
        يُنشأ معلّقاً — والموافقة هي ما يُقيّد المبلغ على الحساب.
      </p>

      <div className="flex items-center gap-2">
        <Button disabled={!ready || pending} onClick={submit} className="gap-2">
          <Plus className="size-4" />
          {pending ? "…" : "إنشاء"}
        </Button>
        <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
          إلغاء
        </Button>
      </div>
    </div>
  );
}
