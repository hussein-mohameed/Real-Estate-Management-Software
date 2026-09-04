import type { Metadata } from "next";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import { ThemeScript } from "@/components/theme/theme-script";
import "./globals.css";

/**
 * الجذر — عربي RTL بلا استثناء (‏§11.1).
 *
 * ── لماذا `dir="rtl"` على الجذر لا على حاوية داخلية ──────────────────
 * الاتجاه يجب أن يحكم **كل شيء**: التمرير، والقوائم المنسدلة، والحوارات،
 * وترتيب عناصر النموذج. وضعه على حاوية داخلية يترك أطراف الصفحة LTR
 * فتظهر عيوب اتجاه لا يكتشفها إلا مستخدم عربي حقيقي.
 *
 * ── الخط ──────────────────────────────────────────────────────────────
 * `IBM Plex Sans Arabic` — أحد الخيارين في §11.1، ويُحمَّل عبر `next/font`
 * فيُستضاف ذاتياً بلا طلب خارجي ولا انزياح تخطيط عند التحميل.
 */

const arabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-arabic",
  display: "swap",
});

export const metadata: Metadata = {
  title: "نظام إدارة المجمّع السكني",
  description: "إدارة المخزون العقاري والسكان والاشتراكات والدفتر المالي والطلبات",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    /*
     * ⚠️ `suppressHydrationWarning` على `<html>` **لازم لا تجميلي**:
     * `ThemeScript` يكتب `data-theme` والصنف `dark` على هذا العنصر قبل
     * أن يرطّبه React، فيراهما React اختلافاً عن خرج الخادم ويحذّر.
     * والحدّ من التحذير هنا مقصور على سمات هذا العنصر وحده.
     */
    <html lang="ar" dir="rtl" className={arabic.variable} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-dvh bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
