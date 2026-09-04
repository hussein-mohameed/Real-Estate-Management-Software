import { AppShell } from "@/components/shell/app-shell";
import { requireRoleOrRedirect } from "@/lib/auth/guard";
import { STAFF_NAV } from "@/lib/nav";

/** §9.1: `/staff` تسمح للأدمن والمالك أيضاً — ليست حصرية على الموظف. */
/**
 * ⚠️ `LayoutProps<"/">` لا `LayoutProps<"/staff">`: مجموعة المسارات
 * `(staff)` **لا تضيف مقطعاً للمسار**، فالتخطيط يقع على الجذر. أنواع
 * Next 16 المولَّدة تؤكّده: `type LayoutRoutes = "/"`.
 */
export default async function StaffLayout({ children }: LayoutProps<"/">) {
  const user = await requireRoleOrRedirect("STAFF", "ADMIN", "OWNER");
  return (
    <AppShell
      role={user.role}
      userName={user.fullName}
      email={user.email}
      avatarUrl={user.avatarUrl}
      title="لوحة الموظف"
      nav={STAFF_NAV}
    >
      {children}
    </AppShell>
  );
}
