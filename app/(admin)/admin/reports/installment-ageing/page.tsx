import { requireRoleOrRedirect } from "@/lib/auth/guard";
import { getInstallmentAgeingReport } from "@/lib/actions/reports";
import { Money } from "@/components/ui/money";
import { Ltr } from "@/components/ui/ltr";
import { Badge } from "@/components/ui/badge";
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
import { CalendarClock } from "lucide-react";

/**
 * تقادُم الأقساط.
 *
 * 🔴 التأخّر يُحسب من `dueDate` لا من `status`: `OVERDUE` تكتبها مهمّة
 * ليلية، فقسطٌ استحقّ صباح اليوم يبقى `PENDING` حتى الليل. وتقريرٌ يقرأ
 * الحالة وحدها يُسقط يوماً كاملاً — والفرق يظهر في أوّل يوم من كل شهر،
 * وهو أكثر يوم يُقرأ فيه التقرير.
 */

export default async function AgeingReportPage() {
  const me = await requireRoleOrRedirect("ADMIN", "OWNER");

  const result = await getInstallmentAgeingReport({}, { userId: me.id, role: me.role });
  if (!result.ok) return <ActionError message={result.error.message} />;

  const { buckets, rows, totalIqd } = result.data;

  return (
    <ReportShell
      title="تقادُم الأقساط"
      description="كل قسطٍ مضى استحقاقه ولم يُسدَّد، مرتَّباً بالأقدم."
      basePath="/admin/reports/installment-ageing"
      range={null}
      exportSlug="installment-ageing"
      canExport={canExportReports(me.role)}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {buckets.map((b) => (
          <StatCard
            key={b.key}
            label={b.labelAr}
            value={<Money value={b.totalIqd} />}
            hint={`${b.count} قسطاً`}
            icon={CalendarClock}
            /* ⚠️ اللون يتدرّج مع الشريحة — تسعون يوماً ليست كثلاثين */
            tone={
              b.key === "d30"
                ? "warning"
                : b.key === "d60"
                  ? "warning"
                  : "danger"
            }
          />
        ))}
      </div>

      <TableCard>
        <Table className="min-w-[54rem]">
          <TableHeader>
            <TableRow>
              <TableHead>العقد</TableHead>
              <TableHead>الشقة</TableHead>
              <TableHead>صاحب العقد</TableHead>
              <TableHead>الهاتف</TableHead>
              <TableHead>القسط</TableHead>
              <TableHead>الاستحقاق</TableHead>
              <TableHead>التأخّر</TableHead>
              <TableHead>المبلغ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableEmpty colSpan={8}>لا قسط متأخّر. كلّ الجداول منتظمة.</TableEmpty>
            ) : (
              rows.map((r) => (
                <TableRow key={r.installmentId}>
                  <TableCell className="tabular text-theme-sm">
                    <Ltr>{r.contractNumber}</Ltr>
                  </TableCell>
                  <TableCell className="text-theme-sm">
                    <Ltr>{r.apartmentNumber}</Ltr>
                  </TableCell>
                  <TableCell className="font-medium">{r.holderName}</TableCell>
                  <TableCell className="tabular text-theme-sm">
                    <Ltr>{formatPhoneForDisplay(r.holderPhone)}</Ltr>
                  </TableCell>
                  <TableCell className="tabular text-muted-foreground">
                    {r.sequence}
                  </TableCell>
                  <TableCell className="tabular text-theme-sm">
                    <Ltr>{formatBaghdadDate(r.dueDate)}</Ltr>
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.daysLate > 60 ? "destructive" : "warning"}>
                      <span className="tabular">{r.daysLate}</span> يوماً
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium">
                    <Money value={r.amountIqd} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableCard>

      <p className="text-theme-xs text-muted-foreground">
        الإجمالي المتأخّر: <Money value={totalIqd} />
      </p>
    </ReportShell>
  );
}
