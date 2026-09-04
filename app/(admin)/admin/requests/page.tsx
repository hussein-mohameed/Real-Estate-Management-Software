import Link from "next/link";
import { requireRoleOrRedirect } from "@/lib/auth/guard";
import { one, pageNumber, type SearchParams } from "@/lib/routes/search-params";
import { listServiceRequests } from "@/lib/actions/requests";
import { listDepartments } from "@/lib/actions/staff";
import { Ltr } from "@/components/ui/ltr";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Field } from "@/components/ui/field";
import { ActionError, PageHeader, Pager, TableCard, TableEmpty } from "@/components/ui/page";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  PRIORITY_AR,
  REQUEST_SCOPE_AR,
  REQUEST_STATUS_AR,
  REQUEST_TYPE_AR,
} from "@/lib/labels";
import { REQUEST_STATUS, REQUEST_TYPE } from "@/lib/domain/enums";
import { formatBaghdadDate } from "@/lib/dates";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  الطلبات والشكاوى — الخطوة 4.4.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ⚠️ الترتيب بالأولوية ثم الأقدم ──────────────────────────────────
 * قائمةٌ مرتَّبة بالتاريخ وحده تدفن طلباً عاجلاً وصل اليوم تحت ثلاثين
 * طلباً عادياً وصلت أمس. والأقدم داخل الأولوية الواحدة، فلا يُنسى أحد.
 *
 * ── والمنطقة المشتركة تُميَّز في الجدول ─────────────────────────────
 * ⚠️ `Q35`: شكوى المصعد لا شقة لها. وعمودُ شقةٍ فارغ يُقرأ «بيانات ناقصة»
 * بينما هو الصواب — فيُقال «منطقة مشتركة» صراحةً.
 */

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const me = await requireRoleOrRedirect("ADMIN", "OWNER", "STAFF");
  const p = await searchParams;
  const actor = { userId: me.id, role: me.role };

  const statusParam = one(p["status"]);
  const status = REQUEST_STATUS.find((s) => s === statusParam);
  const typeParam = one(p["type"]);
  const type = REQUEST_TYPE.find((t) => t === typeParam);
  const departmentId = one(p["dept"]);
  const search = one(p["q"]);
  const page = pageNumber(p["page"]);

  const [requests, departments] = await Promise.all([
    listServiceRequests(
      {
        ...(status ? { status } : {}),
        ...(type ? { type } : {}),
        ...(departmentId ? { departmentId } : {}),
        ...(search ? { search } : {}),
        page,
        pageSize: 25,
      },
      actor,
    ),
    listDepartments({ includeInactive: false }, actor),
  ]);

  if (!requests.ok) {
    return (
      <ActionError message={requests.error.message} />
    );
  }

  const { rows, total, pageSize } = requests.data;
  const depts = departments.ok ? departments.data : [];
  const openCount = rows.filter(
    (r) => r.status !== "DONE" && r.status !== "CANCELLED",
  ).length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="الطلبات والشكاوى"
        description="مرتَّبة بالأولوية ثم الأقدم — فلا يُدفَن عاجلٌ تحت عادي."
        actions={
          <span className="flex flex-wrap items-center gap-2">
            {me.role === "ADMIN" ? (
              <Button asChild size="sm">
                <Link href="/admin/requests/new">طلب جديد</Link>
              </Button>
            ) : null}
            <Badge variant={openCount > 0 ? "warning" : "success"}>
              <span className="tabular">{openCount}</span> مفتوح في هذه الصفحة
            </Badge>
          </span>
        }
      />

      {/* المرشّحات — نموذج GET، فتبقى الحالة في العنوان وتُشارَك */}
      <form className="grid gap-4 rounded-2xl border bg-card p-5 md:grid-cols-5">
        <Field label="بحث" htmlFor="q" hint="برقم الطلب أو عنوانه أو رقم الشقة">
          <Input
            id="q"
            name="q"
            type="search"
            defaultValue={search ?? ""}
            placeholder="REQ-2026 · تسرّب · BRJ-1-2"
            aria-describedby="q-hint"
          />
        </Field>

        <Field label="الحالة" htmlFor="status">
          <NativeSelect id="status" name="status" defaultValue={status ?? ""}>
            <option value="">الكل</option>
            {REQUEST_STATUS.map((s) => (
              <option key={s} value={s}>
                {REQUEST_STATUS_AR[s]}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field label="النوع" htmlFor="type">
          <NativeSelect id="type" name="type" defaultValue={type ?? ""}>
            <option value="">الكل</option>
            {REQUEST_TYPE.map((t) => (
              <option key={t} value={t}>
                {REQUEST_TYPE_AR[t]}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field label="القسم" htmlFor="dept">
          <NativeSelect id="dept" name="dept" defaultValue={departmentId ?? ""}>
            <option value="">الكل</option>
            {depts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <div className="flex flex-wrap items-end gap-2">
          <Button type="submit" size="sm">
            ترشيح
          </Button>
          {search || status || type || departmentId ? (
            <Button asChild size="sm" variant="ghost">
              <Link href="/admin/requests">مسح</Link>
            </Button>
          ) : null}
        </div>
      </form>

      <TableCard>
        <Table className="min-w-[60rem]">
          <TableHeader>
            <TableRow>
              <TableHead>الرقم</TableHead>
              <TableHead>العنوان</TableHead>
              <TableHead>الموضوع</TableHead>
              <TableHead>القسم</TableHead>
              <TableHead>المُكلَّف</TableHead>
              <TableHead>الأولوية</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead>التاريخ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableEmpty colSpan={8}>
                {search || status || type || departmentId
                  ? "لا طلب يطابق الترشيح."
                  : "لا طلبات بعد. يُنشئها الساكن من بوّابته، أو الإدارة من هنا."}
              </TableEmpty>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="tabular font-medium">
                    {/* ⚠️ `Ltr`: رقم الطلب لاتيني ويتفتّت في RTL */}
                    <Link href={`/admin/requests/${r.id}`} className="hover:underline">
                      <Ltr>{r.number}</Ltr>
                    </Link>
                  </TableCell>

                  <TableCell className="text-theme-sm">
                    {r.title}
                    <span className="block text-theme-xs text-muted-foreground">
                      {REQUEST_TYPE_AR[r.type]}
                    </span>
                  </TableCell>

                  <TableCell className="text-theme-sm">
                    {/*
                      ⚠️ «منطقة مشتركة» تُقال صراحةً: عمود شقةٍ فارغ يُقرأ
                      «بيانات ناقصة» بينما هو الصواب (‏Q35).
                    */}
                    {r.scope === "COMMON_AREA" ? (
                      <Badge variant="neutral">{REQUEST_SCOPE_AR.COMMON_AREA}</Badge>
                    ) : (
                      <Ltr>{r.apartment?.displayNumber ?? "—"}</Ltr>
                    )}
                  </TableCell>

                  <TableCell className="text-theme-sm text-muted-foreground">
                    {r.department?.name ?? "—"}
                  </TableCell>

                  <TableCell className="text-theme-sm text-muted-foreground">
                    {r.assignedStaff?.user.fullName ?? "—"}
                  </TableCell>

                  <TableCell>
                    <Badge
                      variant={
                        r.priority === "HIGH"
                          ? "destructive"
                          : r.priority === "LOW"
                            ? "neutral"
                            : "warning"
                      }
                    >
                      {PRIORITY_AR[r.priority]}
                    </Badge>
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
        basePath={"/admin/requests"}
        page={page}
        total={total}
        pageSize={pageSize}
        params={p}
      />
    </div>
  );
}
