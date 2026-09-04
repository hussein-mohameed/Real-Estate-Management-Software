import Link from "next/link";
import { notFound } from "next/navigation";
import { Lock } from "lucide-react";
import { requireRoleOrRedirect } from "@/lib/auth/guard";
import { getServiceRequest } from "@/lib/actions/requests";
import { listStaff } from "@/lib/actions/staff";
import { Ltr } from "@/components/ui/ltr";
import { Badge } from "@/components/ui/badge";
import { ActionError, PageHeader, SectionCard } from "@/components/ui/page";
import {
  PRIORITY_AR,
  REQUEST_SCOPE_AR,
  REQUEST_STATUS_AR,
  REQUEST_TYPE_AR,
} from "@/lib/labels";
import { REQUEST_STATUS, type RequestStatus } from "@/lib/domain/enums";
import { formatBaghdadDateTime } from "@/lib/dates";
import { AssignButton, CommentBox, StatusButton } from "./row-actions";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  تفصيل طلب — الخطوة 4.4.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ⚠️ التعليق الداخلي يُميَّز بصرياً ────────────────────────────────
 * هو **مُرشَّح من الاستعلام** للساكن أصلاً، فلا يصل إلى متصفّحه. لكن من
 * يراه هنا (أدمن أو موظّف) يجب أن يعرف أنه داخلي قبل أن يبني عليه ردّاً
 * للساكن — وإلا نقل إليه ما لم يكن ليُقال.
 *
 * ── والمغلق لا أزرار له ─────────────────────────────────────────────
 * الإغلاق نهائي: يُنشَأ طلب جديد بدل إعادة الفتح. وزرٌّ يفشل عند الضغط
 * أسوأ من غيابه.
 */

/** الحالات التي يجوز الانتقال إليها من حالة مفتوحة. */
const OPEN_TARGETS: readonly RequestStatus[] = REQUEST_STATUS.filter(
  (s) => s !== "NEW",
);

export default async function RequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireRoleOrRedirect("ADMIN", "OWNER", "STAFF");
  const { id } = await params;
  const actor = { userId: me.id, role: me.role };

  const [request, staff] = await Promise.all([
    getServiceRequest({ requestId: id }, actor),
    listStaff({ onlyAvailable: true, pageSize: 200 }, actor),
  ]);

  if (!request.ok) {
    return (
      <ActionError message={request.error.message} />
    );
  }
  if (request.data === null) notFound();

  const r = request.data;
  const isOpen = r.status !== "DONE" && r.status !== "CANCELLED";
  const canAssign = me.role === "ADMIN" && isOpen;
  const canAct = (me.role === "ADMIN" || me.role === "STAFF") && isOpen;

  const staffOptions = staff.ok
    ? staff.data.rows.map((s) => ({ userId: s.userId, name: s.user.fullName }))
    : [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={r.title}
        description={`${REQUEST_TYPE_AR[r.type]} · ${r.number}`}
        actions={
          <span className="flex flex-wrap items-center gap-2">
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
            <Badge
              variant={
                r.status === "DONE"
                  ? "success"
                  : r.status === "CANCELLED"
                    ? "neutral"
                    : "info"
              }
            >
              {REQUEST_STATUS_AR[r.status]}
            </Badge>
          </span>
        }
      />

      <nav aria-label="مسار" className="text-theme-xs text-muted-foreground">
        <Link href="/admin/requests" className="hover:underline">
          الطلبات والشكاوى
        </Link>
      </nav>

      <dl className="grid gap-4 rounded-2xl border bg-card p-5 sm:grid-cols-3">
        <div>
          <dt className="text-theme-xs text-muted-foreground">الموضوع</dt>
          <dd>
            {/*
              ⚠️ «منطقة مشتركة» تُقال صراحةً ولا تُترك فراغاً: شكوى المصعد
              لا شقة لها، وفراغٌ هنا يُقرأ «بيانات ناقصة» (‏Q35).
            */}
            {r.scope === "COMMON_AREA" ? (
              REQUEST_SCOPE_AR.COMMON_AREA
            ) : (
              <Ltr>{r.apartment?.displayNumber ?? "—"}</Ltr>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-theme-xs text-muted-foreground">القسم</dt>
          <dd>{r.department?.name ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-theme-xs text-muted-foreground">المهمّة</dt>
          <dd>{r.departmentTask?.name ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-theme-xs text-muted-foreground">المُكلَّف</dt>
          <dd>{r.assignedStaff?.user.fullName ?? "لم يُسنَد بعد"}</dd>
        </div>
        <div>
          <dt className="text-theme-xs text-muted-foreground">المُنشئ</dt>
          <dd>{r.createdBy.fullName}</dd>
        </div>
        <div>
          <dt className="text-theme-xs text-muted-foreground">أُنشئ</dt>
          <dd className="tabular text-theme-sm">
            <Ltr>{formatBaghdadDateTime(r.createdAt)}</Ltr>
          </dd>
        </div>
      </dl>

      <SectionCard title="الوصف">
        <p className="whitespace-pre-wrap text-theme-sm leading-relaxed">
          {r.description}
        </p>
      </SectionCard>

      {r.resolutionNote ? (
        <SectionCard
          title="ما فُعل"
          description="يُقرأ بعد شهر حين يُسأل عن هذا الطلب."
        >
          <p className="whitespace-pre-wrap text-theme-sm leading-relaxed">
            {r.resolutionNote}
          </p>
          {r.closedAt ? (
            <p className="mt-2 tabular text-theme-xs text-muted-foreground">
              أُغلق <Ltr>{formatBaghdadDateTime(r.closedAt)}</Ltr>
            </p>
          ) : null}
        </SectionCard>
      ) : null}

      {canAct ? (
        <div className="flex flex-wrap items-center gap-3">
          {canAssign ? (
            <AssignButton
              requestId={r.id}
              staff={staffOptions}
              currentId={r.assignedStaffId}
            />
          ) : null}
          <StatusButton requestId={r.id} current={r.status} options={OPEN_TARGETS} />
        </div>
      ) : null}

      {/* ── التعليقات ────────────────────────────────────────────── */}
      <SectionCard
        title="التعليقات"
        description="الداخلي منها لا يصل إلى متصفّح الساكن — يُرشَّح في الاستعلام."
      >
        {r.comments.length === 0 ? (
          <p className="text-theme-sm text-muted-foreground">لا تعليقات بعد.</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {r.comments.map((c) => (
              <li
                key={c.id}
                className={
                  c.isInternal
                    ? "-mx-2 rounded-lg bg-warning-25 px-2 py-3 dark:bg-warning-500/5"
                    : "py-3"
                }
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-theme-sm font-medium">
                    {c.author.fullName}
                  </span>
                  {c.isInternal ? (
                    /*
                      ⚠️ يُميَّز بصرياً لمن يراه: من يبني ردّاً للساكن على
                      تعليق داخلي ينقل إليه ما لم يكن ليُقال.
                    */
                    <Badge variant="warning" className="gap-1">
                      <Lock className="size-3" aria-hidden />
                      داخلي
                    </Badge>
                  ) : null}
                  <span className="tabular text-theme-xs text-muted-foreground">
                    <Ltr>{formatBaghdadDateTime(c.createdAt)}</Ltr>
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-theme-sm leading-relaxed">
                  {c.body}
                </p>
              </li>
            ))}
          </ul>
        )}

        {canAct ? (
          <div className="mt-4 border-t pt-4">
            <CommentBox requestId={r.id} />
          </div>
        ) : null}
      </SectionCard>
    </div>
  );
}
