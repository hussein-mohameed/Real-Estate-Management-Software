/**
 * استخراج اسم قيد قاعدة البيانات من خطأ Prisma.
 *
 * ── لماذا وحدة مشتركة ────────────────────────────────────────────────
 * ‏Prisma 7 يغلّف خطأ المحرّك في `PrismaClientKnownRequestError`، ويضع اسم
 * القيد في:
 *     meta.driverAdapterError.cause.originalMessage
 * بينما **رسالته الظاهرة لا تحويه إطلاقاً** — تبدأ بـ
 * «‏Invalid db.model.create() invocation».
 *
 * فالفحص الحدسي `String(error).includes("uniq_…")` **يفشل صامتاً**، فيتسرّب
 * خطأ Prisma خاماً إلى المستخدم بدل رسالة عربية. وقعت في هذا مرتين — في
 * الدفتر وفي إنشاء المستخدمين — قبل أن أستخرجه هنا.
 *
 * المسح **تعاودي** لا مسار مفترض: بنية Prisma الداخلية تتغيّر بين
 * الإصدارات، والمسار الثابت ينكسر بلا إنذار.
 */

/** يجمع كل نصّ داخل كائن الخطأ، مهما عمق. */
export function collectErrorText(error: unknown): string {
  const found: string[] = [];
  const seen = new WeakSet<object>();

  const walk = (value: unknown, depth: number): void => {
    if (depth > 8 || value == null) return;
    if (typeof value === "string") {
      found.push(value);
      return;
    }
    if (typeof value !== "object") return;
    if (seen.has(value as object)) return;
    seen.add(value as object);

    if (value instanceof Error) {
      found.push(value.message);
      walk((value as unknown as Record<string, unknown>)["meta"], depth + 1);
      walk((value as { cause?: unknown }).cause, depth + 1);
      return;
    }
    for (const v of Object.values(value as Record<string, unknown>)) walk(v, depth + 1);
  };

  walk(error, 0);
  return found.join(" | ");
}

/** هل خُرق هذا القيد بالاسم؟ */
export function violates(error: unknown, constraintName: string): boolean {
  return collectErrorText(error).includes(constraintName);
}

/** أول قيد مطابق من قائمة — لترجمة واحدة تخدم عدّة احتمالات. */
export function matchConstraint(
  error: unknown,
  constraints: readonly string[],
): string | null {
  const text = collectErrorText(error);
  return constraints.find((c) => text.includes(c)) ?? null;
}
