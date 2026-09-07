"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Field } from "@/components/ui/field";
import { ActionError } from "@/components/ui/page";
import { REQUEST_SCOPE_AR, REQUEST_TYPE_AR } from "@/lib/labels";
import {
  REQUEST_SCOPE,
  REQUEST_TYPE,
  type RequestScope,
  type RequestType,
} from "@/lib/domain/enums";
import { createMyRequest } from "@/lib/actions/resident-requests";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  نموذج طلب الساكن.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ⚠️ ما لا يُعرَض هنا وهو معروض للإدارة ───────────────────────────
 *   • **الأولوية** — كل طلبٍ عاجل عند صاحبه. وحقلٌ يختاره الساكن يجعل
 *     الجميع يختارون «عاجلة»، فيصير العمود بلا معنى وتفقد الإدارة أداة
 *     ترتيبها. الخادم يكتب `NORMAL` دائماً، وغيابُ الحقل من `‏
 *     ResidentRequestInput` هو التنفيذ لا هذه الشاشة.
 *   • **اختيار أي شقة** — الشقة تأتي من ارتباطاته وحدها، ويُرسلها الخادم
 *     إلى `residentApartmentIds` للتحقّق ثانيةً. الاختيار هنا راحةٌ،
 *     والحدّ هناك.
 *
 * ── والتصنيف اختياريّ لا إلزاميّ ────────────────────────────────────
 * ⚠️ إلزامُه يجعل من لا يعرف قسم مشكلته يختار شيئاً ليمرّ — فيصل الطلب
 * إلى القسم الخطأ، وهو أسوأ من وصوله بلا قسم. «لست متأكّداً» خيارٌ صريح
 * لأنه جوابٌ صحيح.
 */

interface Apartment {
  id: string;
  label: string;
}

interface Category {
  id: string;
  name: string;
  departmentName: string;
}

export function CreateMyRequestForm({
  apartments,
  categories,
}: {
  apartments: readonly Apartment[];
  categories: readonly Category[];
}) {
  const router = useRouter();

  const [type, setType] = useState<RequestType>("SERVICE_REQUEST");
  const [scope, setScope] = useState<RequestScope>(
    /* ⚠️ من لا شقة له لا يُعرَض عليه نطاقٌ سكنيّ يُردّ عند الإرسال */
    apartments.length > 0 ? "APARTMENT" : "COMMON_AREA",
  );
  const [apartmentId, setApartmentId] = useState(apartments[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const needsApartment = scope === "APARTMENT";
  const ready =
    title.trim().length >= 3 &&
    description.trim().length >= 3 &&
    (!needsApartment || apartmentId !== "");

  /**
   * ⚠️ التصنيفات مجموعة بالقسم في `optgroup`.
   * قائمةٌ مسطّحة من اثنتي عشرة مهمّة تُقرأ سطراً سطراً؛ والقسم يجعل
   * الاختيار خطوتين قصيرتين بدل مسحٍ واحد طويل.
   */
  const byDepartment = new Map<string, Category[]>();
  for (const c of categories) {
    byDepartment.set(c.departmentName, [...(byDepartment.get(c.departmentName) ?? []), c]);
  }

  function submit(): void {
    setError(null);
    start(async () => {
      const result = await createMyRequest({
        type,
        scope,
        /* ⚠️ تُحذف للمنطقة المشتركة: الخادم يرفض شقةً معها (‏Q35) */
        ...(needsApartment ? { apartmentId } : {}),
        title: title.trim(),
        description: description.trim(),
        ...(categoryId ? { departmentTaskId: categoryId } : {}),
      });

      if (!result.ok) {
        setError(result.message);
        return;
      }

      /*
       * ⚠️ **يُعاد إلى القائمة لا يُعرَض نجاحٌ في مكانه.** الطلب صار صفّاً
       * له رقم وحالة، ورؤيته في القائمة هي الإيصال. ورسالةٌ خضراء فوق
       * نموذجٍ فارغ تترك السؤال «هل وصل فعلاً؟» بلا جواب.
       */
      router.push("/app/requests");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 rounded-2xl border bg-card p-5 md:grid-cols-2">
        <Field label="نوع الطلب" htmlFor="type">
          <NativeSelect
            id="type"
            value={type}
            onChange={(e) => setType(e.target.value as RequestType)}
          >
            {REQUEST_TYPE.map((t) => (
              <option key={t} value={t}>
                {REQUEST_TYPE_AR[t]}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field label="أين المشكلة؟" htmlFor="scope">
          <NativeSelect
            id="scope"
            value={scope}
            onChange={(e) => setScope(e.target.value as RequestScope)}
          >
            {REQUEST_SCOPE.map((s) => (
              <option key={s} value={s} disabled={s === "APARTMENT" && apartments.length === 0}>
                {s === "APARTMENT" ? "داخل شقّتي" : REQUEST_SCOPE_AR.COMMON_AREA}
              </option>
            ))}
          </NativeSelect>
        </Field>

        {/*
          ⚠️ يظهر لمن له أكثر من شقة وحده. ومن له واحدة لا يُسأل سؤالاً
          جوابُه واحد — والقيمة مضبوطة سلفاً.
        */}
        {needsApartment && apartments.length > 1 ? (
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

        <Field
          label="التصنيف"
          htmlFor="category"
          hint="يوجّه طلبك إلى القسم المختصّ مباشرةً"
        >
          <NativeSelect
            id="category"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            aria-describedby="category-hint"
          >
            <option value="">لست متأكّداً — تُحدّده الإدارة</option>
            {[...byDepartment.entries()].map(([department, items]) => (
              <optgroup key={department} label={department}>
                {items.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </NativeSelect>
        </Field>

        <Field label="العنوان" htmlFor="title" className="md:col-span-2">
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={150}
            placeholder="تسرّب ماء تحت المغسلة"
          />
        </Field>

        <div className="md:col-span-2">
          <Field
            label="الوصف"
            htmlFor="desc"
            hint="ما المشكلة بالضبط، ومتى بدأت، وما جُرِّب"
          >
            <Textarea
              id="desc"
              rows={5}
              maxLength={2000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              aria-describedby="desc-hint"
              placeholder="الماء يتسرّب من وصلة المغسلة منذ يومين، ويزداد عند فتح الصنبور."
            />
          </Field>
        </div>
      </div>

      {error ? <ActionError message={error} /> : null}

      <div>
        <Button disabled={!ready || pending} onClick={submit} className="gap-2">
          <Send className="size-4" />
          {pending ? "…" : "إرسال الطلب"}
        </Button>
      </div>
    </div>
  );
}
