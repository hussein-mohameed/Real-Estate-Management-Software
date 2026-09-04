import Link from "next/link";
import { requireRoleOrRedirect } from "@/lib/auth/guard";
import { listContracts } from "@/lib/actions/contracts";
import { listInstallmentPlans } from "@/lib/actions/installments";
import { ActionError, PageHeader } from "@/components/ui/page";
import { MigrateForm } from "./migrate-form";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  ترحيل عقد قائم إلى خطة أقساط — `N3` (محسوم 2026-09-02).
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── متى تُستعمل ─────────────────────────────────────────────────────
 * **مرّة واحدة** عند إدخال النظام: عقودٌ وُقّعت قبله وسُدّد منها جزء. وبعدها
 * تُنشأ الخطط من صفحة العقد بالمسار العادي.
 *
 * ── ⚠️ ولماذا صفحة منفصلة عن الإنشاء ────────────────────────────────
 * الترحيل يكسر قواعد التشغيل اليومي **عمداً**: بلا صندوق نقد، وبتواريخ
 * ماضية، وبلا فاتورة. وخلطُه مع «إنشاء خطة» في نموذج واحد كان يجعل
 * استثناءاته تبدو خياراً متاحاً في العمل اليومي.
 */

export default async function MigratePage() {
  const me = await requireRoleOrRedirect("ADMIN");
  const actor = { userId: me.id, role: me.role };

  const [contracts, plans] = await Promise.all([
    listContracts({ status: "ACTIVE", pageSize: 200 }, actor),
    listInstallmentPlans({ pageSize: 100 }, actor),
  ]);

  if (!contracts.ok) {
    return (
      <ActionError message={contracts.error.message} />
    );
  }

  /*
   * ── ⚠️ الاستثناء تسهيلٌ لا ضمانة ───────────────────────────────────
   * الضمانة الحقيقية في الخادم: `InstallmentPlan.contractId` فريد،
   * والإجراء يرفض المكرَّر برسالة صريحة. وهذا هنا يُنظّف القائمة وحدها.
   *
   * ويصحّ تماماً في اللحظة التي تهمّ: الترحيل يجري عند إدخال النظام حين
   * لا خطط بعد. ولو تجاوز عددها الصفحة، ظهر عقدٌ مُرحَّل في القائمة —
   * فيردّه الخادم بسببه مكتوباً، لا يقبله صامتاً.
   */
  const migrated = new Set(
    plans.ok ? plans.data.rows.map((p) => p.contractId) : [],
  );

  const options = contracts.data.rows
    .filter((c) => !migrated.has(c.id))
    .map((c) => ({
      id: c.id,
      label: `${c.contractNumber} · ${c.holder.fullName} · ${c.apartment?.displayNumber ?? "بلا شقة"}`,
    }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="ترحيل عقد قائم"
        description="عقدٌ وُقّع قبل النظام وسُدّد منه جزء — تُنشأ خطّته كاملة بأقساطها الماضية."
      />

      <nav aria-label="مسار" className="text-theme-xs text-muted-foreground">
        <Link href="/admin/installments" className="hover:underline">
          متابعة الأقساط
        </Link>
      </nav>

      {options.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-8 text-center">
          <p className="text-theme-sm font-medium">لا عقد مؤهَّل للترحيل</p>
          <p className="mt-1 text-theme-xs text-muted-foreground">
            {/*
              ⚠️ السببان مختلفان ويُقالان معاً: «لا عقود نشطة» و«كلّها
              رُحِّلت» حالتان مختلفتان، وجملةٌ واحدة غامضة تترك الأدمن
              يخمّن أيّهما.
            */}
            إمّا لا عقود نشطة بعد، وإمّا أن كل العقود النشطة عليها خطط سلفاً.
          </p>
        </div>
      ) : (
        <MigrateForm contracts={options} />
      )}
    </div>
  );
}
