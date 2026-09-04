import Link from "next/link";
import { notFound } from "next/navigation";
import { Banknote, GraduationCap } from "lucide-react";
import { requireRoleOrRedirect } from "@/lib/auth/guard";
import { getStaff, listDepartments, listVendors } from "@/lib/actions/staff";
import { staffCollectionToday } from "@/lib/actions/cash";
import { Money } from "@/components/ui/money";
import { Ltr } from "@/components/ui/ltr";
import { Badge } from "@/components/ui/badge";
import { ActionError, EmptyState, PageHeader, SectionCard, TableCard } from "@/components/ui/page";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EMPLOYMENT_TYPE_AR, SKILL_LEVEL_AR } from "@/lib/labels";
import { formatPhoneForDisplay, whatsappLink } from "@/lib/domain/phone";
import { formatBaghdadDate, formatBaghdadDateTime } from "@/lib/dates";
import { EditStaffForm } from "./edit-form";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  صفحة موظّف واحد.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ما تجيب عنه وما لا تجيب ─────────────────────────────────────────
 * القائمة تجيب «من عندي؟». وهذه تجيب «**من هذا؟**»: ملفّه، ومهاراته،
 * ومسؤوليّته المالية.
 *
 * ── ⚠️ وجلسات الصندوق هنا لا في القائمة ─────────────────────────────
 * القائمة تعرض تحصيل **اليوم** — سؤال المتابعة. وهذه تعرض آخر عشر
 * جلسات بفروقها: سجلّ المسؤولية. وصفحةٌ تعرض مهاراته وتُخفي فروق صناديقه
 * تُجيب عن السؤال السهل وحده.
 *
 * ── والمعطَّل يُعرَض ولا يُخفى ──────────────────────────────────────
 * من ترك العمل يبقى ملفّه مقروءاً: تدقيقه وجلساته وقيوده تشير إليه،
 * وصفحةٌ تقول «غير موجود» تقطع الخيط على من يراجع بعد سنة.
 */

export default async function StaffDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireRoleOrRedirect("ADMIN", "OWNER");
  const { id } = await params;
  const actor = { userId: me.id, role: me.role };

  const [staff, departments, vendors, collection] = await Promise.all([
    getStaff({ userId: id }, actor),
    listDepartments({ includeInactive: false }, actor),
    listVendors({ includeInactive: false }, actor),
    staffCollectionToday({ staffUserIds: [id] }, actor),
  ]);

  if (!staff.ok) {
    return (
      <ActionError message={staff.error.message} />
    );
  }
  if (staff.data === null) notFound();

  const s = staff.data;
  const canWrite = me.role === "ADMIN";
  const today = collection.ok ? collection.data[0] : undefined;
  const needsTraining = s.skills.filter((k) => k.needsTraining);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={s.user.fullName}
        description={s.jobTitle ?? "بلا مسمّى وظيفي"}
        actions={
          <span className="flex flex-wrap items-center gap-2">
            {s.user.isActive ? null : <Badge variant="neutral">معطَّل</Badge>}
            <Badge variant={s.isAvailable ? "success" : "neutral"}>
              {s.isAvailable ? "متواجد" : "غير متواجد"}
            </Badge>
            {s.canReceiveCash ? (
              <Badge variant="warning" className="gap-1">
                <Banknote className="size-3" aria-hidden />
                يقبض نقداً
              </Badge>
            ) : null}
          </span>
        }
      />

      <nav aria-label="مسار" className="text-theme-xs text-muted-foreground">
        <Link href="/admin/staff" className="hover:underline">
          الموظفون
        </Link>
      </nav>

      {/* ── الملفّ ────────────────────────────────────────────────── */}
      <dl className="grid gap-4 rounded-2xl border bg-card p-5 sm:grid-cols-3">
        <div>
          <dt className="text-theme-xs text-muted-foreground">التوظيف</dt>
          <dd>{EMPLOYMENT_TYPE_AR[s.employmentType]}</dd>
        </div>
        <div>
          <dt className="text-theme-xs text-muted-foreground">القسم</dt>
          <dd>{s.department?.name ?? "—"}</dd>
        </div>
        {s.vendor ? (
          <div>
            <dt className="text-theme-xs text-muted-foreground">الشركة</dt>
            <dd>{s.vendor.name}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-theme-xs text-muted-foreground">الهاتف</dt>
          <dd className="tabular">
            {/* ⚠️ رابط واتساب: هو الطريق الفعلي للتواصل في هذا السياق */}
            <a
              href={whatsappLink(s.user.phone)}
              target="_blank"
              rel="noreferrer"
              className="hover:underline"
            >
              <Ltr>{formatPhoneForDisplay(s.user.phone)}</Ltr>
            </a>
          </dd>
        </div>
        {s.user.email ? (
          <div>
            <dt className="text-theme-xs text-muted-foreground">البريد</dt>
            <dd className="text-theme-sm">
              <Ltr>{s.user.email}</Ltr>
            </dd>
          </div>
        ) : null}
        {s.hiredAt ? (
          <div>
            <dt className="text-theme-xs text-muted-foreground">تاريخ المباشرة</dt>
            <dd className="tabular">
              <Ltr>{formatBaghdadDate(s.hiredAt)}</Ltr>
            </dd>
          </div>
        ) : null}
      </dl>

      {canWrite ? (
        <SectionCard
          title="تعديل الملفّ"
          description="الاسم والهاتف يُعدَّلان من شاشة المستخدمين — الهاتف مفتاح دخول لا بيان تنظيمي."
        >
          <EditStaffForm
            userId={s.userId}
            initial={{
              employmentType: s.employmentType,
              departmentId: s.departmentId,
              vendorId: s.vendorId,
              jobTitle: s.jobTitle,
            }}
            departments={departments.ok ? departments.data : []}
            vendors={vendors.ok ? vendors.data : []}
          />
        </SectionCard>
      ) : null}

      {/* ── المهارات ─────────────────────────────────────────────── */}
      <SectionCard
        title="المهارات"
        description="تُعدَّل من قائمة الموظفين. وما يحتاج تدريباً معلومة لا منع."
        actions={
          needsTraining.length > 0 ? (
            <Badge variant="warning" className="gap-1">
              <GraduationCap className="size-3" aria-hidden />
              <span className="tabular">{needsTraining.length}</span> تحتاج تدريباً
            </Badge>
          ) : null
        }
      >
        {s.skills.length === 0 ? (
          <p className="text-theme-sm text-muted-foreground">لا مهارات مسجَّلة.</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {s.skills.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                <span className="min-w-0 flex-1 font-medium">{k.skill.name}</span>
                <Badge variant="neutral">{SKILL_LEVEL_AR[k.level]}</Badge>
                {k.needsTraining ? (
                  <Badge variant="warning">يحتاج تدريباً</Badge>
                ) : k.hasTrained ? (
                  <Badge variant="success">تدرَّب</Badge>
                ) : null}
                {k.trainingNote ? (
                  <span className="w-full text-theme-xs text-muted-foreground">
                    {k.trainingNote}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* ── المسؤولية المالية ────────────────────────────────────── */}
      <SectionCard
        title="صناديق النقد"
        description="آخر عشر جلسات. والفرق بين المتوقَّع والمُقرّ يظهر باسم صاحبه."
        actions={
          today ? (
            <Badge variant={today.staleDrawer ? "destructive" : "neutral"}>
              اليوم: {today.collectedLabel}
            </Badge>
          ) : null
        }
      >
        {s.drawers.length === 0 ? (
          <EmptyState
            icon={Banknote}
            title="لا جلسات صندوق"
            description={
              s.canReceiveCash
                ? "مصرَّح له بقبض النقد ولم يفتح صندوقاً بعد."
                : "غير مصرَّح له بقبض النقد."
            }
          />
        ) : (
          <TableCard>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الفتح</TableHead>
                  <TableHead>الإقفال</TableHead>
                  <TableHead>المُقرّ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {s.drawers.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="tabular text-theme-xs">
                      <Ltr>{formatBaghdadDateTime(d.openedAt)}</Ltr>
                    </TableCell>
                    <TableCell className="tabular text-theme-xs">
                      {d.closedAt ? (
                        <Ltr>{formatBaghdadDateTime(d.closedAt)}</Ltr>
                      ) : (
                        /* ⚠️ المفتوح حالةٌ تُتابَع — B4 يوجب إقفالاً يومياً */
                        <Badge variant="warning">مفتوح</Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-medium">
                      {d.declaredIqd === null ? (
                        <span className="text-theme-xs text-muted-foreground">—</span>
                      ) : (
                        <Money value={d.declaredIqd} />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCard>
        )}
      </SectionCard>
    </div>
  );
}
