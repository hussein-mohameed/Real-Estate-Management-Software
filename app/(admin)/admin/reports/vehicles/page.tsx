import { requireRoleOrRedirect } from "@/lib/auth/guard";
import { getVehiclesReport } from "@/lib/actions/reports";
import { Ltr } from "@/components/ui/ltr";
import { Badge } from "@/components/ui/badge";
import { ActionError, SectionCard, TableCard, TableEmpty } from "@/components/ui/page";
import { StatCard } from "@/components/ui/stat-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BADGE_STATUS_AR, VEHICLE_STATUS_AR } from "@/lib/labels";
import { ReportShell } from "@/components/reports/report-shell";
import { canExportFor } from "../_range";
import { AlertTriangle, Car, IdCard, ShieldOff } from "lucide-react";

/**
 * تقرير المركبات والباجات.
 *
 * ── 🔴 الباج يُعدّ بحالته **المشتقّة** لا بعمودها ────────────────────
 * `EXPIRED` تكتبها مهمّة ليلية، فباجٌ انتهى صباح اليوم يبقى `ISSUED` في
 * القاعدة. وتقريرٌ يعدّ العمود يقول «كذا باجاً سارياً» وفيها منتهية —
 * والحارس عند البوّابة يبني عليها.
 *
 * ⚠️ و«عمودها ساري وتاريخها مضى» يُعرَض **رقماً مستقلّاً**: هو مقياس
 * تأخّر المهمّة الليلية، ولا شاشة أخرى تُظهره.
 */

export default async function VehiclesReportPage() {
  const me = await requireRoleOrRedirect("ADMIN", "OWNER");

  const result = await getVehiclesReport({}, { userId: me.id, role: me.role });
  if (!result.ok) return <ActionError message={result.error.message} />;

  const d = result.data;

  return (
    <ReportShell
      title="تقرير المركبات"
      description="المسجَّل والمعتمَد، وحال الباجات عند البوّابة."
      basePath="/admin/reports/vehicles"
      range={null}
      exportSlug="vehicles"
      canExport={canExportFor(me.role, "VEHICLES")}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="مركبات مسجَّلة"
          value={<span className="tabular">{d.total}</span>}
          icon={Car}
          tone="brand"
        />
        <StatCard
          label="باجات سارية"
          value={
            <span className="tabular">
              {d.badgesByEffectiveStatus.find((b) => b.status === "ISSUED")?.count ?? 0}
            </span>
          }
          hint="بالحالة المشتقّة من التاريخ"
          icon={IdCard}
          tone="success"
        />
        <StatCard
          label="معتمَدة بلا باج ساري"
          value={<span className="tabular">{d.approvedWithoutValidBadge}</span>}
          hint="تقف عند البوّابة ولا تدخل"
          icon={ShieldOff}
          tone={d.approvedWithoutValidBadge > 0 ? "warning" : "success"}
        />
        <StatCard
          label="باج منتهٍ لم يُقلَب"
          value={<span className="tabular">{d.staleIssuedBadges}</span>}
          hint="عمودها ساري وتاريخها مضى"
          icon={AlertTriangle}
          tone={d.staleIssuedBadges > 0 ? "danger" : "success"}
        />
      </div>

      {d.staleIssuedBadges > 0 ? (
        <p className="rounded-xl border border-warning-200 bg-warning-25 p-4 text-theme-sm dark:border-warning-500/30 dark:bg-warning-500/5">
          ⚠️ هناك <span className="tabular">{d.staleIssuedBadges}</span> باجاً عمودُه
          «صادر» وتاريخه مضى — المهمّة الليلية لم تقلبه بعد. الشاشات تعرضه منتهياً
          بالاشتقاق، لكن أي قارئٍ للعمود مباشرةً سيراه سارياً.
        </p>
      ) : null}

      <SectionCard title="المركبات بالحالة">
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الحالة</TableHead>
                <TableHead>العدد</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.byStatus.length === 0 ? (
                <TableEmpty colSpan={2}>لا مركبات مسجَّلة.</TableEmpty>
              ) : (
                d.byStatus.map((x) => (
                  <TableRow key={x.status}>
                    <TableCell>
                      <Badge
                        variant={
                          x.status === "APPROVED"
                            ? "success"
                            : x.status === "PENDING_APPROVAL"
                              ? "warning"
                              : x.status === "REJECTED"
                                ? "destructive"
                                : "neutral"
                        }
                      >
                        {VEHICLE_STATUS_AR[x.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="tabular">{x.count}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableCard>
      </SectionCard>

      <SectionCard
        title="الباجات بالحالة المشتقّة"
        description="محسوبةٌ من تاريخ الانتهاء لا من العمود."
      >
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الحالة</TableHead>
                <TableHead>العدد</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.badgesByEffectiveStatus.length === 0 ? (
                <TableEmpty colSpan={2}>لا باجات مُصدَرة.</TableEmpty>
              ) : (
                d.badgesByEffectiveStatus.map((x) => (
                  <TableRow key={x.status}>
                    <TableCell>
                      <Badge
                        variant={
                          x.status === "ISSUED"
                            ? "success"
                            : x.status === "EXPIRED"
                              ? "warning"
                              : "neutral"
                        }
                      >
                        {BADGE_STATUS_AR[x.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="tabular">{x.count}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableCard>
      </SectionCard>

      <SectionCard title="بالبناية">
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>البناية</TableHead>
                <TableHead>مركبات</TableHead>
                <TableHead>معتمَدة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.byBuilding.length === 0 ? (
                <TableEmpty colSpan={3}>لا مركبات.</TableEmpty>
              ) : (
                d.byBuilding.map((b) => (
                  <TableRow key={b.buildingCode}>
                    <TableCell className="font-medium">
                      <Ltr>{b.buildingCode}</Ltr>
                    </TableCell>
                    <TableCell className="tabular">{b.vehicles}</TableCell>
                    <TableCell className="tabular">{b.approved}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableCard>
      </SectionCard>
    </ReportShell>
  );
}
