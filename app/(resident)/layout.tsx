import { AppShell } from "@/components/shell/app-shell";
import { requireRoleOrRedirect } from "@/lib/auth/guard";
import { RESIDENT_NAV } from "@/lib/nav";

/**
 * بوابة الساكن.
 *
 * ⚠️ `STAFF` مسموح هنا عمداً (‏Q41): الموظف المقيم دوره `STAFF` ولا يتغيّر،
 * ونطاقه السكني يأتي من `residentApartmentIds` لا من الدور. بدون هذا يبقى
 * الحارس المقيم بلا كشف حساب ولا طريق لدفع اشتراكاته.
 */
/**
 * ⚠️ `LayoutProps<"/">` لا `LayoutProps<"/resident">`: مجموعة المسارات
 * `(resident)` **لا تضيف مقطعاً للمسار**، فالتخطيط يقع على الجذر. أنواع
 * Next 16 المولَّدة تؤكّده: `type LayoutRoutes = "/"`.
 */
export default async function ResidentLayout({ children }: LayoutProps<"/">) {
  const user = await requireRoleOrRedirect("RESIDENT", "STAFF", "ADMIN", "OWNER");
  return (
    <AppShell
      role={user.role}
      userName={user.fullName}
      email={user.email}
      avatarUrl={user.avatarUrl}
      title="بوّابة الساكن"
      nav={RESIDENT_NAV}
    >
      {children}
    </AppShell>
  );
}
