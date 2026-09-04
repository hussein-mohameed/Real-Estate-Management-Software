import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Field } from "@/components/ui/field";
import type { CustomField } from "@/lib/domain/custom-fields";

/**
 * يرسم حقول الخدمة المخصّصة **من تعريفها**، بلا كود لكل خدمة.
 *
 * هذا هو المكوّن الذي يجعل «خدمة جديدة بلا كود جديد» حقيقةً لا شعاراً:
 * المولّدة تحتاج «رقم العداد» و«عدد الأمبيرات»، والحارس يحتاج «رقم
 * الغرفة» — ولا يُكتب سطر لأيّ منها.
 *
 * ── التعريف نفسه يحكم الطرفين ───────────────────────────────────────
 * ⚠️ ما يُرسَم هنا يُتحقَّق منه على الخادم بـ`buildValuesSchema` من **نفس**
 * مصفوفة الحقول. مصدران منفصلان كانا سيتفرّقان: حقلٌ يظهر ولا يُقبل،
 * أو يُقبل ولا يظهر.
 *
 * ── الأسماء مبادئة بـ`cf_` ─────────────────────────────────────────
 * القيم تصل في `FormData` مع حقول النموذج الأخرى (‏`serviceId`،
 * `quantity`…). بلا بادئة يصطدم مفتاح مخصّص اسمه `quantity` بالحقل
 * الأصلي **ويكتب فوقه صامتاً**.
 */

export const CUSTOM_FIELD_PREFIX = "cf_";

export function CustomFieldsForm({
  fields,
  values,
}: {
  fields: readonly CustomField[];
  values?: Record<string, unknown>;
}) {
  if (fields.length === 0) return null;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {fields.map((f) => {
        const name = `${CUSTOM_FIELD_PREFIX}${f.key}`;
        const current = values?.[f.key];

        return (
          <Field
            key={f.key}
            label={f.labelAr}
            htmlFor={name}
            required={f.required}
            hint={f.helpAr}
          >
            {f.type === "select" ? (
              <NativeSelect
                id={name}
                name={name}
                defaultValue={typeof current === "string" ? current : ""}
              >
                {/* الاختياري يحتاج خياراً فارغاً؛ المطلوب لا يحتاجه */}
                {!f.required ? <option value="">—</option> : null}
                {(f.options ?? []).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </NativeSelect>
            ) : f.type === "boolean" ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  id={name}
                  name={name}
                  type="checkbox"
                  defaultChecked={current === true}
                  className="size-4 accent-primary"
                />
                <span className="text-muted-foreground">نعم</span>
              </label>
            ) : (
              <Input
                id={name}
                name={name}
                type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                // الأرقام والتواريخ لاتينية الشكل: بلا عزل تُعرض معكوسة
                dir={f.type === "text" ? undefined : "ltr"}
                className={f.type === "text" ? undefined : "tabular"}
                min={f.min}
                max={f.max}
                defaultValue={
                  current === undefined || current === null ? "" : String(current)
                }
              />
            )}
          </Field>
        );
      })}
    </div>
  );
}

/**
 * يستخرج قيم الحقول المخصّصة من `FormData` ويُزيل البادئة.
 *
 * ⚠️ **يُستدعى على الخادم** ثم تُمرَّر النتيجة إلى `buildValuesSchema`.
 * الاستخراج هنا لا يتحقّق من شيء — التحقّق مهمّة المخطّط وحده.
 */
export function extractCustomValues(formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith(CUSTOM_FIELD_PREFIX)) continue;
    out[key.slice(CUSTOM_FIELD_PREFIX.length)] = value;
  }
  return out;
}
