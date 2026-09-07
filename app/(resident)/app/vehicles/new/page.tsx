import Link from "next/link";
import { Car } from "lucide-react";
import { requireRoleOrRedirect } from "@/lib/auth/guard";
import { getMyHome } from "@/lib/actions/resident-portal";
import { ActionError, EmptyState, PageHeader } from "@/components/ui/page";
import { RegisterVehicleForm } from "./register-form";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  تسجيل مركبة — §3.2 «‏W (own — pending admin approval)» · الخطوة 4.1.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ⚠️ **وبلا باج.** إصدار الباج محجوب بـ`B3`: للشقة حسابان ممكنان بعد
 * `D1`، ورسمُه يُقيَّد على أحدهما ولم يُحسم أيّهما. والتسجيل لا ينتظره —
 * مركبةٌ مسجَّلة ومعتمَدة بيانٌ صحيح بذاته، والباج يُصدَر فوقه لاحقاً.
 */

export default async function RegisterVehiclePage() {
  const me = await requireRoleOrRedirect("RESIDENT", "STAFF", "ADMIN", "OWNER");
  const home = await getMyHome({}, { userId: me.id, role: me.role });

  if (!home.ok) return <ActionError message={home.error.message} />;

  const apartments = home.data.apartments.map((a) => ({
    id: a.id,
    label: a.displayNumber,
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="تسجيل مركبة"
        description="تُسجَّل معلّقة، وتدخل البوّابة بعد اعتماد الإدارة."
      />

      <nav aria-label="مسار" className="text-theme-xs text-muted-foreground">
        <Link href="/app/vehicles" className="hover:underline">
          سيارتي
        </Link>
      </nav>

      {apartments.length === 0 ? (
        <EmptyState
          icon={Car}
          title="لا شقة مرتبطة بحسابك"
          description="المركبة تُسجَّل على وحدة سكنية. راجع الإدارة لربط حسابك بشقّتك."
        />
      ) : (
        <RegisterVehicleForm apartments={apartments} />
      )}
    </div>
  );
}
