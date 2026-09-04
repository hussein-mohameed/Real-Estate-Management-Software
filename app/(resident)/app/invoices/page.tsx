import { requireRoleOrRedirect } from "@/lib/auth/guard";
import { pageNumber, type SearchParams } from "@/lib/routes/search-params";
import { getMyInvoices } from "@/lib/actions/resident-portal";
import { Money } from "@/components/ui/money";
import { Ltr } from "@/components/ui/ltr";
import { ActionError, PageHeader, Pager, TableCard, TableEmpty } from "@/components/ui/page";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBaghdadDateTime } from "@/lib/dates";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  الفواتير.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ⚠️ الفاتورة **إقرار استلام** لا مطالبة ──────────────────────────
 * تصدر مع كل دفعة سُدّدت — فما هنا مالٌ **دخل** لا مالٌ مطلوب. والمطلوب
 * يُقرأ من كشف الحساب. وخلطُ الاثنين يجعل الساكن يظنّ أن عليه مبلغاً دفعه.
 *
 * ── وما لا يُعرَض ───────────────────────────────────────────────────
 * لقطة البنود ورابط الملفّ مستثنيان من الاستعلام نفسه — لا من العرض.
 */

export default async function MyInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const me = await requireRoleOrRedirect("RESIDENT", "STAFF", "ADMIN", "OWNER");
  const p = await searchParams;
  const page = pageNumber(p["page"]);

  const result = await getMyInvoices({ page, pageSize: 25 }, { userId: me.id, role: me.role });

  if (!result.ok) {
    return (
      <ActionError message={result.error.message} />
    );
  }

  const { rows, total, pageSize } = result.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="الفواتير"
        description="وصلٌ لكل دفعة سُدّدت. وما عليك يُقرأ من كشف الحساب."
      />

      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الرقم</TableHead>
              <TableHead>التاريخ</TableHead>
              <TableHead>الشقة</TableHead>
              <TableHead>المبلغ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableEmpty colSpan={4}>
                {/*
                  ⚠️ «لم تُسدَّد دفعة بعد» لا «لا فواتير»: الأولى تشرح السبب،
                  والثانية تُقرأ كأن شيئاً ضاع.
                */}
                لا فواتير — لم تُسجَّل دفعة على حسابك بعد.
              </TableEmpty>
            ) : (
              rows.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="tabular font-medium">
                    {/* ⚠️ `Ltr`: رقم الفاتورة لاتيني ويتفتّت في RTL */}
                    <Ltr>{inv.number}</Ltr>
                  </TableCell>

                  <TableCell className="tabular text-theme-sm text-muted-foreground">
                    <Ltr>{formatBaghdadDateTime(inv.issuedAt)}</Ltr>
                  </TableCell>

                  <TableCell className="text-theme-sm">
                    <Ltr>{inv.account.apartment?.displayNumber ?? "—"}</Ltr>
                  </TableCell>

                  <TableCell className="tabular font-medium">
                    <Money value={inv.totalIqd} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableCard>

      <Pager
        basePath={"/app/invoices"}
        page={page}
        total={total}
        pageSize={pageSize}
        params={p}
      />
    </div>
  );
}
