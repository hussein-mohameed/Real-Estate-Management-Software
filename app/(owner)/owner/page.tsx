import Link from "next/link";
import {
  Building2,
  HardHat,
  Home,
  Receipt,
  Users,
  Wallet,
} from "lucide-react";
import { requireRoleOrRedirect } from "@/lib/auth/guard";
import {
  allBuildingsStats,
  compoundPortfolioStats,
  compoundStats,
} from "@/lib/services/statistics";
import { listBuildings } from "@/lib/actions/buildings";
import { Money } from "@/components/ui/money";
import { Ltr } from "@/components/ui/ltr";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/ui/stat-card";
import { SegmentedBar } from "@/components/ui/segmented-bar";
import { OccupancyGauge } from "@/components/charts/occupancy-gauge";
import { BuildingsProgressChart } from "@/components/charts/buildings-progress-chart";
import { PageHeader, SectionCard, TableCard, TableEmpty } from "@/components/ui/page";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatPercentage } from "@/lib/domain/statistics";
import {
  CONSTRUCTION_STATUS_AR,
  CONTRACT_TYPE_AR,
  OCCUPANCY_STATUS_AR,
  OWNERSHIP_STATUS_AR,
} from "@/lib/labels";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  لوحة المالك — مؤشّرات المجمّع.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── الأرقام تُقرأ من وحدة واحدة ─────────────────────────────────────
 * كل رقم هنا من `lib/services/statistics.ts`، لا يُحسب في هذه الصفحة.
 * إعادة حساب «نسبة الإنجاز» هنا وفي شاشة البنايات كانت ستُنتج رقمين
 * مختلفين عند أول تعديل — **بلا فشل ولا تحذير**، والمالك يقرأ ليقرّر.
 *
 * ── وأربع طبقات، من «كيف الحال» إلى «أين بالتفصيل» ─────────────────
 *   1. **أربعة مقاييس** — إجمالي · إنجاز · إشغال · سكّان.
 *   2. **الإنجاز والإشغال** رسماً: المالك يسأل «هل نتقدّم؟» لا «كم بالضبط».
 *   3. **المال** في قسم منفصل بتحفّظه المكتوب معه — لا مبثوثاً بين غيره.
 *   4. **التوزيعات ثم جدول البنايات** — للنزول إلى التفصيل.
 *
 * ── ما ليس هنا ولماذا ──────────────────────────────────────────────
 * لوحة §8.1 الكاملة تسع مجموعات مؤشّرات، وأكثرها مالي يحتاج الفوترة
 * والدفعات. وما يبقى **معطوباً بالتعريف** حتى تُحسم قرارات:
 *   · «رصيد الشقة» ← `B3`: للشقة حسابان بعد D1، وجمعهما يخلط ذمّتين.
 *   · «إجمالي قيمة المبيعات» ← `Q30`: يُحسب من سعر الشقة أو من قيمة
 *     العقد، بنتيجتين مختلفتين ولا مرجع معلن.
 * ما يُعرض هنا هو ما له تعريف واحد لا لبس فيه.
 */
export default async function OwnerDashboard() {
  const me = await requireRoleOrRedirect("OWNER", "ADMIN");

  const [stats, portfolio, byBuilding, buildings] = await Promise.all([
    compoundStats(),
    compoundPortfolioStats(),
    allBuildingsStats(),
    listBuildings({ page: 1 }, { userId: me.id, role: me.role }),
  ]);

  const rows = buildings.ok ? buildings.data.rows : [];

  /** بيانات رسم الإنجاز — من وحدة الإحصاءات لا من عدٍّ في الصفحة. */
  const progress = rows.map((b) => {
    const s = byBuilding.get(b.id);
    return {
      code: b.code,
      completed: s?.completedApartments ?? 0,
      total: s?.apartmentsInBuilding ?? 0,
      percentage: s?.completionPercentage ?? null,
    };
  });

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="مؤشّرات المجمّع"
        description="محسوبة لحظياً من البيانات — لا عدّادات مخزَّنة تتقادم."
      />

      {/* ── 1. المقاييس على عرض الصفحة كلّه ──────────────────────── */}
      <section className="grid gap-4 sm:grid-cols-2 md:gap-6 xl:grid-cols-4">
        <StatCard
          label="إجمالي الشقق"
          value={stats.totalApartments}
          hint={
            <>
              في <span className="tabular">{portfolio.buildingsCount}</span> بناية
            </>
          }
          icon={Building2}
          tone="brand"
          href="/admin/apartments"
        />
        <StatCard
          label="نسبة الإنجاز"
          value={portfolio.completedApartments}
          /*
           * ⚠️ القيمة هي **العدد** والشريط يحمل النسبة.
           * بطاقةٌ قيمتها «٦٢٪» ثم شريطٌ بنفس الـ٦٢٪ تقول الشيء مرّتين
           * وتُسقط الرقم المطلق — والمالك يحتاج الاثنين: النسبة ليقيس
           * التقدّم، والعدد ليعرف حجمه.
           */
          share={{ value: portfolio.completedApartments, total: stats.totalApartments }}
          hint="مكتملة أو مُسلَّمة — التسليم بعد الإنجاز لا بدلاً منه"
          icon={HardHat}
          tone="warning"
          href="/admin/buildings"
        />
        <StatCard
          label="مسكونة"
          value={stats.occupiedTotal}
          share={{ value: stats.occupiedTotal, total: stats.totalApartments }}
          hint="تُفوتَر عليها الخدمات الدورية"
          icon={Home}
          tone="success"
          href="/admin/apartments"
        />
        <StatCard
          label="السكّان"
          value={portfolio.activeResidents}
          /* ⚠️ بلا `share`: السكّان ليسوا جزءاً من الشقق — والنسبة بينهما لا معنى لها */
          hint="أشخاص لهم ارتباط سكن نشط"
          icon={Users}
          tone="info"
          href="/admin/residents"
        />
      </section>

      {/* ── 2. الإنجاز والإشغال رسماً ─────────────────────────────── */}
      <div className="grid grid-cols-12 gap-4 md:gap-6">
        <div className="col-span-12 xl:col-span-8">
          <SectionCard
            title="الإنجاز حسب البناية"
            description="أيّ البنايات متأخّرة — وهو السؤال الذي يُفتح التقرير من أجله."
            className="h-full"
          >
            <BuildingsProgressChart data={progress} />
          </SectionCard>
        </div>

        <div className="col-span-12 xl:col-span-4">
          <SectionCard
            title="الإشغال"
            description="المحور الذي يقرّر ما يُفوتَر — الفارغة لا تُقيَّد عليها خدمات دورية."
            className="h-full"
          >
            <OccupancyGauge
              percentage={stats.occupancyPercentage}
              occupied={stats.occupiedTotal}
              total={stats.totalApartments}
            />
            <div className="mt-2">
              <SegmentedBar
                emptyAr="لا شقق بعد — أنشئ بناية لتظهر هنا."
                segments={[
                  {
                    label: OCCUPANCY_STATUS_AR.OCCUPIED_BY_OWNER,
                    value: stats.occupancy.OCCUPIED_BY_OWNER,
                    className: "bg-occupancy-owner",
                  },
                  {
                    label: OCCUPANCY_STATUS_AR.OCCUPIED_BY_TENANT,
                    value: stats.occupancy.OCCUPIED_BY_TENANT,
                    className: "bg-occupancy-tenant",
                  },
                  {
                    label: OCCUPANCY_STATUS_AR.VACANT,
                    value: stats.occupancy.VACANT,
                    className: "bg-occupancy-vacant",
                  },
                ]}
              />
            </div>
          </SectionCard>
        </div>
      </div>

      {/* ── 3. المال — بتحفّظه مكتوباً معه لا في هامش الصفحة ─────── */}
      <SectionCard
        title="الوضع المالي"
        description="ما له تعريف واحد لا لبس فيه من §4.20. وما ينتظر قراراً مذكور تحته صراحةً."
        bodyClassName="flex flex-col gap-4"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <StatCard
            label="إجمالي المستحقات"
            value={<Money value={stats.totalOutstandingIqd} />}
            /*
             * ⚠️ عدد المدينين ليس زينة: مبلغٌ كبير على حسابين حالةٌ،
             * وعلى ثمانين حالةٌ أخرى تماماً — والإجمالي وحده لا يفرّق.
             */
            hint={
              portfolio.debtorAccounts === 0 ? (
                "لا حساب مدين"
              ) : (
                <>
                  على <span className="tabular">{portfolio.debtorAccounts}</span> حساباً
                  مفتوحاً برصيد موجب
                </>
              )
            }
            icon={Wallet}
            tone={stats.totalOutstandingIqd > 0n ? "danger" : "neutral"}
          />
          <StatCard
            label="الإيراد الشهري المتوقّع"
            value={<Money value={portfolio.expectedMonthlyServiceRevenueIqd} />}
            hint="من الاشتراكات النشطة — الربعي ÷ 3 والسنوي ÷ 12 (‏Q45)"
            icon={Receipt}
            tone="brand"
            href="/admin/services"
          />
        </div>

        {/*
         * ⚠️ التحفّظ **داخل القسم المالي** لا في ذيل الصفحة.
         * ملاحظةٌ في الأسفل لا يقرأها من نظر إلى الرقم وأغلق الصفحة —
         * وهو ما يفعله المالك. وموضعُها بجانب ما تتحفّظ عليه هو ما يجعلها
         * تُقرأ.
         */}
        {/*
         * ⚠️ `<strong>` لا `**نجمتان**`: الترميز داخل JSX نصٌّ عاديّ
         * يُعرض حرفياً — «‏**التحصيل الفعلي**» بنجمتيه على الشاشة.
         */}
        <p className="rounded-lg border border-dashed p-3 text-theme-xs leading-relaxed text-muted-foreground">
          الرقمان أعلاه <strong className="font-medium text-foreground">مقياسان
          قائمان</strong>: المستحقات من أرصدة الحسابات المفتوحة، والإيراد
          المتوقّع من الاشتراكات النشطة. وما ينتظر قرارات{" "}
          <Ltr className="tabular">B1–B7</Ltr> هو التحصيل الفعلي (يحتاج الفوترة
          والدفعات)، ورصيد الشقة المفرد (‏<Ltr>B3</Ltr> — للشقة حسابان بعد{" "}
          <Ltr>D1</Ltr>)، وإجمالي قيمة المبيعات (‏<Ltr>Q30</Ltr> — من سعر الشقة
          أم من قيمة العقد).
        </p>
      </SectionCard>

      {/* ── 4. التوزيعات ─────────────────────────────────────────── */}
      <section className="grid gap-4 md:gap-6 lg:grid-cols-3">
        <SectionCard
          title="حالة الإنشاء"
          description="‏المُسلَّمة منجَزةٌ أيضاً — التسليم يقع بعد الإنجاز."
        >
          <SegmentedBar
            emptyAr="لا شقق بعد."
            segments={[
              {
                label: CONSTRUCTION_STATUS_AR.UNDER_CONSTRUCTION,
                value: portfolio.construction.UNDER_CONSTRUCTION,
                className: "bg-construction-under",
              },
              {
                label: CONSTRUCTION_STATUS_AR.COMPLETED,
                value: portfolio.construction.COMPLETED,
                className: "bg-construction-done",
              },
              {
                label: CONSTRUCTION_STATUS_AR.DELIVERED,
                value: portfolio.construction.DELIVERED,
                className: "bg-construction-delivered",
              },
            ]}
          />
        </SectionCard>

        <SectionCard
          title="حالة التملّك"
          description="المحور الذي يقرّر من يُقيَّد عليه ثمن الوحدة."
        >
          <SegmentedBar
            emptyAr="لا شقق بعد."
            segments={[
              {
                label: OWNERSHIP_STATUS_AR.SOLD,
                value: portfolio.ownership.SOLD,
                className: "bg-occupancy-owner",
              },
              {
                label: OWNERSHIP_STATUS_AR.RENTED_BY_COMPANY,
                value: portfolio.ownership.RENTED_BY_COMPANY,
                className: "bg-occupancy-tenant",
              },
              {
                label: OWNERSHIP_STATUS_AR.UNSOLD,
                value: portfolio.ownership.UNSOLD,
                className: "bg-occupancy-vacant",
              },
            ]}
          />
        </SectionCard>

        <SectionCard
          title="العقود النشطة"
          description="لكل عقد حسابه المالي المستقلّ (‏D1)."
        >
          <SegmentedBar
            emptyAr="لا عقود نشطة بعد."
            segments={[
              {
                label: CONTRACT_TYPE_AR.SALE,
                value: portfolio.activeContracts.SALE,
                className: "bg-occupancy-owner",
              },
              {
                label: CONTRACT_TYPE_AR.RENTAL,
                value: portfolio.activeContracts.RENTAL,
                className: "bg-occupancy-tenant",
              },
            ]}
          />
        </SectionCard>
      </section>

      {/* ── 5. التفصيل: بناية بناية ──────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <h3 className="text-theme-sm font-medium text-muted-foreground">
          الإنجاز حسب البناية — بالتفصيل
        </h3>
        <TableCard>
          <Table className="min-w-[40rem]">
            <TableHeader>
              <TableRow>
                <TableHead>البناية</TableHead>
                <TableHead>الشقق</TableHead>
                <TableHead>المنجَزة</TableHead>
                <TableHead className="w-56">نسبة الإنجاز</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableEmpty colSpan={4}>
                  لا بنايات بعد — أضف أولاها لتظهر هنا.
                </TableEmpty>
              ) : (
                rows.map((b) => {
                  const s = byBuilding.get(b.id);
                  const pct = s?.completionPercentage ?? null;
                  return (
                    <TableRow key={b.id}>
                      <TableCell className="font-medium">
                        <Ltr>{b.code}</Ltr>
                        {b.name ? (
                          <span className="ms-2 text-muted-foreground">{b.name}</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="tabular">
                        {s?.apartmentsInBuilding ?? 0}
                      </TableCell>
                      <TableCell className="tabular">
                        {s?.completedApartments ?? 0}
                      </TableCell>
                      <TableCell>
                        {/*
                         * شريطٌ مع الرقم لا رقمٌ وحده: عمودٌ من نسبٍ نصّية
                         * يحتاج قراءةَ كل سطر لمعرفة أيُّ بناية متأخّرة،
                         * والشريط يُظهرها بلمحة.
                         *
                         * ⚠️ وبناية بلا شقق تعرض «—» لا شريطاً فارغاً:
                         * الفارغ يقول «صفر إنجاز»، والحقيقة «لا مقام».
                         */}
                        {pct === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span className="flex items-center gap-3">
                            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                              <span
                                className="block h-full rounded-full bg-construction-done"
                                style={{ width: `${pct}%` }}
                              />
                            </span>
                            <span className="tabular w-14 shrink-0 text-end text-theme-xs">
                              {formatPercentage(pct)}
                            </span>
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableCard>
        {buildings.ok && buildings.data.total > rows.length ? (
          /* ⚠️ الجدول يعرض أول 25 — يُقال صراحةً كي لا يُقرأ الناقص كغائب */
          <p className="text-theme-xs text-muted-foreground">
            تُعرض <span className="tabular">{rows.length}</span> من{" "}
            <span className="tabular">{buildings.data.total}</span> بناية.{" "}
            <Link href="/admin/buildings" className="underline">
              الشاشة الكاملة
            </Link>
          </p>
        ) : null}
      </section>

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href="/admin/apartments">تصفّح الشقق</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href="/admin/contracts">تصفّح العقود</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href="/admin/services">تصفّح الخدمات</Link>
        </Button>
      </div>
    </div>
  );
}
