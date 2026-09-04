import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRoleOrRedirect } from "@/lib/auth/guard";
import { getInstallmentPlan } from "@/lib/actions/installments";
import { Money } from "@/components/ui/money";
import { Ltr } from "@/components/ui/ltr";
import { Badge } from "@/components/ui/badge";
import { ActionError, PageHeader, TableCard } from "@/components/ui/page";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBaghdadDate, formatBaghdadDateTime } from "@/lib/dates";
import { formatIqd } from "@/lib/money";
import { InstallmentActions } from "../row-actions";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  تفصيل خطة الأقساط — الخطوة 3.5.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ⚠️ الأفعال هنا لا في القائمة ────────────────────────────────────
 * السداد يُنشئ **دفعة وقيداً وفاتورة**. وزرٌّ بهذا الأثر في صفّ جدولٍ من
 * ثمانية أعمدة يُضغَط بالخطأ على الصفّ المجاور. فالقائمة تُجيب «من تأخّر»،
 * وهذه الصفحة تُجيب «أيّ قسط بالضبط» — وفيها وحدها يُسدَّد.
 *
 * ── والمتأخّر يتصدّر بلونه ──────────────────────────────────────────
 * ⚠️ صفٌّ متأخّر بين ثلاثين صفّاً متشابهاً لا يُرى. اللون والشارة يجعلانه
 * أوّل ما تقع عليه العين — وهو الغرض الوحيد من هذه الشاشة.
 */

const STATUS_AR = {
  PENDING: "لم يحن",
  PAID: "مدفوع",
  OVERDUE: "متأخّر",
  CANCELLED: "ملغى",
} as const;

export default async function PlanDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireRoleOrRedirect("ADMIN", "OWNER", "STAFF");
  const { id } = await params;

  const result = await getInstallmentPlan({ planId: id }, { userId: me.id, role: me.role });

  if (!result.ok) {
    return (
      <ActionError message={result.error.message} />
    );
  }
  if (result.data === null) notFound();

  const plan = result.data;
  /** ⚠️ المالك يقرأ ولا يكتب (‏D3/2) — فلا أزرار له بدل أزرار تفشل. */
  const canAct = me.role === "ADMIN" || me.role === "STAFF";

  const paid = plan.installments.filter((i) => i.status === "PAID");
  const overdue = plan.installments.filter((i) => i.status === "OVERDUE");
  const remaining = plan.installments
    .filter((i) => i.status === "PENDING" || i.status === "OVERDUE")
    .reduce((sum, i) => sum + i.amountIqd, 0n);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`أقساط العقد ${plan.contract.contractNumber}`}
        description={`${plan.contract.holder.fullName} · الشقة ${plan.contract.apartment?.displayNumber ?? "—"}`}
        actions={
          overdue.length > 0 ? (
            <Badge variant="destructive">
              <span className="tabular">{overdue.length}</span> قسطاً متأخّراً
            </Badge>
          ) : (
            <Badge variant="success">لا متأخّر</Badge>
          )
        }
      />

      <nav aria-label="مسار" className="text-theme-xs text-muted-foreground">
        <Link href="/admin/installments" className="hover:underline">
          متابعة الأقساط
        </Link>
      </nav>

      {/* ── الملخّص ──────────────────────────────────────────────── */}
      <dl className="grid gap-4 rounded-2xl border bg-card p-5 sm:grid-cols-4">
        <div>
          <dt className="text-theme-xs text-muted-foreground">قيمة العقد</dt>
          <dd className="font-medium">
            <Money value={plan.totalAmountIqd} />
          </dd>
        </div>
        <div>
          {/*
            ⚠️ تُسمّى «مقبوضة» لا «مقدّمة» وحدها: القرار B1 جعلها مالاً
            دخل فعلاً بوصل وفاتورة، لا رقماً في العقد.
          */}
          <dt className="text-theme-xs text-muted-foreground">مقدّمة مقبوضة</dt>
          <dd className="font-medium">
            <Money value={plan.downPaymentIqd ?? 0n} />
          </dd>
        </div>
        <div>
          <dt className="text-theme-xs text-muted-foreground">المتبقّي</dt>
          <dd className="font-medium">
            <Money value={remaining} />
          </dd>
        </div>
        <div>
          <dt className="text-theme-xs text-muted-foreground">التقدّم</dt>
          <dd className="tabular font-medium">
            {paid.length} / {plan.installmentsCount}
          </dd>
        </div>
      </dl>

      <TableCard>
        <Table className="min-w-[52rem]">
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>الاستحقاق</TableHead>
              <TableHead>المبلغ</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead>آخر متابعة</TableHead>
              {canAct ? <TableHead>أفعال</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {plan.installments.map((i) => (
              <TableRow
                key={i.id}
                className={i.status === "OVERDUE" ? "bg-error-25 dark:bg-error-500/5" : ""}
              >
                <TableCell className="tabular text-muted-foreground">{i.sequence}</TableCell>

                <TableCell className="tabular text-theme-sm">
                  <Ltr>{formatBaghdadDate(i.dueDate)}</Ltr>
                </TableCell>

                <TableCell className="font-medium">
                  <Money value={i.amountIqd} />
                </TableCell>

                <TableCell>
                  <Badge
                    variant={
                      i.status === "PAID"
                        ? "success"
                        : i.status === "OVERDUE"
                          ? "destructive"
                          : i.status === "CANCELLED"
                            ? "neutral"
                            : "warning"
                    }
                  >
                    {STATUS_AR[i.status]}
                  </Badge>
                  {i.paidAt ? (
                    <span className="tabular block text-theme-xs text-muted-foreground">
                      <Ltr>{formatBaghdadDate(i.paidAt)}</Ltr>
                    </span>
                  ) : null}
                </TableCell>

                <TableCell className="text-theme-xs text-muted-foreground">
                  {i.lastFollowUpAt ? (
                    <>
                      <span className="tabular block">
                        <Ltr>{formatBaghdadDateTime(i.lastFollowUpAt)}</Ltr>
                      </span>
                      {/*
                        ⚠️ اسم من تابع يُعرض: متابعةٌ بلا صاحب لا تُسأل عنها،
                        فتصير خانةً تُملأ بلا أثر.
                      */}
                      {i.followUpStaff ? (
                        <span className="block">{i.followUpStaff.user.fullName}</span>
                      ) : null}
                      {i.followUpNote ? (
                        <span className="block">{i.followUpNote}</span>
                      ) : null}
                    </>
                  ) : (
                    "—"
                  )}
                </TableCell>

                {canAct ? (
                  <TableCell>
                    {i.status === "PENDING" || i.status === "OVERDUE" ? (
                      <InstallmentActions
                        installmentId={i.id}
                        sequence={i.sequence}
                        /*
                         * ⚠️ المبلغ يُنسَّق في **الخادم** ويُمرَّر نصّاً:
                         * تنسيقه في العميل يعني قاعدة تنسيق ثانية للمال،
                         * وأول اختلاف بينهما يظهر في حوار يقرأه المحصِّل
                         * قبل أن يُقيّد.
                         */
                        amountLabel={formatIqd(i.amountIqd)}
                        holderName={plan.contract.holder.fullName}
                      />
                    ) : (
                      /* المدفوع والملغى: لا زرّ. زرٌّ معطَّل يُقرأ «معطوب» */
                      <span className="text-theme-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>
    </div>
  );
}
