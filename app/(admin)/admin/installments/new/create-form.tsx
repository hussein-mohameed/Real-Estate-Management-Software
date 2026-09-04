"use client";

import { useState, useTransition } from "react";
import { CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Field } from "@/components/ui/field";
import { createPlanAction } from "../actions";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  إنشاء خطة أقساط لعقد جديد — الخطوة 3.5 · القرار `B1`.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ⚠️ هذا نموذج **مالي** لا إداري ──────────────────────────────────
 * القرار `B1` جعل الدفعة المقدّمة مالاً مقبوضاً: الحفظ يُنشئ خطةً **وقيداً
 * ودفعةً وفاتورة** في لحظة واحدة، ويحتاج صندوقاً مفتوحاً. وليس حفظَ
 * بيانات يُراجَع لاحقاً.
 *
 * ── والفرق عن الترحيل يُقال هنا ─────────────────────────────────────
 * هذا للعقد **الجديد**: أوّل قسط في المستقبل، ولا قسط مسدَّد سلفاً. أما
 * العقد القائم قبل النظام فله شاشته — وقواعدها مختلفة عمداً.
 */

interface ContractOption {
  id: string;
  label: string;
}

export function CreatePlanForm({
  contracts,
  hasOpenDrawer,
}: {
  contracts: readonly ContractOption[];
  /** ⚠️ يُقرَّر في الخادم — المتصفّح لا يعرف صناديق أحد. */
  hasOpenDrawer: boolean;
}) {
  const [contractId, setContractId] = useState("");
  const [total, setTotal] = useState("");
  const [down, setDown] = useState("0");
  const [count, setCount] = useState("12");
  const [interval, setInterval] = useState("1");
  const [startDate, setStartDate] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const parsedCount = Number(count);
  const downIsPositive = (Number(down) || 0) > 0;

  const ready =
    contractId !== "" &&
    total !== "" &&
    startDate !== "" &&
    Number.isInteger(parsedCount) &&
    parsedCount > 0 &&
    /* ⚠️ بلا صندوق لا مقدّمة: الزرّ يُعطَّل بدل أن يُرفض بعد ملء النموذج */
    (!downIsPositive || hasOpenDrawer);

  function submit() {
    setError(null);
    setDone(null);
    start(async () => {
      const r = await createPlanAction({
        contractId,
        totalAmountIqd: total,
        downPaymentIqd: down || "0",
        installmentsCount: parsedCount,
        intervalMonths: Number(interval) || 1,
        startDate,
      });

      if (!r.ok) {
        setError(r.error.message);
        return;
      }

      const data = r.data as {
        installments: number;
        downPayment: { invoiceNumber: string } | null;
      };

      setDone(
        `أُنشئت الخطة: ${data.installments} قسطاً.` +
          (data.downPayment
            ? ` والمقدّمة قُبضت بفاتورة ${data.downPayment.invoiceNumber}.`
            : ""),
      );
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {/*
        ⚠️ الشرط يُقال **قبل** ملء النموذج لا بعد رفضه.
        من يملأ عشرة حقول ثم يُردّ بـ«لا صندوق مفتوح» يظنّ الشاشة معطوبة.
      */}
      {!hasOpenDrawer ? (
        <p
          role="status"
          className="rounded-xl border border-warning-200 bg-warning-25 p-4 text-theme-sm dark:border-warning-500/30 dark:bg-warning-500/5"
        >
          لا صندوق نقد مفتوح باسمك. تستطيع إنشاء خطة <strong>بلا</strong> دفعة
          مقدّمة، أما قبض المقدّمة فيحتاج صندوقاً مفتوحاً — القرار B4.
        </p>
      ) : null}

      <div className="grid gap-4 rounded-2xl border bg-card p-5 md:grid-cols-3">
        <Field label="العقد" htmlFor="contract" hint="العقود النشطة بلا خطة">
          <NativeSelect
            id="contract"
            value={contractId}
            onChange={(e) => setContractId(e.target.value)}
            aria-describedby="contract-hint"
          >
            <option value="">اختر عقداً</option>
            {contracts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field label="قيمة العقد (د.ع)" htmlFor="total">
          <Input
            id="total"
            inputMode="numeric"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
            className="tabular"
            placeholder="50000000"
          />
        </Field>

        <Field
          label="الدفعة المقدّمة (د.ع)"
          htmlFor="down"
          hint="تُقبض الآن بوصل وفاتورة، والأقساط على الباقي"
        >
          <Input
            id="down"
            inputMode="numeric"
            value={down}
            onChange={(e) => setDown(e.target.value)}
            className="tabular"
            aria-describedby="down-hint"
          />
        </Field>

        <Field label="عدد الأقساط" htmlFor="count">
          <Input
            id="count"
            inputMode="numeric"
            value={count}
            onChange={(e) => setCount(e.target.value)}
            className="tabular"
          />
        </Field>

        <Field label="كل كم شهر" htmlFor="interval" hint="1 شهري · 3 ربعي · 12 سنوي">
          <Input
            id="interval"
            inputMode="numeric"
            value={interval}
            onChange={(e) => setInterval(e.target.value)}
            className="tabular"
            aria-describedby="interval-hint"
          />
        </Field>

        <Field
          label="تاريخ أوّل قسط"
          htmlFor="start"
          hint="بعد التوقيع بفترة — لا تاريخ العقد"
        >
          <Input
            id="start"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            aria-describedby="start-hint"
          />
        </Field>
      </div>

      {/*
        ⚠️ الأثر بالضبط قبل الزرّ (‏§11.2). والقيد لا يُحذف (‏R29): يُصحَّح
        بقيد معاكس بسبب مكتوب، لا بحذف.
      */}
      <div className="rounded-xl bg-muted p-4 text-theme-sm text-muted-foreground">
        الحفظ يُنشئ الخطة ويُقسّم <strong>المتبقّي بعد المقدّمة</strong> على
        عدد الأقساط. والمقدّمة تُقبض الآن بوصل وفاتورة. أما الأقساط فلا
        تُقيَّد اليوم: تُقيَّد كلٌّ في موعدها. والقيود لا تُحذف بعدها.
      </div>

      {done ? (
        <p role="status" className="text-theme-sm text-occupancy-owner">
          {done}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-theme-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div>
        <Button disabled={!ready || pending} onClick={submit} className="gap-2">
          <CalendarPlus className="size-4" />
          {pending ? "جارٍ الإنشاء…" : "إنشاء الخطة"}
        </Button>
      </div>
    </div>
  );
}
