"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Field } from "@/components/ui/field";
import { ActionError } from "@/components/ui/page";
import { registerMyVehicle } from "@/lib/actions/resident-vehicles";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  نموذج تسجيل المركبة.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ⚠️ حقلٌ واحد إلزاميّ: اللوحة ────────────────────────────────────
 * هي ما تقرؤه البوّابة وما يُبنى عليه التفريد (‏S7). أمّا النوع واللون
 * فيساعدان الحارس ولا يمنعان مركبةً من التسجيل — وإلزامُهما يوقف ساكناً
 * لا يعرف طراز سيارته بالضبط عند حقلٍ لا يحتاجه أحد.
 *
 * ── ولا حقل للحالة ─────────────────────────────────────────────────
 * 🔴 `status` **ليس مُدخَلاً** لا هنا ولا في التوقيع: الخدمة تكتب
 * `PENDING_APPROVAL` دائماً. وقبولُه كان يعني أن يمنح الساكن نفسه دخول
 * البوّابة بلا مراجعة — وهو نقيض «‏pending admin approval» في §3.2.
 */

/** محافظات لوحات العراق — قائمةٌ تمنع الأخطاء الإملائية في حقلٍ يُبحَث به. */
const PROVINCES = [
  "بغداد",
  "البصرة",
  "نينوى",
  "أربيل",
  "النجف",
  "كربلاء",
  "بابل",
  "ذي قار",
  "الأنبار",
  "ديالى",
  "كركوك",
  "السليمانية",
  "دهوك",
  "واسط",
  "ميسان",
  "المثنى",
  "القادسية",
  "صلاح الدين",
] as const;

interface Apartment {
  id: string;
  label: string;
}

export function RegisterVehicleForm({ apartments }: { apartments: readonly Apartment[] }) {
  const router = useRouter();

  const [apartmentId, setApartmentId] = useState(apartments[0]?.id ?? "");
  const [plateNumber, setPlateNumber] = useState("");
  const [plateProvince, setPlateProvince] = useState<string>(PROVINCES[0]);
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [color, setColor] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const ready = plateNumber.trim().length >= 3 && apartmentId !== "";

  function submit(): void {
    setError(null);
    start(async () => {
      const result = await registerMyVehicle({
        apartmentId,
        plateNumber: plateNumber.trim(),
        plateProvince,
        ...(make.trim() ? { make: make.trim() } : {}),
        ...(model.trim() ? { model: model.trim() } : {}),
        ...(color.trim() ? { color: color.trim() } : {}),
      });

      if (!result.ok) {
        setError(result.message);
        return;
      }

      /*
       * ⚠️ يُعاد إلى القائمة: المركبة تظهر هناك بحالة «بانتظار الموافقة»،
       * وهي الإيصال. ورسالةٌ خضراء في مكانها تترك «هل وصل؟» بلا جواب.
       */
      router.push("/app/vehicles");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 rounded-2xl border bg-card p-5 md:grid-cols-2">
        {apartments.length > 1 ? (
          <Field label="الشقة" htmlFor="apartment" className="md:col-span-2">
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

        <Field label="رقم اللوحة" htmlFor="plate" hint="كما هو مكتوب على اللوحة">
          <Input
            id="plate"
            value={plateNumber}
            onChange={(e) => setPlateNumber(e.target.value)}
            maxLength={40}
            /* ⚠️ `tabular` وLTR: الرقم لاتيني ويتفتّت في سياق عربي */
            className="tabular"
            dir="ltr"
            aria-describedby="plate-hint"
            placeholder="12 34567"
          />
        </Field>

        <Field label="محافظة اللوحة" htmlFor="province">
          <NativeSelect
            id="province"
            value={plateProvince}
            onChange={(e) => setPlateProvince(e.target.value)}
          >
            {PROVINCES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field label="النوع" htmlFor="make" hint="اختياريّ">
          <Input
            id="make"
            value={make}
            onChange={(e) => setMake(e.target.value)}
            maxLength={40}
            aria-describedby="make-hint"
            placeholder="تويوتا"
          />
        </Field>

        <Field label="الطراز" htmlFor="model" hint="اختياريّ">
          <Input
            id="model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            maxLength={40}
            aria-describedby="model-hint"
            placeholder="كورولا"
          />
        </Field>

        <Field label="اللون" htmlFor="color" hint="اختياريّ" className="md:col-span-2">
          <Input
            id="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            maxLength={30}
            aria-describedby="color-hint"
            placeholder="أبيض"
          />
        </Field>
      </div>

      {error ? <ActionError message={error} /> : null}

      <div>
        <Button disabled={!ready || pending} onClick={submit} className="gap-2">
          <Send className="size-4" />
          {pending ? "…" : "إرسال للتسجيل"}
        </Button>
      </div>
    </div>
  );
}
