/**
 * المال — الدينار العراقي.
 *
 * المبدأ 4 والقاعدة الأولى في 10-money-invariants:
 *   كل مبلغ `bigint` بالدينار الصحيح، بلا وحدة فرعية، بلا `float`، بلا `Decimal`.
 *   الاتجاه يحمله `LedgerEntry.type` لا إشارة الرقم — المبالغ موجبة دائماً.
 *
 * التنسيق يمرّ من هنا وحده. `toLocaleString` على مبلغ محظور بقاعدة ESLint،
 * لأن تنسيقاً بديلاً في شاشة واحدة يُنتج رقمين مختلفين لنفس المبلغ.
 */

/** لاحقة العملة كما تُعرض للمستخدم. */
export const IQD_SUFFIX = "د.ع";

/**
 * الأرقام **غربية** (‏123) لا هندية — تصحيح `T4`.
 * §11.1 قاعدة معيارية صريحة، والتعليق في §9.1 الذي يكتب ١٢٥٬٠٠٠ مثال عابر خاطئ.
 * لذلك المحلّية `en-US` للأرقام، والنصّ العربي حوله.
 */
const GROUPING = new Intl.NumberFormat("en-US", { useGrouping: true });

/** «125,000» — بلا لاحقة. للجداول والتصدير وحقول الإدخال. */
export function formatIqdPlain(value: bigint): string {
  return GROUPING.format(value);
}

/** «125,000 د.ع» — الشكل المعروض الوحيد. يُستدعى من مكوّن <Money> فقط. */
export function formatIqd(value: bigint): string {
  return `${formatIqdPlain(value)} ${IQD_SUFFIX}`;
}

/**
 * تحويل مُدخل المستخدم إلى `bigint`.
 * يقبل الفواصل والمسافات والأرقام الهندية (لأن لوحة المفاتيح العربية قد تنتجها)،
 * ويرفض أي كسر عشري — الدينار لا يقبل كسوراً.
 * يُعيد `null` عند أي مُدخل غير صالح؛ لا يرمي، لأن المتصل نموذج إدخال.
 */
export function parseIqd(input: string): bigint | null {
  if (typeof input !== "string") return null;

  // تطبيع الأرقام الهندية-العربية والفارسية إلى غربية
  const normalized = input
    .replace(/[٠-٩]/gu, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/gu, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\s,٬،]/gu, "") // مسافات وفواصل عربية ولاتينية
    .replace(new RegExp(IQD_SUFFIX, "gu"), "")
    .trim();

  if (normalized === "" || normalized === "-") return null;
  if (!/^-?\d+$/u.test(normalized)) return null; // يرفض 1.5 و1e3 و«abc»

  try {
    return BigInt(normalized);
  } catch {
    return null;
  }
}

/** جمع آمن. المتغيّر الابتدائي `0n` لا `0` — خلطهما خطأ نوعي شائع. */
export function sumIqd(values: readonly bigint[]): bigint {
  let total = 0n;
  for (const v of values) total += v;
  return total;
}

/**
 * ضرب مبلغ في كمية صحيحة.
 * الكمية `number` لأنها عدّ (أمبيرات، أشخاص) لا مال — لكنها **تُحوَّل إلى BigInt
 * قبل أي عملية**، فلا تمرّ أي خطوة وسيطة عبر `Number`. تحويل واحد يفقد الدقّة
 * فوق 2^53 ويُنتج فرقاً بالدينار (الخطوة 2.2).
 */
export function mulIqd(amount: bigint, quantity: number): bigint {
  if (!Number.isInteger(quantity)) {
    throw new RangeError(`الكمية يجب أن تكون عدداً صحيحاً، وصلت: ${quantity}`);
  }
  if (quantity < 0) {
    throw new RangeError(`الكمية لا يجوز أن تكون سالبة، وصلت: ${quantity}`);
  }
  return amount * BigInt(quantity);
}

/**
 * تقسيم مبلغ على عدد أقساط بالتساوي، **والباقي يُضاف إلى القسط الأخير**
 * ليطابق المجموع بالضبط — نصّ `R18` حرفياً.
 *
 * مثال المواصفة: 10,000,000 على 3 ← [3,333,333 · 3,333,333 · 3,333,334].
 * أي انحراف بدينار واحد يُنتج خلافاً مع العميل.
 *
 * ⚠️ **المبلغ المرجعي الذي يُقسَّم محجوب بالقرار `B1`** (هل هو `totalAmountIqd`
 * أم `totalAmountIqd − downPaymentIqd`؟). هذه الدالة تقسّم ما يُعطى لها ولا
 * تقرّر أيّهما — القرار في مسار إنشاء الخطة، لا هنا.
 */
export function splitEvenlyIqd(total: bigint, count: number): bigint[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(`عدد الأقساط يجب أن يكون صحيحاً ≥ 1، وصل: ${count}`);
  }
  if (total < 0n) {
    throw new RangeError(`المبلغ المُقسَّم لا يجوز أن يكون سالباً، وصل: ${total}`);
  }

  const n = BigInt(count);
  const base = total / n; // قسمة BigInt تقتطع، وهذا المقصود
  const parts = Array.from({ length: count }, () => base);
  const remainder = total - base * n;
  parts[count - 1] = base + remainder;
  return parts;
}

/** فحص الثابت «المبالغ موجبة دائماً» تطبيقياً — والقاعدة نفسها مفروضة بـCHECK في القاعدة. */
export function assertPositiveIqd(value: bigint, field = "amountIqd"): void {
  if (value <= 0n) {
    throw new RangeError(
      `${field} يجب أن يكون موجباً (‏CHECK في قاعدة البيانات)، وصل: ${value}`,
    );
  }
}

/** صفر الدينار — يُستعمل بدل `0n` الحرفي ليقرأ الكود كمال لا كعدد. */
export const ZERO_IQD = 0n;
