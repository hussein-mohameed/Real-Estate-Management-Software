import Link from "next/link";
import {
  Building2,
  DoorOpen,
  FileClock,
  FileSignature,
  HardHat,
  Home,
  KeyRound,
  UserX,
} from "lucide-react";
import { requireRoleOrRedirect } from "@/lib/auth/guard";
import { listApartments } from "@/lib/actions/apartments";
import { listContracts } from "@/lib/actions/contracts";
import { listResidents } from "@/lib/actions/residents";
import { listBuildings } from "@/lib/actions/buildings";
import { Ltr } from "@/components/ui/ltr";
import { StatCard } from "@/components/ui/stat-card";
import { TaskCard } from "@/components/ui/task-card";
import { SegmentedBar } from "@/components/ui/segmented-bar";
import { OccupancyGauge } from "@/components/charts/occupancy-gauge";
import { BuildingsProgressChart } from "@/components/charts/buildings-progress-chart";
import { SectionCard } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { PageHeader } from "@/components/ui/page";
import { allBuildingsStats, compoundStats } from "@/lib/services/statistics";
import { CONTRACT_TYPE_AR, OCCUPANCY_STATUS_AR } from "@/lib/labels";
import { formatBaghdadDate } from "@/lib/dates";

/**
 * لوحة الإدارة — «مهام اليوم».
 *
 * ── لماذا **مهام** لا أرقام ─────────────────────────────────────────
 * لوحة تعرض أرقاماً وحدها تُقرأ مرّة ثم تُتجاهَل. ما يجعل الأدمن يفتحها
 * كل صباح هو أن تقول له **ما ينتظر فعله**، ولماذا يهمّ.
 *
 * ── التدرّج البصري مقصود ───────────────────────────────────────────
 * ثلاث طبقات، من الأعمّ إلى الأخصّ:
 *   1. **أربعة مقاييس** على عرض الصفحة — حالة المجمّع بلمحة، لكلٍّ
 *      أيقونته ولونه.
 *   2. **رسم الإنجاز والإشغال** — نسبة قبل رقم، لأن «كم مسكونة من كم»
 *      سؤال نسبيّ لا عدديّ.
 *   3. **بطاقات المهام** — ما ينتظر، بحافّة لونية تُقرأ خطورتها قبل نصّها.
 *
 * ⚠️ **المقاييس كانت محشورة في 2×2 داخل سبعة أعمدة** بجانب رسم الإنجاز.
 * أربع بطاقات في نصف العرض تعني رقماً في ربع البطاقة — وهو أصغر ما يجب
 * أن يكون أكبرَ شيء في اللوحة. صارت صفّاً واحداً على العرض كلّه، والرسمان
 * تحتها في صفّ ثانٍ يقتسمانه 8/4.
 *
 * ⚠️ الأرقام العامّة من `compoundStats` لا من ترشيح الصفوف: اللوحة تجلب
 * 200 شقة **للقوائم** لا للعدّ، وعدّها في الذاكرة كان يكسر الأرقام بصمت
 * فوق 200 شقة.
 */
export default async function AdminHome() {
  const me = await requireRoleOrRedirect("ADMIN", "OWNER");
  const actor = { userId: me.id, role: me.role };

  const [stats, byBuilding, apartments, drafts, activeContracts, residents, buildings] =
    await Promise.all([
      compoundStats(),
      allBuildingsStats(),
      listApartments({ page: 1, pageSize: 200 }, actor),
      listContracts({ status: "DRAFT", page: 1, pageSize: 25 }, actor),
      listContracts({ status: "ACTIVE", page: 1, pageSize: 200 }, actor),
      listResidents({ page: 1, pageSize: 200 }, actor),
      listBuildings({ page: 1 }, actor),
    ]);

  const apts = apartments.ok ? apartments.data.rows : [];
  const draftRows = drafts.ok ? drafts.data.rows : [];
  const activeRows = activeContracts.ok ? activeContracts.data.rows : [];
  const resRows = residents.ok ? residents.data.rows : [];

  // مسكونة بلا عقد نشط: خلل تحصيل — تُستهلك الخدمات ولا حساب يقيّدها
  const contracted = new Set(activeRows.map((c) => c.apartment.id));
  const occupiedNoContract = apts.filter(
    (a) => a.occupancyStatus !== "VACANT" && !contracted.has(a.id),
  );
  const unlinked = resRows.filter((r) => r.apartmentLinks.length === 0);
  const underConstruction = apts.filter(
    (a) => a.constructionStatus === "UNDER_CONSTRUCTION",
  );

  /** بيانات رسم الإنجاز — من وحدة الإحصاءات لا من عدٍّ في الصفحة. */
  const progress = (buildings.ok ? buildings.data.rows : []).map((b) => {
    const st = byBuilding.get(b.id);
    return {
      code: b.code,
      completed: st?.completedApartments ?? 0,
      total: st?.apartmentsInBuilding ?? 0,
      percentage: st?.completionPercentage ?? null,
    };
  });

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="مهام اليوم"
        description="ما ينتظر تدخّلك الآن — محسوباً لحظياً، بلا عدّادات مخزَّنة."
      />

      {/* ── الطبقة الأولى: المقاييس على عرض الصفحة كلّه ────────── */}
      <section className="grid gap-4 sm:grid-cols-2 md:gap-6 xl:grid-cols-4">
        <StatCard
          label="إجمالي الشقق"
          value={stats.totalApartments}
          hint={
            buildings.ok ? (
              <>
                في <span className="tabular">{buildings.data.total}</span> بناية
              </>
            ) : undefined
          }
          icon={Building2}
          tone="brand"
          href="/admin/apartments"
        />
        <StatCard
          label="مسكونة"
          value={stats.occupiedTotal}
          /* الشريط يعطي «من كم» — فلا يحتاج التلميح إلى تكرار النسبة */
          share={{ value: stats.occupiedTotal, total: stats.totalApartments }}
          hint="تُفوتَر عليها الخدمات الدورية"
          icon={Home}
          tone="success"
          href="/admin/apartments?occupancy=OCCUPIED_BY_OWNER"
        />
        <StatCard
          label="فارغة"
          value={stats.occupancy.VACANT}
          share={{ value: stats.occupancy.VACANT, total: stats.totalApartments }}
          hint="لا تُفوتَر خدماتها الدورية"
          icon={DoorOpen}
          tone="neutral"
          href="/admin/apartments?occupancy=VACANT"
        />
        {/* ⚠️ بلا `share`: العقود ليست جزءاً من الشقق — والنسبة بينهما لا معنى لها */}
        <StatCard
          label="عقود نشطة"
          value={activeRows.length}
          hint="لكلٍّ حسابه المالي المستقلّ"
          icon={FileSignature}
          tone="info"
          href="/admin/contracts?status=ACTIVE"
        />
      </section>

      {/* ── الطبقة الثانية: الإنجاز على 8 والإشغال على 4 ────────── */}
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

      {/* ── الطبقة الثالثة: ما ينتظر ────────────────────────────── */}
      <section className="flex flex-col gap-4">
        <h3 className="text-sm font-medium text-muted-foreground">ما ينتظر تدخّلك</h3>

        <div className="grid gap-4 xl:grid-cols-2">
          <TaskCard
            title="شقق مسكونة بلا عقد نشط"
            count={occupiedNoContract.length}
            tone="danger"
            icon={KeyRound}
            why="خلل تحصيل: الوحدة مشغولة وتستهلك الخدمات، ولا حساب يُقيَّد عليه شيء."
            href="/admin/apartments"
            emptyAr="كل شقة مسكونة عليها عقد نشط."
          >
            {occupiedNoContract.slice(0, 5).map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                <Link
                  href={`/admin/apartments/${a.id}`}
                  className="font-medium hover:underline"
                >
                  <Ltr>{a.displayNumber}</Ltr>
                </Link>
                <StatusBadge axis="occupancy" value={a.occupancyStatus} />
              </li>
            ))}
          </TaskCard>

          <TaskCard
            title="مسوّدات عقود لم تُفعَّل"
            count={draftRows.length}
            tone="warning"
            icon={FileClock}
            why="المسوّدة لا حساب لها. حتى تُفعَّل، لا شيء يُقيَّد على الشقة."
            href="/admin/contracts?status=DRAFT"
            emptyAr="لا مسوّدات معلّقة."
          >
            {draftRows.slice(0, 5).map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <Ltr className="font-medium">{c.contractNumber}</Ltr>
                  <span className="block text-xs text-muted-foreground">
                    {CONTRACT_TYPE_AR[c.type]} · <Ltr>{c.apartment.displayNumber}</Ltr>
                  </span>
                </span>
                <span className="tabular shrink-0 text-xs text-muted-foreground">
                  <Ltr>{formatBaghdadDate(c.startDate)}</Ltr>
                </span>
              </li>
            ))}
          </TaskCard>

          <TaskCard
            title="سكان بلا شقة"
            count={unlinked.length}
            tone="warning"
            icon={UserX}
            why="حساب أُنشئ ولم يُربط بوحدة — لا يظهر في أي كشف ولا يستلم أي إخطار شقة."
            href="/admin/residents"
            emptyAr="كل ساكن مربوط بشقة."
          >
            {unlinked.slice(0, 5).map((r) => (
              <li key={r.id} className="py-2.5 font-medium">
                {r.fullName}
              </li>
            ))}
          </TaskCard>

          <TaskCard
            title="شقق تحت الإنشاء"
            count={underConstruction.length}
            tone="info"
            icon={HardHat}
            why="لا يمكن تعيين حالة سكن لها (‏R10)، ولا تدخل حساب الإشغال."
            href="/admin/apartments?construction=UNDER_CONSTRUCTION"
            emptyAr="لا شقة تحت الإنشاء."
          >
            {underConstruction.slice(0, 5).map((a) => (
              <li key={a.id} className="py-2.5">
                <Link
                  href={`/admin/apartments/${a.id}`}
                  className="font-medium hover:underline"
                >
                  <Ltr>{a.displayNumber}</Ltr>
                </Link>
              </li>
            ))}
          </TaskCard>
        </div>
      </section>
    </div>
  );
}
