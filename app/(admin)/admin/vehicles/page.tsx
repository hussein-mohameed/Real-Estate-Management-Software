import { requireRoleOrRedirect } from "@/lib/auth/guard";
import { one, pageNumber, type SearchParams } from "@/lib/routes/search-params";
import { listVehicles } from "@/lib/actions/vehicles";
import { listApartments } from "@/lib/actions/apartments";
import { Ltr } from "@/components/ui/ltr";
import { Badge } from "@/components/ui/badge";
import {
  ActionError,
  FilterLink,
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
import { VEHICLE_STATUS_AR } from "@/lib/labels";
import { formatBaghdadDate } from "@/lib/dates";
import { VehicleActions } from "./row-actions";
import { AddVehicleForm } from "./create-form";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  المركبات — الخطوة 4.1 (بلا الباج).
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── 🔴 لماذا وُجدت هذه الشاشة مع تسجيل الساكن لا بعده ───────────────
 * التسجيل الذاتي يُنتج صفوفاً `PENDING_APPROVAL`. وبلا شاشةٍ تعرضها تبقى
 * معلّقة إلى الأبد: الساكن سجّل وينتظر، ولا أحد يعرف أن هناك ما ينتظر.
 *
 * وهو نفس ما أُصلح في «إلغاء الاشتراك»: علمٌ بلا شاشة ليس ميزة.
 *
 * ── وما ليس فيها: الباج ─────────────────────────────────────────────
 * ⚠️ محجوب بـ`B3` — على حساب مَن يُقيَّد الرسم حين يكون للشقة حسابان
 * (‏D1)؟ والعمود يعرض **وجوده** لا تفاصيله: مركبةٌ تحتها باجٌ ساري لا
 * تُرفَع، والشاشة تقول ذلك قبل أن يحاول الأدمن.
 */

const STATUSES = ["PENDING_APPROVAL", "APPROVED", "REJECTED", "REMOVED"] as const;

/**
 * ⚠️ **نفس نمط بقيّة صفحات القائمة** لا `PageProps<"…">` — الأخير يعتمد
 * أنواعاً يولّدها Next عند البناء، فمسارٌ جديد لا يُصرَّف قبل أوّل بناء.
 */
export default async function VehiclesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const me = await requireRoleOrRedirect("ADMIN", "OWNER");
  const p = await searchParams;

  const statusParam = one(p["status"]);
  const status = STATUSES.find((s) => s === statusParam);
  const search = one(p["q"])?.trim();
  const page = pageNumber(p["page"]);

  const result = await listVehicles(
    {
      ...(status ? { status } : {}),
      ...(search ? { search } : {}),
      page,
    },
    { userId: me.id, role: me.role },
  );

  if (!result.ok) return <ActionError message={result.error.message} />;

  const { rows, total, pageSize, pendingCount } = result.data;
  /** ⚠️ المالك يقرأ ولا يكتب (‏D3/2) — فلا أزرار له بدل أزرار تفشل. */
  const canAct = me.role === "ADMIN";

  const apartments = canAct
    ? await listApartments({ pageSize: 200 }, { userId: me.id, role: me.role })
    : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="المركبات"
        description="ما سجّله السكان وما اعتمدته الإدارة. البوّابة تقرأ المعتمَد وحده."
        actions={
          pendingCount > 0 ? (
            <Badge variant="warning">
              <span className="tabular">{pendingCount}</span> بانتظار الاعتماد
            </Badge>
          ) : (
            <Badge variant="success">لا شيء ينتظر الاعتماد</Badge>
          )
        }
      />

      {canAct ? (
        <AddVehicleForm
          apartments={
            apartments?.ok
              ? apartments.data.rows.map((a) => ({ id: a.id, label: a.displayNumber }))
              : []
          }
        />
      ) : null}

      {/* المرشّحات — روابط لا نموذج، فتبقى الحالة في العنوان ويُشارَك */}
      <nav aria-label="ترشيح بالحالة" className="flex flex-wrap items-center gap-2">
        <FilterLink label="الكل" href="/admin/vehicles" active={!status} />
        {STATUSES.map((s) => (
          <FilterLink
            key={s}
            label={VEHICLE_STATUS_AR[s]}
            href={`/admin/vehicles?status=${s}`}
            active={status === s}
          />
        ))}
      </nav>

      <TableCard>
        <Table className="min-w-[52rem]">
          <TableHeader>
            <TableRow>
              <TableHead>اللوحة</TableHead>
              <TableHead>المركبة</TableHead>
              <TableHead>الشقة</TableHead>
              <TableHead>المالك</TableHead>
              <TableHead>سُجّلت</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead>أفعال</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableEmpty colSpan={7}>
                {status
                  ? `لا مركبة بحالة «${VEHICLE_STATUS_AR[status]}».`
                  : "لا مركبات بعد. يسجّلها الساكن من بوّابته، أو تُدخلها الإدارة."}
              </TableEmpty>
            ) : (
              rows.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="tabular font-medium">
                    {/* ⚠️ `Ltr`: رقم اللوحة لاتيني ويتفتّت في RTL */}
                    <Ltr>{v.plateNumber}</Ltr>
                    {v.plateProvince ? (
                      <span className="block text-theme-xs text-muted-foreground">
                        {v.plateProvince}
                      </span>
                    ) : null}
                  </TableCell>

                  <TableCell className="text-theme-sm">
                    {[v.make, v.model].filter(Boolean).join(" ") || "—"}
                    {v.color ? (
                      <span className="block text-theme-xs text-muted-foreground">
                        {v.color}
                      </span>
                    ) : null}
                  </TableCell>

                  <TableCell className="text-theme-sm">
                    <Ltr>{v.apartment.displayNumber}</Ltr>
                  </TableCell>

                  <TableCell className="text-theme-sm">
                    {v.owner?.fullName ?? "—"}
                  </TableCell>

                  <TableCell className="tabular text-theme-xs text-muted-foreground">
                    <Ltr>{formatBaghdadDate(v.createdAt)}</Ltr>
                  </TableCell>

                  <TableCell>
                    <Badge
                      variant={
                        v.status === "APPROVED"
                          ? "success"
                          : v.status === "PENDING_APPROVAL"
                            ? "warning"
                            : v.status === "REJECTED"
                              ? "destructive"
                              : "neutral"
                      }
                    >
                      {VEHICLE_STATUS_AR[v.status]}
                    </Badge>
                    {/*
                      ⚠️ وجود الباج يُعرَض هنا لا في عمود مستقلّ: هو **قيدٌ
                      على الرفع** لا خاصيّةٌ للمركبة. والأدمن يقرؤه في
                      اللحظة التي يقرّر فيها.
                    */}
                    {v._count.badges > 0 ? (
                      <span className="block text-theme-xs text-muted-foreground">
                        عليها <span className="tabular">{v._count.badges}</span> باج
                      </span>
                    ) : null}
                    {v.notes ? (
                      <span className="block text-theme-xs text-muted-foreground">
                        {v.notes}
                      </span>
                    ) : null}
                  </TableCell>

                  <TableCell>
                    {canAct ? (
                      <VehicleActions
                        vehicleId={v.id}
                        plateNumber={v.plateNumber}
                        status={v.status}
                        apartmentNumber={v.apartment.displayNumber}
                      />
                    ) : (
                      <span className="text-theme-xs text-muted-foreground">قراءة</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableCard>

      <Pager basePath="/admin/vehicles" page={page} total={total} pageSize={pageSize} params={p} />
    </div>
  );
}
