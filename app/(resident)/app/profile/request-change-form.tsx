"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PencilLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/field";
import { ActionError } from "@/components/ui/page";
import { requestMyProfileChange } from "@/lib/actions/resident-profile-requests";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  طلب تعديل البيانات — §3.2 «‏read + request change».
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ⚠️ الحقول مملوءة بالقيم الحالية ────────────────────────────────
 * نموذجٌ فارغ يجعل الساكن يعيد كتابة اسمه كاملاً ليصحّح حرفاً — ويُخطئ
 * في إعادة الكتابة. والخادم يقارن بالمخزَّن ويتجاهل ما لم يتغيّر، فما
 * يُرسَل بلا تعديل لا يُنتج طلباً.
 *
 * ── 🔴 وتغيير الهاتف يُقال ما هو ────────────────────────────────────
 * هو **نقل وجهة رمز الدخول**، لا تحديث حقل. وساكنٌ يغيّره ولا يعرف ذلك
 * يفقد حسابه إن أخطأ رقماً — والتنبيه هنا لا في رسالة خطأ بعد فوات الأوان.
 *
 * ── والبريد ليس في النموذج ─────────────────────────────────────────
 * ⚠️ مفتاح مطابقة حساب Google، ودخول الساكن بالرمز لا به. فحقلٌ لا
 * يستعمله وطريقٌ لنقل حسابٍ إلى بريد آخر — استُثني في الخادم أيضاً، لا
 * هنا وحده.
 */

export function RequestProfileChangeForm({
  currentName,
  currentPhone,
  currentEmergencyPhone,
}: {
  currentName: string;
  currentPhone: string;
  currentEmergencyPhone: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState(currentName);
  const [phone, setPhone] = useState(currentPhone);
  const [emergencyPhone, setEmergencyPhone] = useState(currentEmergencyPhone ?? "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const phoneChanged = phone.trim() !== currentPhone;

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)} className="gap-2 self-start">
        <PencilLine className="size-4" />
        طلب تعديل بياناتي
      </Button>
    );
  }

  function submit(): void {
    setError(null);
    start(async () => {
      const result = await requestMyProfileChange({
        fullName: fullName.trim(),
        phone: phone.trim(),
        ...(emergencyPhone.trim() ? { emergencyPhone: emergencyPhone.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });

      if (!result.ok) {
        setError(result.message);
        return;
      }

      setOpen(false);
      setNote("");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border bg-card p-5">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="الاسم الكامل" htmlFor="pc-name">
          <Input
            id="pc-name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            maxLength={120}
          />
        </Field>

        <Field
          label="رقم الهاتف"
          htmlFor="pc-phone"
          hint="إليه يصل رمز الدخول"
          error={
            phoneChanged
              ? "تغيير الرقم ينقل وجهة رمز دخولك — تأكّد منه قبل الإرسال."
              : undefined
          }
        >
          <Input
            id="pc-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            maxLength={20}
            className="tabular"
            dir="ltr"
            aria-describedby="pc-phone-hint"
          />
        </Field>

        <Field label="هاتف الطوارئ" htmlFor="pc-emergency" hint="اختياريّ">
          <Input
            id="pc-emergency"
            value={emergencyPhone}
            onChange={(e) => setEmergencyPhone(e.target.value)}
            maxLength={20}
            className="tabular"
            dir="ltr"
            aria-describedby="pc-emergency-hint"
          />
        </Field>

        <Field label="سبب التعديل" htmlFor="pc-note" hint="يقرؤه من يراجع الطلب">
          <Textarea
            id="pc-note"
            rows={2}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-describedby="pc-note-hint"
            placeholder="مثلاً: غيّرتُ رقمي."
          />
        </Field>
      </div>

      {error ? <ActionError message={error} /> : null}

      <p className="text-theme-xs text-muted-foreground">
        لا يسري شيء حتى توافق الإدارة. وما تتركه كما هو لا يُرسَل.
      </p>

      <div className="flex items-center gap-2">
        <Button disabled={pending} onClick={submit} className="gap-2">
          <PencilLine className="size-4" />
          {pending ? "…" : "إرسال الطلب"}
        </Button>
        <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
          إلغاء
        </Button>
      </div>
    </div>
  );
}
