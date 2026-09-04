/**
 * §9.1: «مُصدَّق لكن بلا سجل `User`».
 * ‏Google OAuth يُنشئ مستخدم Supabase حتى لو لم يوجد `User` عندنا —
 * فنُسجّل خروجه **فعلياً** ونعرض هذه الصفحة بدل تركه في حالة معلّقة.
 */
export default function PendingPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold">حسابك غير مُفعَّل</h1>
      <p className="text-sm text-muted-foreground">
        لا يوجد حساب مرتبط بهذه الهوية في النظام. راجع إدارة المجمّع لإنشاء حسابك.
      </p>
    </main>
  );
}
