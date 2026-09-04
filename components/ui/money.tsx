import { cn } from "@/lib/cn";
import { formatIqd, formatIqdPlain } from "@/lib/money";

/**
 * **المكوّن الوحيد الذي يعرض مالاً** (‏§11.1).
 *
 * قاعدة ESLint تمنع `toLocaleString` على مبلغ في أي مكان آخر — لأن تنسيقاً
 * بديلاً في شاشة واحدة يُنتج رقمين مختلفين لنفس المبلغ، والمستخدم يرى
 * تناقضاً لا يعرف أيّه الصحيح.
 *
 * مكوّن خادم: يستقبل `bigint` مباشرةً بلا حاجة إلى تسلسل. لو احتاجه مكوّن
 * عميل فالقيمة تعبر الحدّ عبر `superjson` (‏lib/serialization).
 */
export function Money({
  value,
  suffix = true,
  signed = false,
  className,
}: {
  value: bigint;
  /** إخفاء «د.ع» في الجداول الضيّقة حيث العملة في رأس العمود. */
  suffix?: boolean;
  /** تلوين حسب الاتجاه: موجب = مستحقّ عليه، سالب = رصيد دائن له. */
  signed?: boolean;
  className?: string;
}) {
  const text = suffix ? formatIqd(value) : formatIqdPlain(value);
  const tone = !signed
    ? undefined
    : value > 0n
      ? "text-money-overdue"
      : value < 0n
        ? "text-money-paid"
        : undefined;

  return (
    <span
      className={cn("tabular whitespace-nowrap", tone, className)}
      // القيمة الخام للقراءة الآلية والنسخ — بلا فواصل ولا لاحقة
      data-iqd={value.toString()}
    >
      {text}
    </span>
  );
}
