import { Banknote, LockKeyhole, ShieldAlert, Wallet } from "lucide-react";
import { requireRoleOrRedirect } from "@/lib/auth/guard";
import { prisma } from "@/lib/prisma";
import { drawerSummary, openDrawerIdFor } from "@/lib/services/cash-drawer";
import { Money } from "@/components/ui/money";
import { Ltr } from "@/components/ui/ltr";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/ui/stat-card";
import { PageHeader, SectionCard, EmptyState } from "@/components/ui/page";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBaghdadDateTime } from "@/lib/dates";
import { CloseDrawerForm, OpenDrawerButton, RecordPaymentForm } from "./forms";
import type { AccountOption } from "./forms";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  صندوق النقد — `B4` · الخطوتان 3.1 و3.2.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── الشاشة تتبع الترتيب الإلزامي ────────────────────────────────────
 * لا دفعة بلا صندوق مفتوح. فمن لا صندوق له يرى زرّ الفتح **وحده**، ولا
 * نموذج دفعٍ مُعطَّلاً: الحقل المعطَّل يُقرأ «معطوب» لا «غير متاح بعد».
 *
 * ── ⚠️ وصلاحية القبض تُقرأ لا تُفترض ───────────────────────────────
 * من لا يملك `canReceiveCash` يرى **لماذا** لا يستطيع، لا زرّاً يفشل عند
 * الضغط. الرفض المُفسَّر قبل المحاولة أفضل من رسالة خطأ بعدها.
 */
export default async function CashPage() {
  const me = await requireRoleOrRedirect("ADMIN", "OWNER", "STAFF");

  const [profile, sessionId] = await Promise.all([
    prisma.staffProfile.findUnique({
      where: { userId: me.id },
      select: { canReceiveCash: true },
    }),
    openDrawerIdFor(me.id),
  ]);

  const summary = sessionId ? await drawerSummary(sessionId) : null;

  /**
   * دفعات الجلسة المفتوحة — للعرض تحت الرصيد.
   * ⚠️ محدودة بـ`take`: جلسة يوم مزدحم قد تحمل مئات الدفعات، وجلبُها كلها
   * لعرض آخرها يُبطئ الشاشة التي تُفتح عند كل قبض.
   */
  const payments = sessionId
    ? await prisma.payment.findMany({
        where: { cashDrawerSessionId: sessionId, status: "PAID" },
        select: {
          id: true,
          amountIqd: true,
          paidAt: true,
          account: { select: { apartment: { select: { displayNumber: true } } } },
          invoice: { select: { number: true } },
        },
        orderBy: { paidAt: "desc" },
        take: 25,
      })
    : [];

  /**
   * الحسابات المفتوحة — منتقى الدفعة.
   * ⚠️ `take` هنا أيضاً: بلا حدّ تُجلب كل حسابات المجمّع في قائمة منسدلة.
   */
  const accountRows = await prisma.account.findMany({
    where: { status: "OPEN" },
    select: {
      id: true,
      balanceIqd: true,
      apartment: { select: { displayNumber: true } },
      holder: { select: { fullName: true } },
    },
    orderBy: { balanceIqd: "desc" },
    take: 200,
  });

  const accounts: AccountOption[] = accountRows.map((a) => ({
    id: a.id,
    label: `${a.apartment.displayNumber} — ${a.holder.fullName}`,
    balanceIqd: a.balanceIqd,
  }));

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="صندوق النقد"
        description="لا دفعة بلا صندوق مفتوح، ولا إقفال بلا مبلغ مُقرّ (‏B4)."
      />

      {!profile ? (
        <EmptyState
          icon={ShieldAlert}
          title="لا ملفّ وظيفي على حسابك"
          description="قبض النقد يحتاج ملفّاً وظيفياً وصلاحية صريحة. راجع الإدارة."
        />
      ) : !profile.canReceiveCash ? (
        /*
         * ⚠️ يُقال **لماذا** لا يستطيع، لا يُعرض زرّ يفشل عند الضغط.
         * والافتراضي `false` مقصود: لا أحد يقبض حتى يُمنح صراحةً.
         */
        <EmptyState
          icon={ShieldAlert}
          title="لا تملك صلاحية قبض النقد"
          description="تُمنح صراحةً من شاشة الموظفين بسبب مكتوب، ولا تُملأ سهواً في نموذج الإنشاء."
        />
      ) : !summary ? (
        <SectionCard
          title="افتح صندوقك"
          description="كل دفعة نقدية تنتمي إلى صندوق يُسأل عنه. والصندوق شخصي: صندوق مشترك يُلغي المسؤولية."
        >
          <OpenDrawerButton />
        </SectionCard>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 md:gap-6 xl:grid-cols-3">
            <StatCard
              label="المُسجَّل في هذه الجلسة"
              value={<Money value={summary.expectedIqd} />}
              hint={
                <>
                  <span className="tabular">{summary.paymentsCount}</span> دفعة —
                  محسوب من الدفعات لا مخزَّناً
                </>
              }
              icon={Banknote}
              tone="brand"
            />
            <StatCard
              label="فُتح الصندوق"
              value={<Ltr className="text-title-sm">{formatBaghdadDateTime(summary.openedAt)}</Ltr>}
              hint="يبقى مفتوحاً حتى تُقفله بمبلغ تُقرّ به"
              icon={Wallet}
              tone="neutral"
            />
            <StatCard
              label="الحسابات المفتوحة"
              value={accounts.length}
              hint="ما يمكن القبض عليه الآن"
              icon={LockKeyhole}
              tone="info"
            />
          </section>

          <SectionCard
            title="تسجيل دفعة نقدية"
            description="تُقيَّد على حساب العقد وتُصدَر فاتورتها في نفس اللحظة — لا دفعة بلا قيد."
          >
            <RecordPaymentForm accounts={accounts} />
          </SectionCard>

          <SectionCard
            title="دفعات هذه الجلسة"
            description="آخر 25 دفعة — وما فوقها في تقرير التحصيل."
          >
            {payments.length === 0 ? (
              <EmptyState
                icon={Banknote}
                title="لا دفعات بعد"
                description="أول دفعة تُسجّلها تظهر هنا برقم فاتورتها."
              />
            ) : (
              <div className="overflow-x-auto">
                <Table className="min-w-[34rem]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>الوقت</TableHead>
                      <TableHead>الشقة</TableHead>
                      <TableHead>الفاتورة</TableHead>
                      <TableHead>المبلغ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="tabular text-theme-xs text-muted-foreground">
                          <Ltr>{p.paidAt ? formatBaghdadDateTime(p.paidAt) : "—"}</Ltr>
                        </TableCell>
                        <TableCell>
                          <Ltr>{p.account.apartment.displayNumber}</Ltr>
                        </TableCell>
                        <TableCell>
                          {p.invoice ? (
                            <Ltr className="tabular text-theme-xs">{p.invoice.number}</Ltr>
                          ) : (
                            /* ⚠️ حالة لا ينبغي أن توجد: الفاتورة تُصدر في نفس المعاملة */
                            <Badge variant="warning">بلا فاتورة</Badge>
                          )}
                        </TableCell>
                        <TableCell className="font-medium">
                          <Money value={p.amountIqd} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="إقفال الصندوق"
            description="الفرق يُسجَّل باسمك ولا يمنع الإقفال — والإقفال لا يُعدَّل بعده."
          >
            <CloseDrawerForm
              sessionId={summary.sessionId}
              expectedIqd={summary.expectedIqd}
            />
          </SectionCard>
        </>
      )}
    </div>
  );
}
