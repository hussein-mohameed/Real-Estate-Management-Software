import { Car } from "lucide-react";
import { requireRoleOrRedirect } from "@/lib/auth/guard";
import { getMyVehicles } from "@/lib/actions/resident-portal";
import { Ltr } from "@/components/ui/ltr";
import { Badge } from "@/components/ui/badge";
import { ActionError, EmptyState, PageHeader, SectionCard } from "@/components/ui/page";
import { BADGE_STATUS_AR, VEHICLE_STATUS_AR } from "@/lib/labels";
import { formatBaghdadDate } from "@/lib/dates";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  سيارتي.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ⚠️ ما لا يُعرَض هنا: رسم الباج ──────────────────────────────────
 * `feeIqd` مستثنى من الاستعلام نفسه. الرسم يُقيَّد على الحساب ويُقرأ من
 * كشفه — وعرضُه على البطاقة يجعل الساكن يظنّه مبلغاً ثانياً مطلوباً.
 *
 * ── وحالة الباج **مشتقّة من التاريخ** لا مقروءة من العمود ──────────
 * ⚠️ باجٌ حالته `ISSUED` وتاريخه مضى هو **منتهٍ** فعلاً، ومهمّة الصيانة
 * تقلبه ليلاً. وعرضُه «ساري» بين القلب والانتهاء يجعل الساكن يقف عند
 * البوّابة واثقاً ثم يُردّ.
 */

export default async function MyVehiclesPage() {
  const me = await requireRoleOrRedirect("RESIDENT", "STAFF", "ADMIN", "OWNER");
  const result = await getMyVehicles({}, { userId: me.id, role: me.role });

  if (!result.ok) {
    return (
      <ActionError message={result.error.message} />
    );
  }

  const { rows: vehicles } = result.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="سيارتي"
        description="مركباتك المسجَّلة وباجات الدخول. والتسجيل يجري في الإدارة."
      />

      {vehicles.length === 0 ? (
        <EmptyState
          icon={Car}
          title="لا مركبات مسجَّلة"
          description="تسجيل المركبة وإصدار الباج يجريان في إدارة المجمَّع."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {vehicles.map((v) => (
            <SectionCard
              key={v.id}
              title={v.plateNumber}
              description={`${v.plateProvince} · الشقة ${v.apartment?.displayNumber ?? "—"}`}
              actions={
                <Badge variant={v.status === "APPROVED" ? "success" : v.status === "REJECTED" ? "destructive" : "neutral"}>
                  {VEHICLE_STATUS_AR[v.status]}
                </Badge>
              }
            >
              {v.badge === null ? (
                <p className="text-theme-sm text-muted-foreground">
                  {/*
                    ⚠️ «لا باج» ≠ «ممنوع الدخول»: الأولى حالة تُعالَج في
                    الإدارة، والثانية حكم لا يقوله هذا النظام.
                  */}
                  لا باج على هذه المركبة. الإصدار يجري في الإدارة.
                </p>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="tabular min-w-0 flex-1 font-medium">
                    <Ltr>{v.badge.code ?? "—"}</Ltr>
                  </span>

                  {/*
                    ⚠️ `effectiveStatus` لا `status`: باجٌ حالته `ISSUED`
                    وتاريخه مضى هو **منتهٍ** فعلاً، والمهمّة الليلية تقلبه.
                    وعرضُه «ساري» بينهما يجعل الساكن يقف عند البوّابة واثقاً
                    ثم يُردّ.
                  */}
                  <Badge
                    variant={
                      v.badge.effectiveStatus === "ISSUED"
                        ? "success"
                        : v.badge.effectiveStatus === "EXPIRED"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {BADGE_STATUS_AR[v.badge.effectiveStatus]}
                  </Badge>

                  {v.badge.expiresAt ? (
                    <span className="tabular text-theme-xs text-muted-foreground">
                      حتى <Ltr>{formatBaghdadDate(v.badge.expiresAt)}</Ltr>
                    </span>
                  ) : null}
                </div>
              )}
            </SectionCard>
          ))}
        </div>
      )}
    </div>
  );
}
