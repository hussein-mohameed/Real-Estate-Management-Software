import { requireRoleOrRedirect } from "@/lib/auth/guard";
import { one, pageNumber, type SearchParams } from "@/lib/routes/search-params";
import { listSubscriptions } from "@/lib/actions/subscriptions";
import { Money } from "@/components/ui/money";
import { Ltr } from "@/components/ui/ltr";
import { Badge } from "@/components/ui/badge";
import { ActionError, PageHeader, Pager, TableCard, TableEmpty } from "@/components/ui/page";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatIqd } from "@/lib/money";
import { formatBaghdadDate } from "@/lib/dates";
import {
  BILLING_CYCLE_AR,
  PAYER_TYPE_AR,
  SUBSCRIPTION_STATUS_AR,
} from "@/lib/labels";
import { ActiveActions, PendingActions } from "./row-actions";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  الاشتراكات — الخطوة 2.4.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── المعلّق أولاً ───────────────────────────────────────────────────
 * ما ينتظر تدخّل الأدمن يتصدّر، ويظهر عدده في الرأس. قائمةٌ مرتَّبة
 * أبجدياً كانت تدفن `PENDING_APPROVAL` تحت `ACTIVE` أبداً.
 *
 * ── ⚠️ والمبلغ المعروض هو **الدورة الكاملة** ────────────────────────
 * الفترة الأولى وحدها مقسَّطة بالتناسب (‏B2). والعمود يقول ما يُقيَّد **كل
 * دورة** — وهو ما يسأل عنه الأدمن. أما ما قُيّد فعلاً فيُقرأ من كشف الحساب.
 */

const STATUSES = ["PENDING_APPROVAL", "ACTIVE", "PAUSED", "CANCELLED"] as const;

/**
 * ⚠️ **نفس نمط بقيّة صفحات القائمة** لا `PageProps<"…">`.
 * الأخير يعتمد أنواعاً يولّدها Next عند البناء، فمسارٌ جديد لا يُصرَّف حتى
 * أوّل بناء — ويكسر `typecheck` قبله بلا أن يكون في الكود عيب.
 */


export default async function SubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const me = await requireRoleOrRedirect("ADMIN", "OWNER");
  const p = await searchParams;

  const statusParam = one(p["status"]);
  const status = STATUSES.find((s) => s === statusParam);
  const page = pageNumber(p["page"]);

  const result = await listSubscriptions(
    { ...(status ? { status } : {}), page },
    { userId: me.id, role: me.role },
  );

  if (!result.ok) {
    return (
      <ActionError message={result.error.message} />
    );
  }

  const { rows, total, pageSize, pendingCount } = result.data;
  /** ⚠️ المالك يقرأ ولا يكتب (‏D3/2) — فلا أزرار له بدل أزرار تفشل. */
  const canAct = me.role === "ADMIN";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="الاشتراكات"
        description="ما يُقيَّد على الحسابات كل دورة. الموافقة تُقيّد مالاً فوراً."
        actions={
          pendingCount > 0 ? (
            <Badge variant="warning">
              <span className="tabular">{pendingCount}</span> بانتظار الموافقة
            </Badge>
          ) : (
            <Badge variant="success">لا شيء ينتظر الموافقة</Badge>
          )
        }
      />

      {/* المرشّحات — روابط لا نموذج، فتبقى الحالة في العنوان ويُشارَك */}
      <nav aria-label="ترشيح بالحالة" className="flex flex-wrap items-center gap-2">
        <FilterLink label="الكل" href="/admin/subscriptions" active={!status} />
        {STATUSES.map((s) => (
          <FilterLink
            key={s}
            label={SUBSCRIPTION_STATUS_AR[s]}
            href={`/admin/subscriptions?status=${s}`}
            active={status === s}
          />
        ))}
      </nav>

      <TableCard>
        <Table className="min-w-[56rem]">
          <TableHeader>
            <TableRow>
              <TableHead>الخدمة</TableHead>
              <TableHead>الموضوع</TableHead>
              <TableHead>مبلغ الدورة</TableHead>
              <TableHead>الدورة</TableHead>
              <TableHead>الدفع على</TableHead>
              <TableHead>الفوترة القادمة</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead>أفعال</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableEmpty colSpan={8}>
                {status
                  ? `لا اشتراك بحالة «${SUBSCRIPTION_STATUS_AR[status]}».`
                  : "لا اشتراكات بعد. تُنشأ مع الإشغال للإلزامية، أو بطلب من الساكن."}
              </TableEmpty>
            ) : (
              rows.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">
                    {s.service.name}
                    {s.service.isMandatory ? (
                      <Badge variant="neutral" className="ms-2">
                        إلزامية
                      </Badge>
                    ) : null}
                  </TableCell>

                  <TableCell className="text-theme-sm">
                    <Ltr>{s.apartment?.displayNumber ?? "—"}</Ltr>
                    {/*
                      ⚠️ موضوع الاشتراك يُقال صراحةً: اشتراكٌ على **ساكن**
                      يحمل `apartmentId` أيضاً بحكم القيد، فرقمُ الشقة وحده
                      يجعله يبدو خدمةً على الوحدة كلها.
                    */}
                    {s.subjectType === "RESIDENT" ? (
                      <span className="block text-theme-xs text-muted-foreground">
                        {s.residentUser?.fullName ?? "ساكن"}
                      </span>
                    ) : null}
                  </TableCell>

                  <TableCell className="font-medium">
                    <Money value={s.periodAmountIqd} />
                    {s.quantity > 1 ? (
                      <span className="tabular block text-theme-xs text-muted-foreground">
                        × {s.quantity}
                      </span>
                    ) : null}
                  </TableCell>

                  <TableCell className="text-theme-sm">
                    {s.billingCycle ? BILLING_CYCLE_AR[s.billingCycle] : "مرّة واحدة"}
                  </TableCell>

                  <TableCell className="text-theme-sm">
                    {PAYER_TYPE_AR[s.payerType]}
                  </TableCell>

                  <TableCell className="tabular text-theme-xs text-muted-foreground">
                    {s.nextChargeDate ? (
                      <Ltr>{formatBaghdadDate(s.nextChargeDate)}</Ltr>
                    ) : (
                      "—"
                    )}
                  </TableCell>

                  <TableCell>
                    <Badge
                      variant={
                        s.status === "ACTIVE"
                          ? "success"
                          : s.status === "PENDING_APPROVAL"
                            ? "warning"
                            : "neutral"
                      }
                    >
                      {SUBSCRIPTION_STATUS_AR[s.status]}
                    </Badge>
                  </TableCell>

                  <TableCell>
                    {!canAct ? (
                      <span className="text-theme-xs text-muted-foreground">قراءة</span>
                    ) : s.status === "PENDING_APPROVAL" ? (
                      <PendingActions
                        subscriptionId={s.id}
                        serviceName={s.service.name}
                        apartmentNumber={s.apartment?.displayNumber ?? "—"}
                        /*
                         * ⚠️ المبلغ يُنسَّق في **الخادم** ويُمرَّر نصّاً.
                         * تنسيقه في العميل يعني قاعدة تنسيق ثانية للمال،
                         * وأول اختلاف بينهما يظهر في حوار تأكيد يقرأه
                         * الأدمن قبل أن يُقيّد.
                         */
                        amountLabel={formatIqd(s.periodAmountIqd)}
                      />
                    ) : s.status === "ACTIVE" ? (
                      <ActiveActions
                        subscriptionId={s.id}
                        serviceName={s.service.name}
                        isPerUnit={s.service.pricingModel === "PER_UNIT"}
                        quantity={s.quantity}
                      />
                    ) : (
                      /* الملغى والموقوف: لا زرّ. زرٌّ معطَّل يُقرأ «معطوب» */
                      <span className="text-theme-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableCard>

      <Pager
        basePath={"/admin/subscriptions"}
        page={page}
        total={total}
        pageSize={pageSize}
        params={p}
      />
    </div>
  );
}

/** رابط ترشيح — الحالة في العنوان كي تُشارَك وتُحفظ في المفضّلة. */
function FilterLink({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active: boolean;
}) {
  return (
    <a
      href={href}
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "rounded-full bg-accent-brand-soft px-3 py-1.5 text-theme-xs font-medium text-accent-brand-strong"
          : "rounded-full border px-3 py-1.5 text-theme-xs text-muted-foreground transition-colors hover:bg-accent"
      }
    >
      {label}
    </a>
  );
}
