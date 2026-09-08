import Link from "next/link";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Ltr } from "@/components/ui/ltr";
import { FilterLink, PageHeader } from "@/components/ui/page";
import {
  RANGE_PRESET,
  RANGE_PRESET_AR,
  toDayParam,
  type ReportRange,
} from "@/lib/domain/report-range";
import { formatBaghdadDate } from "@/lib/dates";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  قشرة التقرير — رأسٌ ومدّةٌ وتصدير.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── ⚠️ المدّة **في العنوان** لا في حالة العميل ─────────────────────
 * التقرير يُرسَل ويُطبَع ويُحفَظ في المفضّلة. ومدّةٌ تعيش في `useState`
 * تجعل الرابط الواحد يعني شيئاً مختلفاً لكل من يفتحه — وهو أسوأ ما يقع
 * لتقرير ماليّ يُناقَش بين اثنين.
 *
 * ── و**المدّة المعروضة تُكتب بحدودها الحقيقية** ────────────────────
 * ⚠️ الحدّ الأعلى مفتوح (بداية الغد)، وعرضُه كما هو يقول للمستخدم إن
 * التقرير يشمل الغد. فيُعرَض اليوم السابق له — وهو آخر يومٍ داخلٌ فعلاً.
 *
 * ── والتصدير للمالك وحده ───────────────────────────────────────────
 * الزرّ يظهر له فقط، والمسار يفرضه ثانيةً. والزرّ راحةٌ والحدّ هناك.
 */

/** المدد التي تُعرَض كأزرار — «مخصّصة» ليست زرّاً بل نتيجة تاريخين. */
const QUICK_PRESETS = RANGE_PRESET.filter((p) => p !== "custom");

export function ReportShell({
  title,
  description,
  basePath,
  range,
  exportSlug,
  canExport,
  children,
}: {
  title: string;
  description: string;
  basePath: string;
  /** `null` لتقريرٍ بلا مدّة — المستحقّات والتقادُم. */
  range: ReportRange | null;
  exportSlug: string;
  canExport: boolean;
  children: React.ReactNode;
}) {
  /* آخر يومٍ داخلٌ فعلاً — راجع التعليق أعلاه */
  const lastIncluded = range ? new Date(range.to.getTime() - 1) : null;

  const exportHref = range
    ? `/api/reports/${exportSlug}?preset=${range.preset}` +
      (range.preset === "custom"
        ? `&from=${toDayParam(range.from)}&to=${toDayParam(lastIncluded!)}`
        : "")
    : `/api/reports/${exportSlug}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={title}
        description={description}
        actions={
          canExport ? (
            <Button asChild variant="outline" className="gap-2">
              {/*
                ⚠️ `download` و`prefetch={false}`: المسار يبني الملفّ في كل
                طلب، والجلب المسبق كان سيبنيه لمجرّد المرور بالمؤشّر.
              */}
              <a href={exportHref} download>
                <Download className="size-4" />
                تصدير CSV
              </a>
            </Button>
          ) : null
        }
      />

      {range ? (
        <div className="flex flex-col gap-3">
          <nav aria-label="مدّة التقرير" className="flex flex-wrap items-center gap-2">
            {QUICK_PRESETS.map((p) => (
              <FilterLink
                key={p}
                label={RANGE_PRESET_AR[p]}
                href={`${basePath}?preset=${p}`}
                active={range.preset === p}
              />
            ))}
          </nav>

          <p className="text-theme-xs text-muted-foreground">
            من <Ltr>{formatBaghdadDate(range.from)}</Ltr> إلى{" "}
            <Ltr>{formatBaghdadDate(lastIncluded!)}</Ltr>
            {range.preset === "custom" ? " (مدّة مخصّصة)" : ""}
          </p>
        </div>
      ) : (
        <p className="text-theme-xs text-muted-foreground">
          {/* ⚠️ يُقال لماذا لا مدّة — وإلا بدا غيابُ المرشّح نقصاً */}
          هذا التقرير يعرض الحال **الآن** لا حركة مدّة — فلا مرشّح زمنيّ له.
        </p>
      )}

      {children}

      <nav aria-label="العودة" className="text-theme-xs text-muted-foreground">
        <Link href="/admin/reports" className="hover:underline">
          كل التقارير
        </Link>
      </nav>
    </div>
  );
}
