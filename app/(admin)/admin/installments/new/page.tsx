import Link from "next/link";
import { requireRoleOrRedirect } from "@/lib/auth/guard";
import { listContracts } from "@/lib/actions/contracts";
import { listInstallmentPlans } from "@/lib/actions/installments";
import { openDrawerIdFor } from "@/lib/services/cash-drawer";
import { ActionError, PageHeader } from "@/components/ui/page";
import { CreatePlanForm } from "./create-form";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  خطة أقساط جديدة — الخطوة 3.5 · القرار `B1`.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ⚠️ حالة الصندوق تُقرأ في الخادم ─────────────────────────────────
 * المتصفّح لا يعرف صناديق أحد، والشرط يُفرَض في الإجراء على أي حال. لكن
 * قراءتَه هنا تجعل الشاشة **تقول الشرط قبل ملء النموذج** بدل أن ترفض
 * بعده — ومن يملأ عشرة حقول ثم يُردّ يظنّ الشاشة معطوبة.
 */

export default async function NewPlanPage() {
  const me = await requireRoleOrRedirect("ADMIN");
  const actor = { userId: me.id, role: me.role };

  const [contracts, plans, drawerId] = await Promise.all([
    listContracts({ status: "ACTIVE", pageSize: 200 }, actor),
    listInstallmentPlans({ pageSize: 100 }, actor),
    openDrawerIdFor(me.id),
  ]);

  if (!contracts.ok) {
    return (
      <ActionError message={contracts.error.message} />
    );
  }

  /*
   * ⚠️ الاستثناء تسهيلٌ لا ضمانة — الضمانة `contractId` الفريد في المخطّط،
   * والإجراء يرفض المكرَّر برسالة صريحة.
   */
  const planned = new Set(plans.ok ? plans.data.rows.map((p) => p.contractId) : []);

  const options = contracts.data.rows
    .filter((c) => !planned.has(c.id))
    .map((c) => ({
      id: c.id,
      label: `${c.contractNumber} · ${c.holder.fullName} · ${c.apartment?.displayNumber ?? "بلا شقة"}`,
    }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="خطة أقساط جديدة"
        description="لعقد وُقّع في هذا النظام. والعقد القائم قبله له شاشة الترحيل."
      />

      <nav aria-label="مسار" className="text-theme-xs text-muted-foreground">
        <Link href="/admin/installments" className="hover:underline">
          متابعة الأقساط
        </Link>
      </nav>

      {options.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-8 text-center">
          <p className="text-theme-sm font-medium">لا عقد بلا خطة</p>
          <p className="mt-1 text-theme-xs text-muted-foreground">
            إمّا لا عقود نشطة بعد، وإمّا أن كل العقود النشطة عليها خطط سلفاً.
          </p>
        </div>
      ) : (
        <CreatePlanForm contracts={options} hasOpenDrawer={drawerId !== null} />
      )}
    </div>
  );
}
