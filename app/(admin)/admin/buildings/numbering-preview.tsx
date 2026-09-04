"use client";

import { useMemo, useState } from "react";
import {
  countApartments,
  generateApartments,
  type BuildingSpec,
} from "@/lib/domain/apartment-generator";
import { Ltr } from "@/components/ui/ltr";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Field } from "@/components/ui/field";

/**
 * معالج الترقيم بمعاينة **حيّة** (‏§4.8).
 *
 * ⚠️ يستدعي **نفس** الدالة النقية التي يستدعيها الخادم — لا نسخة مبسّطة
 * منها. ولو اختلفت النسختان لرأى الأدمن معاينة لا تطابق ما سيُحفظ، وهو
 * أسوأ من غياب المعاينة أصلاً.
 *
 * والسبب من §4.8 حرفياً: اكتشاف قالب خاطئ **بعد** توليد 200 شقة مكلف.
 */
export function NumberingPreview() {
  const [code, setCode] = useState("A");
  const [floorsCount, setFloors] = useState(5);
  const [unitsPerFloor, setUnits] = useState(5);
  const [scheme, setScheme] = useState<"SEQUENTIAL" | "PER_FLOOR">("SEQUENTIAL");
  const [format, setFormat] = useState("{building}-{floor}-{unit}");

  const spec: BuildingSpec = useMemo(
    () => ({
      code: code || "A",
      floorsCount,
      unitsPerFloor,
      numberingScheme: scheme,
      displayNumberFormat: format,
    }),
    [code, floorsCount, unitsPerFloor, scheme, format],
  );

  const preview = useMemo(() => generateApartments(spec), [spec]);
  const total = useMemo(() => {
    try {
      return countApartments(spec);
    } catch {
      return 0;
    }
  }, [spec]);

  return (
    <div className="rounded-2xl border bg-card p-5">
      <h3 className="mb-4 text-sm font-semibold">إضافة بناية</h3>

      <div className="grid gap-4 md:grid-cols-3">
        {/* ⚠️ dir="ltr" ليس تجميلاً: حقل RTL يعرض رمز البناية والقالب
            مقلوبَين، فالقيمة سليمة والعرض كاذب. كشفته لقطة شاشة لا اختبار. */}
        <Field
          label="رمز البناية"
          htmlFor="code"
          required
          hint="يظهر في رقم كل شقة"
        >
          <Input
            id="code"
            name="code"
            dir="ltr"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-describedby="code-hint"
          />
        </Field>

        <Field label="اسم البناية" htmlFor="name" hint="اختياري">
          <Input id="name" name="name" aria-describedby="name-hint" />
        </Field>

        <Field label="عدد الطوابق" htmlFor="floorsCount" required>
          <Input
            id="floorsCount"
            name="floorsCount"
            type="number"
            min={1}
            className="tabular"
            value={floorsCount}
            onChange={(e) => setFloors(Number(e.target.value) || 0)}
          />
        </Field>

        <Field label="وحدات كل طابق" htmlFor="unitsPerFloor" required>
          <Input
            id="unitsPerFloor"
            name="unitsPerFloor"
            type="number"
            min={1}
            className="tabular"
            value={unitsPerFloor}
            onChange={(e) => setUnits(Number(e.target.value) || 0)}
          />
        </Field>

        <Field label="طريقة الترقيم" htmlFor="numberingScheme">
          <NativeSelect
            id="numberingScheme"
            name="numberingScheme"
            value={scheme}
            onChange={(e) => setScheme(e.target.value as typeof scheme)}
          >
            <option value="SEQUENTIAL">تسلسلي عبر البناية</option>
            <option value="PER_FLOOR">يبدأ من جديد كل طابق</option>
          </NativeSelect>
        </Field>

        <Field
          label="قالب رقم العرض"
          htmlFor="displayNumberFormat"
          required
          hint={<span dir="ltr">{"{building} · {floor} · {unit} · {seq}"}</span>}
        >
          <Input
            id="displayNumberFormat"
            name="displayNumberFormat"
            dir="ltr"
            value={format}
            onChange={(e) => setFormat(e.target.value)}
            aria-describedby="displayNumberFormat-hint"
          />
        </Field>
      </div>

      {/* ── المعاينة الحيّة ─────────────────────────────────────────── */}
      <div className="mt-4 rounded-md bg-muted p-3 text-sm">
        {preview.ok ? (
          <>
            <p className="mb-2 font-medium">
              سيُنشأ <span className="tabular">{total}</span> شقة
            </p>
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              {(preview.apartments.length <= 4
                ? preview.apartments
                : [
                    ...preview.apartments.slice(0, 3),
                    preview.apartments[preview.apartments.length - 1]!,
                  ]
              ).map((a, i, arr) => (
                <span key={a.displayNumber} className="rounded bg-background px-2 py-1">
                  <Ltr>{a.displayNumber}</Ltr>
                  {i === 2 && arr.length === 4 ? " …" : ""}
                </span>
              ))}
            </div>
          </>
        ) : (
          <p role="alert" className="text-destructive">
            {preview.messageAr}
          </p>
        )}
      </div>
    </div>
  );
}
