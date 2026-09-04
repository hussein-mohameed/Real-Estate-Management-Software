import { requireRoleOrRedirect } from "@/lib/auth/guard";
import { getMyProfile } from "@/lib/actions/resident-portal";
import { Ltr } from "@/components/ui/ltr";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { PageHeader } from "@/components/ui/page";
import { ROLE_LABELS_AR, type UserRole } from "@/lib/auth/roles";
import { formatPhoneForDisplay } from "@/lib/domain/phone";
import { formatBaghdadDate, formatBaghdadDateTime } from "@/lib/dates";

/**
 * ملف الساكن.
 *
 * ── لماذا لا يوجد زرّ «تعديل» ────────────────────────────────────────
 * §3.2 يعطي الساكن **«قراءة + طلب تغيير»** لا كتابةً مباشرة. تعديل رقم
 * الهاتف مثلاً يغيّر الوجهة التي يصلها رمز الدخول، فالسماح به بلا مراجعة
 * يجعل الاستيلاء على الحساب خطوةً واحدة.
 *
 * مسار الطلب (`ResidentRequest`) يُبنى في مرحلته؛ حتى ذلك الحين الصفحة
 * **تقول ما تفعله بوضوح** بدل أن تعرض زرّاً معطّلاً أو تصمت.
 */
export default async function MyProfilePage() {
  const me = await requireRoleOrRedirect("RESIDENT", "STAFF", "ADMIN", "OWNER");
  const result = await getMyProfile({}, { userId: me.id, role: me.role });

  if (!result.ok || result.data === null) {
    return (
      <p className="rounded-md bg-destructive/10 p-4 text-sm text-destructive">
        {result.ok ? "تعذّر تحميل ملفك." : result.error.message}
      </p>
    );
  }

  const u = result.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="ملفي"
        description="بياناتك كما هي مسجَّلة لدى الإدارة."
      />

      <Card className="gap-0 py-0"><CardContent className="p-5 md:p-6">
        <dl className="grid gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="text-muted-foreground">الاسم</dt>
          <dd className="font-medium">{u.fullName}</dd>

          <dt className="text-muted-foreground">رقم الهاتف</dt>
          <dd className="tabular">
            <Ltr>{formatPhoneForDisplay(u.phone)}</Ltr>
            <span className="ms-2 text-xs text-muted-foreground">
              عليه يصل رمز الدخول
            </span>
          </dd>

          <dt className="text-muted-foreground">البريد الإلكتروني</dt>
          <dd>{u.email ? <Ltr>{u.email}</Ltr> : <span className="text-muted-foreground">—</span>}</dd>

          <dt className="text-muted-foreground">هاتف الطوارئ</dt>
          <dd className="tabular">
            {u.residentProfile?.emergencyPhone ? (
              <Ltr>{formatPhoneForDisplay(u.residentProfile.emergencyPhone)}</Ltr>
            ) : (
              <span className="text-muted-foreground">غير مسجَّل</span>
            )}
          </dd>

          <dt className="text-muted-foreground">الصفة</dt>
          <dd>
            <Badge variant="neutral">{ROLE_LABELS_AR[u.role as UserRole]}</Badge>
            {u.role !== "RESIDENT" ? (
              <span className="ms-2 text-xs text-muted-foreground">
                موظف مقيم — تصل إلى هذه البوّابة بحكم سكنك
              </span>
            ) : null}
          </dd>

          <dt className="text-muted-foreground">الحساب</dt>
          <dd>
            <Badge variant={u.isActive ? "success" : "danger"}>
              {u.isActive ? "نشط" : "معطَّل"}
            </Badge>
          </dd>

          <dt className="text-muted-foreground">مسجَّل منذ</dt>
          <dd className="tabular text-muted-foreground">
            <Ltr>{formatBaghdadDate(u.createdAt)}</Ltr>
          </dd>

          <dt className="text-muted-foreground">آخر دخول</dt>
          <dd className="tabular text-muted-foreground">
            {u.lastLoginAt ? (
              <Ltr>{formatBaghdadDateTime(u.lastLoginAt)}</Ltr>
            ) : (
              "—"
            )}
          </dd>
        </dl>

        {u.residentProfile?.notes ? (
          <>
            <Separator className="my-4" />
            <p className="text-sm text-muted-foreground">{u.residentProfile.notes}</p>
          </>
        ) : null}
      </CardContent></Card>

      <p className="rounded-xl bg-muted p-3 text-sm text-muted-foreground">
        لتغيير أي من هذه البيانات راجع إدارة المجمّع. التعديل المباشر غير متاح
        عمداً: تغيير رقم الهاتف يغيّر الوجهة التي يصلها رمز دخولك.
      </p>
    </div>
  );
}
