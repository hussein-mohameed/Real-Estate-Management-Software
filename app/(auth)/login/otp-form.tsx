"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { requestOtpAction, verifyOtpAction } from "./otp-actions";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  دخول برقم الهاتف — خطوتان.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ⚠️ الرقم يبقى معروضاً في خطوة الرمز ────────────────────────────
 * من يُدخل رقماً خاطئاً بخانة لا يعرف ذلك وهو ينتظر رسالةً لا تصل. وعرضُه
 * مع زرّ «تغيير الرقم» يجعل الخطأ مرئيّاً في اللحظة التي يُشكّ فيها.
 *
 * ── ولا عدّاد تنازليّ ──────────────────────────────────────────────
 * ⚠️ عدّادٌ في العميل يقيس ساعة الجهاز، والحدّ يُطبَّق في الخادم بساعته.
 * فيختلفان، ويصير الزرّ متاحاً والخادم يردّ — أو العكس. والخادم يقول
 * «انتظر ٤٠ ثانية» بالرقم الصحيح، وهو أصدق من عدّادٍ يخمّن.
 *
 * ── والرمز `inputMode="numeric"` ───────────────────────────────────
 * يفتح لوحة الأرقام على الهاتف — وهو أكثر ما يُفتَح منه هذا النموذج.
 */

export function OtpLoginForm() {
  const router = useRouter();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function askForCode(): void {
    setError(null);
    setNotice(null);
    start(async () => {
      const r = await requestOtpAction(phone);
      if (!r.ok) {
        setError(r.message);
        return;
      }
      setNotice(r.message);
      setStep("code");
    });
  }

  function submitCode(): void {
    setError(null);
    start(async () => {
      const r = await verifyOtpAction(phone, code);
      if (!r.ok) {
        setError(r.message);
        return;
      }
      /*
       * ⚠️ `refresh` قبل `push`: الجلسة كوكي كُتب للتوّ، والقشرة مُصيَّرة
       * في الخادم. وبلا تحديث يُعاد استعمال التصيير القديم فيُقرأ
       * المستخدم غير مسجَّل، ويرتدّ إلى صفحة الدخول.
       */
      router.refresh();
      router.push("/");
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {step === "phone" ? (
        <>
          <Field label="رقم الهاتف" htmlFor="otp-phone" hint="الرقم المسجَّل لدى الإدارة">
            <Input
              id="otp-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={20}
              className="tabular"
              dir="ltr"
              inputMode="tel"
              autoComplete="tel"
              placeholder="07XX XXX XXXX"
              aria-describedby="otp-phone-hint"
              onKeyDown={(e) => {
                if (e.key === "Enter" && phone.trim().length >= 6) askForCode();
              }}
            />
          </Field>

          <Button
            onClick={askForCode}
            disabled={pending || phone.trim().length < 6}
            className="gap-2"
          >
            <MessageCircle className="size-4" />
            {pending ? "…" : "أرسل الرمز على واتساب"}
          </Button>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted p-3">
            <span className="tabular text-theme-sm" dir="ltr">
              {phone}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => {
                setStep("phone");
                setCode("");
                setError(null);
                setNotice(null);
              }}
            >
              تغيير الرقم
            </Button>
          </div>

          <Field label="الرمز" htmlFor="otp-code" hint="ستّة أرقام، صالحة خمس دقائق">
            <Input
              id="otp-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/gu, "").slice(0, 6))}
              className="tabular text-center text-theme-xl tracking-[0.4em]"
              dir="ltr"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              aria-describedby="otp-code-hint"
              onKeyDown={(e) => {
                if (e.key === "Enter" && code.length === 6) submitCode();
              }}
            />
          </Field>

          <Button onClick={submitCode} disabled={pending || code.length !== 6} className="gap-2">
            <ArrowRight className="size-4" />
            {pending ? "…" : "دخول"}
          </Button>

          <Button variant="ghost" size="sm" disabled={pending} onClick={askForCode}>
            إعادة إرسال الرمز
          </Button>
        </>
      )}

      {notice ? (
        <p role="status" className="text-theme-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-theme-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
