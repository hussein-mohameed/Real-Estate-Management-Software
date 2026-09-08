import { requireRoleOrRedirect } from "@/lib/auth/guard";
import { one, pageNumber, type SearchParams } from "@/lib/routes/search-params";
import { getLedgerMovementReport } from "@/lib/actions/reports";
import { Money } from "@/components/ui/money";
import { Ltr } from "@/components/ui/ltr";
import { Badge } from "@/components/ui/badge";
import {
  ActionError,
  FilterLink,
  Pager,
  TableCard,
  TableEmpty,
} from "@/components/ui/page";
import { StatCard } from "@/components/ui/stat-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LEDGER_ENTRY_TYPE, LEDGER_SOURCE } from "@/lib/domain/enums";
import { LEDGER_ENTRY_TYPE_AR, LEDGER_SOURCE_AR } from "@/lib/labels";
import { formatBaghdadDateTime } from "@/lib/dates";
import { ReportShell } from "@/components/reports/report-shell";
import { canExportReports, rangeInputFrom } from "../_range";
import { ArrowDownLeft, ArrowUpRight, Scale } from "lucide-react";

/**
 * دفتر الحركة — **يفسّر بقيّة التقارير**.
 *
 * ⚠️ والمجاميع على **المدّة كلّها** لا على الصفحة: مجموعٌ يتغيّر بالتصفيح
 * ليس مجموعاً. راجع `ledgerMovementReport`.
 */

export default async function LedgerReportPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const me = await requireRoleOrRedirect("ADMIN", "OWNER");
  const p = await searchParams;

  const type = LEDGER_ENTRY_TYPE.find((t) => t === one(p["type"]));
  const source = LEDGER_SOURCE.find((s) => s === one(p["source"]));
  const page = pageNumber(p["page"]);

  const result = await getLedgerMovementReport(
    {
      ...rangeInputFrom(p),
      ...(type ? { type } : {}),
      ...(source ? { source } : {}),
      page,
      pageSize: 50,
    },
    { userId: me.id, role: me.role },
  );
  if (!result.ok) return <ActionError message={result.error.message} />;

  const { range, rows, total, chargedIqd, paidIqd, adjustedIqd } = result.data;

  /** يحفظ المدّة عبر روابط الترشيح — وإلا عاد كل ضغطٍ إلى الافتراضي. */
  const keep = `preset=${range.preset}`;

  return (
    <ReportShell
      title="دفتر الحركة"
      description="كل قيدٍ في المدّة بنوعه ومصدره — منه تُفسَّر أرقام التقارير الأخرى."
      basePath="/admin/reports/ledger"
      range={range}
      exportSlug="ledger"
      canExport={canExportReports(me.role)}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="مقيَّد"
          value={<Money value={chargedIqd} />}
          icon={ArrowUpRight}
          tone="info"
        />
        <StatCard
          label="مدفوع"
          value={<Money value={paidIqd} />}
          icon={ArrowDownLeft}
          tone="brand"
        />
        <StatCard
          label="تسويات"
          value={<Money value={adjustedIqd} />}
          icon={Scale}
          tone="neutral"
        />
      </div>

      <nav aria-label="ترشيح بالنوع" className="flex flex-wrap items-center gap-2">
        <FilterLink
          label="كل الأنواع"
          href={`/admin/reports/ledger?${keep}`}
          active={!type}
        />
        {LEDGER_ENTRY_TYPE.map((t) => (
          <FilterLink
            key={t}
            label={LEDGER_ENTRY_TYPE_AR[t]}
            href={`/admin/reports/ledger?${keep}&type=${t}`}
            active={type === t}
          />
        ))}
      </nav>

      <TableCard>
        <Table className="min-w-[52rem]">
          <TableHeader>
            <TableRow>
              <TableHead>الوقت</TableHead>
              <TableHead>النوع</TableHead>
              <TableHead>المصدر</TableHead>
              <TableHead>الشقة</TableHead>
              <TableHead>صاحب الحساب</TableHead>
              <TableHead>الوصف</TableHead>
              <TableHead>المبلغ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableEmpty colSpan={7}>لا قيود في هذه المدّة.</TableEmpty>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="tabular text-theme-xs text-muted-foreground">
                    <Ltr>{formatBaghdadDateTime(r.createdAt)}</Ltr>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        r.type === "PAYMENT"
                          ? "success"
                          : r.type === "CHARGE"
                            ? "info"
                            : "neutral"
                      }
                    >
                      {LEDGER_ENTRY_TYPE_AR[r.type]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-theme-sm">
                    {LEDGER_SOURCE_AR[r.source]}
                  </TableCell>
                  <TableCell className="text-theme-sm">
                    <Ltr>{r.apartmentNumber}</Ltr>
                  </TableCell>
                  <TableCell className="text-theme-sm">{r.holderName}</TableCell>
                  <TableCell className="text-theme-xs text-muted-foreground">
                    {r.descriptionAr}
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

      <Pager
        basePath="/admin/reports/ledger"
        page={page}
        total={total}
        pageSize={50}
        params={p}
      />
    </ReportShell>
  );
}
