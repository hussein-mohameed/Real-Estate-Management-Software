import Link from "next/link";
import { Car, Home, ReceiptText, Sparkles, Wallet } from "lucide-react";
import { requireRoleOrRedirect } from "@/lib/auth/guard";
import { getMyHome } from "@/lib/actions/resident-portal";
import { myActiveSubscriptions, myApartmentVehicles } from "@/lib/actions/resident-extras";
import { StatusBadge } from "@/components/ui/status-badge";
import { Money } from "@/components/ui/money";
import { Ltr } from "@/components/ui/ltr";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, PageHeader, SectionCard } from "@/components/ui/page";
import {
  BADGE_STATUS_AR,
  BILLING_CYCLE_AR,
  CONTRACT_TYPE_AR,
  LEDGER_SOURCE_AR,
  RESIDENT_RELATION_AR,
  SUBSCRIPTION_STATUS_AR,
  VEHICLE_STATUS_AR,
} from "@/lib/labels";
import { formatBaghdadDate, formatBaghdadDateTime } from "@/lib/dates";
import { formatPhoneForDisplay } from "@/lib/domain/phone";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  الصفحة الرئيسية للساكن (‏§8.4).
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ما يراه ومن لا يراه ─────────────────────────────────────────────
 * الشقة والسكان والسيارات يراها **كل** ساكن مرتبط بالوحدة: كلها وقائع على
 * مستوى الوحدة. أما **الرصيد وكشف الحساب فلصاحب العقد وحده** — الحسابات
 * تُقرأ بشرط `holderUserId`، فابن صاحب العقد يرى بيته ولا يرى ديونه.
 * تسريب مالي داخل البيت الواحد لا يقلّ عن التسريب بين الشقق.
 *
 * والاشتراك على خطّين: ما موضوعه الوحدة يراه الجميع، وما موضوعه شخص
 * فلصاحبه. راجع `lib/services/resident-extras.ts`.
 *
 * ── ولماذا الرصيد أول ما يُعرض ──────────────────────────────────────
 * الساكن يفتح البوّابة لسؤال واحد غالباً: «كم عليّ؟». إخفاء الجواب خلف
 * تبويب يجعله يتصل بالإدارة — وهو بالضبط الاتصال الذي وُجد هذا النظام
 * ليُغني عنه.
 *
 * ── وما ينتظر قراراً ليس هنا ────────────────────────────────────────
 * §8.4 يَعِد بالفواتير (‏B7) والأقساط (‏B1) والدفع الإلكتروني (‏B6) وطلب
 * اشتراك أو إلغائه (‏B2) والطلبات والشكاوى (الخطوة 4.4). لا شيء منها
 * معروض هنا بشكل معطَّل: زرٌّ لا يعمل أسوأ من غيابه.
 */
export default async function ResidentHome() {
  const me = await requireRoleOrRedirect("RESIDENT", "STAFF", "ADMIN", "OWNER");

  const [result, subscriptions, vehicles] = await Promise.all([
    getMyHome({}, { userId: me.id, role: me.role }),
    myActiveSubscriptions(),
    myApartmentVehicles(),
  ]);

  if (!result.ok) {
    return (
      <Card className="gap-0 border-error-200 bg-error-25 py-0 dark:border-error-500/30 dark:bg-error-500/5">
        <CardContent className="p-5">
          <p role="alert" className="text-theme-sm text-destructive">
            {result.error.message}
          </p>
        </CardContent>
      </Card>
    );
  }

  const { apartments, accounts } = result.data;

  if (apartments.length === 0) {
    return (
      <EmptyState
        icon={Home}
        title="لا شقة مرتبطة بحسابك بعد"
        description="حسابك موجود ولم يُربط بوحدة سكنية. راجع إدارة المجمّع لربطه."
      />
    );
  }

  const openAccounts = accounts.filter((a) => a.status === "OPEN");
  const closedAccounts = accounts.filter((a) => a.status !== "OPEN");
  const totalDue = openAccounts.reduce((sum, a) => sum + a.balanceIqd, 0n);

  /**
   * الالتزام الشهري المتوقّع من الاشتراكات النشطة.
   *
   * ⚠️ **بلا تطبيع الدورات هنا.** التطبيع (‏ربعي ÷ 3) رقمٌ إداريّ يقارن
   * خدمات ببعضها؛ والساكن يسأل «كم أدفع ومتى». فالمعروض هو مبلغ الدورة
   * كما هو، مع دورته بجانبه.
   */
  const activeSubs = subscriptions.filter((s) => s.status === "ACTIVE");
  const pendingSubs = subscriptions.filter((s) => s.status === "PENDING_APPROVAL");

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={`مرحباً، ${me.fullName}`}
        description={
          apartments.length === 1 ? "وحدتك" : `وحداتك (${apartments.length})`
        }
      />

      {/* ── الرصيد أولاً: هو السؤال الذي فُتحت الصفحة من أجله ───────── */}
      {openAccounts.length > 0 ? (
        <Card
          className={
            totalDue > 0n
              ? "gap-0 border-error-200 bg-error-25 py-0 dark:border-error-500/30 dark:bg-error-500/5"
              : "gap-0 py-0"
          }
        >
          <CardContent className="flex flex-wrap items-start justify-between gap-4 p-6">
            <div>
              <p className="text-theme-sm text-muted-foreground">
                {totalDue > 0n
                  ? "المستحق عليك"
                  : totalDue < 0n
                    ? "رصيدك الدائن"
                    : "رصيدك"}
              </p>
              <p className="mt-2 text-title-lg font-bold tracking-tight">
                <Money value={totalDue < 0n ? -totalDue : totalDue} />
              </p>
              {totalDue === 0n ? (
                <p className="mt-1 text-theme-sm text-occupancy-owner">
                  لا مستحقات عليك.
                </p>
              ) : null}

              {openAccounts.length > 1 ? (
                <p className="mt-3 text-theme-xs text-muted-foreground">
                  مجموع <span className="tabular">{openAccounts.length}</span> حسابات.
                  التفصيل أدناه — الحسابات لا تُدمج.
                </p>
              ) : null}
            </div>

            <span
              className="grid size-11 shrink-0 place-items-center rounded-xl bg-muted"
              aria-hidden
            >
              <Wallet
                className={totalDue > 0n ? "size-5 text-money-overdue" : "size-5 text-muted-foreground"}
              />
            </span>
          </CardContent>
        </Card>
      ) : null}

      {/* ── الوحدات ────────────────────────────────────────────────── */}
      {apartments.map((apt) => {
        const apartmentAccounts = accounts.filter((a) => a.apartment.id === apt.id);
        return (
          <Card key={apt.id} className="gap-0 py-0">
            <CardContent className="p-5 md:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-theme-sm text-muted-foreground">
                    <Ltr>{apt.building.code}</Ltr>
                    {apt.building.name ? ` · ${apt.building.name}` : ""} · الطابق{" "}
                    <span className="tabular">{apt.floorNumber}</span>
                  </p>
                  <h3 className="text-title-sm font-semibold">
                    <Ltr>{apt.displayNumber}</Ltr>
                  </h3>
                </div>
                <StatusBadge axis="occupancy" value={apt.occupancyStatus} />
              </div>

              {/* أفراد الوحدة — يراهم كل ساكن مرتبط بها */}
              <Separator className="my-4" />
              <h4 className="mb-2 text-theme-sm font-medium">
                أفراد الوحدة{" "}
                <span className="tabular text-muted-foreground">
                  ({apt.residents.length})
                </span>
              </h4>
              <ul className="flex flex-col gap-2 text-theme-sm">
                {apt.residents.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{r.user.fullName}</span>
                    {r.isContractHolder ? (
                      <Badge variant="info">صاحب العقد</Badge>
                    ) : (
                      <span className="text-muted-foreground">
                        {RESIDENT_RELATION_AR[r.relationType]}
                      </span>
                    )}
                    {r.user.id === me.id ? (
                      <Badge variant="neutral">أنت</Badge>
                    ) : (
                      <Ltr className="tabular text-theme-xs text-muted-foreground">
                        {formatPhoneForDisplay(r.user.phone)}
                      </Ltr>
                    )}
                  </li>
                ))}
              </ul>

              {/* العقد والحساب — لصاحب العقد وحده */}
              <Separator className="my-4" />
              {apartmentAccounts.length > 0 ? (
                <div className="flex flex-col gap-3">
                  {apartmentAccounts.map((acc) => (
                    <div
                      key={acc.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-surface-muted/50 p-3"
                    >
                      <div className="text-theme-sm">
                        <p className="font-medium">
                          عقد {CONTRACT_TYPE_AR[acc.contract.type]}{" "}
                          <Ltr className="text-muted-foreground">
                            {acc.contract.contractNumber}
                          </Ltr>
                        </p>
                        <p className="tabular text-theme-xs text-muted-foreground">
                          <Ltr>{formatBaghdadDate(acc.contract.startDate)}</Ltr>
                          {acc.contract.endDate ? (
                            <>
                              {" — "}
                              <Ltr>{formatBaghdadDate(acc.contract.endDate)}</Ltr>
                            </>
                          ) : null}
                        </p>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="text-end text-theme-sm">
                          <span className="block text-theme-xs text-muted-foreground">
                            {acc.status === "OPEN" ? "الرصيد" : "رصيد مجمَّد"}
                          </span>
                          <Money value={acc.balanceIqd} signed className="font-semibold" />
                        </span>
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/app/account?id=${acc.id}`}>كشف الحساب</Link>
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-theme-sm text-muted-foreground">
                  لست صاحب عقد هذه الوحدة، فلا كشف حساب على اسمك هنا.
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}

      {/* ── الاشتراكات والسيارات ───────────────────────────────────── */}
      <section className="grid gap-4 md:gap-6 lg:grid-cols-2">
        <SectionCard
          title="اشتراكاتي"
          description="خدمات وحدتك وخدماتك الشخصية — بمبلغ الدورة كما يُقيَّد."
          actions={
            pendingSubs.length > 0 ? (
              <Badge variant="warning">
                <span className="tabular">{pendingSubs.length}</span> بانتظار الموافقة
              </Badge>
            ) : null
          }
        >
          {subscriptions.length === 0 ? (
            <EmptyState
              icon={Sparkles}
              title="لا اشتراكات على وحدتك"
              description="الاشتراكات تُنشئها الإدارة. وطلب الاشتراك من البوّابة ينتظر القرار B2."
            />
          ) : (
            <ul className="flex flex-col divide-y">
              {subscriptions.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 first:pt-0 last:pb-0">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{s.serviceName}</span>
                    <span className="block text-theme-xs text-muted-foreground">
                      {s.billingCycle ? BILLING_CYCLE_AR[s.billingCycle] : "مرّة واحدة"}
                      {s.quantity > 1 ? (
                        <>
                          {" · "}
                          <span className="tabular">{s.quantity}</span> وحدات
                        </>
                      ) : null}
                      {" · منذ "}
                      <Ltr>{formatBaghdadDate(s.startDate)}</Ltr>
                    </span>
                  </span>

                  {/*
                   * ⚠️ «شخصي» تُقال صراحةً: بلا هذا التمييز يظنّ الساكن أن
                   * اشتراكه الخاص خدمةٌ على الوحدة كلها ويتوقّع أن يقتسم
                   * ثمنها غيره.
                   */}
                  {s.isPersonal ? <Badge variant="neutral">شخصي</Badge> : null}
                  {s.status !== "ACTIVE" ? (
                    <Badge variant={s.status === "PENDING_APPROVAL" ? "warning" : "neutral"}>
                      {SUBSCRIPTION_STATUS_AR[s.status]}
                    </Badge>
                  ) : null}
                  <Money value={s.periodAmountIqd} className="shrink-0 font-semibold" />
                </li>
              ))}
            </ul>
          )}

          {activeSubs.length > 0 ? (
            <p className="mt-3 border-t pt-3 text-theme-xs text-muted-foreground">
              <span className="tabular">{activeSubs.length}</span> اشتراك نشط. المبالغ
              تُقيَّد على حساب العقد في موعد كل دورة.
            </p>
          ) : null}
        </SectionCard>

        <SectionCard
          title="سياراتي"
          description="السيارات المسجَّلة على وحدتك وحالة باجاتها."
        >
          {vehicles.length === 0 ? (
            <EmptyState
              icon={Car}
              title="لا سيارات مسجَّلة"
              description="تسجيل السيارة من البوّابة يُبنى في مرحلته — راجع الإدارة لتسجيلها."
            />
          ) : (
            <ul className="flex flex-col divide-y">
              {vehicles.map((v) => (
                <li key={v.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Ltr className="tabular font-semibold">{v.plateNumber}</Ltr>
                    {v.plateProvince ? (
                      <span className="text-theme-xs text-muted-foreground">
                        {v.plateProvince}
                      </span>
                    ) : null}
                    <span className="min-w-0 flex-1 truncate text-theme-sm text-muted-foreground">
                      {[v.make, v.model, v.color].filter(Boolean).join(" · ") || "بلا وصف"}
                    </span>
                    {v.isMine ? <Badge variant="neutral">باسمي</Badge> : null}
                    <Badge
                      variant={
                        v.status === "APPROVED"
                          ? "success"
                          : v.status === "REJECTED"
                            ? "danger"
                            : "warning"
                      }
                    >
                      {VEHICLE_STATUS_AR[v.status]}
                    </Badge>
                  </div>

                  {v.badges.length > 0 ? (
                    <ul className="flex flex-wrap gap-2 ps-1">
                      {v.badges.map((b) => (
                        <li
                          key={b.id}
                          className="flex items-center gap-2 rounded-lg border bg-surface-muted/50 px-2.5 py-1.5"
                        >
                          <ReceiptText className="size-3.5 text-muted-foreground" aria-hidden />
                          <span className="text-theme-xs">
                            {b.code ? <Ltr className="tabular">{b.code}</Ltr> : "بلا رقم بعد"}
                          </span>
                          <Badge
                            variant={
                              b.effectiveStatus === "ISSUED"
                                ? "success"
                                : b.effectiveStatus === "EXPIRED"
                                  ? "danger"
                                  : "warning"
                            }
                          >
                            {BADGE_STATUS_AR[b.effectiveStatus]}
                          </Badge>
                          {b.expiresAt ? (
                            <span className="tabular text-theme-xs text-muted-foreground">
                              حتى <Ltr>{formatBaghdadDate(b.expiresAt)}</Ltr>
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="ps-1 text-theme-xs text-muted-foreground">
                      لا باج على هذه السيارة.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </section>

      {/* ── آخر الحركات ────────────────────────────────────────────── */}
      {openAccounts.some((a) => a.entries.length > 0) ? (
        <SectionCard
          title="آخر الحركات"
          description="على حساباتك المفتوحة — الأحدث أولاً."
        >
          <ul className="divide-y text-theme-sm">
            {openAccounts
              .flatMap((a) => a.entries)
              .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())
              .slice(0, 8)
              .map((e) => (
                <li
                  key={e.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
                >
                  <span>
                    <span className="block">{e.descriptionAr}</span>
                    <span className="tabular text-theme-xs text-muted-foreground">
                      <Ltr>{formatBaghdadDateTime(e.createdAt)}</Ltr> ·{" "}
                      {LEDGER_SOURCE_AR[e.source]}
                    </span>
                  </span>
                  {/* الاتجاه يحمله `type`؛ المبلغ موجب دائماً */}
                  <span
                    className={
                      e.type === "PAYMENT" ? "text-money-paid" : "text-money-overdue"
                    }
                  >
                    {e.type === "PAYMENT" ? "− " : "+ "}
                    <Money value={e.amountIqd} suffix={false} />
                  </span>
                </li>
              ))}
          </ul>
        </SectionCard>
      ) : null}

      {/* المبدأ 3: العقود المنتهية وحساباتها تبقى مرئية له لا تُمحى */}
      {closedAccounts.length > 0 ? (
        <section className="rounded-2xl border border-dashed p-5">
          <h3 className="text-theme-sm font-semibold">عقود سابقة</h3>
          <p className="mb-3 text-theme-xs text-muted-foreground">
            الحساب المغلق ودفتره يبقيان مقروءَين. الرصيد المجمَّد عليه يبقى
            مستحقاً ولا يُنقَل إلى عقد آخر.
          </p>
          <ul className="flex flex-col gap-2 text-theme-sm">
            {closedAccounts.map((acc) => (
              <li
                key={acc.id}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <span>
                  عقد {CONTRACT_TYPE_AR[acc.contract.type]}{" "}
                  <Ltr className="text-muted-foreground">
                    {acc.contract.contractNumber}
                  </Ltr>
                  {acc.closedAt ? (
                    <span className="tabular block text-theme-xs text-muted-foreground">
                      أُغلق <Ltr>{formatBaghdadDate(acc.closedAt)}</Ltr>
                    </span>
                  ) : null}
                </span>
                <span className="flex items-center gap-3">
                  <Money value={acc.balanceIqd} signed />
                  <Button asChild size="xs" variant="ghost">
                    <Link href={`/app/account?id=${acc.id}`}>الكشف</Link>
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
