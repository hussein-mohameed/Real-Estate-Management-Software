"use client";

import { usePathname } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { GlobalSearch } from "./global-search";
import { NotificationsBell } from "./notifications-bell";
import { UserMenu } from "./user-menu";
import type { NotificationRow } from "@/lib/actions/notifications";
import type { NavItem } from "@/lib/nav";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  الشريط العلوي.
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   [طيّ] │ مسار التنقّل ……… [بحث] [جرس] [سمة] [المستخدم]
 *
 * ── مسار التنقّل ────────────────────────────────────────────────────
 * كان يعرض عنوان القسم وحده — «لوحة الإدارة» — والصفحة تحته تعرض عنوانها
 * «مهام اليوم». عنوانان بلا علاقة ظاهرة بينهما، والمستخدم لا يعرف أين هو
 * في الشجرة. صار **مسار تنقّل**: القسم ثم الصفحة الحالية.
 *
 * ── ولماذا يُشتقّ عنوان الصفحة من `nav` لا يُمرَّر ──────────────────
 * ⚠️ تمريره من كل صفحة يعني **تسميتين لنفس الشاشة** — واحدة في الشريط
 * وأخرى في الرأس — وأول تعديل يُفرّقهما. الاشتقاق من `lib/nav.ts` يجعل
 * التسمية واحدة بالبناء لا بالانتباه.
 *
 * ── والمطابقة **بأطول بادئة** ──────────────────────────────────────
 * ⚠️ أول بند مطابق كان سيُعطي «مهام اليوم» لكل مسار يبدأ بـ`/admin` —
 * أي لكل شاشة في اللوحة. الأطول يفوز، فتُطابِق `/admin/apartments` بندها
 * لا الجذر.
 *
 * ── وترتيب الأدوات على جهة النهاية مقصود ───────────────────────────
 * البحث أوّلها لأنه الأكثر استعمالاً ويحتاج مساحة؛ ثم الجرس (تنبيه
 * عارض)؛ ثم السمة (تُضبط مرّة)؛ والمستخدم في الطرف — حيث تتوقّعه العين
 * ولا يُنقر بالخطأ عند القصد إلى ما قبله.
 */

function currentLabel(nav: readonly NavItem[], pathname: string): string | null {
  let best: NavItem | null = null;
  for (const item of nav) {
    const hit = pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (!hit) continue;
    if (!best || item.href.length > best.href.length) best = item;
  }
  return best?.label ?? null;
}

export function AppTopbar({
  sectionTitle,
  roleLabel,
  nav,
  userName,
  email,
  avatarUrl,
  notifications,
  unreadCount,
  showSearch,
}: {
  sectionTitle: string;
  roleLabel: string;
  nav: readonly NavItem[];
  userName: string;
  email: string | null;
  avatarUrl: string | null;
  notifications: readonly NotificationRow[];
  unreadCount: number;
  /**
   * ⚠️ يقرّره الخادم لا هذا المكوّن.
   *
   * البحث العامّ يعبر ثلاث قدرات ومقصور على الإدارة والمالك — راجع تعليق
   * `globalSearch`. وإخفاء زرٍّ يُرجع نتائج فارغة دائماً أصدق من عرضه:
   * زرٌّ لا يجد شيئاً يُقرأ «معطوب» لا «ممنوع».
   */
  showSearch: boolean;
}) {
  const pathname = usePathname();
  const page = currentLabel(nav, pathname);

  return (
    /*
     * لاصق: الجداول تُمرَّر كثيراً، وفقدان العنوان يُفقد السياق.
     *
     * ── ⚠️ ولا خطّ تحته ولا بينه وبين أدواته ──────────────────────────
     * كان `border-b` يرسم خطّاً عبر العرض كلّه، وفاصلٌ رأسيّ ثانٍ بعد زرّ
     * الطيّ. وثلاثة خطوط في أعلى كل شاشة — العلويّ، والرأسيّ، وحدّ الشريط
     * الجانبي — تقطّع القشرة إلى شرائح قبل أن يبدأ المحتوى.
     *
     * والطبقة تُقرأ **بالضبابية والشفافية** لا بالخطّ: المحتوى يمرّ تحت
     * `backdrop-blur` فيُرى أنه خلفها، وهذا أدقّ من خطٍّ صلب لأنه يقول
     * «طبقة» لا «حدّ». والفراغ يفصل الزرّ عن المسار بما يكفي.
     */
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 bg-canvas/80 px-3 backdrop-blur-md md:px-6">
      <SidebarTrigger className="-ms-1 size-9 rounded-full" />

      {/* مسار التنقّل — القسم يُخفى على الهاتف حيث لا مساحة للسلسلة */}
      <nav aria-label="مسار التنقّل" className="min-w-0 flex-1">
        <ol className="flex min-w-0 items-center gap-1.5">
          {page ? (
            <>
              {/*
               * ⚠️ الإخفاء بـCSS لا بـ`isMobile`. الخُطّاف يُرجع `false`
               * على الخادم ثم قيمته الحقيقية بعد التركيب، فتختلف الشجرة
               * المُرطَّبة عن المُصيَّرة — تحذير ترطيب ووميض في كل تحميل.
               */}
              <li className="hidden truncate text-theme-sm text-muted-foreground md:block">
                {sectionTitle}
              </li>
              <li aria-hidden className="hidden text-muted-foreground/50 md:block">
                {/*
                 * ⚠️ `ChevronLeft` **فيزيائي مقصود**: السهم يتبع اتجاه
                 * القراءة، وهو في العربية من اليمين إلى اليسار. أيقونة
                 * `ChevronRight` هنا كانت ستشير عكس تدفّق المسار.
                 */}
                <ChevronLeft className="size-3.5" />
              </li>
            </>
          ) : null}
          <li
            aria-current="page"
            className="truncate text-theme-sm font-semibold tracking-tight md:text-theme-xl"
          >
            {page ?? sectionTitle}
          </li>
        </ol>
      </nav>

      <div className="flex shrink-0 items-center gap-1 md:gap-1.5">
        {showSearch ? <GlobalSearch /> : null}
        <NotificationsBell rows={notifications} unread={unreadCount} />
        <ThemeToggle />
        <UserMenu
          userName={userName}
          email={email}
          roleLabel={roleLabel}
          avatarUrl={avatarUrl}
        />
      </div>
    </header>
  );
}
