import Link from "next/link";
import {
  Banknote,
  CalendarClock,
  Car,
  FileSignature,
  IdCard,
  MessageSquareWarning,
  Scale,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { requireRoleOrRedirect } from "@/lib/auth/guard";
import { PageHeader } from "@/components/ui/page";
import { Badge } from "@/components/ui/badge";
import { canExportReports } from "./_range";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  التقارير — اللوحة الجامعة.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ⚠️ كل بطاقة تقول **مصدر رقمها** ────────────────────────────────
 * «مقيَّد» و«محصَّل» و«رصيد الآن» ثلاثة أشياء يخلطها الناس، والخلط بينها
 * في تقريرٍ ماليّ يُنتج قراراً خاطئاً لا رقماً خاطئاً فقط. فالوصف هنا
 * يفرّقها قبل أن يُفتَح التقرير.
 *
 * ── والدفعة الأولى: المال ───────────────────────────────────────────
 * تقارير الناس والتشغيل (السكان · الموظفون · الطلبات والمركبات) تأتي
 * لاحقاً. واللوحة لا تعرض بطاقاتٍ لصفحاتٍ لم تُبنَ — رابطٌ يعطي 404
 * يُعلّم المستخدم ألّا يثق بالبقيّة.
 */

interface ReportCard {
  /** المجموعة — كما في شريط التنقّل، فلا يتعلّم المستخدم تصنيفاً ثانياً. */
  group: "المال" | "الناس" | "التشغيل";
  href: string;
  title: string;
  description: string;
  source: string;
  icon: LucideIcon;
  ranged: boolean;
}

const REPORTS: readonly ReportCard[] = [
  {
    group: "المال",
    href: "/admin/reports/collections",
    title: "التحصيل",
    description: "ما قُبض فعلاً — بالطريقة واليوم والمحصِّل.",
    source: "المصدر: الدفعات المسدَّدة",
    icon: Banknote,
    ranged: true,
  },
  {
    group: "المال",
    href: "/admin/reports/outstanding",
    title: "المستحقّات",
    description: "من عليه رصيد اليوم، من الأكبر إلى الأصغر.",
    source: "المصدر: رصيد الحساب الآن",
    icon: Wallet,
    ranged: false,
  },
  {
    group: "المال",
    href: "/admin/reports/installment-ageing",
    title: "تقادُم الأقساط",
    description: "المتأخّر بشرائح 30 و60 و90 يوماً وأكثر.",
    source: "المصدر: تاريخ استحقاق القسط",
    icon: CalendarClock,
    ranged: false,
  },
  {
    group: "المال",
    href: "/admin/reports/service-revenue",
    title: "إيراد الخدمات",
    description: "ما قُيّد لكل خدمة في المدّة، واشتراكاتها النشطة.",
    source: "المصدر: قيود الدفتر",
    icon: FileSignature,
    ranged: true,
  },
  {
    group: "المال",
    href: "/admin/reports/ledger",
    title: "دفتر الحركة",
    description: "كل قيدٍ بنوعه ومصدره — منه تُفسَّر بقيّة الأرقام.",
    source: "المصدر: الدفتر",
    icon: Scale,
    ranged: true,
  },

  {
    group: "الناس",
    href: "/admin/reports/residents",
    title: "السكان",
    description: "من يسكن أين وكم — والحسابات التي لم تُربَط بعد.",
    source: "المصدر: روابط الشقق",
    icon: Users,
    ranged: false,
  },
  {
    group: "الناس",
    href: "/admin/reports/staff",
    title: "الموظفون",
    description: "التوزيع على الأقسام والتواجد وعبء العمل المفتوح.",
    source: "المصدر: الملفّات الوظيفية — بلا مبالغ",
    icon: IdCard,
    ranged: false,
  },

  {
    group: "التشغيل",
    href: "/admin/reports/requests",
    title: "الطلبات",
    description: "ما أُنجز في المدّة ومتوسّط إنجازه، وما ينتظر الآن.",
    source: "المصدر: الطلبات وتواريخ إغلاقها",
    icon: MessageSquareWarning,
    ranged: true,
  },
  {
    group: "التشغيل",
    href: "/admin/reports/vehicles",
    title: "المركبات",
    description: "المسجَّل والمعتمَد، وحال الباجات عند البوّابة.",
    source: "المصدر: المركبات والباجات",
    icon: Car,
    ranged: false,
  },
];

/** ترتيب المجموعات — كترتيب الشريط. */
const GROUPS = ["المال", "الناس", "التشغيل"] as const;

export default async function ReportsHubPage() {
  const me = await requireRoleOrRedirect("ADMIN", "OWNER");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="التقارير"
        description="أرقام المال — كلٌّ منها يقول من أين جاء رقمه."
        actions={
          canExportReports(me.role) ? (
            <Badge variant="success">التصدير متاح لك</Badge>
          ) : (
            /*
              ⚠️ يُقال للأدمن **لماذا** لا زرّ تصدير عنده، لا يُخفى الزرّ
              بصمت: غيابٌ بلا سبب يُقرأ عطلاً ويُفتَح له بلاغ.
            */
            <Badge variant="neutral">التصدير من صلاحية المالك</Badge>
          )
        }
      />

      {GROUPS.map((g) => (
        <section key={g} className="flex flex-col gap-3">
          {/*
            ⚠️ **مجموعات كمجموعات الشريط.** تسعة روابط في شبكة واحدة
            تُقرأ كوماً، والمستخدم الذي يعرف «المال» في الشريط يجده هنا
            بنفس الاسم — فلا يتعلّم تصنيفاً ثانياً للشيء نفسه.
          */}
          <h2 className="text-theme-sm font-semibold text-muted-foreground">{g}</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {REPORTS.filter((r) => r.group === g).map((r) => {
              const Icon = r.icon;
              return (
                <Link
                  key={r.href}
                  href={r.href}
                  className="flex flex-col gap-3 rounded-2xl border bg-card p-5 transition-colors hover:bg-accent"
                >
                  <span className="flex items-center gap-3">
                    <span
                      className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-brand-soft text-accent-brand-strong"
                      aria-hidden
                    >
                      <Icon className="size-5" />
                    </span>
                    <span className="font-semibold">{r.title}</span>
                  </span>

                  <span className="text-theme-sm text-muted-foreground">
                    {r.description}
                  </span>

                  <span className="flex flex-wrap items-center gap-2 text-theme-xs text-muted-foreground">
                    <span>{r.source}</span>
                    {/* ⚠️ «بلا مدّة» يُقال هنا كي لا يُبحَث عن مرشّح غير موجود */}
                    <Badge variant="neutral">{r.ranged ? "بمدّة" : "الحال الآن"}</Badge>
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
