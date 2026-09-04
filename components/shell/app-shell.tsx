import { ROLE_LABELS_AR, type UserRole } from "@/lib/auth/roles";
import type { NavItem } from "@/lib/nav";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { myNotifications } from "@/lib/actions/notifications";
import { AppSidebar } from "./app-sidebar";
import { AppTopbar } from "./app-topbar";

/**
 * القشرة المشتركة — §11.2.
 *
 * ── البنية من shadcn ────────────────────────────────────────────────
 *   SidebarProvider
 *   ├── AppSidebar        (side="right" · collapsible="icon")
 *   └── SidebarInset
 *       ├── AppTopbar     (طيّ + مسار + بحث + جرس + سمة + مستخدم)
 *       └── المحتوى
 *
 * ── ما يعطيه `SidebarProvider` ولم يكن عندي ────────────────────────
 *   • حالة الطيّ **محفوظة في كوكي** — تبقى بين الجلسات.
 *   • اختصار `Ctrl/⌘ + B` للطيّ.
 *   • تحويل تلقائي إلى درج على الهاتف، بلا مكوّن ثانٍ أكتبه.
 *
 * ── ولماذا تُجلَب الإخطارات **هنا** ────────────────────────────────
 * ⚠️ القشرة مكوّن **خادم**، فالجرس يُصيَّر بعدده الحقيقي مع الصفحة —
 * بلا طلب ثانٍ من المتصفّح بعد الترطيب، وبلا وميض «0» يتحوّل إلى رقم.
 * والاستعلام واحد لكل صفحة لأن القشرة في `layout` لا في كل صفحة.
 *
 * ── RTL ─────────────────────────────────────────────────────────────
 * `side="right"` **فيزيائي مقصود**: جهة البدء في العربية هي اليمين.
 * وما عدا ذلك خصائص منطقية — قاعدة ESLint واختبار `ui-rtl` يحرسان ذلك.
 *
 * ── المحتوى بحدّ أقصى ──────────────────────────────────────────────
 * `max-w-screen-2xl` موسَّطاً: بلا حدّ تمتدّ الجداول على شاشة 4K حتى يصير
 * تتبّع الصفّ بالعين مستحيلاً.
 */

/**
 * أدوار البحث العامّ.
 *
 * ⚠️ مقصورة على من ثبت نطاق قراءته للشقق والسكان والعقود — راجع تعليق
 * `globalSearch`. والقائمة هنا **مرآة** لما يفحصه الإجراء نفسه: لو
 * اتّسعت هنا وحدها لظهر زرٌّ يُرجع فراغاً دائماً.
 */
const SEARCH_ROLES: readonly UserRole[] = ["ADMIN", "OWNER"];

export async function AppShell({
  role,
  userName,
  email,
  avatarUrl,
  nav,
  title,
  children,
}: {
  role: UserRole;
  userName: string;
  email: string | null;
  avatarUrl: string | null;
  nav: readonly NavItem[];
  title: string;
  children: React.ReactNode;
}) {
  const bell = await myNotifications();

  return (
    <SidebarProvider>
      <AppSidebar nav={nav} />

      <SidebarInset>
        <AppTopbar
          sectionTitle={title}
          roleLabel={ROLE_LABELS_AR[role]}
          nav={nav}
          userName={userName}
          email={email}
          avatarUrl={avatarUrl}
          notifications={bell.rows}
          unreadCount={bell.unread}
          showSearch={SEARCH_ROLES.includes(role)}
        />

        <div className="mx-auto w-full max-w-screen-2xl flex-1 p-4 md:p-6">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

export type { NavItem };
