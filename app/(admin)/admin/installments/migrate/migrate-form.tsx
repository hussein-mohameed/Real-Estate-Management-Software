"use client";

import { useState, useTransition } from "react";
import { FileClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Field } from "@/components/ui/field";
import { migrateAction } from "./actions";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  نموذج ترحيل عقد قائم — `N3`.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ⚠️ لماذا تاريخ لكل قسط لا تاريخ واحد ────────────────────────────
 * القرار `N3` اختار **السجلّ الكامل** على القيد المجمَّع، وثمنُه المُعلَن
 * هو تاريخ كل دفعة ماضية. وحقلٌ واحد «تاريخ السداد» لكلّها كان يُلغي
 * السبب الذي اختير من أجله النموذج أصلاً.
 *
 * ── وما لا تاريخ له يُترك فارغاً ولا يُخمَّن ─────────────────────────
 * ⚠️ الفارغ يأخذ تاريخ الترحيل، **ويُعلَّم القيد بأنه تقريبي**، ويُعاد
 * عدده في النتيجة. وملءُ الفراغ بتخمين يُنتج تاريخاً يبدو دقيقاً وليس
 * كذلك — وهو أسوأ من الاعتراف.
 *
 * ── ⚠️ ولا معاينة كاذبة ─────────────────────────────────────────────
 * جدول الأقساط يبنيه الخادم (`buildSchedule`). وحسابُه هنا ثانيةً يعني
 * قاعدتَي تقسيم، وأول اختلاف بينهما يظهر في شاشة يقرأها الأدمن قبل أن
 * يُقيّد ملايين. فالمعروض هنا **عدد الصفوف وحده** لا مبالغها.
 */

interface ContractOption {
  id: string;
  label: string;
}

export function MigrateForm({ contracts }: { contracts: readonly ContractOption[] }) {
  const [contractId, setContractId] = useState("");
  const [total, setTotal] = useState("");
  const [down, setDown] = useState("0");
  const [count, setCount] = useState("12");
  const [interval, setInterval] = useState("1");
  const [startDate, setStartDate] = useState("");
  const [migratedAt, setMigratedAt] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [reason, setReason] = useState("");
  const [paidThrough, setPaidThrough] = useState("0");
  const [paidDates, setPaidDates] = useState<Record<number, string>>({});

  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const total_ = Number(count);
  const paidCount = Math.min(Math.max(Number(paidThrough) || 0, 0), total_ || 0);
  const paidSequences = Array.from({ length: paidCount }, (_, i) => i + 1);

  const ready =
    contractId !== "" &&
    total !== "" &&
    startDate !== "" &&
    reason.trim().length >= 3 &&
    Number.isInteger(total_) &&
    total_ > 0;

  function submit() {
    setError(null);
    setDone(null);
    start(async () => {
      const r = await migrateAction({
        contractId,
        totalAmountIqd: total,
        downPaymentIqd: down || "0",
        installmentsCount: total_,
        intervalMonths: Number(interval) || 1,
        startDate,
        migratedAt,
        reason,
        paid: paidSequences.map((sequence) => ({
          sequence,
          ...(paidDates[sequence] ? { paidAt: paidDates[sequence]! } : {}),
        })),
      });

      if (!r.ok) {
        setError(r.error.message);
        return;
      }

      const data = r.data as {
        installments: number;
        paidCount: number;
        approximateDates: number;
        openingBalanceLabel: string;
        planCompleted: boolean;
      };

      setDone(
        `رُحِّل العقد: ${data.installments} قسطاً، منها ${data.paidCount} مسدَّد. ` +
          `الرصيد الافتتاحي ${data.openingBalanceLabel}.` +
          (data.approximateDates > 0
            ? ` و${data.approximateDates} تاريخاً دخل تقريبياً — مُعلَّم في الدفتر.`
            : "") +
          (data.planCompleted ? " والخطة مكتملة." : ""),
      );
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 rounded-2xl border bg-card p-5 md:grid-cols-3">
        <Field label="العقد" htmlFor="contract" hint="العقود النشطة بلا خطة أقساط">
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
          hint="مقبوضة سلفاً — تُقيَّد وتُسدَّد بلا فاتورة"
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

        <Field label="كل كم شهر" htmlFor="interval">
          <Input
            id="interval"
            inputMode="numeric"
            value={interval}
            onChange={(e) => setInterval(e.target.value)}
            className="tabular"
          />
        </Field>

        <Field label="تاريخ أوّل قسط" htmlFor="start" hint="لا تاريخ العقد">
          <Input
            id="start"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            aria-describedby="start-hint"
          />
        </Field>

        <Field
          label="عدد الأقساط المسدَّدة"
          htmlFor="paid"
          hint="الأوّل فالثاني — والاستثناءات تُصحَّح بتواريخها أدناه"
        >
          <Input
            id="paid"
            inputMode="numeric"
            value={paidThrough}
            onChange={(e) => setPaidThrough(e.target.value)}
            className="tabular"
            aria-describedby="paid-hint"
          />
        </Field>

        <Field label="تاريخ الترحيل" htmlFor="migrated">
          <Input
            id="migrated"
            type="date"
            value={migratedAt}
            onChange={(e) => setMigratedAt(e.target.value)}
          />
        </Field>

        <Field label="السبب" htmlFor="reason" hint="يُكتب في كل قيد ويُقرأ عند التدقيق">
          <Input
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="ترحيل العقود القائمة عند إدخال النظام"
            aria-describedby="reason-hint"
          />
        </Field>
      </div>

      {/* ── تواريخ السداد الماضية ─────────────────────────────────── */}
      {paidCount > 0 ? (
        <section className="flex flex-col gap-3 rounded-2xl border bg-card p-5">
          <div>
            <h2 className="text-base font-semibold">
              تواريخ السداد — <span className="tabular">{paidCount}</span> قسطاً
            </h2>
            <p className="text-theme-xs text-muted-foreground">
              اتركه فارغاً إن لم يكن التاريخ معروفاً: يأخذ تاريخ الترحيل ويُعلَّم
              القيد بأنه تقريبي. التخمين يُنتج تاريخاً يبدو دقيقاً وليس كذلك.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {paidSequences.map((sequence) => (
              <div key={sequence} className="space-y-1">
                <Label htmlFor={`d-${sequence}`} className="text-theme-xs">
                  القسط <span className="tabular">{sequence}</span>
                </Label>
                <Input
                  id={`d-${sequence}`}
                  type="date"
                  value={paidDates[sequence] ?? ""}
                  onChange={(e) =>
                    setPaidDates((prev) => ({ ...prev, [sequence]: e.target.value }))
                  }
                />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/*
        ⚠️ الأثر يُقال **قبل** الزرّ لا بعده: الترحيل يكتب عشرات القيود في
        دفترٍ لا يُحذف منه شيء (‏R29). ومن يقرأ بعد الضغط قرأ متأخّراً.
      */}
      <div className="rounded-xl bg-muted p-4 text-theme-sm text-muted-foreground">
        سيُنشئ الترحيل الخطة كاملة، ويُقيّد ما استحقّ منها، ويُسدّد ما عُلِّم
        مدفوعاً — بقيود مصدرها «افتتاحي». ولا تُصدَر فاتورة ولا تُسجَّل دفعة
        نقدية: هذا المال لم يمرّ بهذا النظام. والقيود لا تُحذف بعدها.
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
          <FileClock className="size-4" />
          {pending ? "جارٍ الترحيل…" : "ترحيل العقد"}
        </Button>
      </div>
    </div>
  );
}
