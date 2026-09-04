import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { PaginationNav } from "@/components/ui/pagination-nav";

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  تشريح الصفحة — §11.2.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── لماذا هذه المكوّنات موجودة ──────────────────────────────────────
 * ⚠️ **هذا الملف مكتوب لمنع خطأ ارتكبتُه.** بنيتُ عشر شاشات فكتبتُ في
 * كلٍّ منها رأسها وبطاقتها وحالة فراغها بيدي — فتفرّقت المسافات
 * والأحجام، وصار لكل شاشة تصميمها الصغير الخاص.
 *
 * §11.2 ينصّ على **تشريح ثابت** لصفحة القائمة: رأس + مرشّحات + جدول +
 * حالة فراغ. والثبات لا يتحقّق بالنيّة بل بمكوّن واحد يستعمله الجميع.
 */

/**
 * رأس الصفحة: عنوان + وصف + أفعال.
 *
 * الوصف **ليس زينة**: يقول ما هذه الشاشة ومتى تُستعمل. شاشةٌ بعنوان
 * وحده تُترك للتخمين.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 className="text-title-sm font-semibold tracking-tight">{title}</h2>
        {description ? (
          <p className="mt-1 text-theme-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

/**
 * بطاقة تحوي جدولاً.
 *
 * ⚠️ `overflow-x-auto` على **الحاوية لا الجدول**: الجدول العريض يجب أن
 * يُمرَّر داخل بطاقته لا أن يدفع الصفحة كلها أفقياً — وهو ما يكسر
 * التخطيط على الهاتف ويجعل شريط التنقّل يهرب.
 */
export function TableCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        /*
         * ⚠️ **`min-w-0` ليست تزيّناً — بدونها `overflow-x-auto` لا تعمل.**
         * هذه البطاقة عنصر في `flex flex-col`، وافتراض عنصر الـflex هو
         * `min-width: auto`: أي أنه **يرفض الانكماش دون عرض محتواه**. فجدولٌ
         * بـ`min-w-[68rem]` يوسّع البطاقة، فتوسّع الصفحة، فينزلق **جسم
         * الصفحة كلّه أفقياً** — والقائمة الجانبية والرأس معه.
         *
         * والعيب لا يظهر إلا حين يتجاوز الجدولُ عرض الشاشة، فيمرّ في
         * التطوير على شاشة عريضة ويظهر عند المستخدم.
         */
        "min-w-0 overflow-x-auto rounded-2xl border bg-card",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * بطاقة نموذج: عنوان ووصف ثم الحقول.
 *
 * ⚠️ `<Card>` يلفّ `<form>` ولا يكونه: `Card` عنصر `div`، والنموذج داخله.
 * الخلط بينهما كان يجعل كل نموذج يكتب أصنافَ البطاقة بيده من جديد.
 */
export function FormCard({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("gap-0 py-0", className)}>
      <CardHeader className="gap-1 border-b px-5 py-4 md:px-6">
        <CardTitle className="text-theme-sm font-semibold">{title}</CardTitle>
        {description ? (
          <p className="text-theme-xs text-muted-foreground">{description}</p>
        ) : null}
      </CardHeader>
      <CardContent className="p-5 md:p-6">{children}</CardContent>
    </Card>
  );
}

/** بطاقة قسم عامّة — عنوان ووصف ومحتوى. */
export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <Card className={cn("gap-0 py-0", className)}>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3 px-5 py-4 md:px-6">
        <div className="min-w-0">
          <CardTitle className="text-theme-sm font-semibold">{title}</CardTitle>
          {description ? (
            <p className="mt-1 text-theme-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions}
      </CardHeader>
      <CardContent className={cn("px-5 pb-5 md:px-6 md:pb-6", bodyClassName)}>
        {children}
      </CardContent>
    </Card>
  );
}

/**
 * حالة الفراغ.
 *
 * ── ثلاث حالات لا واحدة ────────────────────────────────────────────
 * ⚠️ «لا نتائج» و«لا بيانات بعد» و«لم يُبنَ» **معانٍ مختلفة**، وعرضها
 * بنصّ واحد يضلّل: المستخدم الذي رشّح ولم يجد يظنّ النظام فارغاً، والذي
 * فتح شاشة جديدة يظنّ ترشيحه خاطئاً.
 *
 * `action` يجعل الحالة **مخرجاً لا حائطاً**: «لا بنايات — أضف أولاها».
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 rounded-2xl border border-dashed px-6 py-12 text-center",
        className,
      )}
    >
      {Icon ? (
        <span className="mb-1 grid size-11 place-items-center rounded-full bg-gray-100 dark:bg-white/5">
          <Icon className="size-5 text-gray-400" aria-hidden />
        </span>
      ) : null}
      <p className="text-theme-sm font-medium">{title}</p>
      {description ? (
        <p className="max-w-sm text-theme-xs text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

/** صفّ فراغ داخل جدول — يحافظ على بنية الجدول ولا يكسر أعمدته. */
export function TableEmpty({
  colSpan,
  children,
}: {
  colSpan: number;
  children: React.ReactNode;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-5 py-12 text-center">
        <p className="text-theme-sm text-muted-foreground">{children}</p>
      </td>
    </tr>
  );
}

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  لافتة خطأ الإجراء.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── 🔴 لماذا وُجدت ─────────────────────────────────────────────────
 * كانت هذه الكتلة منسوخة حرفياً في **خمس عشرة صفحة**: نفس الأصناف، نفس
 * `role="alert"`، نفس ألوان الوضع الداكن. وأول تعديل على واحدة يترك أربع
 * عشرة على حالها — فتختلف الشاشات في شيء يقرأه المستخدم عند الفشل، وهو
 * أسوأ وقت لتختلف فيه.
 *
 * ⚠️ و`role="alert"` **جزء من المكوّن لا خيار للمستدعي**: قارئ الشاشة لا
 * ينطق نصّاً يظهر بلا هذا الدور، فيبقى المستخدم الكفيف ينتظر جواباً وصل
 * ولم يُقَل.
 */
export function ActionError({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="rounded-xl border border-error-200 bg-error-25 p-4 text-theme-sm text-destructive dark:border-error-500/30 dark:bg-error-500/5"
    >
      {message}
    </p>
  );
}

/**
 * ترقيم صفحات من **الإجمالي وحجم الصفحة** لا من عدد الصفحات.
 *
 * ⚠️ `Math.max(1, Math.ceil(total / pageSize))` كان مكرّراً في **اثنتي
 * عشرة صفحة**. و`Math.max(1, …)` ليس تزيّناً: `total = 0` يُعطي `pages = 0`،
 * فيُصيَّر شريطُ ترقيم بلا صفحات — أو يُقسَم على صفر إن غاب الحدّ.
 *
 * والمكوّن يقبل ما يعرفه المستدعي (‏`total`) لا ما يجب أن يحسبه.
 */
export function Pager({
  basePath,
  page,
  total,
  pageSize,
  params,
}: {
  basePath: string;
  page: number;
  total: number;
  pageSize: number;
  params: Record<string, string | string[] | undefined>;
}) {
  return (
    <PaginationNav
      basePath={basePath}
      page={page}
      pages={Math.max(1, Math.ceil(total / pageSize))}
      params={params}
    />
  );
}
