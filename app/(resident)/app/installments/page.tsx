import { requireRoleOrRedirect } from "@/lib/auth/guard";
import { getMyInstallments } from "@/lib/actions/resident-portal";
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
import { CONTRACT_TYPE_AR } from "@/lib/labels";
import { formatBaghdadDate } from "@/lib/dates";
import { Wallet } from "lucide-react";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  الأقساط.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ⚠️ المتأخّر يتصدّر بلونه ────────────────────────────────────────
 * هذا أوّل ما يُفتَح من أجله. وقسطٌ متأخّر بين اثني عشر صفّاً متشابهاً لا
 * يُرى — فيُعلَّم بلون وشارة.
 *
 * ── والدفعة المقدّمة تُذكر ولا تُحسب في المتبقّي ───────────────────
 * مقبوضة عند التوقيع بوصل وفاتورة (‏B1). وإدخالها في المتبقّي يجعل من
 * دفعها يبدو مديناً بها.
 */

const STATUS_AR = {
  PENDING: "لم يحن",
  PAID: "مدفوع",
  OVERDUE: "متأخّر",
  CANCELLED: "ملغى",
} as const;

export default async function MyInstallmentsPage() {
  const me = await requireRoleOrRedirect("RESIDENT", "STAFF", "ADMIN", "OWNER");
  const result = await getMyInstallments({}, { userId: me.id, role: me.role });

  if (!result.ok) {
    return (
      <ActionError message={result.error.message} />
    );
  }

  const plans = result.data;
  const overdueTotal = plans.reduce((n, p) => n + p.overdueCount, 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="الأقساط"
        description="جدول ما عليك، وما سُدّد منه."
        actions={
          plans.length === 0 ? null : overdueTotal > 0 ? (
            <Badge variant="destructive">
              <span className="tabular">{overdueTotal}</span> قسطاً متأخّراً
            </Badge>
          ) : (
            <Badge variant="success">لا متأخّر</Badge>
          )
        }
      />

      {plans.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="لا خطة أقساط على عقودك"
          description="الأقساط تُنشَأ مع عقد التمليك حين يكون الدفع مقسَّطاً."
        />
      ) : (
        plans.map((plan) => (
          <SectionCard
            key={plan.id}
            title={`${CONTRACT_TYPE_AR[plan.contract.type]} — ${plan.contract.contractNumber}`}
            description={`الشقة ${plan.contract.apartment?.displayNumber ?? "—"}`}
            actions={
              <span className="tabular text-theme-sm">
                {plan.paidCount} / {plan.installmentsCount}
              </span>
            }
          >
            <dl className="mb-4 grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-theme-xs text-muted-foreground">قيمة العقد</dt>
                <dd className="font-medium">
                  <Money value={plan.totalAmountIqd} />
                </dd>
              </div>
              <div>
                {/*
                  ⚠️ «مقبوضة» لا «مقدّمة» وحدها: القرار B1 جعلها مالاً دخل
                  فعلاً بوصل وفاتورة — لا رقماً في العقد.
                */}
                <dt className="text-theme-xs text-muted-foreground">مقدّمة مقبوضة</dt>
                <dd className="font-medium">
                  <Money value={plan.downPaymentIqd ?? 0n} />
                </dd>
              </div>
              <div>
                <dt className="text-theme-xs text-muted-foreground">المتبقّي</dt>
                <dd className="font-medium">
                  <Money value={plan.remainingIqd} />
                </dd>
              </div>
            </dl>

            <TableCard>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>الاستحقاق</TableHead>
                    <TableHead>المبلغ</TableHead>
                    <TableHead>الحالة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plan.installments.map((i) => (
                    <TableRow
                      key={i.id}
                      className={
                        i.status === "OVERDUE" ? "bg-error-25 dark:bg-error-500/5" : ""
                      }
                    >
                      <TableCell className="tabular text-muted-foreground">
                        {i.sequence}
                      </TableCell>

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
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableCard>
          </SectionCard>
        ))
      )}
    </div>
  );
}
