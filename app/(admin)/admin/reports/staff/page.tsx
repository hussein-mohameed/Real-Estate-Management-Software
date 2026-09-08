import { requireRoleOrRedirect } from "@/lib/auth/guard";
import { getStaffReport } from "@/lib/actions/reports";
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
import { EMPLOYMENT_TYPE_AR } from "@/lib/labels";
import type { EmploymentType } from "@/lib/domain/enums";
import { ReportShell } from "@/components/reports/report-shell";
import { canExportFor } from "../_range";
import { Banknote, Network, UserCheck, IdCard } from "lucide-react";

/**
 * تقرير الموظفين — **عبء عمل لا مبالغ**.
 *
 * 🔴 ولا عمود «حصّل كذا» هنا. تحصيل الموظف يعيش تحت `FINANCIAL_REPORTS`
 * بعد أن كُشف أنه كان مقروءاً بقدرة إدارة الموظفين — أي أن كل موظّف كان
 * يقرأ نقد زملائه. وإضافتُه هنا تُعيد الثغرة من باب التقارير.
 */

export default async function StaffReportPage() {
  const me = await requireRoleOrRedirect("ADMIN", "OWNER");

  const result = await getStaffReport({}, { userId: me.id, role: me.role });
  if (!result.ok) return <ActionError message={result.error.message} />;

  const d = result.data;

  return (
    <ReportShell
      title="تقرير الموظفين"
      description="التوزيع على الأقسام، والتواجد، وعبء العمل المفتوح."
      basePath="/admin/reports/staff"
      range={null}
      exportSlug="staff"
      canExport={canExportFor(me.role, "DEPARTMENTS_SKILLS_STAFF")}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="موظفون نشطون"
          value={<span className="tabular">{d.total}</span>}
          icon={IdCard}
          tone="brand"
        />
        <StatCard
          label="متواجدون"
          value={<span className="tabular">{d.available}</span>}
          icon={UserCheck}
          tone="success"
        />
        <StatCard
          label="بلا قسم"
          value={<span className="tabular">{d.unassignedDepartment}</span>}
          hint="لا تصلهم طلبات القسم"
          icon={Network}
          tone={d.unassignedDepartment > 0 ? "warning" : "neutral"}
        />
        <StatCard
          label="لهم صلاحية القبض"
          value={<span className="tabular">{d.cashPermitted}</span>}
          hint="استثناء لا قاعدة (‏B4)"
          icon={Banknote}
          tone="info"
        />
      </div>

      <SectionCard title="بالقسم" description="العدد والتواجد والطلبات المفتوحة.">
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>القسم</TableHead>
                <TableHead>الموظفون</TableHead>
                <TableHead>المتواجدون</TableHead>
                <TableHead>طلبات مفتوحة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.byDepartment.length === 0 ? (
                <TableEmpty colSpan={4}>لا موظفين.</TableEmpty>
              ) : (
                d.byDepartment.map((x) => (
                  <TableRow key={x.departmentId ?? "none"}>
                    <TableCell className="font-medium">{x.departmentName}</TableCell>
                    <TableCell className="tabular">{x.total}</TableCell>
                    <TableCell className="tabular">{x.available}</TableCell>
                    <TableCell className="tabular">{x.openRequests}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableCard>
      </SectionCard>

      <SectionCard
        title="عبء العمل"
        description="مرتَّبٌ بالأكثر انشغالاً — منه يُقرأ من يُسنَد إليه التالي."
      >
        <TableCard>
          <Table className="min-w-[46rem]">
            <TableHeader>
              <TableRow>
                <TableHead>الموظف</TableHead>
                <TableHead>القسم</TableHead>
                <TableHead>الصفة</TableHead>
                <TableHead>التواجد</TableHead>
                <TableHead>مهارات</TableHead>
                <TableHead>طلبات مفتوحة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.rows.length === 0 ? (
                <TableEmpty colSpan={6}>لا موظفين.</TableEmpty>
              ) : (
                d.rows.map((s) => (
                  <TableRow key={s.userId}>
                    <TableCell className="font-medium">
                      {s.name}
                      {s.jobTitle ? (
                        <span className="block text-theme-xs text-muted-foreground">
                          {s.jobTitle}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-theme-sm">{s.departmentName}</TableCell>
                    <TableCell className="text-theme-sm">
                      {EMPLOYMENT_TYPE_AR[s.employmentType as EmploymentType]}
                    </TableCell>
                    <TableCell>
                      <Badge variant={s.isAvailable ? "success" : "neutral"}>
                        {s.isAvailable ? "متواجد" : "غير متواجد"}
                      </Badge>
                    </TableCell>
                    <TableCell className="tabular">{s.skills}</TableCell>
                    <TableCell className="tabular font-medium">{s.openRequests}</TableCell>
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
