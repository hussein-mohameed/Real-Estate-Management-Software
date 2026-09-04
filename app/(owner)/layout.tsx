import { AppShell } from "@/components/shell/app-shell";
import { requireRoleOrRedirect } from "@/lib/auth/guard";
import { OWNER_NAV } from "@/lib/nav";

/**
 * الطبقة الثانية من التحصين (‏§10.3).
 *
 * ⚠️ تحكم بأدوار **القراءة** لا الكتابة (‏D3/1). لذلك `(admin)` يسمح
 * للمالك بالعرض كما في §9.1، ومنعُه من الكتابة يقع على كل Server Action
 * على حدة. خلط المعيارين هو ما يجعل مصفوفة §3.2 تبدو متناقضة.
 */
/**
 * ⚠️ `LayoutProps<"/">` لا `LayoutProps<"/owner">`: مجموعة المسارات
 * `(owner)` **لا تضيف مقطعاً للمسار**، فالتخطيط يقع على الجذر. أنواع
 * Next 16 المولَّدة تؤكّده: `type LayoutRoutes = "/"`.
 */
export default async function OwnerLayout({ children }: LayoutProps<"/">) {
  const user = await requireRoleOrRedirect("OWNER");
  return (
    <AppShell
      role={user.role}
      userName={user.fullName}
      email={user.email}
      avatarUrl={user.avatarUrl}
      title="لوحة المالك"
      nav={OWNER_NAV}
    >
      {children}
    </AppShell>
  );
}
