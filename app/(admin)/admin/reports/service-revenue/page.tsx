import { requireRoleOrRedirect } from "@/lib/auth/guard";
import type { SearchParams } from "@/lib/routes/search-params";
import { getServiceRevenueReport } from "@/lib/actions/reports";
import { Money } from "@/components/ui/money";
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
import { ReportShell } from "@/components/reports/report-shell";
import { canExportReports, rangeInputFrom } from "../_range";
import { Banknote, FileSignature } from "lucide-react";

/**
 * إيراد الخدمات — **المقيَّد** لكل خدمة.
 *
 * ── 🔴 ولماذا لا يُقسَّم المحصَّل على الخدمات ───────────────────────
 * الدفعة تُسدَّد على **الحساب** لا على قيدٍ بعينه. فقولُ «حُصّل من خدمة
 * المولّدة كذا» يحتاج قاعدة توزيع — الأقدم أوّلاً؟ بالتناسب؟ — وهي قرارٌ
 * محاسبيّ لم يُتّخذ في هذا النظام.
 *
 * فالجدول يعرض المقيَّد لكل خدمة، والمحصَّل **مجموعاً على حِدَة**، ويقول
 * صراحةً إنهما لا يُقسَّمان. ورقمٌ مخترَع يبدو دقيقاً أسوأ من رقمٍ ناقص
 * يقول إنه ناقص.
 */

export default async function ServiceRevenueReportPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const me = await requireRoleOrRedirect("ADMIN", "OWNER");
  const p = await searchParams;

  const result = await getServiceRevenueReport(rangeInputFrom(p), {
    userId: me.id,
    role: me.role,
  });
  if (!result.ok) return <ActionError message={result.error.message} />;

  const { range, rows, chargedTotalIqd, collectedTotalIqd } = result.data;

  return (
    <ReportShell
      title="إيراد الخدمات"
      description="ما قُيّد على الحسابات في المدّة، لكل خدمة."
      basePath="/admin/reports/service-revenue"
      range={range}
      exportSlug="service-revenue"
      canExport={canExportReports(me.role)}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          label="المقيَّد في المدّة"
          value={<Money value={chargedTotalIqd} />}
          hint="دَينٌ نشأ على الحسابات"
          icon={FileSignature}
          tone="info"
        />
        <StatCard
          label="المحصَّل في المدّة"
          value={<Money value={collectedTotalIqd} />}
          hint="نقدٌ دخل — لا يُنسَب إلى خدمة"
          icon={Banknote}
          tone="brand"
        />
      </div>

      <p className="rounded-xl bg-muted p-3 text-theme-xs text-muted-foreground">
        ⚠️ الرقمان لا يُطرح أحدهما من الآخر: المقيَّد التزامٌ نشأ في المدّة،
        والمحصَّل قد يكون سداداً لالتزامٍ أقدم. والدفعة تُسدَّد على الحساب لا
        على خدمة، فلا تُقسَّم عليها.
      </p>

      <TableCard>
        <Table className="min-w-[44rem]">
          <TableHeader>
            <TableRow>
              <TableHead>الخدمة</TableHead>
              <TableHead>المقيَّد</TableHead>
              <TableHead>عدد القيود</TableHead>
              <TableHead>اشتراكات نشطة</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableEmpty colSpan={4}>لا قيود خدمات في هذه المدّة.</TableEmpty>
            ) : (
              rows.map((r) => (
                <TableRow key={r.serviceId}>
                  <TableCell className="font-medium">
                    {r.serviceName}
                    {r.isMandatory ? (
                      <Badge variant="neutral" className="ms-2">
                        إلزامية
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-medium">
                    <Money value={r.chargedIqd} />
                  </TableCell>
                  <TableCell className="tabular">{r.chargeCount}</TableCell>
                  {/* ⚠️ «نشطة الآن» لا «في المدّة» — والعنوان يقولها */}
                  <TableCell className="tabular">{r.activeSubscriptions}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableCard>
    </ReportShell>
  );
}
