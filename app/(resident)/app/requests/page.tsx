import { ClipboardList } from "lucide-react";
import { requireRoleOrRedirect } from "@/lib/auth/guard";
import { pageNumber, type SearchParams } from "@/lib/routes/search-params";
import { listServiceRequests } from "@/lib/actions/requests";
import { Ltr } from "@/components/ui/ltr";
import { Badge } from "@/components/ui/badge";
import {
  ActionError,
  EmptyState,
  PageHeader,
  Pager,
  TableCard,
  TableEmpty,
} from "@/components/ui/page";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { REQUEST_SCOPE_AR, REQUEST_STATUS_AR, REQUEST_TYPE_AR } from "@/lib/labels";
import { formatBaghdadDate } from "@/lib/dates";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  طلباتي وشكاواي.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ⚠️ النطاق يُفرَض في الاستعلام لا في العرض ───────────────────────
 * `listServiceRequests` يرشّح بـ`createdByUserId` للساكن داخل `where`.
 * قائمةٌ تُرجع طلبات الجيران ثم تُرشَّح في الصفحة **أرسلتها فعلاً**.
 *
 * ── 🔴 والبوّابة **للقراءة وحدها** ──────────────────────────────────
 * لا إنشاء ولا تعديل من الساكن في هذه الشاشات — قرار صاحب النظام. فالطلب
 * يُرفَع باتّصال أو مراجعة، وتُدخله الإدارة من `‏/admin/requests/new`.
 *
 * ⚠️ ونُزع النموذج **من الصفحة لا من الخادم**: النطاق البنيويّ في
 * `lib/services/resident-requests.ts` يبقى مبنيّاً ومختبَراً، لأن القرار
 * هنا قرار واجهة قد يُراجَع — لا قاعدة أمان. وحذفُ المنطق كان سيُلزم
 * إعادة كتابته وإعادة اختباره لو عاد الطلب الذاتي.
 */

export default async function MyRequestsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const me = await requireRoleOrRedirect("RESIDENT", "STAFF", "ADMIN", "OWNER");
  const p = await searchParams;
  const page = pageNumber(p["page"]);
  const actor = { userId: me.id, role: me.role };

  const requests = await listServiceRequests({ page, pageSize: 25 }, actor);

  if (!requests.ok) {
    return (
      <ActionError message={requests.error.message} />
    );
  }

  const { rows, total, pageSize } = requests.data;

  const open = rows.filter((r) => r.status !== "DONE" && r.status !== "CANCELLED").length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="طلباتي وشكاواي"
        description="ما طلبتَه وما آل إليه. الطلب الجديد يُرفَع عبر الإدارة."
        actions={
          rows.length > 0 ? (
            <Badge variant={open > 0 ? "warning" : "success"}>
              <span className="tabular">{open}</span> مفتوح
            </Badge>
          ) : null
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="لا طلبات بعد"
          description="ما يُرفَع باسمك يظهر هنا بحالته، وتصلك ردود الإدارة عليه."
        />
      ) : (
        <>
          <TableCard>
            <Table className="min-w-[44rem]">
              <TableHeader>
                <TableRow>
                  <TableHead>الرقم</TableHead>
                  <TableHead>العنوان</TableHead>
                  <TableHead>الموضوع</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>التاريخ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableEmpty colSpan={5}>لا طلبات.</TableEmpty>
                ) : (
                  rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="tabular font-medium">
                        {/* ⚠️ `Ltr`: رقم الطلب لاتيني ويتفتّت في RTL */}
                        <Ltr>{r.number}</Ltr>
                      </TableCell>

                      <TableCell className="text-theme-sm">
                        {r.title}
                        <span className="block text-theme-xs text-muted-foreground">
                          {REQUEST_TYPE_AR[r.type]}
                        </span>
                      </TableCell>

                      <TableCell className="text-theme-sm">
                        {r.scope === "COMMON_AREA" ? (
                          <Badge variant="neutral">
                            {REQUEST_SCOPE_AR.COMMON_AREA}
                          </Badge>
                        ) : (
                          <Ltr>{r.apartment?.displayNumber ?? "—"}</Ltr>
                        )}
                      </TableCell>

                      <TableCell>
                        <Badge
                          variant={
                            r.status === "DONE"
                              ? "success"
                              : r.status === "CANCELLED"
                                ? "neutral"
                                : r.status === "NEW"
                                  ? "warning"
                                  : "info"
                          }
                        >
                          {REQUEST_STATUS_AR[r.status]}
                        </Badge>
                      </TableCell>

                      <TableCell className="tabular text-theme-xs text-muted-foreground">
                        <Ltr>{formatBaghdadDate(r.createdAt)}</Ltr>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableCard>

          <Pager
        basePath={"/app/requests"}
        page={page}
        total={total}
        pageSize={pageSize}
        params={p}
      />
        </>
      )}
    </div>
  );
}
