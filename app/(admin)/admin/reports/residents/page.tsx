import { requireRoleOrRedirect } from "@/lib/auth/guard";
import { getResidentsReport } from "@/lib/actions/reports";
import { Ltr } from "@/components/ui/ltr";
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
import { RESIDENT_RELATION_AR } from "@/lib/labels";
import { ReportShell } from "@/components/reports/report-shell";
import { canExportFor } from "../_range";
import { Home, UserMinus, Users, UsersRound } from "lucide-react";

/**
 * تقرير السكان — **الحال الآن**.
 *
 * ⚠️ و«غير المرتبطين» أهمّ رقم فيه: حسابٌ نشط بلا شقة لا يرى شيئاً في
 * بوّابته ولا يُفوتَر — ولا شاشة أخرى تُظهره، لأن كل جدول يبدأ من الشقة.
 */

export default async function ResidentsReportPage() {
  const me = await requireRoleOrRedirect("ADMIN", "OWNER");

  const result = await getResidentsReport({}, { userId: me.id, role: me.role });
  if (!result.ok) return <ActionError message={result.error.message} />;

  const d = result.data;

  return (
    <ReportShell
      title="تقرير السكان"
      description="من يسكن أين، وكم — والحسابات التي لم تُربَط بعد."
      basePath="/admin/reports/residents"
      range={null}
      exportSlug="residents"
      canExport={canExportFor(me.role, "RESIDENT_PROFILES")}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="سكّان نشطون"
          value={<span className="tabular">{d.activeResidents}</span>}
          icon={Users}
          tone="brand"
        />
        <StatCard
          label="حسابات معطَّلة"
          value={<span className="tabular">{d.inactiveResidents}</span>}
          icon={UserMinus}
          tone="neutral"
        />
        <StatCard
          label="نشطون بلا شقة"
          value={<span className="tabular">{d.unlinkedActive}</span>}
          hint="لا يرون بوّابتهم ولا يُفوتَرون"
          icon={UsersRound}
          tone={d.unlinkedActive > 0 ? "warning" : "success"}
        />
        <StatCard
          label="شقق مسكونة"
          value={
            <span className="tabular">
              {d.byBuilding.reduce((n, b) => n + b.apartmentsWithResidents, 0)}
            </span>
          }
          icon={Home}
          tone="info"
        />
      </div>

      <SectionCard title="بالبناية">
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>البناية</TableHead>
                <TableHead>شقق مسكونة</TableHead>
                <TableHead>سكّان</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.byBuilding.length === 0 ? (
                <TableEmpty colSpan={3}>لا بنايات.</TableEmpty>
              ) : (
                d.byBuilding.map((b) => (
                  <TableRow key={b.buildingId}>
                    <TableCell className="font-medium">
                      <Ltr>{b.buildingCode}</Ltr>
                      {b.buildingName ? (
                        <span className="block text-theme-xs text-muted-foreground">
                          {b.buildingName}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="tabular">{b.apartmentsWithResidents}</TableCell>
                    <TableCell className="tabular font-medium">{b.residents}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableCard>
      </SectionCard>

      <SectionCard title="بالعلاقة" description="صفة الساكن في الشقة.">
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>العلاقة</TableHead>
                <TableHead>العدد</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.byRelation.length === 0 ? (
                <TableEmpty colSpan={2}>لا روابط.</TableEmpty>
              ) : (
                d.byRelation.map((r) => (
                  <TableRow key={r.relation}>
                    <TableCell>{RESIDENT_RELATION_AR[r.relation]}</TableCell>
                    <TableCell className="tabular">{r.count}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableCard>
      </SectionCard>

      <SectionCard
        title="أكبر البيوت"
        description="يُقرأ منه أثر التسعير «بالفرد» — عشرة تكفي."
      >
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الشقة</TableHead>
                <TableHead>البناية</TableHead>
                <TableHead>عدد السكان</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.largestHouseholds.length === 0 ? (
                <TableEmpty colSpan={3}>لا شقق مسكونة.</TableEmpty>
              ) : (
                d.largestHouseholds.map((h) => (
                  <TableRow key={h.apartmentId}>
                    <TableCell className="font-medium">
                      <Ltr>{h.displayNumber}</Ltr>
                    </TableCell>
                    <TableCell className="text-theme-sm">
                      <Ltr>{h.buildingCode}</Ltr>
                    </TableCell>
                    <TableCell className="tabular">{h.residents}</TableCell>
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
