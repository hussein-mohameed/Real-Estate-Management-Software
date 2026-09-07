"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Field } from "@/components/ui/field";
import { ActionError } from "@/components/ui/page";
import { addVehicleAction } from "./actions";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  إضافة مركبة — الإدارة نيابةً عن ساكن اتّصل أو راجع.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ⚠️ **معتمَدة فوراً** بخلاف تسجيل الساكن: الأدمن هو جهة الاعتماد،
 * وجعلُه يعتمد ما سجّله بنفسه نقرةٌ لا تُضيف مراجعة.
 *
 * ⚠️ واللوحة تصطدم بـ`uniq_active_plate` إن كانت مسجَّلة — والرسالة
 * **تذكر الشقة** هنا بخلاف رسالة الساكن: الأدمن يملك النظر في الصفّ
 * أصلاً (‏§3.2 يعطيه `F`)، وإخفاؤها عنه يجعله يبحث عمّا يراه بنقرة.
 */

export function AddVehicleForm({
  apartments,
}: {
  apartments: readonly { id: string; label: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [apartmentId, setApartmentId] = useState("");
  const [plateNumber, setPlateNumber] = useState("");
  const [plateProvince, setPlateProvince] = useState("بغداد");
  const [make, setMake] = useState("");
  const [color, setColor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const ready = apartmentId !== "" && plateNumber.trim().length >= 3;

  if (!open) {
    return (
      <div>
        <Button onClick={() => setOpen(true)} className="gap-2">
          <Plus className="size-4" />
          إضافة مركبة
        </Button>
      </div>
    );
  }

  function submit(): void {
    setError(null);
    start(async () => {
      const r = await addVehicleAction({
        apartmentId,
        plateNumber: plateNumber.trim(),
        plateProvince,
        make,
        color,
      });
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      setOpen(false);
      setPlateNumber("");
      setMake("");
      setColor("");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border bg-card p-5">
      <div className="grid gap-4 md:grid-cols-4">
        <Field label="الشقة" htmlFor="v-apartment">
          <NativeSelect
            id="v-apartment"
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

        <Field label="رقم اللوحة" htmlFor="v-plate">
          {/* ⚠️ `dir="ltr"`: الرقم لاتيني ويتفتّت في سياق عربي */}
          <Input
            id="v-plate"
            value={plateNumber}
            onChange={(e) => setPlateNumber(e.target.value)}
            maxLength={40}
            className="tabular"
            dir="ltr"
            placeholder="12 34567"
          />
        </Field>

        <Field label="المحافظة" htmlFor="v-province">
          <Input
            id="v-province"
            value={plateProvince}
            onChange={(e) => setPlateProvince(e.target.value)}
            maxLength={40}
          />
        </Field>

        <Field label="النوع واللون" htmlFor="v-make" hint="اختياريّ">
          <Input
            id="v-make"
            value={make}
            onChange={(e) => setMake(e.target.value)}
            maxLength={40}
            aria-describedby="v-make-hint"
            placeholder="تويوتا"
          />
        </Field>

        <Field label="اللون" htmlFor="v-color" hint="اختياريّ">
          <Input
            id="v-color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            maxLength={30}
            aria-describedby="v-color-hint"
            placeholder="أبيض"
          />
        </Field>
      </div>

      {error ? <ActionError message={error} /> : null}

      <p className="text-theme-xs text-muted-foreground">
        تُضاف معتمَدة — الأدمن هو جهة الاعتماد.
      </p>

      <div className="flex items-center gap-2">
        <Button disabled={!ready || pending} onClick={submit} className="gap-2">
          <Plus className="size-4" />
          {pending ? "…" : "إضافة"}
        </Button>
        <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
          إلغاء
        </Button>
      </div>
    </div>
  );
}
