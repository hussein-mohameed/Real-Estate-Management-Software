import { requireRoleOrRedirect } from "@/lib/auth/guard";
import type { SearchParams } from "@/lib/routes/search-params";
import { getCollectionsReport } from "@/lib/actions/reports";
import { Money } from "@/components/ui/money";
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
import { PAYMENT_METHOD_AR } from "@/lib/labels";
import { ReportShell } from "@/components/reports/report-shell";
import { canExportReports, rangeInputFrom } from "../_range";
import { Banknote, Receipt } from "lucide-react";

/**
 * تقرير التحصيل — **ما دخل الصندوق**.
 *
 * ⚠️ لا يُخلط بـ«المقيَّد»: هذا نقدٌ قُبض، وذاك دَينٌ نشأ. والعنوان يقولها.
 */

export default async function CollectionsReportPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const me = await requireRoleOrRedirect("ADMIN", "OWNER");
  const p = await searchParams;

  const result = await getCollectionsReport(rangeInputFrom(p), {
    userId: me.id,
    role: me.role,
  });
  if (!result.ok) return <ActionError message={result.error.message} />;

  const { range, totalIqd, count, byMethod, byDay, byCollector } = result.data;

  return (
    <ReportShell
      title="تقرير التحصيل"
      description="ما قُبض فعلاً في المدّة — نقداً أو برابط دفع. لا يشمل ما قُيّد ولم يُدفع."
      basePath="/admin/reports/collections"
      range={range}
      exportSlug="collections"
      canExport={canExportReports(me.role)}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          label="إجمالي المحصَّل"
          value={<Money value={totalIqd} />}
          icon={Banknote}
          tone="brand"
        />
        <StatCard
          label="عدد الدفعات"
          value={<span className="tabular">{count}</span>}
          icon={Receipt}
          tone="neutral"
        />
      </div>

      <SectionCard title="بالطريقة" description="نقدٌ في المركز أم رابط دفع.">
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الطريقة</TableHead>
                <TableHead>العدد</TableHead>
                <TableHead>المبلغ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byMethod.length === 0 ? (
                <TableEmpty colSpan={3}>لا تحصيل في هذه المدّة.</TableEmpty>
              ) : (
                byMethod.map((m) => (
                  <TableRow key={m.method}>
                    <TableCell>{PAYMENT_METHOD_AR[m.method]}</TableCell>
                    <TableCell className="tabular">{m.count}</TableCell>
                    <TableCell className="font-medium">
                      <Money value={m.totalIqd} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableCard>
      </SectionCard>

      <SectionCard
        title="باليوم"
        description="بحدود بغداد — يطابق إقفال الصندوق الذي يقفله المحصِّل."
      >
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>اليوم</TableHead>
                <TableHead>العدد</TableHead>
                <TableHead>المبلغ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byDay.length === 0 ? (
                <TableEmpty colSpan={3}>لا تحصيل في هذه المدّة.</TableEmpty>
              ) : (
                byDay.map((d) => (
                  <TableRow key={d.day}>
                    <TableCell className="tabular">
                      <Ltr>{d.day}</Ltr>
                    </TableCell>
                    <TableCell className="tabular">{d.count}</TableCell>
                    <TableCell className="font-medium">
                      <Money value={d.totalIqd} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableCard>
      </SectionCard>

      <SectionCard title="بالمحصِّل" description="من قبض، وكم.">
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>المحصِّل</TableHead>
                <TableHead>العدد</TableHead>
                <TableHead>المبلغ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byCollector.length === 0 ? (
                <TableEmpty colSpan={3}>لا تحصيل في هذه المدّة.</TableEmpty>
              ) : (
                byCollector.map((c) => (
                  <TableRow key={c.userId}>
                    <TableCell>{c.name}</TableCell>
                    <TableCell className="tabular">{c.count}</TableCell>
                    <TableCell className="font-medium">
                      <Money value={c.totalIqd} />
                    </TableCell>
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
