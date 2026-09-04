import { Building2, ShieldCheck } from "lucide-react";
import { signInWithGoogle } from "./actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

/**
 * شاشة الدخول (‏§7.1 · §10.1).
 *
 * مساران: Google للمالك والإدارة والموظفين، ورمز واتساب للسكان.
 * **لا تسجيل عام** — الرسالة تقول ذلك صراحةً حتى لا يبحث المستخدم عن زرّ
 * «إنشاء حساب» غير موجود.
 *
 * ⚠️ البطاقة `<Card>` لا `div` بحدّ: كانت مكتوبة يدوياً بلا خلفية، فلمّا
 * صارت أرضية الصفحة قماشاً رمادياً ظهرت **شفّافة**. الحدّ وحده لا يصنع
 * بطاقة — الخلفية والارتفاع يصنعانها.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const errorCode = typeof params["error"] === "string" ? params["error"] : null;
  const next = typeof params["next"] === "string" ? params["next"] : undefined;

  const ERRORS: Record<string, string> = {
    missing_code: "لم يصل رمز التحقّق من Google. أعد المحاولة.",
    exchange_failed: "تعذّر إكمال الدخول عبر Google. أعد المحاولة.",
    oauth_start_failed: "تعذّر بدء الدخول عبر Google. راجع إعدادات النظام.",
  };

  async function start() {
    "use server";
    await signInWithGoogle(next);
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <span
          className="grid size-12 place-items-center rounded-2xl bg-accent-brand text-white"
          aria-hidden
        >
          <Building2 className="size-6" />
        </span>
        <div className="space-y-1">
          <h1 className="text-title-sm font-semibold tracking-tight">
            نظام إدارة المجمّع السكني
          </h1>
          <p className="text-sm text-muted-foreground">
            لا يوجد تسجيل عام — الحسابات تُنشئها الإدارة.
          </p>
        </div>
      </div>

      {errorCode ? (
        <p
          role="alert"
          className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive ring-1 ring-inset ring-destructive/25"
        >
          {ERRORS[errorCode] ?? "تعذّر إكمال الدخول. أعد المحاولة."}
        </p>
      ) : null}

      <Card className="gap-0 py-0">
        <CardContent className="flex flex-col gap-4 p-6">
          <form action={start}>
            <Button type="submit" size="lg" className="w-full">
              الدخول بحساب Google
            </Button>
          </form>
          <p className="text-center text-xs text-muted-foreground">
            للمالك والإدارة والموظفين.
          </p>

          <Separator />

          <div className="flex items-start gap-3 rounded-lg bg-muted p-3">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="space-y-1 text-sm">
              <p className="text-muted-foreground">
                السكان يدخلون برقم الهاتف عبر رمز يصل على واتساب.
              </p>
              <p className="text-xs text-muted-foreground">
                يُبنى في الخطوة 0.9 — ويحتاج بيانات اعتماد UltraMsg.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
