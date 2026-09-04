import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * تصفّح الصفحات.
 *
 * ── لماذا مكوّن ─────────────────────────────────────────────────────
 * ⚠️ كان مكتوباً بيده في **خمس شاشات**، وفي كلٍّ منها يُعاد بناء سلسلة
 * الاستعلام من جديد — وهو الموضع الذي يُنسى فيه مرشّح فتضيع مرشّحات
 * المستخدم عند الانتقال للصفحة الثانية.
 *
 * ── والاتجاه هنا **فيزيائي بحقّ** ──────────────────────────────────
 * «السابق» في واجهة عربية يقع يميناً و«التالي» يساراً. `ChevronRight`
 * للسابق و`ChevronLeft` للتالي — والقلب هنا يكسر المعنى لا يصلحه.
 */
export function PaginationNav({
  basePath,
  page,
  pages,
  params,
}: {
  basePath: string;
  page: number;
  pages: number;
  /** مرشّحات الصفحة — تُحمَل معها كي لا تضيع عند الانتقال. */
  params: Record<string, string | string[] | undefined>;
}) {
  if (pages <= 1) return null;

  const href = (n: number): string => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (typeof v === "string" && v && k !== "page") qs.set(k, v);
    }
    qs.set("page", String(n));
    return `${basePath}?${qs.toString()}`;
  };

  /**
   * نافذة من خمس صفحات حول الحالية.
   * ⚠️ عرضُ الكل يكسر التخطيط عند 40 صفحة — وهو رقم واقعي في مجمّع
   * بـ500 شقة و25 صفّاً للصفحة.
   */
  const from = Math.max(1, Math.min(page - 2, pages - 4));
  const to = Math.min(pages, from + 4);
  const window = Array.from({ length: to - from + 1 }, (_, i) => from + i);

  return (
    <nav
      className="flex flex-wrap items-center justify-between gap-3"
      aria-label="تصفّح الصفحات"
    >
      <p className="text-theme-xs text-muted-foreground">
        صفحة <span className="tabular">{page}</span> من{" "}
        <span className="tabular">{pages}</span>
      </p>

      <div className="flex items-center gap-1">
        <Button
          asChild={page > 1}
          size="icon-sm"
          variant="outline"
          disabled={page <= 1}
          aria-label="الصفحة السابقة"
        >
          {page > 1 ? (
            <Link href={href(page - 1)}>
              <ChevronRight className="size-4" />
            </Link>
          ) : (
            <ChevronRight className="size-4" />
          )}
        </Button>

        {from > 1 ? <span className="px-1 text-muted-foreground">…</span> : null}

        {window.map((n) => (
          <Button
            key={n}
            asChild
            size="icon-sm"
            variant={n === page ? "default" : "ghost"}
            aria-current={n === page ? "page" : undefined}
          >
            <Link href={href(n)} className="tabular">
              {n}
            </Link>
          </Button>
        ))}

        {to < pages ? <span className="px-1 text-muted-foreground">…</span> : null}

        <Button
          asChild={page < pages}
          size="icon-sm"
          variant="outline"
          disabled={page >= pages}
          aria-label="الصفحة التالية"
        >
          {page < pages ? (
            <Link href={href(page + 1)}>
              <ChevronLeft className="size-4" />
            </Link>
          ) : (
            <ChevronLeft className="size-4" />
          )}
        </Button>
      </div>
    </nav>
  );
}
