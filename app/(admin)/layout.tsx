import { AppShell } from "@/components/shell/app-shell";
import { requireRoleOrRedirect } from "@/lib/auth/guard";
import { ADMIN_NAV } from "@/lib/nav";

/** المالك يدخل هنا **للعرض** — §9.1 ينصّ عليه، وD3/1 يفسّره. */
/**
 * ⚠️ `LayoutProps<"/">` لا `LayoutProps<"/admin">`: مجموعة المسارات
 * `(admin)` **لا تضيف مقطعاً للمسار**، فالتخطيط يقع على الجذر. أنواع
 * Next 16 المولَّدة تؤكّده: `type LayoutRoutes = "/"`.
 */
export default async function AdminLayout({ children }: LayoutProps<"/">) {
  const user = await requireRoleOrRedirect("ADMIN", "OWNER");
  return (
    <AppShell
      role={user.role}
      userName={user.fullName}
      email={user.email}
      avatarUrl={user.avatarUrl}
      title="لوحة الإدارة"
      nav={ADMIN_NAV}
    >
      {children}
    </AppShell>
  );
}
