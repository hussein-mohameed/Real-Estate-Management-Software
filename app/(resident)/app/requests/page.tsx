import { ClipboardList, Plus } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
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
 * ── 🔴 والإنشاء **عاد** — والقاعدة العامّة لا تسري هنا ───────────────
 * البوّابة للقراءة في المال والعقود والسكان: تلك بيانات تُقرَّر عن الساكن
 * لا يقرّرها. أمّا الطلب فمصفوفة §3.2 تعطيه عليه **`O (create + follow
 * own)`** — الإنشاء نصّاً، لا استنتاجاً.
 *
 * ⚠️ وبوّابةٌ تعرض حالة الطلبات ولا تقبل طلباً تدفع الساكن إلى الهاتف،
 * فيُدخل الموظّف الطلب نيابةً عنه — ويضيع من اشتكى ومتى وبأيّ لفظ، ويصير
 * `createdByUserId` اسم الموظّف في كل صفّ.
 *
 * ✅ ونجا المنطق لأنه لم يُحذف يوم نُزع النموذج: `lib/services/
 * resident-requests.ts` بقي مبنيّاً ومختبَراً على أساس أن ذلك «قرار واجهة
 * قد يُراجَع لا قاعدة أمان» — فكلّف رجوعُه صفحةً واحدة لا إعادة بناء.
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

  /*
   * ⚠️ **`mine: true` صراحةً.** الصفحة عنوانها «طلباتي»، ويفتحها الساكن
   * والموظّف المقيم والأدمن والمالك. والنطاق في الإجراء كان مشروطاً بدور
   * `RESIDENT` وحده — فمن ليس ساكناً كان يقرأ طلبات المجمَّع كلّه تحتها.
   */
  const requests = await listServiceRequests({ page, pageSize: 25, mine: true }, actor);

  if (!requests.ok) {
    return (
      <ActionError message={requests.error.message} />
    );
  }

  /* ⚠️ `openTotal` من القاعدة لا `rows.filter` من الصفحة: العدّ لا يتغيّر بالتصفيح */
  const { rows, total, openTotal, pageSize } = requests.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="طلباتي وشكاواي"
        description="ما طلبتَه وما آل إليه."
        actions={
          <div className="flex items-center gap-3">
            {rows.length > 0 ? (
              <Badge variant={openTotal > 0 ? "warning" : "success"}>
                <span className="tabular">{openTotal}</span> مفتوح
              </Badge>
            ) : null}
            <Button asChild className="gap-2">
              <Link href="/app/requests/new">
                <Plus className="size-4" />
                طلب جديد
              </Link>
            </Button>
          </div>
        }
      />

      {rows.length === 0 ? (
        /*
         * ⚠️ الحالة الفارغة **تدعو إلى الفعل**. «لا طلبات بعد» وحدها تصف
         * الفراغ ولا تقول ما يُفعل به — وهذه أوّل شاشة يراها ساكن جديد.
         */
        <EmptyState
          icon={ClipboardList}
          title="لا طلبات بعد"
          description="صِف مشكلتك وحدّد تصنيفها، ويصل الطلب إلى القسم المختصّ."
          action={
            <Button asChild className="gap-2">
              <Link href="/app/requests/new">
                <Plus className="size-4" />
                طلب جديد
              </Link>
            </Button>
          }
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
