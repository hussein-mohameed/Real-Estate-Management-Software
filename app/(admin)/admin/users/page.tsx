import { requireRoleOrRedirect } from "@/lib/auth/guard";
import { listUsers } from "@/lib/actions/users";
import { ROLE_LABELS_AR, type UserRole } from "@/lib/auth/roles";
import { formatPhoneForDisplay } from "@/lib/domain/phone";
import { formatBaghdadDateTime } from "@/lib/dates";
import { Ltr } from "@/components/ui/ltr";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader, TableCard, TableEmpty } from "@/components/ui/page";
import { PaginationNav } from "@/components/ui/pagination-nav";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CreateUserForm } from "./create-user-form";
import { ToggleActiveButton } from "./toggle-active";

/**
 * شاشة إدارة المستخدمين — الخطوة 0.14.
 *
 * ── تشريح صفحة القائمة كما في §11.2 ──────────────────────────────────
 * رأس + مرشّحات + جدول **مُصفَّح من الخادم** + حالة فراغ. بلا استثناء،
 * لأن كل شاشة قائمة في النظام تتبع نفس التشريح فيتعلّمه المستخدم مرة —
 * والثبات محفوظ الآن بمكوّنات مشتركة لا بالنيّة.
 */
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const me = await requireRoleOrRedirect("ADMIN", "OWNER");
  const params = await searchParams;
  const page = Number(params["page"] ?? 1) || 1;
  const includeInactive = params["inactive"] === "1";

  const result = await listUsers(
    { page, includeInactive },
    { userId: me.id, role: me.role },
  );

  if (!result.ok) {
    return (
      <p className="rounded-2xl bg-destructive/10 p-4 text-theme-sm text-destructive">
        {result.error.message}
      </p>
    );
  }

  const { rows, total, pageSize } = result.data;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="المستخدمون"
        description={
          <>
            <span className="tabular">{total}</span> مستخدماً{" "}
            {includeInactive ? "(يشمل المعطَّلين)" : "نشطاً"}
          </>
        }
        actions={
          <Button asChild variant="outline" size="sm">
            <a href={includeInactive ? "/admin/users" : "/admin/users?inactive=1"}>
              {includeInactive ? "إخفاء المعطَّلين" : "إظهار المعطَّلين"}
            </a>
          </Button>
        }
      />

      {/* ⚠️ المالك يرى الشاشة ولا يكتب فيها إلا على المستخدمين —
          وهو أحد استثناءَي D3 الكتابيَّين. */}
      <CreateUserForm actorRole={me.role} />

      <TableCard>
        <Table className="min-w-[52rem]">
          <TableHeader>
            <TableRow>
              <TableHead>الاسم</TableHead>
              <TableHead>الدور</TableHead>
              <TableHead>الهاتف</TableHead>
              <TableHead>البريد</TableHead>
              <TableHead>آخر دخول</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableEmpty colSpan={7}>لا مستخدمين بعد.</TableEmpty>
            ) : (
              rows.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.fullName}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {ROLE_LABELS_AR[u.role as UserRole]}
                  </TableCell>
                  <TableCell className="tabular">
                    <Ltr>{formatPhoneForDisplay(u.phone)}</Ltr>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {u.email ? <Ltr>{u.email}</Ltr> : "—"}
                  </TableCell>
                  <TableCell className="tabular text-muted-foreground">
                    {u.lastLoginAt ? (
                      <Ltr>{formatBaghdadDateTime(u.lastLoginAt)}</Ltr>
                    ) : (
                      "لم يدخل بعد"
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.isActive ? "success" : "neutral"}>
                      {u.isActive ? "نشط" : "معطَّل"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <ToggleActiveButton
                      userId={u.id}
                      fullName={u.fullName}
                      isActive={u.isActive}
                      isSelf={u.id === me.id}
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableCard>

      <PaginationNav basePath="/admin/users" page={page} pages={pages} params={params} />
    </div>
  );
}
