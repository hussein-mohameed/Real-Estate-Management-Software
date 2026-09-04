import Link from "next/link";
import { requireRoleOrRedirect } from "@/lib/auth/guard";
import { listApartments } from "@/lib/actions/apartments";
import { listDepartmentTasks } from "@/lib/actions/departments";
import { PageHeader } from "@/components/ui/page";
import { CreateRequestForm } from "./create-form";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  طلب جديد — الخطوة 4.4.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ⚠️ المهامّ **المفعَّلة** وحدها ──────────────────────────────────
 * الموقوفة يرفضها الإجراء، وعرضُها في القائمة يدعو إلى اختيارها ثم يردّ
 * الاختيار — وهذا هو سبب وجود الإيقاف أصلاً: ألّا تُسنَد إليها طلبات جديدة.
 */

export default async function NewRequestPage() {
  const me = await requireRoleOrRedirect("ADMIN");
  const actor = { userId: me.id, role: me.role };

  const [apartments, tasks] = await Promise.all([
    listApartments({ pageSize: 200 }, actor),
    listDepartmentTasks({ includeInactive: false, pageSize: 200 }, actor),
  ]);

  const apartmentOptions = apartments.ok
    ? apartments.data.rows.map((a) => ({ id: a.id, label: a.displayNumber }))
    : [];

  const taskOptions = tasks.ok
    ? tasks.data.rows.map((t) => ({
        id: t.id,
        /* ⚠️ القسم في التسمية: مهمّتان بنفس الاسم في قسمين تُربكان بلا ذلك */
        label: `${t.departmentName} · ${t.name}`,
      }))
    : [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="طلب جديد"
        description="الإدارة تُنشئ نيابةً عن ساكن اتّصل، أو لعملٍ في منطقة مشتركة."
      />

      <nav aria-label="مسار" className="text-theme-xs text-muted-foreground">
        <Link href="/admin/requests" className="hover:underline">
          الطلبات والشكاوى
        </Link>
      </nav>

      <CreateRequestForm apartments={apartmentOptions} tasks={taskOptions} />
    </div>
  );
}
