"use client";

/**
 * حدود الخطأ الجذرية — تُستدعى حين يفشل **التخطيط الجذري نفسه**.
 *
 * ⚠️ هذا الملف **يحلّ محلّ `app/layout.tsx` بالكامل**، فيجب أن يرسم
 * `<html>` و`<body>` بنفسه. وهذا بالضبط موضع الخطر: التخطيط الجذري هو ما
 * يحمل `lang="ar"` و`dir="rtl"`، فإن نسيناهما هنا صارت صفحة الخطأ الجذري
 * **إنكليزية الاتجاه** — ويراها المستخدم في أسوأ لحظة ممكنة.
 *
 * ولا يمكن استيراد `globals.css` هنا بأمان، لأن فشل التخطيط قد يكون سببه
 * الأنماط نفسها. فالأنماط مضمَّنة، قليلة، ومستقلّة تماماً.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ar" dir="rtl">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          padding: "1.5rem",
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          background: "#fff",
          color: "#1f2430",
          textAlign: "center",
        }}
      >
        <main style={{ maxWidth: "28rem", display: "grid", gap: "1rem" }}>
          <h1 style={{ fontSize: "1.125rem", margin: 0 }}>تعذّر تحميل النظام</h1>
          <p style={{ fontSize: "0.875rem", color: "#5b6172", margin: 0 }}>
            حدث خطأ قبل أن تكتمل تهيئة الصفحة. أعد المحاولة، وإن تكرّر فراجع
            مسؤول النظام.
          </p>
          {error.digest ? (
            <p style={{ fontSize: "0.75rem", color: "#5b6172", margin: 0 }}>
              رمز الحادثة:{" "}
              <span dir="ltr" style={{ fontVariantNumeric: "tabular-nums" }}>
                {error.digest}
              </span>
            </p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            style={{
              justifySelf: "center",
              padding: "0.5rem 1rem",
              borderRadius: "0.375rem",
              border: "none",
              background: "#1f2430",
              color: "#fff",
              fontSize: "0.875rem",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            إعادة المحاولة
          </button>
        </main>
      </body>
    </html>
  );
}
