import { requireRoleOrRedirect } from "@/lib/auth/guard";
import { getOutstandingReport } from "@/lib/actions/reports";
import { Money } from "@/components/ui/money";
import { Ltr } from "@/components/ui/ltr";
import { ActionError, TableCard, TableEmpty } from "@/components/ui/page";
import { StatCard } from "@/components/ui/stat-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatPhoneForDisplay } from "@/lib/domain/phone";
import { formatBaghdadDate } from "@/lib/dates";
import { ReportShell } from "@/components/reports/report-shell";
import { canExportReports } from "../_range";
import { Users, Wallet } from "lucide-react";

/**
 * تقرير المستحقّات — **الرصيد الآن**.
 *
 * ⚠️ يقرأ `Account.balanceIqd` ولا يُعيد جمع القيود: الرصيد يُحسب داخل
 * معاملة القيد، ومهمّةٌ ليلية تكشف انحرافه. وجمعٌ ثانٍ هنا يفتح مساراً
 * ثالثاً للحساب — فيصير الاختلاف بين رقمين كلاهما «صحيح».
 */

export default async function OutstandingReportPage() {
  const me = await requireRoleOrRedirect("ADMIN", "OWNER");

  const result = await getOutstandingReport({}, { userId: me.id, role: me.role });
  if (!result.ok) return <ActionError message={result.error.message} />;

  const { rows, totalIqd, debtorCount } = result.data;

  return (
    <ReportShell
      title="تقرير المستحقّات"
      description="كل حسابٍ عليه رصيد اليوم، من الأكبر إلى الأصغر."
      basePath="/admin/reports/outstanding"
      range={null}
      exportSlug="outstanding"
      canExport={canExportReports(me.role)}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          label="إجمالي المستحقّ"
          value={<Money value={totalIqd} />}
          icon={Wallet}
          tone="danger"
        />
        <StatCard
          label="حسابات مدينة"
          value={<span className="tabular">{debtorCount}</span>}
          icon={Users}
          tone="neutral"
        />
      </div>

      <TableCard>
        <Table className="min-w-[48rem]">
          <TableHeader>
            <TableRow>
              <TableHead>الشقة</TableHead>
              <TableHead>صاحب الحساب</TableHead>
              <TableHead>الهاتف</TableHead>
              <TableHead>أقدم قيد</TableHead>
              <TableHead>الرصيد</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableEmpty colSpan={5}>لا حساب عليه رصيد. كلّ شيء مسدَّد.</TableEmpty>
            ) : (
              rows.map((r) => (
                <TableRow key={r.accountId}>
                  <TableCell className="text-theme-sm">
                    <Ltr>{r.apartmentNumber}</Ltr>
                    <span className="block text-theme-xs text-muted-foreground">
                      {r.buildingCode}
                    </span>
                  </TableCell>
                  <TableCell className="font-medium">{r.holderName}</TableCell>
                  <TableCell className="tabular text-theme-sm">
                    <Ltr>{formatPhoneForDisplay(r.holderPhone)}</Ltr>
                  </TableCell>
                  <TableCell className="tabular text-theme-xs text-muted-foreground">
                    {r.oldestChargeAt ? (
                      <Ltr>{formatBaghdadDate(r.oldestChargeAt)}</Ltr>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="font-medium text-destructive">
                    <Money value={r.balanceIqd} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableCard>
    </ReportShell>
  );
}
