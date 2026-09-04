"use client";

import { useState, useTransition } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Field } from "@/components/ui/field";
import { EMPLOYMENT_TYPE_AR } from "@/lib/labels";
import { EMPLOYMENT_TYPE, type EmploymentType } from "@/lib/domain/enums";
import { updateStaffAction } from "./actions";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  تعديل الملفّ الوظيفي.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ⚠️ الشركة تظهر لموظّف البائع وحده ───────────────────────────────
 * حقلٌ ظاهر دائماً يُملأ لموظّف داخلي ثم يُرفض عند الحفظ. وإخفاؤه يجعل
 * القاعدة تُقرأ من الشاشة قبل أن تُقرأ من رسالة خطأ.
 *
 * ── ⚠️ ونوع التوظيف يُنظّف الشركة عند الحفظ ────────────────────────
 * ذلك في الخادم لا هنا: من ينقل موظّفاً من `VENDOR` إلى `INTERNAL` يترك
 * `vendorId` عليه لو لم يُمسَح صراحةً — بياناً يناقض حالته ويضلّل كل
 * تقرير يجمع حسب الشركة.
 *
 * ── والاسم والهاتف غير قابلين للتعديل هنا ──────────────────────────
 * ⚠️ هما في `User` وقدرتهما `USERS_AND_ROLES`: الهاتف **مفتاح دخول** لا
 * بيان تنظيمي. وعرضُهما معطَّلَين أصدق من إخفائهما — يقول أين تُعدَّل.
 */

interface Option {
  id: string;
  name: string;
}

export function EditStaffForm({
  userId,
  initial,
  departments,
  vendors,
}: {
  userId: string;
  initial: {
    employmentType: EmploymentType;
    departmentId: string | null;
    vendorId: string | null;
    jobTitle: string | null;
  };
  departments: readonly Option[];
  vendors: readonly Option[];
}) {
  const [employmentType, setEmploymentType] = useState<EmploymentType>(
    initial.employmentType,
  );
  const [departmentId, setDepartmentId] = useState(initial.departmentId ?? "");
  const [vendorId, setVendorId] = useState(initial.vendorId ?? "");
  const [jobTitle, setJobTitle] = useState(initial.jobTitle ?? "");

  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  const isVendor = employmentType === "VENDOR";
  const ready = !isVendor || vendorId !== "";

  function submit() {
    setError(null);
    setDone(false);
    start(async () => {
      const r = await updateStaffAction({
        userId,
        employmentType,
        vendorId: isVendor ? vendorId : "",
        departmentId,
        jobTitle,
      });
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      setDone(true);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="نوع التوظيف" htmlFor="employment">
          <NativeSelect
            id="employment"
            value={employmentType}
            onChange={(e) => {
              const next = e.target.value as EmploymentType;
              setEmploymentType(next);
              /* ⚠️ يُصفَّر في الواجهة أيضاً: قيمةٌ مخفيّة تُرسَل تُربك */
              if (next !== "VENDOR") setVendorId("");
            }}
          >
            {EMPLOYMENT_TYPE.map((t) => (
              <option key={t} value={t}>
                {EMPLOYMENT_TYPE_AR[t]}
              </option>
            ))}
          </NativeSelect>
        </Field>

        {isVendor ? (
          <Field label="الشركة" htmlFor="vendor">
            <NativeSelect
              id="vendor"
              value={vendorId}
              onChange={(e) => setVendorId(e.target.value)}
            >
              <option value="">اختر شركة</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : null}

        <Field label="القسم" htmlFor="dept" hint="الفراغ يعني فكّ الإسناد">
          <NativeSelect
            id="dept"
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            aria-describedby="dept-hint"
          >
            <option value="">بلا قسم</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field label="المسمّى الوظيفي" htmlFor="title">
          <Input
            id="title"
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
            maxLength={120}
            placeholder="فنّي كهرباء"
          />
        </Field>
      </div>

      {done ? (
        <p role="status" className="text-theme-sm text-occupancy-owner">
          حُفظ.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-theme-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div>
        <Button disabled={!ready || pending} onClick={submit} className="gap-2">
          <Save className="size-4" />
          {pending ? "…" : "حفظ التعديل"}
        </Button>
      </div>
    </div>
  );
}
