import { requireRoleOrRedirect } from "@/lib/auth/guard";
import type { SearchParams } from "@/lib/routes/search-params";
import { getRequestsReport } from "@/lib/actions/reports";
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
import { REQUEST_STATUS_AR, REQUEST_TYPE_AR } from "@/lib/labels";
import { ReportShell } from "@/components/reports/report-shell";
import { canExportFor, rangeInputFrom } from "../_range";
import { CheckCircle2, Clock, Inbox, UserX } from "lucide-react";

/**
 * تقرير الطلبات.
 *
 * ── ⚠️ رقمان لا رقم واحد ────────────────────────────────────────────
 * **المنجَز في المدّة** يقيس الأداء، و**المفتوح الآن** يقيس المتراكم.
 * وخلطُهما يُنتج «متوسّط إنجاز» يشمل ما لم يُنجَز — رقمٌ **يتحسّن كلّما
 * تراكم العمل**، وهو نقيض ما يُراد قياسه.
 *
 * ولذلك المتوسّط هنا **للمغلق في المدّة وحده**، ويُقال ذلك في وصفه.
 */

export default async function RequestsReportPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const me = await requireRoleOrRedirect("ADMIN", "OWNER");
  const p = await searchParams;

  const result = await getRequestsReport(rangeInputFrom(p), {
    userId: me.id,
    role: me.role,
  });
  if (!result.ok) return <ActionError message={result.error.message} />;

  const d = result.data;

  return (
    <ReportShell
      title="تقرير الطلبات"
      description="ما أُنجز في المدّة، وما ينتظر الآن."
      basePath="/admin/reports/requests"
      range={d.range}
      exportSlug="requests"
      canExport={canExportFor(me.role, "SERVICE_REQUESTS")}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="أُغلق في المدّة"
          value={<span className="tabular">{d.closedInRange}</span>}
          icon={CheckCircle2}
          tone="success"
        />
        <StatCard
          label="متوسّط الإنجاز"
          value={
            /* ⚠️ «—» لا صفر: «لا بيانات» ليست «أُنجزت في يوم صفر» */
            d.avgDaysToClose === null ? (
              "—"
            ) : (
              <span className="tabular">{d.avgDaysToClose} يوم</span>
            )
          }
          hint="للمغلق في المدّة وحده"
          icon={Clock}
          tone="info"
        />
        <StatCard
          label="مفتوح الآن"
          value={<span className="tabular">{d.openTotal}</span>}
          hint="لا علاقة له بالمدّة"
          icon={Inbox}
          tone={d.openTotal > 0 ? "warning" : "success"}
        />
        <StatCard
          label="مفتوح بلا مُكلَّف"
          value={<span className="tabular">{d.openUnassigned}</span>}
          hint="لا أحد يعمل عليه"
          icon={UserX}
          tone={d.openUnassigned > 0 ? "danger" : "success"}
        />
      </div>

      <SectionCard
        title="بالقسم"
        description="المفتوح الآن، والمغلق في المدّة، ومتوسّط إنجازه."
      >
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>القسم</TableHead>
                <TableHead>مفتوح الآن</TableHead>
                <TableHead>أُغلق في المدّة</TableHead>
                <TableHead>متوسّط الإنجاز</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.byDepartment.length === 0 ? (
                <TableEmpty colSpan={4}>لا طلبات.</TableEmpty>
              ) : (
                d.byDepartment.map((x) => (
                  <TableRow key={x.departmentId ?? "none"}>
                    <TableCell className="font-medium">{x.departmentName}</TableCell>
                    <TableCell className="tabular">{x.open}</TableCell>
                    <TableCell className="tabular">{x.closedInRange}</TableCell>
                    <TableCell className="tabular">
                      {x.avgDaysToClose === null ? "—" : `${x.avgDaysToClose} يوم`}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableCard>
      </SectionCard>

      <SectionCard title="المفتوح بالحالة">
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الحالة</TableHead>
                <TableHead>العدد</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.openByStatus.length === 0 ? (
                <TableEmpty colSpan={2}>لا طلبات مفتوحة.</TableEmpty>
              ) : (
                d.openByStatus.map((x) => (
                  <TableRow key={x.status}>
                    <TableCell>
                      <Badge variant={x.status === "NEW" ? "warning" : "info"}>
                        {REQUEST_STATUS_AR[x.status]}
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
        title="أقدم ما ينتظر"
        description="عشرة تكفي لقراءة المتراكم — الأقدم أوّلاً."
      >
        <TableCard>
          <Table className="min-w-[46rem]">
            <TableHeader>
              <TableRow>
                <TableHead>الرقم</TableHead>
                <TableHead>العنوان</TableHead>
                <TableHead>القسم</TableHead>
                <TableHead>المُكلَّف</TableHead>
                <TableHead>مفتوح منذ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.oldestOpen.length === 0 ? (
                <TableEmpty colSpan={5}>لا طلبات مفتوحة.</TableEmpty>
              ) : (
                d.oldestOpen.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="tabular font-medium">
                      <Ltr>{r.number}</Ltr>
                    </TableCell>
                    <TableCell className="text-theme-sm">{r.title}</TableCell>
                    <TableCell className="text-theme-sm">{r.departmentName}</TableCell>
                    <TableCell className="text-theme-sm">
                      {r.assignedTo ?? (
                        <span className="text-destructive">بلا مُكلَّف</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.daysOpen > 7 ? "destructive" : "warning"}>
                        <span className="tabular">{r.daysOpen}</span> يوماً
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableCard>
      </SectionCard>

      <SectionCard title="المغلق بالنوع">
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>النوع</TableHead>
                <TableHead>أُغلق في المدّة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.byType.length === 0 ? (
                <TableEmpty colSpan={2}>لا شيء أُغلق في هذه المدّة.</TableEmpty>
              ) : (
                d.byType.map((x) => (
                  <TableRow key={x.type}>
                    <TableCell>{REQUEST_TYPE_AR[x.type]}</TableCell>
                    <TableCell className="tabular">{x.closedInRange}</TableCell>
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
